import { damp } from '../../src/core/math.js';

// 2 つの時計:
//   UI / 入力の時間（realDt）… タイピング・カメラ・HUD・演出の文字。スローでも普通の速さ
//   世界の時間（gameDt）   … 選手・ベッド・観客・花火・飛行機。スロー・ヒットストップの対象
// gameDt = realDt × scale。ヒットストップ中は 0。

export class TrampolineTime {
  constructor() {
    this.reset();
  }

  reset() {
    this.scale = 1;
    this.target = 1;
    this.rate = 6;
    this.hitStop = 0;
    this.real = 0;
    this.game = 0;
  }

  // 一瞬止める（踏み込みの手応え）
  hit(seconds) {
    this.hitStop = Math.max(this.hitStop, seconds);
  }

  // 世界の速さの目標（rate: 追従の速さ。大きいほど急に変わる）
  to(scale, rate = 6) {
    this.target = scale;
    this.rate = rate;
  }

  snap(scale) {
    this.scale = this.target = scale;
  }

  update(realDt) {
    this.real += realDt;
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - realDt);
      return 0;
    }
    this.scale = damp(this.scale, this.target, this.rate, realDt);
    if (Math.abs(this.scale - this.target) < 0.002) this.scale = this.target;
    const g = realDt * this.scale;
    this.game += g;
    return g;
  }
}
