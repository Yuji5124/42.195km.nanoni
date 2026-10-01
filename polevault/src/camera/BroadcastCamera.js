import * as THREE from 'three';
import { clamp, damp } from '../../../src/core/math.js';

// テレビ中継のスポーツカメラ（三脚 + 流体ヘッド + 望遠ズーム）。単なる FPS カメラにしない。
//   パン/ティルト: 入力は「ヘッドを押す力」。実際の角度はばね + 減衰で遅れてついてくる（重い望遠レンズ感）。
//     倍率が高いほど重く（追従が遅い）、入力も細かくなる（同じマウスの動きで回る角度 ∝ 画角）。
//   ズーム: 目標の倍率へ慣性つきで（サーボの速さには上限）。R で一瞬だけ広角へ戻す。
//   フォーカス: ピントの距離は遅れて合う（AF がゆっくり追う / 右クリックで素早く合わせ直す / ロック中は対象を追う）。
//   ロック: 対象を画面の中央へ少しだけ引き寄せる（撮る人の補助。完全には固定しない）。
//   ブレ: 急なパンほど揺れる（望遠ほど目立つ）。風の微振動。
// yaw = 0 で +X、+ で +Z の方へ。pitch は上が正。

const _f = new THREE.Vector3();
const _t = new THREE.Vector3();

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 50;
export const BASE_FOV = 46; // 縦の画角（広角端）

export class BroadcastCamera {
  constructor(camera, pos) {
    this.camera = camera;
    this.pos = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.yaw = -2.2;
    this.pitch = -0.02;
    this.yawT = this.yaw;
    this.pitchT = this.pitch;
    this.yawV = 0;
    this.pitchV = 0;
    this.zoom = 1.6;
    this.zoomT = 1.6;
    this.zoomV = 0;
    this.wideHold = false;
    this.zoomBeforeWide = 1.6;
    this.baseFov = BASE_FOV;
    this.focus = 30; // ピントの距離（m）
    this.focusT = 30;
    this.focusSpeed = 2.2;
    this.lock = null; // { getPos(out) }
    this.shake = 0;
    this.time = 0;
    this.panSpeed = 0; // rad/s（画面のブレ・音）
    this.pitchMin = -0.55;
    this.pitchMax = 1.3;
    this.inputScale = 1;
  }

  setAspect(aspect) {
    // 縦長の画面でも横の見える幅を保つ
    const h = THREE.MathUtils.degToRad(BASE_FOV * 1.6);
    const v = 2 * Math.atan(Math.tan(h / 2) / aspect);
    this.baseFov = clamp(THREE.MathUtils.radToDeg(v), BASE_FOV, 80);
  }

