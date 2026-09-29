import * as THREE from 'three';
import { SamuraiModel } from '../../src/world/SamuraiModel.js';
import { TrampolinePoser } from './TrampolinePoser.js';
import { TrampolinePhysics, BED } from './TrampolinePhysics.js';
import { clamp, damp } from '../../src/core/math.js';

// 選手（1500m の侍をそのまま使う）。
//   physics: 足の高さ・速度・ベッドの沈み（TrampolinePhysics）
//   回転: flip（宙返り・左右の軸）/ twist（ひねり・体の軸）/ spin（ピルエット・縦の軸）
//     「目標の角度」へ角速度の上限つきで追いかける → 入力した分だけ回る
//   姿勢: 状態と技から POSES の重みを決めて TrampolinePoser へ
//   体の中心（腰のあたり）で回る: pivot（ベッドの上の位置）→ body（重心、回転）→ model.root（足が下）

const COM = 1.0; // 足から重心まで
const TAU = Math.PI * 2;

export class TrampolineController {
  constructor(scene) {
    this.model = new SamuraiModel();
    this.model.setRim(0x39e6ff, 0.45);
    this.poser = new TrampolinePoser(this.model);
    this.physics = new TrampolinePhysics();
    this.pivot = new THREE.Group();
    this.body = new THREE.Group();
    this.body.position.y = COM;
    this.pivot.add(this.body);
    this.body.add(this.model.root);
    this.model.root.position.y = -COM;
    // 競技の向き: トランポリンの長い辺（X）に沿って前を向く
    this.facing = -Math.PI / 2;
    this.faceDir = new THREE.Vector3(-Math.sin(this.facing), 0, -Math.cos(this.facing)); // 顔の向き（水平）
    scene.add(this.pivot);
    this._q = new THREE.Quaternion();
    this._qa = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._axisX = new THREE.Vector3(1, 0, 0);
    this._axisY = new THREE.Vector3(0, 1, 0);
    this.headPos = new THREE.Vector3();
    this.headFwd = new THREE.Vector3(1, 0, 0);
    this.headUp = new THREE.Vector3(0, 1, 0);
    this._hq = new THREE.Quaternion();
    this.reset();
  }

  reset() {
    this.physics.reset();
    this.flip = 0;
    this.flipTarget = 0;
    this.twist = 0;
    this.twistTarget = 0;
    this.spin = 0;
    this.spinTarget = 0;
    this.flipVel = 0;
    this.spinVel = 0;
    this.twistVel = 0;
    this.trick = null; // 'tuck' | 'pike' | 'layout' | 'ballerina' | 'star'
    this.trickW = 0;
    this.landT = 0;
    this.failT = 0;
    this.failed = false;
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.rotSpeed = 0; // 世界の時間での回転の速さ（rad/s）
    this.model.reset();
    this.pivot.position.set(0, 0, 0);
  }

  get airborne() {
    return !this.physics.contact;
  }

  get height() {
    return this.physics.height;
  }

  // 技の目標を足す（タイピング）: 回転数は「目標」、実際の角度は後から追いかける
  setTargets({ flip, twist, spin }) {
    if (flip !== undefined) this.flipTarget = flip * TAU;
    if (twist !== undefined) this.twistTarget = twist * TAU;
    if (spin !== undefined) this.spinTarget = spin * TAU;
  }

  setTrick(name) {
    this.trick = name;
  }

  // 着地の出来: 宙返り・ひねりの角度が 1 回転の整数倍に近いほど良い（0 = 完璧 / 1 = 真逆）
  landingError() {
    const e = (a) => {
      const r = ((a % TAU) + TAU) % TAU;
      return Math.min(r, TAU - r) / Math.PI;
    };
    return Math.max(e(this.flip), e(this.twist) * 0.6);
  }

  // 着地の瞬間: 回転を 1 回転の倍数にそろえる（残りは「着地失敗」の見た目で吸収）
  settle(failed) {
    this.failed = failed;
    this.failT = failed ? 2.0 : 0;
    this.landT = 0.35;
    this.flip = this.flipTarget = Math.round(this.flip / TAU) * TAU;
    this.twist = this.twistTarget = Math.round(this.twist / TAU) * TAU;
    this.spin = this.spinTarget = 0;
    this.trick = null;
  }

  // 残りの回転（ラジアン）: 目標に追いついていない分
  get backlog() {
    return Math.abs(this.flipTarget - this.flip) + Math.abs(this.twistTarget - this.twist) + Math.abs(this.spinTarget - this.spin);
  }

