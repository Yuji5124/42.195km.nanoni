import * as THREE from 'three';
import { TRACK, trackPoint } from '../race/trackLogic.js';
import { STAND } from '../stadium/stands.js';
import { clamp, damp, easeInOut, lerp } from '../core/mathx.js';

// CameraRig: すべてのカメラを 1 つにまとめる。各モードは「ポーズ」（位置・注視点・FOV・上方向）を返すだけ。
// モードや被写体が変わったら、前のポーズからなめらかに（またはカットで）切り替える。
//
// モード: FOLLOW SIDE SIDE2D FRONT REAR TV DRONE TOP FIRST_PERSON CCTV FINISH_LINE ORBIT GOAL SKY CROWD START

const up = new THREE.Vector3(0, 1, 0);

function pose() {
  return { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60, up: new THREE.Vector3(0, 1, 0), near: 0.1 };
}

// 観客席の上の防犯カメラ（CCTV）
const CCTV_POINTS = [];
for (let k = 0; k < 10; k++) {
  const d = (k / 10) * TRACK.lap + 12;
  CCTV_POINTS.push({ d, off: STAND.off0 - 1.5, y: 7.5 });
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.a = pose();
    this.b = pose();
    this.out = pose();
    this.blend = 1;
    this.blendDur = 0.6;
    this.mode = 'START';
    this.key = '';
    this.time = 0;
    this.modeTime = 0;
    this.cctv = null;
    this.follow = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };
    this.shakeT = 0;
    this.pt = {};
    this.pt2 = {};
  }

  // 被写体の情報: view（RunnerManager の view）, r（RaceCore の runner）
  computePose(mode, o, t, sub, ctx) {
    const pt = trackPoint(sub.r.d, sub.r.off, this.pt);
    const h = new THREE.Vector3(pt.hx, 0, pt.hz);
    const right = new THREE.Vector3(pt.rx, 0, pt.rz);
    const P = sub.view.pos;
    const scale = sub.view.group.scale.x;
    o.up.set(0, 1, 0);
    o.near = 0.1;
    switch (mode) {
      case 'START': {
        // スタートライン: 横一列を正面から舐める
        const k = easeInOut(clamp(t / 4.5, 0, 1));
        const c = trackPoint(4, 4.5, this.pt2);
        o.pos.set(c.x + c.hx * 6 + c.rx * lerp(-9, 5, k), 2.2, c.z + c.hz * 6 + c.rz * lerp(-9, 5, k));
        o.look.set(c.x + c.rx * lerp(-2, 1, k), 1.0, c.z + c.rz * lerp(-2, 1, k));
        o.fov = 48;
        break;
      }
      case 'FOLLOW':
      default: {
        const k = Math.max(1, scale * 0.8);
        o.pos.copy(P).addScaledVector(h, -5.8 * k).addScaledVector(up, 2.9 * k);
        o.look.copy(P).addScaledVector(h, 7).addScaledVector(up, 0.9 * scale);
        o.fov = 60;
        break;
      }
      case 'REAR':
        o.pos.copy(P).addScaledVector(h, -22).addScaledVector(up, 1.1);
        o.look.copy(P).addScaledVector(up, 1.0);
        o.fov = 20;
        break;
      case 'FRONT':
        o.pos.copy(P).addScaledVector(h, 7.5).addScaledVector(right, 0.8).addScaledVector(up, 1.5);
        o.look.copy(P).addScaledVector(up, 1.1);
        o.fov = 50;
        break;
      case 'SIDE':
        o.pos.copy(P).addScaledVector(right, -13).addScaledVector(up, 2.2);
        o.look.copy(P).addScaledVector(up, 1.0).addScaledVector(h, 1.5);
        o.fov = 34;
        break;
      case 'SIDE2D':
        // 真横 2D: 遠くから超望遠（ほぼ平行投影）
        o.pos.copy(P).addScaledVector(right, -70).addScaledVector(up, 1.3).addScaledVector(h, 3);
        o.look.copy(P).addScaledVector(up, 1.3).addScaledVector(h, 3);
        o.fov = 7.5;
        o.near = 55;
        break;
      case 'TV': {
        // メインスタンド側の高い位置から、長いレンズで追う
        o.pos.set(P.x * 0.85, 16, TRACK.radius + STAND.off0 + 22);
        o.look.copy(P).addScaledVector(up, 1.0).addScaledVector(h, 2);
        const dist = o.pos.distanceTo(o.look);
        o.fov = clamp(2 * Math.atan(7 / dist) * (180 / Math.PI), 6, 40);
        break;
      }
      case 'DRONE': {
        const a = this.time * 0.25;
        o.pos.copy(P).addScaledVector(h, -9 * Math.cos(a)).addScaledVector(right, 9 * Math.sin(a)).addScaledVector(up, 12);
        o.look.copy(P).addScaledVector(up, 0.5);
        o.fov = 55;
        break;
      }
      case 'TOP':
        o.pos.copy(P).addScaledVector(up, 42).addScaledVector(h, 3);
        o.look.copy(P).addScaledVector(h, 3);
        o.up.copy(h);
        o.fov = 45;
        break;
      case 'FIRST_PERSON': {
        const hd = sub.view.head;
        o.pos.copy(hd).addScaledVector(h, 0.18).addScaledVector(up, 0.05);
        o.look.copy(hd).addScaledVector(h, 10).addScaledVector(up, -0.4);
        o.fov = 84;
        o.near = 0.05;
        break;
      }
      case 'ORBIT': {
        const a = this.time * 0.8;
        o.pos.copy(P).addScaledVector(h, Math.cos(a) * 6).addScaledVector(right, Math.sin(a) * 6).addScaledVector(up, 2.2);
        o.look.copy(P).addScaledVector(up, 1.1);
        o.fov = 50;
        break;
      }
      case 'CCTV': {
        // 目の前の防犯カメラ。通り過ぎたら次のカメラへカット
        const pd = ((sub.r.d % TRACK.lap) + TRACK.lap) % TRACK.lap;
        const behind = this.cctv ? (pd - this.cctv.d + TRACK.lap) % TRACK.lap : 0;
        const passed = this.cctv && behind > 4 && behind < TRACK.lap / 2;
        if (!this.cctv || this.cctvFor !== sub.r.index || passed) {
          let best = CCTV_POINTS[0];
          let bestAhead = Infinity;
          for (const c of CCTV_POINTS) {
            const ahead = (c.d - pd + TRACK.lap) % TRACK.lap;
            if (ahead > 8 && ahead < bestAhead) {
              bestAhead = ahead;
              best = c;
            }
          }
          if (this.cctv !== best) {
            this.cctv = best;
            this.cctvFor = sub.r.index;
            this.cctvCount = (this.cctvCount ?? 0) + 1;
            ctx.onCut?.(`CAM ${String(CCTV_POINTS.indexOf(best) + 1).padStart(2, '0')}`);
          }
        }
        const c = trackPoint(this.cctv.d, this.cctv.off, this.pt2);
        o.pos.set(c.x, this.cctv.y, c.z);
        o.look.copy(P).addScaledVector(up, 0.9);
        o.fov = 70;
        break;
      }
      case 'FINISH_LINE': {
        const f = trackPoint(0, 12, this.pt2);
        o.pos.set(f.x + 1, 3.2, f.z + 2);
        o.look.copy(P).addScaledVector(up, 1.0);
        o.fov = 28;
        break;
      }
      case 'GOAL': {
        // ゴールだけ映している（誰もいない）
        const f = trackPoint(0, 4, this.pt2);
        o.pos.set(f.x + 14, 5, f.z + 16);
        o.look.set(f.x, 0.8, f.z - 1);
        o.fov = 35;
        break;
      }
      case 'SKY':
        o.pos.copy(P).addScaledVector(up, 1.6);
        o.look.copy(P).addScaledVector(up, 60).addScaledVector(h, 8);
        o.fov = 60;
        break;
      case 'CROWD': {
        const c = trackPoint(sub.r.d + 6, STAND.off0 + 6, this.pt2);
        o.pos.copy(P).addScaledVector(up, 1.8).addScaledVector(right, 1.2);
        o.look.set(c.x, 4, c.z);
        o.fov = 45;
        break;
      }
      case 'FINISH_PHOTO': {
        // 写真判定: ラインの真横
        const f = trackPoint(0, -9, this.pt2);
        o.pos.set(f.x, 2.2, f.z);
        const g = trackPoint(0, 5, this.pt);
        o.look.set(g.x, 0.9, g.z);
        o.fov = 38;
        break;
      }
    }
    o.fov *= ctx.fovMul ?? 1;
  }

  // want: { mode, subject: { view, r }, cut, roll, shake, fovMul, label }
  update(dt, want, ctx = {}) {
    this.time += dt;
    const key = `${want.mode}:${want.subject.r.index}`;
    if (key !== this.key) {
      const first = !this.key;
      this.prevMode = this.mode;
      this.prevSub = this.sub;
      this.mode = want.mode;
      this.key = key;
      this.modeTime = 0;
      this.blend = first || want.cut ? 1 : 0;
      this.blendDur = want.blend ?? 0.7;
    }
    this.sub = want.subject;
    this.modeTime += dt;
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / this.blendDur);
    this.computePose(this.mode, this.b, this.modeTime, this.sub, { ...ctx, fovMul: want.fovMul });
    const out = this.out;
    if (this.blend < 1 && this.prevSub) {
      this.computePose(this.prevMode, this.a, this.modeTime, this.prevSub, { fovMul: want.fovMul });
      const t = easeInOut(this.blend);
      out.pos.lerpVectors(this.a.pos, this.b.pos, t);
      out.look.lerpVectors(this.a.look, this.b.look, t);
      out.fov = lerp(this.a.fov, this.b.fov, t);
      out.up.lerpVectors(this.a.up, this.b.up, t).normalize();
      out.near = lerp(this.a.near, this.b.near, t);
    } else {
      out.pos.copy(this.b.pos);
      out.look.copy(this.b.look);
      out.fov = this.b.fov;
      out.up.copy(this.b.up);
      out.near = this.b.near;
    }
    // 追従モードは少しなめらかに（カクつきを消す）
    if (this.mode === 'FOLLOW' && this.blend >= 1) {
      const f = this.follow;
      if (!f.init || want.cut) {
        f.pos.copy(out.pos);
        f.look.copy(out.look);
        f.init = true;
      }
      f.pos.x = damp(f.pos.x, out.pos.x, 10, dt);
      f.pos.y = damp(f.pos.y, out.pos.y, 10, dt);
      f.pos.z = damp(f.pos.z, out.pos.z, 10, dt);
      f.look.lerp(out.look, 1 - Math.exp(-14 * dt));
      out.pos.copy(f.pos);
      out.look.copy(f.look);
    } else this.follow.init = false;

    // 揺れ
    this.shakeT = Math.max(0, Math.max(this.shakeT - dt * 1.5, want.shake ?? 0));
    const s = this.shakeT * this.shakeT;
    if (s > 0) {
      out.pos.x += Math.sin(this.time * 47) * s * 0.3;
      out.pos.y += Math.sin(this.time * 53 + 1) * s * 0.25;
    }

    const cam = this.camera;
    cam.position.copy(out.pos);
    cam.up.copy(out.up);
    cam.lookAt(out.look);
    if (want.roll) cam.rotateZ(want.roll);
    const portrait = cam.aspect < 1 ? Math.min(1.5, 0.8 / cam.aspect) : 1;
    cam.fov = clamp(out.fov * portrait, 4, 120);
    cam.near = out.near;
    cam.far = 3000;
    cam.updateProjectionMatrix();
  }
}
