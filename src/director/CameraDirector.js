import * as THREE from 'three';
import { clamp, damp, easeInOut, lerp } from '../core/math.js';
import { MODES } from '../config.js';

// CameraDirector: 「見え方を壊す」担当。レースロジックとは独立。
// 各モードは毎フレーム「ポーズ」（位置・注視点・FOV・near・フォグ）を返すだけ。
// モード切替は 2 つのライブポーズをブレンドする（被写体の画面上サイズを保つドリーズーム補間）。
// TV 中継はショットを「カット」で切り替える。

const tmpA = new THREE.Vector3();

function pose() {
  return {
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    fov: 60,
    near: 0.1,
    fogNear: 70,
    fogFar: 460,
    roll: 0,
  };
}

const TV_SHOTS = [
  { name: 'HELI', label: 'ヘリ中継', dur: 4.5 },
  { name: 'SIDE_TRACK', label: '沿道追走カメラ', dur: 4.0 },
  { name: 'FRONT_TELE', label: '正面望遠', dur: 3.0 },
  { name: 'HELI', label: 'ヘリ中継', dur: 3.5 },
  { name: 'ROADSIDE', label: '定点カメラ', dur: 3.5 },
  { name: 'BIKE', label: '中継バイク', dur: 3.0 },
];

export class CameraDirector {
  constructor(camera, scene, bus) {
    this.camera = camera;
    this.scene = scene;
    this.bus = bus;
    this.poses = { a: pose(), b: pose(), out: pose() };
    this.reset();
  }

  reset() {
    this.mode = MODES.TITLE;
    this.prevMode = null;
    this.blend = 1;
    this.blendDur = 1;
    this.modeTime = 0;
    this.followX = 0;
    this.followY = 0;
    this.trauma = 0;
    this.tvIndex = 0;
    this.tvTime = 0;
    this.roadsideAnchor = new THREE.Vector3();
    this.goalAnchorZ = 0;
    this.changes = 0;
    this.sideBlend = 0;
    this.shotLabel = '';
  }

  setMode(mode, { transition = 1.2, cut = false } = {}) {
    if (mode === this.mode) return;
    this.prevMode = this.mode;
    this.prevModeTime = this.modeTime;
    this.mode = mode;
    this.modeTime = 0;
    this.blend = cut ? 1 : 0;
    this.blendDur = transition;
    if (mode === MODES.TV_BROADCAST) {
      this.tvIndex = 0;
      this.tvTime = 0;
    }
    if (mode !== MODES.TITLE && mode !== MODES.START) this.changes++;
    this.bus.emit('cameraMode', { mode, prev: this.prevMode });
  }

