import * as THREE from 'three';
import { clamp, damp, lerp, easeInOut } from '../../src/core/math.js';

// トランポリン中継のカメラ。各ショットは「位置・注視点・画角」を返すだけ。切り替えはなめらかに（またはカット）。
// カメラは UI の時間（実時間）で動く → 世界がスローでも、カメラは普通の速さで顔へ寄れる。
//
// ショット:
//   WIDE     … 中継の基本（トランポリンの真横、少し見上げ）
//   HIGH     … 高い位置から全景
//   JUDGE    … 審判席の後ろから
//   FACE     … 顔のアップ（跳んだ瞬間 / FACE LOCK）
//   ORBIT    … 選手の周りをゆっくり回る（バレリーナの映画的カメラ）
//   CROWD    … 観客席の一点（観客ドラマ）
//   ROOF     … 床から天井を見上げる（天井 OPEN）
//   LOOK     … 任意の点を映す（カメラが選手を見失った時）
//   TELE     … 超望遠で追う（空へ飛んだ時・帰ってくる時）
//   RESULT   … 着地後の審判と得点
//   INTRO    … タイトルの時、会場の上を回る

const up = new THREE.Vector3(0, 1, 0);

function pose() {
  return { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40 };
}

export class TrampolineCameraDirector {
  constructor(camera) {
    this.camera = camera;
    this.a = pose();
    this.b = pose();
    this.out = pose();
    this.shot = 'WIDE';
    this.prev = 'WIDE';
    this.blend = 1;
    this.blendDur = 0.6;
    this.t = 0;
    this.time = 0;
    this.shakeT = 0;
    this.roll = 0;
    this.lookPoint = new THREE.Vector3(0, 20, 0);
    this.crowdPoint = new THREE.Vector3(0, 3, -34);
    this.judgePoint = new THREE.Vector3(-6, 1.6, 7.6);
    this.smoothLook = new THREE.Vector3(0, 2, 0);
    this.tmp = new THREE.Vector3();
  }

  // cut: 即切り替え / dur: なめらかに切り替える秒数
  set(shot, { cut = false, dur = 0.7 } = {}) {
    if (shot === this.shot) return;
    this.prev = this.shot;
    this.shot = shot;
    this.t = 0;
    this.blend = cut ? 1 : 0;
    this.blendDur = dur;
    this.snapLook = cut; // カットの時は注視点も即座に
  }

  shake(v) {
    this.shakeT = Math.max(this.shakeT, v);
  }

