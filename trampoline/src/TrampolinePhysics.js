import { clamp } from '../../src/core/math.js';

// トランポリンの物理（見た目の気持ちよさ優先の疑似物理）。
//   選手の足の高さ y と速度 vy、ベッドの沈み d。
//   空中: 重力だけ。
//   接触中: ベッドはばね（k）。沈むほど強く押し返す → 「沈む → 張る → 弾む」。
//     SPACE（踏み込み）を押すと脚で踏み込む力が加わり、さらに深く沈む → 底で溜めたエネルギーで高く跳ぶ。
//   跳ぶ高さの最終調整は底で行う（踏み込みのタイミングと強さで決まる。数値計算の誤差で弱まらない）。
//
// 単位: m / s。BED.top がベッドの表面の高さ（沈んでいない時）

export const BED = { top: 1.15, halfX: 2.3, halfZ: 1.2 };
export const PHYS = {
  g: 9.8,
  k: 150, // ばね（接触時間 ≈ 0.26 秒）
  damp: 1.2,
  idleApex: 0.55, // 何もしない時の小さな弾み
  stompPush: 55, // 踏み込みの力（沈みを深くする）
  legPush: 35, // 底から戻る時に脚で蹴る力（これが無いとベッドの上で揺れるだけで離れない）
};

export class TrampolinePhysics {
  constructor() {
    this.reset();
  }

  reset() {
    this.y = BED.top; // 足の高さ
    this.vy = 0;
    this.d = 0; // ベッドの沈み（下向き +）
    this.dv = 0;
    this.contact = true;
    this.maxD = 0;
    this.stomping = false;
    this.nextApex = PHYS.idleApex;
    this.launchV = 0;
    this.events = [];
  }

  // 次に底から跳ぶ時の目標の高さ（ベッドの表面から、m）
  setNextApex(h) {
    this.nextApex = h;
  }

  // dt: 世界の時間 / stomp: 踏み込み中（脚で押している）
  step(dt, stomp = false) {
    this.events.length = 0;
    const { g, k } = PHYS;
    if (!this.contact) {
      this.vy -= g * dt;
      this.y += this.vy * dt;
      // ベッドは自由に揺れて元に戻る
      this.dv += (-k * this.d - PHYS.damp * 6 * this.dv) * dt;
      this.d += this.dv * dt;
      if (this.vy < 0 && this.y <= BED.top - this.d) {
        this.contact = true;
        this.maxD = 0;
        this.events.push({ type: 'touch', v: -this.vy });
        this.d = BED.top - this.y;
        this.dv = -this.vy;
      }
      return this.events;
    }
    // 接触中: 足とベッドの面は一緒に動く
    this.stomping = stomp;
    const push = stomp && this.vy < 0.5 ? PHYS.stompPush : 0;
    const legs = this.vy >= 0 && this.launchV > 0 ? PHYS.legPush : 0;
    const a = k * this.d - g - push + legs - PHYS.damp * this.vy * 0.2;
    const prevVy = this.vy;
    this.vy += a * dt;
    this.y += this.vy * dt;
    this.d = BED.top - this.y;
    this.dv = -this.vy;
    this.maxD = Math.max(this.maxD, this.d);
    // 底（下向き → 上向きに変わった瞬間）: ここで跳ぶ高さを決める
    if (prevVy < 0 && this.vy >= 0) {
      this.events.push({ type: 'bottom', depth: this.maxD });
      // 表面を離れる時に nextApex に届く速さ + 沈みの分
      const v0 = Math.sqrt(2 * g * Math.max(0.05, this.nextApex));
      this.launchV = v0;
    }
    // 表面より上に戻った → 離陸
    if (this.d <= 0 && this.vy > 0) {
      this.contact = false;
      this.d = 0;
      this.y = BED.top;
      if (this.launchV) this.vy = this.launchV;
      this.launchV = 0;
      this.events.push({ type: 'takeoff', v: this.vy, apex: (this.vy * this.vy) / (2 * g) });
    }
    return this.events;
  }

  // 今のまま飛んだ時の頂点の高さ（ベッド表面から）
  get apex() {
    return this.contact ? 0 : this.y - BED.top + Math.max(0, this.vy) ** 2 / (2 * PHYS.g);
  }

  get height() {
    return Math.max(0, this.y - BED.top);
  }

  // 空中で残り何秒で着地するか（世界の時間）
  timeToLand() {
    if (this.contact) return 0;
    const h = this.y - BED.top;
    const { g } = PHYS;
    return (this.vy + Math.sqrt(Math.max(0, this.vy * this.vy + 2 * g * h))) / g;
  }

  // 無理やり上へ（天井 OPEN 後の超反発など）
  kick(v) {
    this.vy = v;
    this.contact = false;
  }

  clampDepth() {
    this.d = clamp(this.d, -0.3, 1.6);
  }
}