  // gameDt: 世界の時間 / stomp: 踏み込み中 / hurry: 着地が近い時に回転を急ぐ（0〜1）/ boost: 回転の速さの倍率（連続入力）
  update(gameDt, { stomp = false, hurry = 0, boost = 1 } = {}) {
    const ph = this.physics;
    const events = ph.step(gameDt, stomp);
    const air = !ph.contact;
    // 回転: 目標の角度へ（速さの上限 = 技の回りやすさ）
    const chase = (cur, target, maxV) => {
      const diff = target - cur;
      const step = clamp(diff * 7, -maxV, maxV) * gameDt;
      return Math.abs(diff) < Math.abs(step) ? target : cur + step;
    };
    const prevFlip = this.flip;
    const prevSpin = this.spin;
    const prevTwist = this.twist;
    const tuck = this.trick === 'tuck' ? 1 : 0;
    // 速く打つほど速く回る（boost）。着地が近いと、残りを一気に回しきろうとする（hurry）
    const k = boost * (1 + hurry * 3);
    this.flip = chase(this.flip, this.flipTarget, (air ? (tuck ? 16 : 10) : 30) * k);
    this.twist = chase(this.twist, this.twistTarget, (air ? 22 : 30) * k);
    this.spin = chase(this.spin, this.spinTarget, (air ? 18 : 30) * k);
    if (gameDt > 0) {
      this.rotSpeed = Math.max(Math.abs(this.flip - prevFlip), Math.abs(this.spin - prevSpin), Math.abs(this.twist - prevTwist)) / gameDt;
    }
    // 横の位置（空から戻る時は ← → で調整。普段は中央へ戻る）
    this.x += this.vx * gameDt;
    this.z += this.vz * gameDt;
    if (!air) {
      this.vx = damp(this.vx, 0, 6, gameDt);
      this.vz = damp(this.vz, 0, 6, gameDt);
      this.x = damp(this.x, 0, 1.5, gameDt);
      this.z = damp(this.z, 0, 1.5, gameDt);
    }
    this.landT = Math.max(0, this.landT - gameDt);
    this.failT = Math.max(0, this.failT - gameDt);
    this.place(gameDt, air);
    return events;
  }

  place(gameDt, air) {
    const ph = this.physics;
    // 着地失敗で寝転がっている間は、体をベッドの面まで下ろす
    const lie = this.failT > 0 ? clamp(Math.min(this.failT / 0.4, (2.0 - this.failT) / 0.15 + 0.2), 0, 1) : 0;
    this.pivot.position.set(this.x, ph.y - lie * 0.72, this.z);
    // 回転の組み立て: 向き × 縦の軸（ピルエット）× 宙返り × ひねり
    const q = this._q.setFromAxisAngle(this._axisY, this.facing + this.spin);
    q.multiply(this._qa.setFromAxisAngle(this._axisX, this.flip));
    q.multiply(this._qa.setFromAxisAngle(this._axisY, this.twist));
    // 着地失敗: 背中から落ちて寝転がる
    if (lie > 0) q.multiply(this._qa.setFromAxisAngle(this._axisX, -1.35 * lie));
    this.body.quaternion.copy(q);
    // 姿勢
    const w = {};
    const h = ph.height;
    const vy = ph.vy;
    if (!air) {
      // ベッドの上: 沈むほどしゃがむ / 着地直後は吸収
      const sink = clamp(ph.d / 0.8, 0, 1);
      w.stand = 1 - sink;
      w.crouch = sink * (vy < 0 ? 1 : 0.7);
      if (vy > 0) w.rise = sink * 0.6;
      if (this.landT > 0) w.land = this.landT * 3;
      if (this.failT > 0) w.flail = 2;
    } else {
      const up = vy > 0;
      w.rise = up ? clamp(vy / 6, 0, 1) : 0;
      w.air = 0.6;
      if (!up) w.fall = clamp(-vy / 8, 0, 1) * (h < 1.6 ? 2 : 0.8);
      if (this.trick) w[this.trick] = 3;
    }
    // 髪・鉢巻・袴・刀のばねは SamuraiModel の既存の処理をそのまま使う（走らない・空中/接地だけ伝える）
    this.model.animate({ dt: gameDt, speed: 0, grounded: !air, y: h, vy, vx: 0, falling: false, stumble: 0, ready: false });
    const wobble = this.failT > 0 ? 1 : 0;
    // 世界の時間で動くので、スロー中は姿勢の変化もスロー
    this.poser.update({ dt: gameDt, weights: w, grounded: !air && this.failT <= 0, rate: air ? 9 : 16, wobble });
    // 頭の位置と向き（顔のアップ用）。SamuraiModel の顔は -Z を向いている
    this.model.head.getWorldPosition(this.headPos);
    this.model.head.getWorldQuaternion(this._hq);
    this.headFwd.set(0, 0, -1).applyQuaternion(this._hq);
    this.headUp.set(0, 1, 0).applyQuaternion(this._hq);
  }

  // 本体の透明度（スローなのに見えない）
  setOpacity(a) {
    const m = this.model.material;
    const tr = a < 0.999;
    if (m.transparent !== tr) {
      m.transparent = tr;
      m.depthWrite = !tr;
      m.needsUpdate = true;
    }
    m.opacity = a;
  }

  // 重心の位置（カメラ用）
  com(out) {
    return this.body.getWorldPosition(out);
  }
}

export { BED };
