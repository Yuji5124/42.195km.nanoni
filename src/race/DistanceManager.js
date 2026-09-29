import { CONFIG } from '../config.js';

// raceDistance（公式距離 km）とワールド座標を分離する唯一の場所。
// ワールドでは「s = コース上の前進量（単位）」、z = -s。
// 表示速度・レース時計もここで決める（ゲーム時間を圧縮しつつ、数字はマラソンらしく見せる）。
// モードごとに縮尺が違う（42.195km: 1 単位 = 1.5m / 1500m: 1 単位 = 0.3m）。
export class DistanceManager {
  constructor(goalKm, { metersPerUnit = CONFIG.raceMetersPerUnit, displayCruiseKmh = CONFIG.displayCruiseKmh, fullKm = CONFIG.fullMarathonKm } = {}) {
    this.goalKm = goalKm;
    this.fullKm = fullKm;
    this.metersPerUnit = metersPerUnit;
    this.displayCruiseKmh = displayCruiseKmh;
    this.reset();
  }

  reset() {
    this.raceTime = 0;
  }

  unitsToKm(s) {
    return (s * this.metersPerUnit) / 1000;
  }

  kmToUnits(km) {
    return (km * 1000) / this.metersPerUnit;
  }

  worldZ(s) {
    return -s;
  }

  get goalUnits() {
    return this.kmToUnits(this.goalKm);
  }

  // 巡航時に displayCruiseKmh と表示されるよう、レース時計は一定倍率で進める。
  // 42.195km: 16u/s × 1.5 = 24m/s（ゲーム内） ÷ 5.56m/s（20km/h） ≒ 4.32 倍
  // 1500m:    16u/s × 0.3 = 4.8m/s ÷ 6.67m/s（24km/h） = 0.72 倍
  get timeScale() {
    const gameMps = CONFIG.player.cruise * this.metersPerUnit;
    return gameMps / (this.displayCruiseKmh / 3.6);
  }

  displayKmh(speed) {
    return (speed / CONFIG.player.cruise) * this.displayCruiseKmh;
  }

  advanceClock(dt) {
    this.raceTime += dt * this.timeScale;
  }
}