  shake(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  computePose(mode, out, ctx, t) {
    const p = ctx.player;
    const z = -p.s;
    out.roll = 0;
    out.near = 0.1;
    out.fogNear = 70;
    out.fogFar = 460;
    switch (mode) {
      case MODES.TITLE: {
        const a = ctx.time * 0.12;
        out.pos.set(Math.sin(a) * 16, 6.5 + Math.sin(a * 0.7) * 1.5, z + Math.cos(a) * 16 - 4);
        out.look.set(0, 1.4, z - 6);
        out.fov = 50;
        break;
      }
      case MODES.START: {
        const k = clamp(t / 4, 0, 1);
        out.pos.set(7 - k * 4, 15 - k * 8, z + 22 - k * 10);
        out.look.set(0, 1, z - 8);
        out.fov = 48;
        break;
      }
      case MODES.NORMAL: {
        const speedN = clamp((p.speed - 12) / 12, 0, 1);
        out.pos.set(this.followX * 0.6, 3.1 + this.followY * 0.35, z + 6.2 - speedN * 0.8);
        out.look.set(this.followX * 0.9, 1.1 + this.followY * 0.5, z - 12);
        out.fov = 60 + speedN * 13;
        break;
      }
      case MODES.TV_BROADCAST:
        this.tvPose(out, ctx, z);
        break;
      case MODES.SIDE_2D: {
        const D = 78;
        out.pos.set(p.x + D, 3.6, z - 5);
        out.look.set(p.x, 3.6, z - 5);
        out.fov = 9.5;
        out.near = D - 3.2;
        out.fogNear = D + 60;
        out.fogFar = D + 420;
        break;
      }
      case MODES.GOAL: {
        // ゴール正面から迎えるカメラ。ゴール後はプレイヤーの前を後退しながら映し続ける
        const gz = this.goalAnchorZ;
        out.pos.set(2.8 + Math.sin(t * 0.6) * 1.5, 1.8, Math.min(gz - 11, z - 7.5));
        out.look.set(p.x, 1.3, z);
        out.fov = 42;
        out.fogNear = 60;
        break;
      }
      default:
        out.pos.set(0, 3, z + 7);
        out.look.set(0, 1, z - 10);
        out.fov = 60;
    }
  }

  tvPose(out, ctx, z) {
    const p = ctx.player;
    const shot = TV_SHOTS[this.tvIndex % TV_SHOTS.length];
    const t = this.tvTime;
    this.shotLabel = shot.label;
    switch (shot.name) {
      case 'HELI':
        // 道路の真上（ビルの谷間）から見下ろす
        out.pos.set(p.x * 0.3 + 2.5, 32 - t * 0.8, z + 26 - t * 1.5);
        out.look.set(p.x * 0.6, 0.5, z - 10);
        out.fov = 40;
        out.fogNear = 90;
        out.fogFar = 520;
        break;
      case 'SIDE_TRACK':
        // 沿道のクレーンカメラ: 観客の頭越しに並走する
        out.pos.set(-10.5, 4.4, z + 1.2);
        out.look.set(p.x, 1.1, z - 0.8);
        out.fov = 34;
        break;
      case 'FRONT_TELE':
        // 頭越しの正面望遠（先頭集団が圧縮されて見える、マラソン中継の定番）
        out.pos.set(p.x * 0.3 + 1.2, 7.0, z - 46);
        out.look.set(p.x, 1.2, z);
        out.fov = 13;
        out.fogNear = 90;
        out.fogFar = 520;
        break;
      case 'ROADSIDE':
        out.pos.copy(this.roadsideAnchor);
        out.look.set(p.x, 1.2, z);
        out.fov = 44;
        break;
      case 'BIKE':
        out.pos.set(p.x + 1.4, 2.1, z - 7.5);
        out.look.set(p.x, 1.3, z);
        out.fov = 52;
        break;
      default:
        break;
    }
  }

  update(dt, ctx) {
    this.modeTime += dt;
    const p = ctx.player;
    this.followX = damp(this.followX, p.x, 6, dt);
    this.followY = damp(this.followY, p.y, 5, dt);

    // TV ショットの自動カット
    if (this.mode === MODES.TV_BROADCAST) {
      this.tvTime += dt;
      const shot = TV_SHOTS[this.tvIndex % TV_SHOTS.length];
      if (this.tvTime > shot.dur) {
        this.tvIndex++;
        this.tvTime = 0;
        this.changes++;
        const next = TV_SHOTS[this.tvIndex % TV_SHOTS.length];
        // 柵の内側・路肩ぎりぎりの定点カメラ
        if (next.name === 'ROADSIDE') this.roadsideAnchor.set(6.9, 2.4, -p.s - 26);
        this.bus.emit('cameraCut', { shot: next.name, label: next.label });
      }
    }

    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / this.blendDur);
    const { a, b, out } = this.poses;
    this.computePose(this.mode, b, ctx, this.modeTime);

    if (this.blend < 1 && this.prevMode) {
      this.computePose(this.prevMode, a, ctx, this.prevModeTime + this.modeTime);
      const t = easeInOut(this.blend);
      out.pos.lerpVectors(a.pos, b.pos, t);
      out.look.lerpVectors(a.look, b.look, t);
      // 被写体の見かけの大きさを保つ補間（ドリーズーム）
      const da = a.pos.distanceTo(a.look);
      const db = b.pos.distanceTo(b.look);
      const ha = 2 * da * Math.tan(THREE.MathUtils.degToRad(a.fov) / 2);
      const hb = 2 * db * Math.tan(THREE.MathUtils.degToRad(b.fov) / 2);
      const d = out.pos.distanceTo(out.look);
      out.fov = THREE.MathUtils.radToDeg(2 * Math.atan(lerp(ha, hb, t) / (2 * Math.max(0.1, d))));
      out.near = lerp(a.near, b.near, t);
      out.fogNear = lerp(a.fogNear, b.fogNear, t);
      out.fogFar = lerp(a.fogFar, b.fogFar, t);
      out.roll = Math.sin(t * Math.PI) * 0.12;
    } else {
      out.pos.copy(b.pos);
      out.look.copy(b.look);
      out.fov = b.fov;
      out.near = b.near;
      out.fogNear = b.fogNear;
      out.fogFar = b.fogFar;
      out.roll = b.roll;
    }

    // near はプレイヤーを絶対に切らない
    tmpA.set(p.x, p.y + 1, -p.s);
    const distToPlayer = out.pos.distanceTo(tmpA);
    out.near = clamp(out.near, 0.1, Math.max(0.1, distToPlayer - 3));

    // 揺れ
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const shakeAmt = this.trauma * this.trauma;
    if (shakeAmt > 0) {
      const tt = ctx.time * 40;
      out.pos.x += Math.sin(tt * 1.3) * shakeAmt * 0.35;
      out.pos.y += Math.sin(tt * 1.7 + 1) * shakeAmt * 0.3;
    }

    // ダッシュ時の FOV キック
    const fovKick = p.dashing && (this.mode === MODES.NORMAL) ? 5 : 0;
    this.fovKick = damp(this.fovKick ?? 0, fovKick, 6, dt);

    const cam = this.camera;
    cam.position.copy(out.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(out.look);
    if (out.roll) cam.rotateZ(out.roll);
    // 縦長画面では横方向の視野が狭くなりすぎるので、縦 FOV を広げて補う
    const portrait = cam.aspect < 1 ? Math.min(1.45, 0.75 / cam.aspect) : 1;
    cam.fov = clamp((out.fov + this.fovKick) * portrait, 5, 115);
    cam.near = out.near;
    cam.far = out.near + 1400;
    cam.updateProjectionMatrix();
    if (this.scene.fog) {
      this.scene.fog.near = out.fogNear;
      this.scene.fog.far = out.fogFar;
    }

    // 横スクロール度合い（エフェクト・背景用）
    const sideTarget = this.mode === MODES.SIDE_2D ? 1 : 0;
    const fromSide = this.prevMode === MODES.SIDE_2D ? 1 : 0;
    this.sideBlend = this.blend < 1 ? lerp(fromSide, sideTarget, easeInOut(this.blend)) : sideTarget;
    this.transitioning = this.blend < 1;
  }
}
