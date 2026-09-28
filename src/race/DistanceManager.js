import { CONFIG } from '../config.js';

// raceDistance（公式距離 km）とワールド座標を分離する唯一の場所。
// ワールドでは「s = コース上の前進量（単位）」、z = -s。
// 表示速度・レース時計もここで決める（ゲーム時間を圧縮しつつ、数字はマラソンらしく見せる）。
export class DistanceManager {
  constructor(goalKm) {
    this.goalKm = goalKm;
    this.fullKm = CONFIG.fullMarathonKm;
    this.reset();
  }

  reset() {
    this.raceTime = 0;
  }

  unitsToKm(s) {
    return (s * CONFIG.raceMetersPerUnit) / 1000;
  }

  kmToUnits(km) {
    return (km * 1000) / CONFIG.raceMetersPerUnit;
  }

  worldZ(s) {
    return -s;
  }

  get goalUnits() {
    return this.kmToUnits(this.goalKm);
  }

  // 巡航時に「20km/h」と表示されるよう、レース時計は一定倍率で進める。
  // 16u/s × 1.5 = 24m/s（ゲーム内） ÷ 5.56m/s（20km/h） ≒ 4.32 倍
  get timeScale() {
    const gameMps = CONFIG.player.cruise * CONFIG.raceMetersPerUnit;
    return gameMps / (CONFIG.displayCruiseKmh / 3.6);
  }

  displayKmh(speed) {
    return (speed / CONFIG.player.cruise) * CONFIG.displayCruiseKmh;
  }

  advanceClock(dt) {
    this.raceTime += dt * this.timeScale;
  }
}
