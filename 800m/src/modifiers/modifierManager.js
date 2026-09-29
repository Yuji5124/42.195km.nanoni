import { EV } from '../core/events.js';
import { REGISTRY, CATEGORY_ORDER, compatible } from './registry.js';
import { clamp, lerp } from '../core/mathx.js';

// ModifierManager: 動いている Modifier の一覧と寿命（start → update → stop → reset）。
// 時間はレース内の固定ステップ（1/60 秒）で進める → 同じ seed なら同じ順番・同じ長さで起きる。
// apply は毎フレーム: Presentation を defaults に戻した後、カテゴリ順に重ね書きする。
//
// 衝突の扱い:
//   同じスロット（camera / skin / pixel / sky / time …）→ 新しい方が勝つ（古い方はフェードアウト）
//   incompatible → 普段は起こさない。force（URL・開発パネル・節目のイベント）なら古い方を止める

export class ModifierManager {
  constructor(bus) {
    this.bus = bus;
    this.active = [];
    this.history = [];
    this.recent = [];
    this.serial = 0;
    this.maxCombo = 0;
  }

  reset() {
    for (const inst of this.active) inst.def.stop?.(inst, this.ctx ?? {});
    this.active = [];
    this.history = [];
    this.recent = [];
    this.maxCombo = 0;
  }

  get ids() {
    return this.active.filter((i) => !i.stopping).map((i) => i.id);
  }

  get running() {
    return this.active.filter((i) => !i.stopping);
  }

  has(id) {
    return this.active.some((i) => i.id === id && !i.stopping);
  }

  // 今この Modifier を起こせるか（理由の文字列 / null = 起こせる）
  blockedBy(id) {
    const def = REGISTRY.get(id);
    if (!def) return 'unknown';
    if (this.has(id)) return 'active';
    for (const inst of this.running) if (!compatible(def, inst.def) && !sharesSlotOnly(def, inst.def)) return inst.id;
    return null;
  }

  // opts: { intensity 0〜1, duration 秒, pinned（止まらない）, force, source, d（距離）, chaos 0〜1, rng }
  start(id, opts = {}) {
    const def = REGISTRY.get(id);
    if (!def) return null;
    const existing = this.active.find((i) => i.id === id);
    if (existing && !existing.stopping) {
      existing.dur = Math.max(existing.dur, existing.t + (opts.duration ?? 4));
      return existing;
    }
    if (existing) this.remove(existing);
    for (const inst of this.running) {
      if (compatible(def, inst.def)) continue;
      if (sharesSlotOnly(def, inst.def) || opts.force) this.stop(inst.id);
      else return null;
    }
    const rng = opts.rng;
    const r = () => (rng ? rng.next() : 0.5);
    const chaos = opts.chaos ?? 0.5;
    const [i0, i1] = def.intensity;
    const [d0, d1] = def.duration;
    const inst = {
      id,
      def,
      serial: ++this.serial,
      t: 0,
      dur: opts.duration ?? lerp(d0, d1, r()),
      intensity: clamp(opts.intensity ?? lerp(i0, i1, clamp(r() * (0.55 + chaos * 0.6), 0, 1)), 0, 1),
      env: 0,
      stopping: false,
      pinned: !!opts.pinned,
      source: opts.source ?? 'director',
      d: opts.d ?? 0,
      data: {},
      rng,
    };
    this.active.push(inst);
    def.start?.(inst, this.ctx ?? {});
    this.recent.push(id);
    if (this.recent.length > 5) this.recent.shift();
    if (!this.history.some((h) => h.id === id)) this.history.push({ id, name: def.nn.name, d: Math.round(inst.d), legendary: def.legendary, category: def.category });
    const count = this.running.length;
    this.maxCombo = Math.max(this.maxCombo, count);
    this.bus.emit(EV.MODIFIER_START, { id, category: def.category, intensity: +inst.intensity.toFixed(2), legendary: def.legendary, count, source: inst.source, d: Math.round(inst.d) });
    return inst;
  }

  stop(id, { instant = false } = {}) {
    const inst = this.active.find((i) => i.id === id && !i.stopping);
    if (!inst) return;
    inst.stopping = true;
    if (instant) this.remove(inst);
  }

  remove(inst) {
    const k = this.active.indexOf(inst);
    if (k < 0) return;
    this.active.splice(k, 1);
    inst.def.stop?.(inst, this.ctx ?? {});
    this.bus.emit(EV.MODIFIER_END, { id: inst.id, t: +inst.t.toFixed(2) });
  }

  // keep(inst) が true のものは残す（ラストのレジェンダリーなど）
  clear({ instant = false, keep = null } = {}) {
    for (const inst of this.active.slice()) {
      if (keep?.(inst)) continue;
      if (instant) this.remove(inst);
      else inst.stopping = true;
    }
  }

  // 固定ステップ（レース内の時間）
  step(dt, ctx) {
    this.ctx = ctx;
    for (const inst of this.active.slice()) {
      inst.t += dt;
      if (!inst.pinned && !inst.stopping && inst.t >= inst.dur) inst.stopping = true;
      const def = inst.def;
      if (inst.stopping) {
        inst.env -= dt / def.fadeOut;
        if (inst.env <= 0) {
          this.remove(inst);
          continue;
        }
      } else inst.env = Math.min(1, inst.env + dt / def.fadeIn);
      def.update?.(inst, dt, ctx);
    }
  }

  // 毎フレーム: Presentation へ書く
  apply(P, ctx) {
    this.ctx = ctx;
    const list = this.active.slice().sort((a, b) => CATEGORY_ORDER.indexOf(a.def.category) - CATEGORY_ORDER.indexOf(b.def.category) || a.serial - b.serial);
    for (const inst of list) {
      const e = inst.env;
      const k = inst.intensity * (e * e * (3 - 2 * e));
      inst.k = k;
      inst.def.apply(P, k, inst, ctx);
    }
  }
}

// スロットだけがかぶる（= 入れ替えてよい）
function sharesSlotOnly(a, b) {
  if (a.incompatible.includes(b.id) || b.incompatible.includes(a.id)) return false;
  return a.slots.some((s) => b.slots.includes(s));
}