  get fov() {
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2) / this.zoom));
  }

  get fovRad() {
    return THREE.MathUtils.degToRad(this.fov);
  }

  // 画面の縦 1px あたりの角度
  radPerPx(heightPx) {
    return this.fovRad / heightPx;
  }

  // マウスの移動量（px）→ ヘッドを押す。fast = Shift（高速パン）
  push(dx, dy, heightPx, fast = false) {
    const k = this.radPerPx(heightPx) * (fast ? 2.6 : 1) * this.inputScale * 0.9;
    this.yawT += dx * k;
    this.pitchT = clamp(this.pitchT - dy * k, this.pitchMin, this.pitchMax);
  }

  // スティック・キー（-1〜1）: 速度で回す
  stick(x, y, dt, fast = false) {
    const sp = this.fovRad * (fast ? 2.4 : 0.9);
    this.yawT += x * sp * dt;
    this.pitchT = clamp(this.pitchT + y * sp * dt, this.pitchMin, this.pitchMax);
  }

  zoomBy(f) {
    if (this.wideHold) {
      this.zoomBeforeWide = clamp(this.zoomBeforeWide * f, ZOOM_MIN, ZOOM_MAX);
      return;
    }
    this.zoomT = clamp(this.zoomT * f, ZOOM_MIN, ZOOM_MAX);
  }

  setWide(on) {
    if (on && !this.wideHold) {
      this.wideHold = true;
      this.zoomBeforeWide = this.zoomT;
      this.zoomT = 1;
    } else if (!on && this.wideHold) {
      this.wideHold = false;
      this.zoomT = this.zoomBeforeWide;
    }
  }

  forward(out = _f) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.cos(this.yaw) * cp, Math.sin(this.pitch), Math.sin(this.yaw) * cp);
  }

  // 点の方向（yaw, pitch）
  anglesTo(p) {
    _t.copy(p).sub(this.pos);
    return { yaw: Math.atan2(_t.z, _t.x), pitch: Math.atan2(_t.y, Math.hypot(_t.x, _t.z)), dist: _t.length() };
  }

  // 画面の中心からの角度のずれ
  offsetTo(p) {
    const a = this.anglesTo(p);
    let dy = a.yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    return { dyaw: dy, dpitch: a.pitch - this.pitch, dist: a.dist };
  }

  // 目標へすぐ向ける（オープニング・自動操縦）
  aimAt(p, instant = false) {
    const a = this.anglesTo(p);
    let dy = a.yaw - this.yawT;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yawT += dy;
    this.pitchT = clamp(a.pitch, this.pitchMin, this.pitchMax);
    if (instant) {
      this.yaw = this.yawT;
      this.pitch = this.pitchT;
      this.yawV = this.pitchV = 0;
    }
  }

  // ピントを点へ合わせ直す（速さ: 速いほど素早く）
  pullFocus(dist, fast = true) {
    this.focusT = clamp(dist, 1.5, 2000);
    this.focusSpeed = fast ? 9 : 2.2;
  }

  update(dt) {
    this.time += dt;
    // ロック: 対象を中央へ少し引き寄せる（目標の角度に足す）
    if (this.lock) {
      const p = this.lock.getPos(_t);
      if (p) {
        const off = this.offsetTo(p);
        const pull = 1 - Math.exp(-dt * 3.2);
        this.yawT += off.dyaw * pull;
        this.pitchT = clamp(this.pitchT + off.dpitch * pull, this.pitchMin, this.pitchMax);
        this.focusT = off.dist;
        this.focusSpeed = 6;
      }
    }
    // パン: 臨界減衰に近いばね。倍率が高いほど重い
    const zn = Math.log(this.zoom) / Math.log(ZOOM_MAX);
    const w = 15 - 8 * zn; // 固有角振動数
    const zeta = 0.92;
    let ey = this.yawT - this.yaw;
    const ep = this.pitchT - this.pitch;
    const ay = w * w * ey - 2 * zeta * w * this.yawV;
    const ap = w * w * ep - 2 * zeta * w * this.pitchV;
    this.yawV += ay * dt;
    this.pitchV += ap * dt;
    this.yaw += this.yawV * dt;
    this.pitch += this.pitchV * dt;
    void ey;
    this.panSpeed = Math.hypot(this.yawV, this.pitchV);
    // ズーム: 対数で慣性（サーボの速さに上限）
    const lz = Math.log(this.zoom);
    const lzt = Math.log(this.zoomT);
    const maxRate = this.wideHold ? 9 : 2.6; // 1 秒あたりの log 倍率
    const want = clamp((lzt - lz) * 7, -maxRate, maxRate);
    this.zoomV = damp(this.zoomV, want, 14, dt);
    this.zoom = Math.exp(lz + this.zoomV * dt);
    this.zoom = clamp(this.zoom, ZOOM_MIN, ZOOM_MAX);
    // フォーカス: 対数で遅れて合う
    const lf = Math.log(this.focus);
    this.focus = Math.exp(damp(lf, Math.log(this.focusT), this.focusSpeed, dt));
    // ブレ
    this.shake = Math.max(0, this.shake - dt * 2);
  }

  kick(a) {
    this.shake = Math.max(this.shake, a);
  }

  apply() {
    const cam = this.camera;
    const t = this.time;
    const fov = this.fovRad;
    // 急パンのブレ（望遠ほど画面上で大きく見える = 角度は画角に比例させない）+ 風の微振動 + 衝撃
    const pan = Math.min(1, this.panSpeed / 1.5);
    const wobble = (0.00012 + pan * 0.0012) * (0.4 + Math.min(1, this.zoom / 12)) + this.shake * 0.004;
    const jy = (Math.sin(t * 17.3) * 0.6 + Math.sin(t * 31.1 + 1) * 0.4) * wobble + Math.sin(t * 0.9) * fov * 0.0015;
    const jp = (Math.sin(t * 23.7 + 2) * 0.6 + Math.sin(t * 13.1) * 0.4) * wobble + Math.sin(t * 1.3 + 1) * fov * 0.0012;
    const yaw = this.yaw + jy;
    const pitch = this.pitch + jp;
    const cp = Math.cos(pitch);
    cam.position.copy(this.pos);
    _f.set(Math.cos(yaw) * cp, Math.sin(pitch), Math.sin(yaw) * cp).add(cam.position);
    cam.up.set(0, 1, 0);
    cam.lookAt(_f);
    // 少しだけ水平が傾く（手持ちではないので、ごくわずか）
    cam.rotateZ(this.yawV * 0.004);
    const f = this.fov;
    if (Math.abs(cam.fov - f) > 1e-5) {
      cam.fov = f;
      cam.updateProjectionMatrix();
    }
  }
}
