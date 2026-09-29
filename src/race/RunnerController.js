import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, damp } from '../core/math.js';
import { SamuraiModel } from '../world/SamuraiModel.js';

// プレイヤー（侍ランナー）。
// 入力の「意味」はルールで変わる:
//   通常 3D: ←→ = 横移動 / ↑↓ = ペース / SPACE = ジャンプ / SHIFT = ダッシュ
//   真横 2D: → = 加速 / ← = 減速 / SPACE・↑ = ジャンプ（横位置はレーン固定）
// スタミナはダッシュを連打できなくするためだけのもの。普通に走るだけでは減らない。

const P = CONFIG.player;
const LIMIT = CONFIG.road.runnerLimit;

export class RunnerController {
  constructor(scene, bus, path) {
    this.bus = bus;
    this.path = path;
    // 主人公だけは専用の関節モデル（CPU は軽いインスタンス人形のまま）
    this.model = new SamuraiModel();
    scene.add(this.model.root);

    this.position = new THREE.Vector3();
    this.heading = 0;
    this.drift = 0;
    this.reset(0, 0);
  }

  reset(s, x) {
    this.s = s;
    this.x = x;
    this.y = 0;
    this.vy = 0;
    this.vx = 0;
    this.speed = 0;
    this.stamina = P.staminaMax;
    this.exhausted = false;
    this.grounded = true;
    this.falling = false;
    this.fallTimer = 0;
    this.fallReason = null;
    this.getUpTimer = 0;
    this.invuln = 0;
    this.stagger = 0;
    this.bumpCooldown = 0;
    this.boostTimer = 0;
    this.dashing = false;
    this.phase = 0;
    this.yaw = 0;
    this.airTime = 0;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.maxSpeed = 0;
    this.jumpStartS = 0;
    this.lastJumpLength = 0;
    this.distanceRun = 0;
    this.finished = false;
    this.gravityTilt = 0;
    this.jumpCount = 0;
    this.model?.reset();
  }

  get airborne() {
    return !this.grounded;
  }

  fall(reason = 'trip') {
    if (this.falling || this.invuln > 0 || this.finished) return false;
    this.falling = true;
    this.fallTimer = P.fallDuration;
    this.fallReason = reason;
    this.bus.emit('playerFall', { reason });
    return true;
  }

  // amount: 速度の減少率 / duration: よろけ時間（よろけ中は巡航の 7 割まで）
  hitStagger(amount = 0.45, duration = 0.35) {
    if (this.falling || this.invuln > 0 || this.bumpCooldown > 0) return;
    this.bumpCooldown = 0.6;
    this.stagger = Math.max(this.stagger, duration);
    this.speed *= 1 - amount;
    this.bus.emit('playerBump', {});
  }

  boost(seconds = 3) {
    this.boostTimer = seconds;
  }

  addStamina(v) {
    this.stamina = clamp(this.stamina + v, 0, P.staminaMax);
    if (this.stamina > 25) this.exhausted = false;
  }

