import { PERSONALITIES } from '../data/personalities.js';
import { PHYS } from '../race/physiology.js';
import { laneCenter, MAX_OFF, isBend } from '../race/trackLogic.js';
import { clamp, curve } from '../core/mathx.js';

// Bot: 性格（data/personalities.js）から「意図」（努力度・スパート・目標レーン）を作る。
// 重い AI は使わない: 距離ごとのペース曲線 + 周りの状況への反応 + 追い越しのためのレーン変更だけ。
// プレイヤーの自動操縦（?autopilot）も同じ Bot を使う → 必ず完走できる。
//
// env: { crowd 0〜1, cheer 0〜100, chaos 0〜1, cameraSubject: runnerIndex | -1 }

// CPU 全体の底上げ（上手いプレイヤーが「勝てるけど楽勝ではない」くらい）
const PACE_BONUS = 0.018;

const MYSTERY_POOL = ['SPRINTER', 'PACER', 'CHASER', 'SHOWMAN', 'PANIC', 'LATE', 'CAMERA', 'QUIET', 'CHAOS', 'DRAFTER'];

export class Bot {
  constructor(runnerDef, rng) {
    let id = runnerDef.personality;
    if (PERSONALITIES[id]?.mystery) {
      // 毎レース別の性格（seed で決まる）
      this.mysteryAs = rng.pick(MYSTERY_POOL);
      id = this.mysteryAs;
    }
    this.p = PERSONALITIES[id];
    this.personality = id;
    this.rng = rng;
    this.passTimer = 0;
    this.wobble = rng.range(0, 10);
    this.talent = rng.range(0.985, 1.015);
  }

  // 自動操縦（プレイヤー用）: 普通のペース → 600m から攻め → 700m 台でスパート。リズム入力も合わせる
  static autopilot(style = 'good', rng = null) {
    const b = Object.create(Bot.prototype);
    b.p =
      style === 'naive'
        ? { pace: [[0, 0.78], [600, 0.85]], kick: { at: 740, stamina: 4 }, inside: 0.5, sense: {} }
        : { pace: [[0, 0.82], [560, 0.83], [620, 0.88]], kick: { at: 715, stamina: 8 }, inside: 0.7, sense: {} };
    b.personality = 'AUTOPILOT';
    b.passTimer = 0;
    b.wobble = 0;
    b.talent = 1;
    b.rhythm = style !== 'naive';
    b.rng = rng;
    return b;
  }

  intent(core, r, env = {}) {
    const p = this.p;
    const d = r.d;
    let e = curve(p.pace, d) + (this.personality === 'AUTOPILOT' ? 0 : PACE_BONUS);
    const s = p.sense ?? {};
    if (s.crowd) e += s.crowd * ((env.crowd ?? 0.5) - 0.4) * 2;
    if (s.quiet) e += s.quiet * (0.6 - (env.crowd ?? 0.5)) * 2;
    if (s.chaos) e += s.chaos * (env.chaos ?? 0);
    if (s.camera && env.cameraSubject === r.index) e += s.camera;
    if (s.panic) {
      // 後ろ 2m 以内に誰かいると焦る
      for (const o of core.runners) {
        const gap = r.d - o.d;
        if (o !== r && gap > 0 && gap < 2.0 && Math.abs(o.off - r.off) < 1.2) {
          e += s.panic;
          break;
        }
      }
    }
    // 前の選手（ほぼ同じレーンにいる人だけ。真横を走っている人は「前」ではない）
    let ahead = null;
    let aheadGap = Infinity;
    for (const o of core.runners) {
      const gap = o.d - r.d;
      if (o !== r && !o.finished && gap > 0.3 && gap < aheadGap && Math.abs(o.off - r.off) < 0.9) {
        ahead = o;
        aheadGap = gap;
      }
    }
    if (s.chase && ahead && aheadGap < 8) {
      // 前の選手の真後ろ 1.2m を保つ
      e = clamp(e + (aheadGap - 1.2) * 0.05, 0.6, 0.95);
    }
    // スタミナの安全装置（尽きると本当に遅い）
    if (r.stamina < 22 && d < p.kick.at - 40) e = Math.min(e, 0.72);
    if (r.stamina < 10 && d < 760) e = Math.min(e, 0.66);
    e += Math.sin(core.time * 0.4 + this.wobble) * 0.012;
    e = clamp(e, 0.5, PHYS.effort.push);

    // 終盤は残りのスタミナを使い切る（残り 1m あたりのスタミナで、攻め / スパートを決める）
    //   スパートは 1m あたり約 0.9 使う → 走り切れる分があればスパート、なければ攻め
    //   最後の 40m は全員が全力（ここが本当のレース）
    const remain = Math.max(1, 800 - d);
    const perM = r.stamina / remain;
    let burst = d >= p.kick.at && perM > 0.8;
    if (d > 600) {
      if (perM > 0.95) burst = true;
      else if (perM > 0.2) e = Math.max(e, PHYS.effort.push);
    }
    if (d >= 760 && r.stamina > 2) burst = true;

    // レーン: 基本は内側。前が詰まっていて自分の方が速い → 外へ出て抜く
    const inside = laneCenter(1) + (1 - (p.inside ?? 0.7)) * 1.4;
    let targetOff = r.targetOff ?? r.off;
    if (d > 60 || core.startDistance > 0) targetOff = inside;
    if (this.passTimer <= 0 && (r.blocked || (ahead && aheadGap < 2.4 && (s.chase ? false : e > ahead.effortEff + 0.02)))) {
      // 外から抜く。外に余裕がなければ内から（大外に張り付かない）
      const base = ahead ? ahead.off : r.off;
      this.passTimer = 2.2;
      this.passOff = base + 1.15 <= MAX_OFF - 1.0 ? base + 1.15 : clamp(base - 1.15, 0, MAX_OFF);
    }
    if (s.chase && ahead && aheadGap < 6 && !r.blocked) targetOff = ahead.off; // 真後ろへ（ドラフト）
    if (this.passTimer > 0) {
      this.passTimer -= 1 / 60;
      targetOff = this.passOff;
    }
    // カーブの途中で大きく外へ出るのは損 → 抜き終わったら内へ
    if (!isBend(d) && this.passTimer <= 0 && !s.chase) targetOff = inside;

    let step = false;
    if (this.rhythm) {
      // 自動操縦: 接地のちょうど手前で押す（PERFECT 狙い）
      const f = r.phase - Math.floor(r.phase);
      const before = (1 - f) / Math.max(0.1, r.stepFreq);
      // 人間らしく、たまにずれる
      const jitter = this.rng ? (this.rng.next() < 0.25 ? 2 : 0) : 0;
      step = before < (1 + jitter) / 60 && before >= jitter / 60 && r.v > 3;
    }
    return { effort: e, burst, targetOff, step };
  }
}
