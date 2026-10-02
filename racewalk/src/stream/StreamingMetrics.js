// 配信の数字（three.js に依存しない）。
//   同接（CCU）= 20,300 × e^R × (1 + レースの盛り上がり)
//     R（届いている範囲・対数）… 面白い出来事（buzz）で上がる。炎上（heat）は R を「伸ばし続ける」（切り抜き・拡散）。
//     何も起きないと、R は少しずつ下がる（ただし一度来た人の一部は残る = 床が上がる）。
//   heat（炎上度 0〜12）… アンチに反応・言い返す・寝たふり … で上がり、放っておくと冷める。
//   trust（ファンの信頼 0〜1）… 真面目・結果で上がり、肝心なところでふざけると下がる。
//   登録者・スパチャ・高評価/低評価・コメント総数・推定切り抜き再生数 は CCU とこれらから流れで決まる。
// 炎上は失敗でも成功でもない: 数字は伸びる。アンチも低評価も増える。審判の注目・集中力の低下はゲーム側（RaceSim）へ。

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

export const CCU0 = 20300;
export const SUBS0 = 150000;
export const HEAT_LEVELS = [3, 6, 9]; // 小炎上 / 炎上 / 大炎上

export class StreamingMetrics {
  constructor({ rng, onSuperchat = () => {}, onEvent = () => {} } = {}) {
    this.rng = rng;
    this.onSuperchat = onSuperchat;
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    this.t = 0;
    this.R = 0;
    this.floor = 0;
    this.heat = 0;
    this.fun = 0;
    this.trust = 0.72;
    this.drama = 0.1;
    this.ccu = CCU0;
    this.ccuShown = CCU0;
    this.peak = CCU0;
    this.subs = SUBS0;
    this.sc = 0;
    this.scCount = 0;
    this.likes = 3120;
    this.dislikes = 41;
    this.comments = 0;
    this.flames = 0;
    this.flameArmed = true;
    this.level = 0;
    this.clipViews = 0;
    this.moments = [];
    this.lastBuzzT = 0;
    this.history = []; // [t, ccu]（グラフ用・2 秒ごと）
    this.histT = 0;
    this.milestone = CCU0;
    this.faceCam = true;
  }

  get heatLevel() {
    return this.heat >= HEAT_LEVELS[2] ? 3 : this.heat >= HEAT_LEVELS[1] ? 2 : this.heat >= HEAT_LEVELS[0] ? 1 : 0;
  }

  // 出来事（ACTION・レースの事件）: buzz = 届く範囲の伸び（R に足す）、heat、trust、fun
  impulse({ buzz = 0, heat = 0, trust = 0, fun = 0, label = null, clip = 1 } = {}) {
    // 届く範囲が広がるほど、同じ出来事で増える人は（割合として）少ない
    if (buzz > 0) buzz = Math.min(2.3, buzz * 0.8 * Math.max(0.04, 1 - this.R / 5));
    this.R += buzz;
    this.heat = clamp(this.heat + heat, 0, 12);
    this.trust = clamp(this.trust + trust, 0.02, 1);
    this.fun = clamp(this.fun + fun, 0, 3);
    if (buzz > 0.02) this.lastBuzzT = this.t;
    // 新しく来た人の一部はそのまま見ていく（床が上がる）
    this.floor = Math.max(this.floor, this.R * 0.55);
    // 登録者: その瞬間に見ていた人のうち少し
    this.subs += Math.max(0, buzz) * this.ccu * 0.04 * (0.5 + this.trust);
    if (label && buzz > 0.12) {
      const views = Math.round(buzz * this.ccu * 9 * clip * (0.8 + this.rng.next() * 0.5));
      this.clipViews += views;
      this.moments.push({ t: this.t, label, buzz, ccu: Math.round(this.ccu), views });
    }
  }

