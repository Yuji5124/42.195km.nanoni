import { clamp } from '../core/math.js';

// 声援（CHEER）。速さだけでなく「どれだけ大会を盛り上げたか」を測る。
// - cheer: 累計スコア
// - combo: 3 秒以内に連続した見せ場で倍率アップ
// - excitement (0..1): 街全体の盛り上がり。観客の動き・フラッシュ・紙吹雪・ランナーの発光・音量に反映
// - tier (0..5): 拍手 → 歓声 → スマホ撮影 → 大歓声 → 紙吹雪

// combo: false の行動はコンボを伸ばさない（スタート直後の大量追い抜きでコンボが暴走しないように）
const ACTIONS = {
  overtake: { base: 6, label: 'OVERTAKE', combo: false },
  multiOvertake: { base: 30, label: 'MULTI OVERTAKE' },
  nearMiss: { base: 40, label: 'NEAR MISS' },
  leapfrog: { base: 65, label: 'LEAPFROG' },
  clear: { base: 25, label: 'CLEAR' },
  perfectClear: { base: 55, label: 'PERFECT JUMP' },
  bigJump: { base: 35, label: 'BIG JUMP' },
  recovery: { base: 90, label: 'COMEBACK!' },
  token: { base: 30, label: '♪ CHEER' },
  takeLead: { base: 150, label: 'TOP RUNNER!' },
  duel: { base: 45, label: 'DUEL!' },
  pickup: { base: 20, label: 'GET!' },
  finalSprint: { base: 60, label: 'FINAL SPRINT' },
  highFive: { base: 15, label: 'HIGH FIVE', combo: false },
  nyanJump: { base: 45, label: 'NYAN JUMP' },
  wan: { base: 18, label: 'WAN!' },
  manners: { base: 250, label: 'MANNERS!' },
  ignoreSignal: { base: -150, label: '信号無視…' },
  trainPass: { base: 80, label: 'TRAIN OVERTAKE' },
  trainBeat: { base: 400, label: '電車に勝った!' },
  leapCar: { base: 150, label: 'CAR JUMP!?' },
  giantDog: { base: 60, label: 'デカ柴!!' },
};

export class CheerSystem {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.cheer = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.heat = 0;
    this.excitement = 0.15;
    this.tier = 0;
    this.multiplier = 1;
    this.passiveAcc = 0;
  }

  get comboMultiplier() {
    return 1 + Math.min(this.combo, 20) * 0.1;
  }

  add(kind, opts = {}) {
    const a = ACTIONS[kind];
    if (!a) return 0;
    const base = (opts.base ?? a.base) * (opts.scale ?? 1);
    // マイナス（ブーイング）: 倍率なしで減点し、コンボと盛り上がりを冷ます
    if (base < 0) {
      const amount = Math.max(-this.cheer, Math.round(base));
      this.cheer += amount;
      this.combo = 0;
      this.comboTimer = 0;
      this.heat = Math.max(0, this.heat - 0.4);
      this.bus.emit('cheer', { kind, amount, label: opts.label ?? a.label, combo: 0, multiplier: 1 });
      return amount;
    }
    const countsCombo = opts.combo ?? a.combo ?? true;
    if (countsCombo) {
      this.combo += 1;
      this.comboTimer = 3.2;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }
    const amount = Math.round(base * this.multiplier * this.comboMultiplier);
    this.cheer += amount;
    // ただの追い抜き等（コンボ対象外）は街の盛り上がりへの寄与を小さく
    this.heat = clamp(this.heat + (base / 380) * (countsCombo ? 1 : 0.25), 0, 1.2);
    this.bus.emit('cheer', {
      kind,
      amount,
      label: opts.label ?? a.label,
      combo: this.combo,
      multiplier: this.multiplier,
    });
    return amount;
  }

  // ctx: { position, total, cheerMul, crowdDensity, nearCrowd, calm, finalStretch, running }
  update(dt, ctx) {
    this.multiplier = ctx.cheerMul ?? 1;

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && this.combo > 0) {
        this.bus.emit('comboEnd', { combo: this.combo });
        this.combo = 0;
      }
    }

    if (ctx.running) {
      // 先頭ほど注目される → 1 位を走る明確なメリット
      const frac = 1 - (ctx.position - 1) / Math.max(1, ctx.total - 1);
      let rate = 2 + Math.pow(frac, 4) * 18;
      if (ctx.position === 1) rate = 55;
      else if (ctx.position <= 3) rate = 28;
      else if (ctx.position <= 10) rate = Math.max(rate, 12);
      if (ctx.nearCrowd) rate += 10 * ctx.crowdDensity;
      if (ctx.finalStretch) rate *= 1.5;
      this.passiveAcc += rate * this.multiplier * dt;
      if (this.passiveAcc >= 1) {
        const whole = Math.floor(this.passiveAcc);
        this.cheer += whole;
        this.passiveAcc -= whole;
      }
      this.heat += (ctx.position <= 3 ? 0.03 : 0) * dt + (ctx.nearCrowd ? 0.02 : 0) * dt;
    }

    this.heat = clamp(this.heat - dt * 0.05, 0, 1.2);
    const base = 0.1 + 0.18 * clamp(ctx.crowdDensity ?? 0.5, 0, 1.6);
    const target = clamp(base + this.heat * 0.8 + (ctx.finalStretch ? 0.35 : 0), 0, 1);
    this.excitement += (target - this.excitement) * (1 - Math.exp(-dt * 1.6));

    const tier = Math.min(5, Math.floor(this.excitement * 5.5));
    if (tier !== this.tier) {
      const up = tier > this.tier;
      this.tier = tier;
      this.bus.emit('cheerTier', { tier, up });
    }
  }

  hype(v) {
    this.heat = clamp(this.heat + v, 0, 1.2);
  }

  // 声援の後押し（ほんの少しだけ速くなる）
  get powerBonus() {
    return this.tier * 0.22;
  }
}
