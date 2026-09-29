import { clamp, lerp, smoothstep } from '../core/math.js';

// 1500m 決勝の CPU ランナー（11 人）。重い AI は使わず「脚質ごとのペース表 + 集団のまとまり + ゆるいラバーバンド」だけ。
//
// レース展開の形（f = ゴールまでの進み具合 0〜1）
//   0 〜 300m   大集団（全員ほぼ同じペース + 集団の中心へ寄る）
//   300 〜 900m  脚質で分裂（逃げが前へ、追込は後ろへ）
//   900 〜 1350m 入れ替わり（逃げが落ち、先行・追込が上がる）
//   1350 〜 1450m 差が詰まる（プレイヤーとの差を縮める）
//   1450m 〜     ラストスパート（着順はプレイヤーの走り次第）

// pace: [集団, 分裂, 入れ替わり, スパート]（単位/秒。プレイヤーの巡航 = 16, ペースアップ = 18.5, ダッシュ = 24）
// 平均的なプレイヤー（ペースアップ中心 ≒ 17.2 + 声援ボーナス）が集団の中にいる強さ
export const ARCHETYPES = {
  start: { label: '逃げ', pace: [17.7, 18.1, 16.5, 18.9] },
  middle: { label: '先行', pace: [17.4, 17.4, 18.1, 20.1] },
  closer: { label: '追込', pace: [17.2, 16.7, 17.8, 20.9] },
  steady: { label: 'イーブン', pace: [17.4, 17.4, 17.4, 19.5] },
};

// index 0 はライバルの忍者（AIRunnerManager がプレイヤーの近くをキープさせる）
export const FIELD = [
  { name: '忍者', type: 'closer', rival: true },
  { name: '陸上部エース', type: 'start' },
  { name: '新聞配達', type: 'start' },
  { name: 'サラリーマン', type: 'middle' },
  { name: '大学生', type: 'middle' },
  { name: '市民ランナー', type: 'steady' },
  { name: 'お医者さん', type: 'closer' },
  { name: '八百屋', type: 'closer' },
  { name: '郵便屋さん', type: 'start' },
  { name: '公務員', type: 'steady' },
  { name: '観光客', type: 'middle' },
];

// フェーズの切り替え（f）
const KEYS = [
  [0.0, 0],
  [0.19, 0],
  [0.24, 1],
  [0.59, 1],
  [0.64, 2],
  [0.93, 2],
  [0.97, 3],
];

function paceAt(pace, f) {
  if (f <= KEYS[0][0]) return pace[KEYS[0][1]];
  for (let k = 1; k < KEYS.length; k++) {
    const [f1, p1] = KEYS[k];
    const [f0, p0] = KEYS[k - 1];
    if (f <= f1) return lerp(pace[p0], pace[p1], smoothstep(f0, f1, f));
  }
  return pace[KEYS[KEYS.length - 1][1]];
}

export class MiddleDistancePacer {
  constructor(n) {
    this.n = n;
    this.type = [];
    this.talent = new Float32Array(n);
    this.names = [];
  }

  // 12 人が横一列（ウォーターフォール）に並ぶ。プレイヤーは中央やや右
  setup(ai, rng, playerStart) {
    const slots = 12;
    const w = 11.6;
    const positions = [];
    for (let k = 0; k < slots; k++) {
      const x = -w / 2 + (k * w) / (slots - 1);
      // 外側ほど少し前（カーブしたスタートラインの見た目）
      const s = -1 + ((x + w / 2) / w) ** 2 * 0.9;
      positions.push({ x, s });
    }
    // プレイヤーに一番近い枠を空ける
    let pSlot = 0;
    for (let k = 1; k < slots; k++) if (Math.abs(positions[k].x - playerStart.x) < Math.abs(positions[pSlot].x - playerStart.x)) pSlot = k;
    playerStart.s = positions[pSlot].s;
    playerStart.x = positions[pSlot].x;
    const free = positions.filter((_, k) => k !== pSlot);
    // ライバル（忍者）はプレイヤーの隣の枠
    let near = 0;
    for (let k = 1; k < free.length; k++) if (Math.abs(free[k].x - playerStart.x) < Math.abs(free[near].x - playerStart.x)) near = k;
    const assign = [near, ...free.map((_, k) => k).filter((k) => k !== near)];
    for (let i = 0; i < ai.n; i++) {
      const pos = free[assign[i] ?? i] ?? { s: -3 - i, x: 0 };
      ai.s[i] = pos.s;
      ai.x[i] = pos.x;
      const def = FIELD[i % FIELD.length];
      this.type[i] = ARCHETYPES[def.type];
      this.names[i] = def.name;
      this.talent[i] = rng.range(-0.3, 0.3);
      ai.base[i] = this.type[i].pace[0];
    }
  }

  // 目標速度。ctx: { player, goalS, finalStretch }
  target(ai, i, ctx, packCenter) {
    const s = ai.s[i];
    const f = clamp(s / ctx.goalS, 0, 1.2);
    let v = paceAt(this.type[i].pace, f) + this.talent[i] * (f > 0.95 ? 0.5 : 1);
    v *= 1 + 0.02 * Math.sin(ai.time * ai.wave[i] + ai.waveOff[i]);

    // 大集団: 集団の中心へ寄る
    if (f < 0.22) v += clamp((packCenter - s) * 0.05, -0.6, 0.6);

    // プレイヤーと離れすぎない（画面に誰もいない時間を作らない）
    const gap = s - ctx.player.s;
    if (gap > 60) v -= Math.min(1.2, (gap - 60) * 0.025);
    else if (gap < -60) v += Math.min(1.6, (-gap - 60) * 0.03);
    // ライバル（忍者）は脚質どおりに走りつつ、プレイヤーの近くに寄ってくる
    if (FIELD[i]?.rival) v += clamp((2.5 - gap) * 0.12, -1.2, 1.2);

    // 1350m〜: 差が詰まる / 1450m〜: 接戦のスプリント
    if (f >= 0.9 && f < 0.967) v += clamp(-gap * 0.06, -1.8, 2.4);
    else if (f >= 0.967) v += clamp(-gap * 0.03, -1.0, 1.0);
    return v;
  }
}
