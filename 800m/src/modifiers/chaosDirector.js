import { EV } from '../core/events.js';
import { REGISTRY, compatible, resolveModifier } from './registry.js';
import { clamp, curve, lerp } from '../core/mathx.js';

// ChaosDirector: 「いつ・何を・いくつ」起こすかを決める演出家。
//   入力: プレイヤーの距離（raceProgress）/ 混沌度（chaosLevel）/ 最近起きたもの（recentModifiers）
//         プレイヤーの位置・順位 / スタミナ / 観客の盛り上がり
//   出力: ModifierManager.start / clear だけ（RaceCore には触れない）
// すべて seed の乱数（'chaos' ストリーム）とレース内の固定ステップで決まる → 同じ seed なら同じ演出。
//
// 800m の流れ:
//     0〜 80m  普通の陸上（号砲・スタートの緊張）
//    80〜120m  最初の小さな異変（一人だけ巨大な観客 / スコアボードが鏡文字）
//   200m〜     少しずつ増える
//   400m       大きく変わる（カメラ + 見た目 + 観客を同時に）
//   600m       いちばん混沌（3〜5 個が重なる）
//   720m       最大のイベント
//   760m       すべて片付く → 770m 画面が普通 → 780m UI が最小 → 790m 音楽が消える（game.js）

export const CHAOS_CURVE = [
  [0, 0.05],
  [100, 0.1],
  [200, 0.25],
  [300, 0.4],
  [400, 0.55],
  [500, 0.7],
  [600, 0.85],
  [700, 1.0],
  [750, 0.65],
  [780, 0.25],
  [800, 0],
];

export const FINALE = { clear: 760, normalScreen: 770, simpleUi: 780, musicFade: 790 };
export const LEGEND_CHANCE = 0.02; // 1〜3% の間

export class ChaosDirector {
  constructor(bus, manager) {
    this.bus = bus;
    this.manager = manager;
    this.level = 0;
  }

  // params: readParams() の { chaos, modifiers, legendary }
  reset(bank, params) {
    this.rng = bank.stream('chaos');
    const legendRng = bank.stream('legend');
    this.level = 0;
    this.levelStep = 0;
    this.cool = 1.5;
    this.fired = new Set();
    this.calm = false;
    this.firstAt = this.rng.range(80, 120);
    this.forced = params.chaos ?? null;
    this.pinned = (params.modifiers ?? []).map(resolveModifier).filter(Boolean);
    this.unknown = (params.modifiers ?? []).filter((m) => !resolveModifier(m));
    // ?modifier= だけの時は、その組み合わせだけを見る（演出家はお休み）
    this.enabled = this.forced !== 0 && !(this.pinned.length && this.forced === null);
    const legends = [...REGISTRY.values()].filter((d) => d.legendary);
    const roll = legendRng.next();
    const pickL = legends[Math.floor(legendRng.next() * legends.length)];
    this.legend = null;
    if (params.legendary) {
      const want = resolveModifier(params.legendary);
      this.legend = legends.find((d) => d.id === want) ?? pickL;
    } else if (roll < LEGEND_CHANCE) this.legend = pickL;
    if (this.forced === 0) this.legend = null;
  }

  // レース開始の瞬間（URL で指定された Modifier はずっと出しっぱなし）
  begin(d) {
    for (const id of this.pinned) this.manager.start(id, { pinned: true, force: true, source: 'url', d, intensity: REGISTRY.get(id).intensity[1], rng: this.rng });
  }

  targetCount(level, d) {
    const peak = d > 590 && d < 700 ? 0.6 : 0;
    return clamp(Math.floor(level * 4.4 + 0.25 + peak), 0, 5);
  }