  // ctx: { com（重心）, head（頭）, headFwd / headUp（頭の向き）, faceDir（選手の正面・水平）, height, airborne }
  computePose(shot, o, ctx, t) {
    const c = ctx.com;
    const h = ctx.height;
    switch (shot) {
      case 'WIDE':
      default: {
        // 中継の基本: トランポリンの横から。高く跳ぶほど少し引いて、選手の高さへ上がる
        o.pos.set(2, 2.6 + clamp(h, 0, 30) * 0.62, 12.5 + clamp(h, 0, 14) * 0.4);
        o.look.set(c.x * 0.6, lerp(1.9, c.y, 0.85), c.z);
        o.fov = 32;
        break;
      }
      case 'HIGH':
        o.pos.set(-9, 11 + clamp(h, 0, 20) * 0.6, 14);
        o.look.set(0, clamp(c.y, 1.5, 30), 0);
        o.fov = 42;
        break;
      case 'JUDGE':
        o.pos.set(-4.5, 1.6, 9.5);
        o.look.set(c.x, clamp(c.y, 1.4, 40), c.z);
        o.fov = 38;
        break;
      case 'FACE': {
        // 顔の正面から（向きは跳んだ時の正面で固定 → 回り始めると顔が外へ回っていくのが見える）
        // faceLock の時は頭の向きごと追う（何回転しても顔しか見えない）
        const hd = ctx.head;
        if (this.faceLock) {
          o.pos.copy(hd).addScaledVector(ctx.headFwd, 0.95);
          o.fov = 38;
        } else {
          o.pos.copy(hd).addScaledVector(ctx.faceDir, 1.9);
          o.pos.y += 0.12;
          o.pos.z += 0.35;
          o.fov = 30;
        }
        o.look.copy(hd);
        break;
      }
      case 'ORBIT': {
        const a = this.time * 0.35;
        o.pos.set(c.x + Math.cos(a) * 6.5, c.y - 0.8, c.z + Math.sin(a) * 6.5);
        o.look.copy(c);
        o.fov = 30;
        break;
      }
      case 'CROWD':
        o.pos.copy(this.crowdPoint).add(this.tmp.set(-this.crowdPoint.x, 0, -this.crowdPoint.z).normalize().multiplyScalar(4.2)).add(this.tmp.set(0, 0.6, 0));
        o.look.copy(this.crowdPoint).add(this.tmp.set(0, 1.1, 0));
        o.fov = 30;
        break;
      case 'ROOF':
        o.pos.set(6, 1.8, 13);
        o.look.set(0, 36, 0);
        o.fov = 62;
        break;
      case 'LOOK':
        o.pos.set(0, 3.4, 15);
        o.look.copy(this.lookPoint);
        o.fov = 38;
        break;
      case 'TELE': {
        // 超望遠: 遠くの地上から、上空の選手を追う
        o.pos.set(60, 6, 110);
        o.look.copy(c);
        const dist = o.pos.distanceTo(c);
        o.fov = clamp(2 * Math.atan(5.5 / dist) * (180 / Math.PI), 1.2, 40);
        break;
      }
      case 'SKY': {
        // 空の上: 選手の横・少し下から（足もとに世界が見える）
        o.pos.set(c.x + 7, c.y - 2.5, c.z + 9);
        o.look.set(c.x, c.y - 1.5, c.z);
        o.fov = 55;
        break;
      }
      case 'RESULT': {
        // 審判席の正面（選手の側）から、札を上げる審判を映す
        const j = this.judgePoint;
        o.pos.set(j.x + 1.8 + Math.sin(t * 0.3) * 0.3, 2.3, j.z - 6.4);
        o.look.set(j.x + 0.3, 1.55, j.z);
        o.fov = 34;
        break;
      }
      case 'INTRO': {
        // タイトル: 会場の上をゆっくり回る
        const a = this.time * 0.08 + 0.6;
        o.pos.set(Math.cos(a) * 26, 15, Math.sin(a) * 26);
        o.look.set(0, 3, 0);
        o.fov = 50;
        break;
      }
    }
    void t;
  }

  update(realDt, ctx) {
    this.time += realDt;
    this.t += realDt;
    if (this.blend < 1) this.blend = Math.min(1, this.blend + realDt / this.blendDur);
    this.computePose(this.shot, this.b, ctx, this.t);
    const out = this.out;
    if (this.blend < 1) {
      this.computePose(this.prev, this.a, ctx, this.t);
      const k = easeInOut(this.blend);
      out.pos.lerpVectors(this.a.pos, this.b.pos, k);
      out.look.lerpVectors(this.a.look, this.b.look, k);
      out.fov = lerp(this.a.fov, this.b.fov, k);
    } else {
      out.pos.copy(this.b.pos);
      out.look.copy(this.b.look);
      out.fov = this.b.fov;
    }
    // 注視点は少しだけ遅れて追う（中継カメラの手ぶれ感）。顔アップは遅れない
    const lag = this.shot === 'FACE' || this.shot === 'TELE' ? 30 : 9;
    if (this.snapLook) {
      this.snapLook = false;
      this.smoothLook.copy(out.look);
    }
    this.smoothLook.x = damp(this.smoothLook.x, out.look.x, lag, realDt);
    this.smoothLook.y = damp(this.smoothLook.y, out.look.y, lag, realDt);
    this.smoothLook.z = damp(this.smoothLook.z, out.look.z, lag, realDt);
    this.shakeT = Math.max(0, this.shakeT - realDt * 2.5);
    const s = this.shakeT * this.shakeT;
    const cam = this.camera;
    cam.position.copy(out.pos);
    if (s > 0) {
      cam.position.x += Math.sin(this.time * 61) * s * 0.35;
      cam.position.y += Math.sin(this.time * 47 + 1) * s * 0.3;
    }
    // 顔ロック: カメラの「上」も頭に合わせる（世界の方が回って見える）
    if (this.shot === 'FACE' && this.faceLock && ctx.headUp) cam.up.copy(ctx.headUp);
    else cam.up.set(0, 1, 0);
    cam.lookAt(this.shot === 'FACE' && this.faceLock ? out.look : this.smoothLook);
    if (this.roll) cam.rotateZ(this.roll);
    const portrait = cam.aspect < 1 ? Math.min(1.6, 0.85 / cam.aspect) : 1;
    cam.fov = clamp(out.fov * portrait, 1, 100);
    cam.updateProjectionMatrix();
  }
}
