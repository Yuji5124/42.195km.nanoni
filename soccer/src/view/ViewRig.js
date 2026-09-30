import * as THREE from 'three';
import { clamp, damp } from '../../../src/core/math.js';

// 一人称の視点（その場から見回す + ズーム）。
//   yaw = 0 で北（+X）を向く。pitch は上が正。
//   ドラッグ 1px = 画面上の 1px ぶん回る（ズームしても指に吸い付く）。
//   倍率 zoom: 肉眼 1 / 双眼鏡 4〜8。双眼鏡は倍率に比例した手ブレ。
//   lookAt(): 候補や試合へ振り向く（なめらかに）

const _f = new THREE.Vector3();
const _t = new THREE.Vector3();

export class ViewRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.yawT = 0;
    this.pitchT = 0;
    this.zoom = 1;
    this.zoomT = 1;
    this.baseFov = 55;
    this.velYaw = 0;
    this.velPitch = 0;
    this.shakeAmt = 0;
    this.handShake = 0;
    this.time = 0;
    this.yawLimit = null; // [min, max]
    this.pitchMin = -0.62;
    this.pitchMax = 0.75;
    this.anim = null;
    this.bob = 0;
  }

  setAspect(aspect) {
    // 横長: 縦 52°。縦長のスマホでも横の見える幅（約 44°）を保つ
    const h = THREE.MathUtils.degToRad(44);
    const v = 2 * Math.atan(Math.tan(h / 2) / aspect);
    this.baseFov = clamp(THREE.MathUtils.radToDeg(v), 52, 78);
  }

  get fov() {
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2) / this.zoom));
  }

  // 画面の縦 1px あたりの角度（ラジアン）
  radPerPx(heightPx) {
    return THREE.MathUtils.degToRad(this.fov) / heightPx;
  }

  drag(dx, dy, heightPx) {
    const k = this.radPerPx(heightPx);
    this.anim = null;
    this.yawT += dx * k;
    this.pitchT = clamp(this.pitchT + dy * k, this.pitchMin, this.pitchMax);
    this.velYaw = (dx * k) / Math.max(1 / 120, this.lastDt ?? 1 / 60);
    this.velPitch = (dy * k) / Math.max(1 / 120, this.lastDt ?? 1 / 60);
  }

  release() {
    // 指を離した後の慣性（肉眼の時だけ少し）
    this.fling = this.zoom < 2 ? 0.12 : 0.05;
  }

  setZoom(z, instant = false) {
    this.zoomT = clamp(z, 1, 40);
    if (instant) this.zoom = this.zoomT;
  }

  forward(out = _f) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.cos(this.yaw) * cp, Math.sin(this.pitch), Math.sin(this.yaw) * cp);
  }

  // 目標の点へ振り向く（seconds 秒）
  lookAt(point, seconds = 0.7, zoom = null) {
    _t.copy(point).sub(this.pos);
    const yaw = Math.atan2(_t.z, _t.x);
    const pitch = Math.atan2(_t.y, Math.hypot(_t.x, _t.z));
    // 近い回り方
    let dy = yaw - this.yawT;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.anim = { y0: this.yawT, y1: this.yawT + dy, p0: this.pitchT, p1: clamp(pitch, this.pitchMin, this.pitchMax), t: 0, dur: seconds, z0: this.zoomT, z1: zoom ?? this.zoomT };
  }

  angleTo(point) {
    _t.copy(point).sub(this.pos).normalize();
    return Math.acos(clamp(_t.dot(this.forward()), -1, 1));
  }

  shake(amount) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  update(dt) {
    this.time += dt;
    this.lastDt = dt;
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.yawT = a.y0 + (a.y1 - a.y0) * e;
      this.pitchT = a.p0 + (a.p1 - a.p0) * e;
      this.zoomT = a.z0 + (a.z1 - a.z0) * e;
      if (k >= 1) this.anim = null;
    } else if (this.fling) {
      this.yawT += this.velYaw * dt * this.fling * 6;
      this.pitchT = clamp(this.pitchT + this.velPitch * dt * this.fling * 6, this.pitchMin, this.pitchMax);
      this.velYaw = damp(this.velYaw, 0, 7, dt);
      this.velPitch = damp(this.velPitch, 0, 7, dt);
      if (Math.abs(this.velYaw) + Math.abs(this.velPitch) < 0.01) this.fling = 0;
    }
    if (this.yawLimit) this.yawT = clamp(this.yawT, this.yawLimit[0], this.yawLimit[1]);
    // 追従: 肉眼は素早く、倍率が高いほど重い（双眼鏡の重さ）
    const follow = this.zoom > 2 ? 14 : 22;
    this.yaw = damp(this.yaw, this.yawT, follow, dt);
    this.pitch = damp(this.pitch, this.pitchT, follow, dt);
    this.zoom = Math.exp(damp(Math.log(this.zoom), Math.log(this.zoomT), 9, dt));
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.6);
  }

  apply() {
    const cam = this.camera;
    const t = this.time;
    // 手ブレ（倍率に比例。ただし画面上のブレは小さく一定に近い）+ 衝撃
    const hs = this.handShake * (this.zoom > 1.5 ? 1 : 0) * THREE.MathUtils.degToRad(this.fov) * 0.006;
    const sk = this.shakeAmt * 0.012;
    const yaw = this.yaw + (Math.sin(t * 7.1) * 0.6 + Math.sin(t * 13.7) * 0.4) * hs + Math.sin(t * 43) * sk;
    const pitch = this.pitch + (Math.sin(t * 5.3 + 1) * 0.6 + Math.sin(t * 11.3) * 0.4) * hs + Math.sin(t * 37 + 2) * sk;
    const cp = Math.cos(pitch);
    cam.position.copy(this.pos);
    cam.position.y += Math.sin(t * 1.3) * 0.01 + this.bob;
    _f.set(Math.cos(yaw) * cp, Math.sin(pitch), Math.sin(yaw) * cp).add(cam.position);
    cam.lookAt(_f);
    const fov = this.fov;
    if (Math.abs(cam.fov - fov) > 1e-4) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
