// 時計。レース（RaceCore）は常に 1/60 秒の固定ステップで進む → 表示がどれだけ壊れても結果は同じ。
//   simScale … 世界の時間の速さ（「時間が遅いのに。」など）。全員に等しくかかるので公平
//   fast     … 自動テスト用。1 フレームで何倍進めるか（?fast=4）

export const STEP = 1 / 60;

export class Clock {
  constructor({ fast = 1 } = {}) {
    this.fast = fast;
    this.acc = 0;
    this.simTime = 0;
    this.realTime = 0;
    this.frame = 0;
    this.last = performance.now();
    this.frozen = false;
    this.stepOnce = false;
  }

  // 実時間の経過を受け取り、今フレームで進める固定ステップ数を返す
  tick(now, simScale = 1) {
    const realDt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.realTime += realDt;
    this.frame++;
    this.realDt = realDt;
    if (this.frozen) {
      if (this.stepOnce) {
        this.stepOnce = false;
        return 1;
      }
      return 0;
    }
    this.acc += realDt * simScale * this.fast;
    let steps = Math.floor(this.acc / STEP);
    this.acc -= steps * STEP;
    const cap = 6 * this.fast;
    if (steps > cap) {
      steps = cap;
      this.acc = 0;
    }
    return steps;
  }
}