  // 毎フレーム。ctx: { drama, faceCam, racing }
  update(dt, ctx = {}) {
    this.t += dt;
    this.drama = ctx.drama ?? this.drama;
    this.faceCam = ctx.faceCam ?? true;
    const idle = this.t - this.lastBuzzT;
    // 拡散（炎上が続く間、R は伸び続ける。ただし上限に近づくほど伸びない）
    this.R += (this.heat * 0.0052 * Math.max(0, 1 - this.R / 4.6) + this.fun * 0.0012 * Math.max(0, 1 - this.R / 3.6)) * dt;
    // 退屈（何も起きない・背中しか映っていない）
    const bored = clamp((idle - 22) / 30) * (this.faceCam ? 0.5 : 1) + (this.faceCam ? 0 : 0.25);
    this.R -= Math.max(0, this.R - this.floor) * 0.006 * bored * dt + (this.faceCam ? 0 : 0.0012 * dt);
    this.R = Math.max(-0.35, this.R);
    this.heat = Math.max(0, this.heat - this.heat * 0.045 * dt - 0.01 * dt);
    this.fun = Math.max(0, this.fun - this.fun * 0.05 * dt);
    this.trust += (0.62 - this.trust) * 0.004 * dt;
    // 同接
    const target = CCU0 * Math.exp(this.R) * (1 + 1.0 * this.drama);
    const tau = target > this.ccu ? 2.6 : 7;
    this.ccu += (target - this.ccu) * (1 - Math.exp(-dt / tau));
    this.ccuShown = this.ccu * (1 + 0.006 * Math.sin(this.t * 1.7) + 0.004 * Math.sin(this.t * 4.3));
    if (this.ccu > this.peak) this.peak = this.ccu;
    // 桁が変わるような伸び
    if (this.ccu > this.milestone * 2.2) {
      this.milestone = this.ccu;
      this.onEvent('ccuSpike', { ccu: this.ccu });
    }
    // 炎上の段階
    const lv = this.heatLevel;
    if (lv !== this.level) {
      const up = lv > this.level;
      this.level = lv;
      this.onEvent('heat', { level: lv, up });
    }
    if (this.flameArmed && this.heat >= 5.5) {
      this.flameArmed = false;
      this.flames++;
      this.onEvent('flame', { n: this.flames });
    } else if (!this.flameArmed && this.heat < 3.2) this.flameArmed = true;
    // 登録者・評価・コメント
    const appeal = 0.45 + 0.55 * this.trust + 0.25 * this.fun - 0.06 * this.heat;
    this.subs += this.ccu * 0.00052 * Math.max(0.08, appeal) * dt;
    this.likes += this.ccu * 0.0011 * (0.35 + 0.4 * this.trust + 0.25 * this.fun) * dt;
    this.dislikes += this.ccu * 0.00011 * (0.15 + 0.45 * this.heat) * dt;
    this.comments += 3 * Math.pow(this.ccu / CCU0, 0.55) * (1 + 0.25 * this.heat + this.drama) * dt;
    // スパチャ
    const lam = 0.011 * Math.pow(this.ccu / CCU0, 0.85) * (1 + 0.35 * this.heat + 1.6 * this.drama + 0.5 * this.fun);
    if (this.rng.next() < lam * dt) this.spawnSuperchat();
    // 履歴
    this.histT += dt;
    if (this.histT >= 2) {
      this.histT = 0;
      this.history.push([Math.round(this.t), Math.round(this.ccu)]);
    }
  }

  spawnSuperchat(amount = null, extra = {}) {
    const a = amount ?? this.randomAmount();
    this.sc += a;
    this.scCount++;
    this.onSuperchat({ amount: a, ...extra });
    return a;
  }

  // 金額（小さいほど多い。炎上中は大きい額が増える）
  randomAmount() {
    const tiers = [200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const w = [30, 26, 20, 10, 7, 4, 2, 1].map((x, i) => x * (1 + (this.heat * 0.08 + this.drama * 0.2) * i * 0.6));
    let s = w.reduce((a, b) => a + b, 0) * this.rng.next();
    for (let i = 0; i < tiers.length; i++) {
      s -= w[i];
      if (s <= 0) return tiers[i];
    }
    return 500;
  }

  // 試合が終わった時の伸び（結果・最後の瞬間）
  finale({ place, dq }) {
    if (dq) this.impulse({ buzz: 0.5, heat: 2, label: '失格の瞬間', clip: 1.4 });
    else if (place === 1) this.impulse({ buzz: 0.35, trust: 0.15, fun: 0.4, label: '優勝の瞬間', clip: 1.2 });
    else if (place <= 3) this.impulse({ buzz: 0.25, trust: 0.08, fun: 0.2, label: 'メダル圏でフィニッシュ' });
    else this.impulse({ buzz: 0.06, trust: 0.02 });
  }

  snapshot() {
    return {
      ccu: Math.round(this.ccu),
      peak: Math.round(this.peak),
      subs: Math.round(this.subs),
      subsGain: Math.round(this.subs - SUBS0),
      sc: Math.round(this.sc),
      scCount: this.scCount,
      likes: Math.round(this.likes),
      dislikes: Math.round(this.dislikes),
      flames: this.flames,
      comments: Math.round(this.comments),
      clipViews: Math.round(this.clipViews),
      heat: this.heat,
      trust: this.trust,
      R: this.R,
    };
  }
}
