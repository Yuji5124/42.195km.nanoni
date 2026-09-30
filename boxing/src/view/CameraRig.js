import * as THREE from 'three';

// カメラ: 遠近（ふつう）と平行投影（横スクロール・真上）の 2 台を持ち、ゲームシステムが毎フレーム「どこから・どこを・画角」を渡す。
//   aim(pos, look, fov, rate) … rate が大きいほど速く追う（Infinity = カット）
//   aimOrtho(pos, look, halfHeight, up)
//   kick(a) … 当たった時の揺れ（減衰）/ handheld … 手持ちの揺れ（スマホ・望遠）

const _v = new THREE.Vector3();

export class CameraRig {
  constructor(aspect) {
    this.persp = new THREE.PerspectiveCamera(50, aspect, 0.05, 600);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 200);
    for (const c of [this.persp, this.ortho]) c.layers.enable(1);
    this.camera = this.persp;
    this.aspect = aspect;
    this.pos = new THREE.Vector3(0, 4, 8);
    this.look = new THREE.Vector3(0, 1.5, 0);
    this.fov = 50;
    this.half = 2;
    this.up = new THREE.Vector3(0, 1, 0);
    this.cutNext = true;
    this.shake = 0;
    this.handheld = 0;
    this.time = 0;
    this.roll = 0;
  }

  setAspect(a) {
    this.aspect = a;
    this.persp.aspect = a;
    this.persp.updateProjectionMatrix();
  }

  cut() {
    this.cutNext = true;
  }

  kick(a = 0.3) {
    this.shake = Math.max(this.shake, a);
  }

  aim(pos, look, fov = 50, rate = 8, dt = 1 / 60) {
    this.camera = this.persp;
    const k = this.cutNext || rate === Infinity ? 1 : 1 - Math.exp(-rate * dt);
    this.pos.lerp(pos, k);
    this.look.lerp(look, k);
    this.fov += (fov - this.fov) * k;
    this.up.set(0, 1, 0);
    this.cutNext = false;
  }

  aimOrtho(pos, look, half, up = null, rate = 8, dt = 1 / 60) {
    this.camera = this.ortho;
    const k = this.cutNext || rate === Infinity ? 1 : 1 - Math.exp(-rate * dt);
    this.pos.lerp(pos, k);
    this.look.lerp(look, k);
    this.half += (half - this.half) * k;
    if (up) this.up.copy(up);
    else this.up.set(0, 1, 0);
    this.cutNext = false;
  }

  apply(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const c = this.camera;
    const s = this.shake * this.shake * 0.12 + this.handheld * 0.02;
    const t = this.time;
    const n = (f, p) => Math.sin(t * f + p) * 0.6 + Math.sin(t * f * 2.3 + p * 1.7) * 0.4;
    c.position.set(this.pos.x + n(23, 0) * s, this.pos.y + n(19, 2) * s, this.pos.z + n(29, 4) * s);
    if (this.handheld > 0) {
      const h = this.handheld;
      c.position.x += n(1.3, 1) * 0.03 * h;
      c.position.y += n(1.7, 3) * 0.03 * h;
    }
    c.up.copy(this.up);
    _v.copy(this.look);
    if (this.handheld > 0) {
      _v.x += n(0.9, 5) * 0.05 * this.handheld;
      _v.y += n(1.1, 7) * 0.04 * this.handheld;
    }
    c.lookAt(_v);
    if (this.roll) c.rotateZ(this.roll);
    if (c === this.persp) {
      if (Math.abs(c.fov - this.fov) > 0.01) {
        c.fov = this.fov;
        c.updateProjectionMatrix();
      }
    } else {
      const h = this.half;
      c.left = -h * this.aspect;
      c.right = h * this.aspect;
      c.top = h;
      c.bottom = -h;
      c.updateProjectionMatrix();
    }
  }
}
