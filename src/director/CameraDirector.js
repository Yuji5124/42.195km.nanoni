import * as THREE from 'three';
import { clamp, damp, easeInOut, lerp } from '../core/math.js';
import { MODES } from '../config.js';

// CameraDirector: 「見え方を壊す」担当。レースロジックとは独立。
// 各モードは毎フレーム「ポーズ」（位置・注視点・FOV・near・フォグ）を返すだけ。
// ポーズはコース座標（s = 前進量, x = 横, y = 高さ）で考え、CoursePath でワールドに直す → カーブに自然に追従。
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

// 1500m 決勝の中継: CAM 01 / CAM 02 / TRACKING / HELICOPTER / GOAL CAM
export const TV_SHOTS_1500 = [
  { name: 'ROADSIDE', label: 'CAM 01', dur: 3.6 },
  { name: 'SIDE_TRACK', label: 'TRACKING', dur: 4.2 },
  { name: 'HELI', label: 'HELICOPTER', dur: 4.2 },
  { name: 'FRONT_TELE', label: 'CAM 02', dur: 3.4 },
  { name: 'GOAL_CAM', label: 'GOAL CAM', dur: 3.2 },
  { name: 'BIKE', label: 'CAM 03 ─ BIKE', dur: 3.2 },
];

export const TV_SHOTS = [
  { name: 'HELI', label: 'ヘリ中継', dur: 4.5 },
  { name: 'SIDE_TRACK', label: '沿道追走カメラ', dur: 4.0 },
  { name: 'FRONT_TELE', label: '正面望遠', dur: 3.0 },
  { name: 'HELI', label: 'ヘリ中継', dur: 3.5 },
  { name: 'ROADSIDE', label: '定点カメラ', dur: 3.5 },
  { name: 'BIKE', label: '中継バイク', dur: 3.0 },
];