  // 固定ステップ（1/60 秒）で呼ばれる。ctx: { core, cheer }
  step(dt, ctx) {
    const core = ctx.core;
    if (!core.running) return;
    const p = core.player;
    const d = p.d;
    let level = curve(CHAOS_CURVE, d);
    if (this.forced !== null && d < FINALE.clear) level = clamp(this.forced, 0, 1);
    this.level = level;
    const lstep = Math.floor(level * 4 + 1e-6);
    if (lstep > this.levelStep) this.bus.emit(EV.CHAOS_UP, { level: +level.toFixed(2), d: Math.round(d) });
    this.levelStep = lstep;

    // 760m: 全部片付けて、純粋なレースへ
    if (d >= FINALE.clear) {
      if (!this.calm) {
        this.calm = true;
        this.manager.clear({ keep: (i) => i.def.finale || i.pinned });
        this.bus.emit('CHAOS_CALM', { d: Math.round(d) });
      }
      return;
    }
    if (!this.enabled) return;
    const m = this.manager;
    const opts = (extra = {}) => ({ d, chaos: level, rng: this.rng, ...extra });

    // レジェンダリー（決まった距離で）
    if (this.legend && !this.fired.has('legend') && d >= this.legend.at) {
      this.fired.add('legend');
      m.start(this.legend.id, opts({ force: true, source: 'legendary' }));
    }
    // 節目
    if (this.forced === null) {
      if (!this.fired.has('first') && d >= this.firstAt) {
        this.fired.add('first');
        m.start(this.rng.chance(0.5) ? 'giantOne' : 'boardMirror', opts({ source: 'beat:first' }));
        this.cool = 3;
      }
      if (!this.fired.has('bell') && d >= 400) {
        this.fired.add('bell');
        this.bigChange(d, level, opts);
      }
      if (!this.fired.has('peak') && d >= 600) {
        this.fired.add('peak');
        const want = this.rng.int(4, 5);
        for (let n = 0; n < 6 && m.running.length < want; n++) this.spawn(d, level, opts({ source: 'beat:peak' }));
      }
      if (!this.fired.has('climax') && d >= 720) {
        this.fired.add('climax');
        if (!(this.legend && this.legend.at >= 690)) this.climax(d, level, opts);
      }
    }

    // 普段の抽選: 混沌度に合わせて「同時にいくつ」を保つ
    this.cool -= dt;
    const early = this.forced === null ? d < 200 : d < 20;
    if (early || this.cool > 0) return;
    if (m.running.length < this.targetCount(level, d)) {
      this.spawn(d, level, opts({ source: 'director' }));
      this.cool = lerp(3.4, 1.2, level) + this.rng.next() * 1.2;
    }
  }

  // 候補の重み: 基本の weight × 相性の良い相手がいる × 同じカテゴリが多いと減る × 距離に合う
  candidates(d, { category = null, big = null } = {}) {
    const m = this.manager;
    const running = m.running;
    const out = [];
    for (const def of REGISTRY.values()) {
      if (def.legendary || def.weight <= 0) continue;
      if (category && def.category !== category) continue;
      if (big !== null && def.big !== big) continue;
      if (d < def.minDistance || d > def.maxDistance) continue;
      if (m.recent.includes(def.id) || m.has(def.id)) continue;
      if (!running.every((i) => compatible(def, i.def))) continue;
      let w = def.weight;
      if (running.some((i) => def.synergy.includes(i.id) || i.def.synergy.includes(def.id))) w *= 2.4;
      const same = running.filter((i) => i.def.category === def.category).length;
      w *= Math.pow(0.4, same);
      if (def.big && d < 600) w *= 0.5;
      out.push({ item: def.id, w });
    }
    return out;
  }

  spawn(d, level, opts) {
    const list = this.candidates(d);
    if (!list.length) return null;
    return this.manager.start(this.rng.weighted(list), opts);
  }

  // 400m: カメラ + 見た目 + 観客をいっぺんに
  bigChange(d, level, opts) {
    const m = this.manager;
    m.clear({ keep: (i) => i.pinned || i.def.legendary });
    for (const category of ['CAMERA', 'VISUAL', 'CROWD']) {
      const list = this.candidates(d, { category, big: false });
      if (list.length) m.start(this.rng.weighted(list), opts({ source: 'beat:bell', duration: this.rng.range(8, 10), force: true }));
    }
    this.cool = 4;
  }

  // 720m: いちばん大きな出来事（ジャンルごと変わる / 世界がねじれる …）+ もう 1 つ
  climax(d, level, opts) {
    const m = this.manager;
    const list = this.candidates(d, { big: true });
    const all = [...REGISTRY.values()].filter((x) => x.big && !x.legendary && d <= x.maxDistance);
    const id = list.length ? this.rng.weighted(list) : all.length ? this.rng.pick(all).id : null;
    if (id) m.start(id, opts({ source: 'beat:climax', force: true, duration: 7, intensity: 1 }));
    this.spawn(d, level, opts({ source: 'beat:climax' }));
    this.cool = 3;
  }

  // 開発パネルの Next Modifier: 距離の条件を無視して 1 つ
  next(d) {
    const list = [];
    for (const def of REGISTRY.values()) {
      if (def.legendary || this.manager.has(def.id)) continue;
      list.push({ item: def.id, w: def.weight || 0.2 });
    }
    if (!list.length) return null;
    return this.manager.start(this.rng.weighted(list), { d, chaos: this.level, rng: this.rng, force: true, source: 'dev' });
  }
}
