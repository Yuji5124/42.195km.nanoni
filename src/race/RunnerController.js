import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, damp } from '../core/math.js';
import { createHumanMaterial, createHumanInstances, applyLook, LOOKS } from '../world/RunnerModel.js';

// プレイヤー（侍ランナー）。
// 入力の「意味」はルールで変わる:
//   通常 3D: ←→ = 横移動 / ↑↓ = ペース / SPACE = ジャンプ / SHIFT = ダッシュ
//   真横 2D: → = 加速 / ← = 減速 / SPACE・↑ = ジャンプ（横位置はレーン固定）
// スタミナはダッシュを連打できなくするためだけのもの。普通に走るだけでは減らない。

const P = CONFIG.player;
const LIMIT = CONFIG.road.runnerLimit;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export class RunnerController {
  constructor(scene, bus) {
    this.bus = bus;
    this.material = createHumanMaterial({ mode: 'runner', rim: 0.9, rimColor: 0x39e6ff });
    this.mesh = createHumanInstances(1, this.material);
    applyLook(this.mesh, 0, LOOKS.samurai);
    scene.add(this.mesh);

    // 鉢巻（白） — 侍ランナーの目印
    this.headband = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.06, 0.29),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    scene.add(this.headband);

    this.position = new THREE.Vector3();
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
    const ax = control ? (ctx.autopilot?.axisX ?? input.axisX) : 0;
    const ay = control ? (ctx.autopilot?.axisY ?? input.axisY) : 0;
    const dashHeld = control && (ctx.autopilot?.dash ?? input.held('dash'));
    const jumpPressed = control && (ctx.autopilot?.jump ?? (input.pressed('jump') || (screen && input.pressed('up'))));
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
    this.x = clamp(this.x + this.vx * dt, -LIMIT, LIMIT);

    // ---- ジャンプ（先行入力 + コヨーテタイム、長押しで高く）
    this.jumpBuffer = jumpPressed ? 0.14 : Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.falling) {
      this.vy = P.jumpVelocity;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumpStartS = this.s;
      this.bus.emit('playerJump', {});
    }
    if (!this.grounded) {
      const g = !jumpHeld && this.vy > 0 ? P.gravity * 2.1 : P.gravity;
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

    // ---- 足音
    const prevPhase = this.phase;
    this.phase += dt * (4 + this.speed * 0.62);
    if (this.grounded && !this.falling && this.speed > 2 && Math.floor(prevPhase / Math.PI) !== Math.floor(this.phase / Math.PI)) {
      this.bus.emit('footstep', { speed: this.speed });
    }

    this.updateVisual(dt);
  }

  updateVisual(dt) {
    this.yaw = damp(this.yaw, -this.vx * 0.045, 10, dt);
    const z = -this.s;
    const anim = this.mesh.geometry.attributes.iAnim;
    let pitch = 0;
    let roll = 0;
    let lift = this.y;
    let amp;
    if (this.falling) {
      const t = 1 - this.fallTimer / P.fallDuration;
      pitch = -Math.min(1, t * 3) * 1.35;
      roll = Math.sin(t * 9) * 0.25 * (1 - t);
      lift = Math.max(0, Math.sin(Math.min(1, t * 3) * Math.PI) * 0.4);
      amp = 0.25;
      anim.setXY(0, this.phase * 0.2, amp);
    } else {
      amp = this.speed < 1 ? 0.15 : this.grounded ? Math.min(1.25, 0.55 + this.speed / 22) : 0.35;
      anim.setXY(0, this.phase, amp);
    }
    anim.needsUpdate = true;

    _e.set(pitch, this.yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    const visible = this.invuln <= 0 || Math.floor(this.invuln * 14) % 2 === 0;
    _s.setScalar(visible ? 1 : 0.0001);
    _m.compose(_p.set(this.x, lift, z), _q, _s);
    this.mesh.setMatrixAt(0, _m);
    this.mesh.instanceMatrix.needsUpdate = true;

    // 鉢巻は頭の位置に追従（転倒中は隠す）
    this.headband.visible = visible && !this.falling;
    // シェーダー側の前傾（rotX(-0.12 * amp)）と揃える
    const lean = 0.12 * amp;
    const bob = Math.abs(Math.cos(this.phase)) * 0.07 * amp;
    const headY = 1.7 + bob;
    this.headband.position.set(this.x, lift + headY * Math.cos(lean), z - headY * Math.sin(lean));
    this.headband.rotation.set(-lean, this.yaw, 0);

    this.position.set(this.x, this.y, z);
    this.material.userData.uniforms.uRim.value = 0.6 + (this.dashing ? 0.8 : 0) + (this.boostTimer > 0 ? 0.6 : 0);
  }

  setGlow(color, strength) {
    const u = this.material.userData.uniforms;
    u.uRimColor.value.set(color);
    u.uRim.value = strength;
  }
}