export class CameraDirector {
  constructor(camera, scene, bus, path) {
    this.camera = camera;
    this.scene = scene;
    this.bus = bus;
    this.path = path;
    this.poses = { a: pose(), b: pose(), out: pose() };
    this.tvShots = TV_SHOTS;
    this.startStyle = 'grid';
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
    this.roadside = { s: 0, x: 6.9, y: 2.4 };
    this.goalS = 0;
    this.changes = 0;
    this.sideBlend = 0;
    this.shotLabel = '';
    this.lean = 0;
    this.cctv = null;
    this.cctvCount = 0;
    this.extraRoll = 0;
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
      const first = this.tvShots[0];
      this.roadside = null; // 次のポーズ計算で、その時のプレイヤー位置から置く
      this.bus.emit('cameraCut', { shot: first.name, label: first.label });
    }
    if (mode === MODES.CCTV) this.cctv = null;
    if (mode !== MODES.TITLE && mode !== MODES.START) this.changes++;
    this.bus.emit('cameraMode', { mode, prev: this.prevMode });
  }

  shake(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  computePose(mode, out, ctx, t) {
    const p = ctx.player;
    const W = (s, x, y, v) => this.path.toWorld(s, x, y, v);
    out.roll = 0;
    out.near = 0.1;
    out.fogNear = 70;
    out.fogFar = 460;
    switch (mode) {
      case MODES.TITLE: {
        const a = ctx.time * 0.12;
        W(p.s, 0, 0, tmpA);
        out.pos.set(tmpA.x + Math.sin(a) * 16, 6.5 + Math.sin(a * 0.7) * 1.5, tmpA.z + Math.cos(a) * 16);
        W(p.s + 6, 0, 1.4, out.look);
        out.fov = 50;
        break;
      }
      case MODES.START: {
        if (this.startStyle === 'line') {
          // 1500m: 横一列のスタートラインを正面から舐めるように
          const k = clamp(t / 4.2, 0, 1);
          const e = easeInOut(k);
          W(p.s + 9 - e * 2, lerp(-9, 6, e), 2.4 + e * 0.6, out.pos);
          W(p.s, lerp(-3, 1.5, e), 1.1, out.look);
          out.fov = 46;
          break;
        }
        const k = clamp(t / 4, 0, 1);
        W(p.s - 22 + k * 10, 7 - k * 4, 15 - k * 8, out.pos);
        W(p.s + 8, 0, 1, out.look);
        out.fov = 48;
        break;
      }
      case MODES.NORMAL: {
        const speedN = clamp((p.speed - 12) / 12, 0, 1);
        // 巨大な侍（1500m のツイスト）: 少しだけ引く（引きすぎると大きく見えない）
        const k = Math.max(1, (p.visualScale ?? 1) * 0.55);
        W(p.s - (6.2 - speedN * 0.8) * k, this.followX * 0.6, (3.1 + this.followY * 0.35) * k, out.pos);
        W(p.s + 12, this.followX * 0.9, (1.1 + this.followY * 0.5) * k, out.look);
        out.fov = 60 + speedN * 13;
        out.roll = this.lean;
        break;
      }
      case MODES.TV_BROADCAST:
        this.tvPose(out, ctx);
        break;
      case MODES.SIDE_2D: {
        const D = 78;
        W(p.s + 5, p.x + D, 3.6, out.pos);
        W(p.s + 5, p.x, 3.6, out.look);
        out.fov = 9.5;
        out.near = D - 3.2;
        out.fogNear = D + 60;
        out.fogFar = D + 420;
        break;
      }
      case MODES.TOP_DOWN: {
        // 見下ろしシューティング: 道路の真上から少しだけ前を向く
        W(p.s - 3, p.x * 0.5, 38, out.pos);
        W(p.s + 11, p.x * 0.5, 0, out.look);
        out.fov = 48;
        out.fogNear = 90;
        out.fogFar = 500;
        break;
      }
      case MODES.RACING: {
        // レースゲーム: 地面すれすれ・広角・カーブで大きく傾く
        const speedN = clamp((p.speed - 12) / 12, 0, 1);
        W(p.s - 3.6, this.followX * 0.92, 1.35 + this.followY * 0.6, out.pos);
        W(p.s + 22, this.followX, 0.9 + this.followY * 0.4, out.look);
        out.fov = 74 + speedN * 14;
        out.roll = this.lean * 2.4;
        break;
      }
      case MODES.CCTV: {
        // 電柱・ビルの防犯カメラ: 固定位置から首だけ振ってプレイヤーを追う
        const c = this.cctv ?? { s: p.s + 20, x: 9, y: 7.5 };
        W(c.s, c.x, c.y, out.pos);
        W(p.s, p.x, 1.0, out.look);
        out.fov = 72;
        out.fogNear = 60;
        out.fogFar = 360;
        break;
      }
      case MODES.PHOTO: {
        // 写真判定: フィニッシュラインの真横・低い位置から望遠で（ランナーは左 → 右へ横切る）
        W(this.goalS, 9.0, 2.9, out.pos);
        W(this.goalS, -4, 0.9, out.look);
        out.fov = 36;
        out.fogNear = 120;
        out.fogFar = 600;
        break;
      }
      case MODES.GOAL: {
        // ゴール正面から迎えるカメラ。ゴール後はプレイヤーの前を後退しながら映し続ける
        W(Math.max(this.goalS + 11, p.s + 7.5), 2.8 + Math.sin(t * 0.6) * 1.5, 1.8, out.pos);
        W(p.s, p.x, 1.3, out.look);
        out.fov = 42;
        out.fogNear = 60;
        break;
      }
      default:
        W(p.s - 7, 0, 3, out.pos);
        W(p.s + 10, 0, 1, out.look);
        out.fov = 60;
    }
  }

  tvPose(out, ctx) {
    const p = ctx.player;
    const W = (s, x, y, v) => this.path.toWorld(s, x, y, v);
    const shot = this.tvShots[this.tvIndex % this.tvShots.length];
    const t = this.tvTime;
    this.shotLabel = shot.label;
    switch (shot.name) {
      case 'HELI':
        // 道路の真上（ビルの谷間）から見下ろす
        W(p.s - 26 + t * 1.5, p.x * 0.3 + 2.5, 32 - t * 0.8, out.pos);
        W(p.s + 10, p.x * 0.6, 0.5, out.look);
        out.fov = 40;
        out.fogNear = 90;
        out.fogFar = 520;
        break;
      case 'SIDE_TRACK':
        // 沿道のクレーンカメラ: 観客の頭越しに並走する
        W(p.s - 1.2, -10.5, 4.4, out.pos);
        W(p.s + 0.8, p.x, 1.1, out.look);
        out.fov = 34;
        break;
      case 'FRONT_TELE':
        // 頭越しの正面望遠（先頭集団が圧縮されて見える、マラソン中継の定番）
        W(p.s + 46, p.x * 0.3 + 1.2, 7.0, out.pos);
        W(p.s, p.x, 1.2, out.look);
        out.fov = 13;
        out.fogNear = 90;
        out.fogFar = 520;
        break;
      case 'ROADSIDE':
        this.roadside ??= { s: p.s + 26, x: 6.9, y: 2.4 };
        W(this.roadside.s, this.roadside.x, this.roadside.y, out.pos);
        W(p.s, p.x, 1.2, out.look);
        out.fov = 44;
        break;
      case 'BIKE':
        W(p.s + 7.5, p.x + 1.4, 2.1, out.pos);
        W(p.s, p.x, 1.3, out.look);
        out.fov = 52;
        break;
      case 'GOAL_CAM':
        // ゴール地点のカメラ…からの超望遠（まだ何百 m も先）
        W(p.s + 160, 0.5, 3.2, out.pos);
        W(p.s, p.x, 1.2, out.look);
        out.fov = 4.2 - t * 0.35;
        out.fogNear = 400;
        out.fogFar = 900;
        break;
      default:
        break;
    }
  }

  update(dt, ctx) {
    this.modeTime += dt;
    const p = ctx.player;
    this.lastPlayerS = p.s;
    this.followX = damp(this.followX, p.x, 6, dt);
    this.followY = damp(this.followY, p.y, 5, dt);
    // カーブで少しだけ内側に傾ける（スピード感）
    this.lean = damp(this.lean, clamp(this.path.kappa(p.s) * p.speed * 2.2, -0.07, 0.07), 3, dt);

    // 監視カメラ: プレイヤーが通り過ぎたら次のカメラへカット
    if (this.mode === MODES.CCTV && (!this.cctv || p.s > this.cctv.s + 20)) {
      this.cctvCount++;
      const side = this.cctvCount % 2 ? 9.5 : -9.5;
      this.cctv = { s: p.s + 22, x: side, y: 7 + (this.cctvCount % 3) * 1.5 };
      if (this.cctvCount > 1) this.changes++;
      this.bus.emit('cameraCut', { shot: 'CCTV', label: `CAM ${String(this.cctvCount).padStart(2, '0')}`, cctv: this.cctvCount });
    }

    // 重力シフト: 画面ごと横倒し・天地逆転（ctx.roll は度）
    this.extraRoll = damp(this.extraRoll, THREE.MathUtils.degToRad(ctx.roll ?? 0), 1.6, dt);

    // TV ショットの自動カット
    if (this.mode === MODES.TV_BROADCAST) {
      this.tvTime += dt;
      const shots = this.tvShots;
      const shot = shots[this.tvIndex % shots.length];
      if (this.tvTime > shot.dur) {
        this.tvIndex++;
        this.tvTime = 0;
        this.changes++;
        const next = shots[this.tvIndex % shots.length];
        // 柵の内側・路肩ぎりぎりの定点カメラ
        if (next.name === 'ROADSIDE') this.roadside = null;
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
      out.roll = lerp(a.roll, b.roll, t) + Math.sin(t * Math.PI) * 0.12;
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
    this.path.toWorld(p.s, p.x, p.y + 1, tmpA);
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
    const fovKick = p.dashing && this.mode === MODES.NORMAL ? 5 : 0;
    this.fovKick = damp(this.fovKick ?? 0, fovKick, 6, dt);

    const cam = this.camera;
    cam.position.copy(out.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(out.look);
    if (out.roll || this.extraRoll) cam.rotateZ(out.roll + this.extraRoll);
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
