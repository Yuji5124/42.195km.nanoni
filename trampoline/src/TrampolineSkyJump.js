import * as THREE from 'three';
import { clamp } from '../../src/core/math.js';
import { TrampolineSkyWorld } from './TrampolineSkyWorld.js';

// SKY JUMP: 天井が開いたあとの超反発で、競技場の外へ。
//   rise（上昇）→ hang（最高点: 宇宙）→ fall（帰ってくる。← → で会場の真上に合わせる）→ 会場へ戻る
// 選手は高さ BASE に止めたまま、世界（world グループ = 会場・街・雲）の方を下へずらして縮める:
//   k = min(1, 600 / 高度) / world.scale = k / world.y = BASE − 高度 × k
//   → 見かけの大きさ（角度）は本物どおり、数値はいつも小さい（何十 km 上空でも描画が安定）
// 高度が高い間は会場の中身（観客席・観客・審判…）を描画しない。

export const BASE = 60; // m: ここから上は「空」
export const PEAK = 120000; // m: 最高点（宇宙）
const T_RISE = 9;
const T_HANG = 2.6;
const T_FALL = 11;

export const ZONES = [
  { id: 'STADIUM', alt: 0 },
  { id: 'CITY', alt: 60 },
  { id: 'CLOUD', alt: 1000 },
  { id: 'SKY', alt: 4000 },
  { id: 'STRATOSPHERE', alt: 15000 },
  { id: 'SPACE', alt: 90000 },
];

export function zoneOf(alt) {
  let z = ZONES[0];
  for (const zz of ZONES) if (alt >= zz.alt) z = zz;
  return z.id;
}

const easeOut = (u) => 1 - Math.pow(1 - u, 3);
const easeIn = (u) => u * u * (1.6 - 0.6 * u);

export class TrampolineSkyJump {
  constructor(world, arena, rng) {
    this.world = world;
    this.arena = arena;
    this.rng = rng;
    this.layer = new TrampolineSkyWorld(world);
    this.active = false;
    this.alt = 0;
    this.drift = new THREE.Vector2();
    this.wind = new THREE.Vector2();
    this.time = 0;
  }

  start() {
    this.active = true;
    this.stage = 'rise';
    this.t = 0;
    this.alt = BASE;
    this.zone = 'CITY';
    this.drift.set(0, 0);
    // 風（帰り道で横へ流される）: 向きがゆっくり変わる
    this.windA = this.rng.next() * Math.PI * 2;
    this.layer.setVisible(true);
  }

  // 帰る時のずれ（m）→ 着地の出来
  get returnGrade() {
    const d = this.drift.length();
    return d < 1.3 ? 'PERFECT' : d < 4 ? 'GOOD' : 'EDGE';
  }

  // realDt: 実時間（空の旅は実時間の台本）/ steer: ← → の入力（-1〜1）/ steerZ: 奥・手前
  update(realDt, steer = 0, steerZ = 0) {
    if (!this.active) return null;
    this.t += realDt;
    this.time += realDt;
    const span = Math.log(PEAK / BASE);
    let ev = null;
    if (this.stage === 'rise') {
      const u = Math.min(1, this.t / T_RISE);
      this.alt = BASE * Math.exp(span * easeOut(u));
      if (u >= 1) {
        this.stage = 'hang';
        this.t = 0;
        ev = 'peak';
      }
    } else if (this.stage === 'hang') {
      this.alt = PEAK * (1 + Math.sin((this.t / T_HANG) * Math.PI) * 0.02);
      if (this.t >= T_HANG) {
        this.stage = 'fall';
        this.t = 0;
        ev = 'fall';
        // 最初から少しずれている（風）
        this.drift.set((this.rng.next() < 0.5 ? -1 : 1) * (2 + this.rng.next() * 3), 0);
      }
    } else if (this.stage === 'fall') {
      const u = Math.min(1, this.t / T_FALL);
      this.alt = BASE * Math.exp(span * (1 - easeIn(u)));
      // 風に流される → ← → で戻す
      this.windA += (this.rng.next() - 0.5) * realDt * 2.4;
      const gust = 0.9 + Math.sin(this.time * 1.3) * 0.5;
      this.wind.set(Math.cos(this.windA) * gust * 1.1, 0); // 横風だけ（← → で戻す）
      this.drift.addScaledVector(this.wind, realDt);
      this.drift.x -= steer * 2.8 * realDt;
      this.drift.y -= steerZ * 2.8 * realDt;
      this.drift.clampLength(0, 14);
      if (u >= 1) {
        this.alt = BASE;
        this.stage = 'done';
        ev = 'enter';
      }
    }
    // 世界を縮めて下へ
    const k = Math.min(1, 600 / this.alt);
    this.k = k;
    this.world.scale.setScalar(k);
    this.world.position.set(-this.drift.x * k, BASE - this.alt * k, -this.drift.y * k);
    this.arena.setInterior(this.alt < 400);
    this.layer.update(this.alt, k, this.time);
    const z = zoneOf(this.alt);
    if (z !== this.zone) {
      this.zone = z;
      if (!ev) ev = 'zone';
    }
    return ev;
  }

  stop() {
    this.active = false;
    this.world.scale.setScalar(1);
    this.world.position.set(0, 0, 0);
    this.layer.setVisible(false);
    this.arena.setInterior(true);
  }

  // 帰り道のずれを画面の小さなレーダー用に（-1〜1）
  radar() {
    return { x: clamp(this.drift.x / 8, -1, 1), y: clamp(this.drift.y / 8, -1, 1) };
  }
}