  // ctx: { canControl, rules, cheerBonus, autopilot }
  update(dt, input, ctx) {
    const rules = ctx.rules ?? {};
    const screen = !!rules.screenControls;
    const control = ctx.canControl && !this.falling && !this.finished;
    // 鏡の世界: 画面に合わせて左右を入れ替える（rules.invertX）
    const ax = (control ? (ctx.autopilot?.axisX ?? input.axisX) : 0) * (rules.invertX && !screen && !ctx.autopilot ? -1 : 1);
    const ay = control ? (ctx.autopilot?.axisY ?? input.axisY) : 0;
    const dashHeld = control && (ctx.autopilot?.dash ?? input.held('dash'));
    // シューティング中は SPACE = 射撃（ジャンプしない）
    const jumpPressed = control && !rules.shooter && (ctx.autopilot?.jump ?? (input.pressed('jump') || (screen && input.pressed('up'))));
    const jumpHeld = ctx.autopilot ? true : input.held('jump') || (screen && input.held('up'));

    // ---- 速度
    const pace = screen ? ax : ay;
    this.dashing = dashHeld && !this.exhausted && this.stamina > 1;
    let target = ctx.canControl ? P.cruise : 0;
    if (ctx.finishedJog) target = 7;
    if (control) {
      if (pace > 0) target = P.push;
      else if (pace < 0) target = P.ease;
      if (this.dashing) target = P.dash;
      if (this.boostTimer > 0) target = Math.max(target, P.boost);
      target += ctx.cheerBonus ?? 0;
      // 赤信号など: ↓ で完全に止まれる
      if (rules.brake && pace < 0) target = 0;
    }
    if (this.falling) target = 0;
    const accel = this.dashing || this.boostTimer > 0 ? P.dashAccel : P.accel;
    if (this.speed < target) this.speed = Math.min(target, this.speed + accel * dt);
    else this.speed = Math.max(target, this.speed - accel * 1.4 * dt * (this.falling ? 3 : 1));
    if (this.stagger > 0) {
      this.stagger -= dt;
      this.speed = Math.min(this.speed, P.cruise * 0.7);
    }
    this.boostTimer = Math.max(0, this.boostTimer - dt);

    // ---- スタミナ（ダッシュ以外で減ることは基本ない）
    if (this.dashing) this.stamina -= P.staminaDashDrain * dt;
    else if (control && pace > 0) this.stamina -= P.staminaPushDrain * dt;
    else if (control && pace < 0) this.stamina += P.staminaRegenEase * dt;
    else this.stamina += P.staminaRegen * dt;
    this.stamina = clamp(this.stamina, 0, P.staminaMax);
    if (this.stamina <= 0.5) this.exhausted = true;
    if (this.exhausted && this.stamina > 25) this.exhausted = false;

    // ---- 横移動
    let targetVx = 0;
    if (typeof rules.lane === 'number') {
      targetVx = clamp((rules.lane - this.x) * 5, -P.lateralSpeed, P.lateralSpeed);
    } else if (!screen) {
      targetVx = ax * P.lateralSpeed * (this.grounded ? 1 : 0.7);
    }
    this.vx = damp(this.vx, targetVx, 14, dt);
    // カーブでは外側へふくらむ（速いほど強い）→ 曲がりに合わせて内側へ操作する
    let drift = typeof rules.lane === 'number' ? 0 : this.path.kappa(this.s) * this.speed * this.speed * 0.45;
    // 重力が横にずれた区間: 「下」になった側へ少しずつ引っぱられる
    if (rules.pullX && typeof rules.lane !== 'number') drift += rules.pullX;
    this.drift = drift;
    this.carLean = !!rules.carLean;
    this.x = clamp(this.x + (this.vx + drift) * dt, -LIMIT, LIMIT);

    // ---- ジャンプ（先行入力 + コヨーテタイム、長押しで高く）
    this.jumpBuffer = jumpPressed ? 0.14 : Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.falling) {
      this.vy = P.jumpVelocity;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumpStartS = this.s;
      this.jumpCount++;
      this.bus.emit('playerJump', {});
    }
    if (!this.grounded) {
      // 重力シフト / 雲の上: 低重力でふわっと高く飛ぶ
      const gScale = rules.lowGravity ? 0.4 : 1;
      const g = (!jumpHeld && this.vy > 0 ? P.gravity * 2.1 : P.gravity) * gScale;
      this.vy -= g * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.grounded = true;
        this.lastJumpLength = this.s - this.jumpStartS;
        this.bus.emit('playerLand', { airTime: this.airTime, length: this.lastJumpLength });
        this.airTime = 0;
      }
    }

    // ---- 前進
    const ds = this.speed * dt;
    this.s += ds;
    this.distanceRun += ds;
    if (ctx.canControl) this.maxSpeed = Math.max(this.maxSpeed, this.speed);

    // ---- 転倒 → 起き上がり
    if (this.falling) {
      this.fallTimer -= dt;
      if (this.fallTimer <= 0) {
        this.falling = false;
        this.invuln = P.invulnAfterFall;
        this.speed = P.cruise * 0.55;
        this.bus.emit('playerRecover', { reason: this.fallReason });
      }
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);

    this.phase += dt * (4 + this.speed * 0.62);
    this.updateVisual(dt, ctx);
    // 足音はモデルの接地に合わせる
    if (this.grounded && !this.falling && this.speed > 2 && this.model.touchdowns > 0) {
      this.bus.emit('footstep', { speed: this.speed });
    }
  }

  updateVisual(dt, ctx = {}) {
    this.yaw = damp(this.yaw, -this.vx * 0.045, 10, dt);
    const f = this.path.sample(this.s);
    this.heading = f.theta;
    let pitch = 0;
    let roll = 0;
    let lift = this.y;
    if (this.falling) {
      const t = 1 - this.fallTimer / P.fallDuration;
      pitch = -Math.min(1, t * 3) * 1.35;
      roll = Math.sin(t * 9) * 0.25 * (1 - t);
      lift = Math.max(0, Math.sin(Math.min(1, t * 3) * Math.PI) * 0.4);
    } else if (this.carLean) {
      // レースゲーム区間: 車のようにコーナー・車線変更で体を傾ける
      roll = clamp(this.path.kappa(this.s) * this.speed * this.speed * 0.1 - this.vx * 0.06, -0.5, 0.5);
    }

    const m = this.model;
    m.animate({
      dt,
      speed: this.speed,
      grounded: this.grounded,
      y: this.y,
      vy: this.vy,
      vx: this.vx,
      falling: this.falling,
      stumble: this.stagger,
      dashing: this.dashing,
      ready: !!ctx.ready,
      gravityTilt: this.gravityTilt,
      jumpLead: this.jumpCount % 2 ? 1 : -1,
    });
    const root = m.root;
    root.position.set(f.x + f.cos * this.x, lift, f.z - f.sin * this.x);
    root.rotation.set(pitch, f.theta + this.yaw, roll, 'YXZ');
    root.visible = this.invuln <= 0 || Math.floor(this.invuln * 14) % 2 === 0;

    this.path.toWorld(this.s, this.x, this.y, this.position);
    m.setRim(undefined, 0.45 + (this.dashing ? 0.7 : 0) + (this.boostTimer > 0 ? 0.5 : 0));
  }

  // 鏡の世界のもう一人の侍（半透明）。区間の演出側が place() で毎フレーム置く
  createGhost(scene) {
    const model = new SamuraiModel({ ghost: true });
    model.setRim(0x9ff2ff, 1.8);
    model.root.visible = false;
    scene.add(model.root);
    const path = this.path;
    return {
      model,
      show(v) {
        model.root.visible = v;
      },
      // yaw = π で「こちらを向いて」後ろ向きに走る（ムーンウォーク）
      place(s, x, y, yaw, speed, dt) {
        const f = path.sample(s);
        model.animate({ dt, speed, grounded: y <= 0.001, y, vy: 0, vx: 0, falling: false, stumble: 0, reverse: true });
        model.root.position.set(f.x + f.cos * x, y, f.z - f.sin * x);
        model.root.rotation.set(0, f.theta + yaw, 0, 'YXZ');
      },
    };
  }

  setGlow(color, strength) {
    this.model.setRim(color, strength);
  }
}
