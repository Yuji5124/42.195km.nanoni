import { LEG } from './proceduralRig.js';
import { Spring, Spring2 } from './physics.js';
import { clamp, damp, lerp, smoothstep, fract } from '../core/mathx.js';

// 手続きアニメーション（アニメーションデータなし）。脚を前後に振るだけのアニメは使わない。
//
// - 足の接地は RaceCore の歩数（phase の整数 = 接地、偶数 = 左足）に合わせる → 足音・リズム判定と一致
// - 接地中の足は「今の速さぴったり」で後ろへ流す（2 ボーン IK）→ 足が滑らない
// - 骨盤の上下動・回旋、肩（胸）の逆回旋、腕振り、肘の遅れ、膝の引き上げ、足首、前傾、頭の安定
// - フォームは速さ・疲労・距離・スパートで変わる:
//     〜100m  スタートの加速（深い前傾）→ 楽に大きく
//     〜400m  落ち着いたリズム
//     〜700m  疲労: 肩が上がり、腕が体の前で交差、頭が揺れ、上体が後ろに残る（「顎が上がる」）
//     780m〜  ラストスパート: 膝を高く、腕を大きく、前傾
// - 髷・鉢巻・羽織・刀・上体・頭は少し遅れてついてくる（ばね）。暴れすぎないよう減衰は強め

export class RunnerAnimator {
  constructor(bones, { costume = false } = {}) {
    this.b = bones;
    this.costume = costume;
    this.springs = {
      top: new Spring2(70, 9, -0.25),
      band1: new Spring2(60, 6, -0.4),
      band2: new Spring(80, 7),
      haori: new Spring(55, 7),
      sword: new Spring2(120, 9, 0.38),
      chest: new Spring(90, 12),
      head: new Spring(110, 14),
    };
    this.reset();
  }

  reset() {
    this.lean = 0;
    this.air = 0;
    this.lastHipY = 0.93;
    this.hipVel = 0;
    this.lastV = 0;
    this.ready = 0;
    this.celebrate = 0;
    this.time = 0;
    this.form = { fatigue: 0, sprint: 0 };
    for (const s of Object.values(this.springs)) s.reset?.();
  }

  // 太腿 → 脛の IK（骨盤ローカル、骨盤の回転は小さいので無視）
  solveLeg(side, ty, tz, footPitch, hipY) {
    const b = this.b;
    const thigh = b[`upperLeg.${side}`];
    const knee = b[`lowerLeg.${side}`];
    const foot = b[`foot.${side}`];
    const hy = hipY - 0.04;
    const fwd = -tz;
    const down = hy - ty;
    let d = Math.hypot(fwd, down);
    const L1 = LEG.thigh;
    const L2 = LEG.shin;
    d = clamp(d, 0.1, (L1 + L2) * 0.999);
    const beta = Math.atan2(fwd, down);
    const cosHip = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const cosKnee = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
    const thighA = beta + Math.acos(cosHip);
    const flex = Math.PI - Math.acos(cosKnee);
    thigh.rotation.x = thighA;
    knee.rotation.x = -flex;
    foot.rotation.x = -(thighA - flex) + footPitch;
    return thighA;
  }

  // st: { dt, v, phase, stepFreq, stamina, d, burst, lateral, state, gravity, finished, won, reverse }
  update(st) {
    const dt = Math.min(0.05, st.dt);
    this.time += dt;
    const b = this.b;
    const v = Math.max(0, st.v);
    const moving = v > 0.5 && st.state !== 'marks' && st.state !== 'set';
    const gravity = st.gravity ?? 1;

    // ---- フォームの要素
    const sprint = smoothstep(6.5, 9.4, v) * 0.6 + (st.burst ? 0.4 : 0) + smoothstep(770, 792, st.d) * 0.35;
    const distFatigue = smoothstep(420, 740, st.d) * 0.45;
    const staminaFatigue = 1 - smoothstep(8, 60, st.stamina);
    const fatigue = clamp(Math.max(distFatigue, staminaFatigue) - (st.burst ? 0.25 : 0), 0, 1);
    const startDrive = st.d < 40 && moving ? 1 - smoothstep(0, 40, st.d) : 0;
    this.form.fatigue = damp(this.form.fatigue, fatigue, 2, dt);
    this.form.sprint = damp(this.form.sprint, clamp(sprint, 0, 1), 4, dt);
    const F = this.form.fatigue;
    const Sp = this.form.sprint;

    this.ready = damp(this.ready, st.state === 'marks' ? 0.6 : st.state === 'set' ? 1 : 0, 7, dt);
    this.celebrate = damp(this.celebrate, st.won && st.finished ? 1 : 0, 3, dt);

    // ---- 歩調（RaceCore の歩数から）。接地中の足の流れ = 速さ → 滑らない
    const cycle = Math.max(0.2, (st.stepFreq || 2.4) / 2);
    const duty = moving ? Math.min(0.36, (0.86 * cycle) / Math.max(0.5, v)) : 1;
    const sweep = moving ? (v * duty) / cycle : 0;
    const psiL = fract((st.phase ?? 0) / 2);
    const psiR = fract(((st.phase ?? 0) - 1) / 2);
    const lift = (0.13 + 0.32 * Sp) * (1 - 0.35 * F) * (gravity < 1 ? 1.6 : gravity > 1 ? 0.6 : 1);
    const kickBack = (0.1 + 0.2 * Sp) * (1 - 0.3 * F);

    // ---- 骨盤の高さ: 接地の真ん中で低く、空中で高い（重力が弱いと大きく弾む）
    const bobAmp = (0.012 + 0.028 * Sp + 0.012 * F) * (gravity < 1 ? 3.2 : gravity > 1 ? 0.35 : 1);
    const bob = moving ? -Math.cos(4 * Math.PI * (psiL - duty / 2)) * bobAmp : Math.sin(this.time * 1.8) * 0.004;
    let hipY = 0.93 - 0.03 * Sp - 0.02 * F + bob - this.ready * 0.16 - startDrive * 0.05;
    if (gravity > 1) hipY -= 0.08 * (gravity - 1);
    b.pelvis.position.y = hipY;
    const hipVel = (hipY - this.lastHipY) / Math.max(1e-3, dt);
    const hipAcc = (hipVel - this.hipVel) / Math.max(1e-3, dt);
    this.hipVel = hipVel;
    this.lastHipY = hipY;

    // ---- 脚
    const thighs = {};
    for (const [side, psi] of [['L', psiL], ['R', psiR]]) {
      let tz;
      let ty;
      let pitch = 0;
      if (!moving) {
        // 位置について / よーい: 片足前のスタンディングスタート。ゴール後は立ち止まる
        const front = side === 'L';
        tz = lerp(side === 'L' ? -0.02 : 0.02, front ? -0.36 : 0.34, this.ready);
        ty = LEG.ankle;
        pitch = !front ? -0.35 * this.ready : 0;
      } else if (psi < duty) {
        const u = psi / duty;
        tz = lerp(-sweep / 2, sweep / 2, u);
        ty = LEG.ankle;
        pitch = u > 0.65 ? -(u - 0.65) * 1.8 : 0; // つま先で蹴る
      } else {
        // 振り出し: 踵を引き上げ → 膝を前へ → 着地の位置へ
        const u = (psi - duty) / (1 - duty);
        const s1 = smoothstep(0.05, 0.95, u);
        tz = lerp(sweep / 2, -sweep / 2 - 0.02, s1) + kickBack * Math.sin(Math.PI * Math.min(1, u / 0.55)) * (1 - u);
        ty = LEG.ankle + lift * Math.pow(Math.sin(Math.PI * u), 0.75);
        pitch = -0.55 * Math.sin(Math.PI * u) * (1 - 0.3 * F);
      }
      thighs[side] = this.solveLeg(side, ty, tz, pitch, hipY);
    }

    // ---- 骨盤の回旋と肩の逆回旋、前傾
    const swing = moving ? Math.sin(2 * Math.PI * (psiL - duty / 2)) : 0;
    const twist = swing * (0.07 + 0.07 * Sp + 0.04 * F);
    b.pelvis.rotation.y = twist;
    b.pelvis.rotation.z = moving ? Math.cos(2 * Math.PI * (psiL - duty / 2)) * (0.03 + 0.03 * F) : 0;
    const accel = (v - this.lastV) / Math.max(1e-3, dt);
    this.lastV = v;
    // 前傾: 加速・スパートで深く、疲れると上体が後ろに残る
    const targetLean = -(0.05 + 0.18 * Sp + clamp(accel * 0.03, -0.05, 0.12) + startDrive * 0.4) + F * 0.12 * (1 - Sp) - this.ready * 0.55;
    this.lean = damp(this.lean, targetLean, 7, dt);
    const S = this.springs;
    const chestLag = S.chest.step(dt, -hipAcc * 0.004);
    b.spine.rotation.x = this.lean * 0.45;
    b.chest.rotation.x = this.lean * 0.55 + chestLag;
    b.chest.rotation.y = -twist * (1.35 - 0.3 * F);
    b.chest.rotation.z = clamp(-(st.lateral ?? 0) * 0.05, -0.1, 0.1);
    // 疲れると肩がすくむ（胸を少し持ち上げる）
    b.chest.position.y = 0.15 + F * 0.015;
    // 頭: 前傾を打ち消して視線を保つ。疲れると揺れて傾く（ばねで遅れて安定）
    const wobble = F * (0.07 * Math.sin(this.time * 5.3) + 0.05 * Math.sin(this.time * 8.1));
    const headTarget = -this.lean * 0.85 + wobble + (Sp > 0.7 ? 0.08 : 0) - F * 0.1;
    b.neck.rotation.x = S.head.step(dt, headTarget);
    b.head.rotation.x = -this.lean * 0.2;
    b.head.rotation.z = F * 0.08 * Math.sin(this.time * 3.1);
    b.head.rotation.y = twist * 0.5;

    // ---- 腕: 反対側の脚と逆に振る。肘は少し遅れて曲がる。疲れると体の前で交差
    const armAmp = (0.55 + 0.7 * Sp) * (1 - 0.25 * F);
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? -1 : 1;
      const upper = b[`upperArm.${side}`];
      const lower = b[`lowerArm.${side}`];
      const hand = b[`hand.${side}`];
      const legT = thighs[side];
      let ax = moving ? clamp(-legT * 1.05, -1.25, 1.25) * (armAmp / 1.1) : 0.06;
      let elbow = 1.25 + 0.35 * Sp + 0.1 * F + (moving ? Math.max(0, ax) * 0.3 : -0.9);
      let abd = 0.08 + 0.05 * Sp - 0.08 * F;
      let cross = F * 0.35;
      // よーい: 左腕後ろ・右腕前
      ax = lerp(ax, side === 'L' ? -0.7 : 0.8, this.ready);
      elbow = lerp(elbow, 1.35, this.ready);
      // ゴール後、1 着なら両手を上げる
      if (this.celebrate > 0.01) {
        ax = lerp(ax, 2.7, this.celebrate);
        elbow = lerp(elbow, 0.25, this.celebrate);
        abd = lerp(abd, 0.35, this.celebrate);
        cross = 0;
      }
      upper.rotation.x = ax;
      upper.rotation.z = sx * abd;
      upper.rotation.y = -sx * cross;
      // 肘の遅れ: 振りの向きが変わったあと少し遅れてたたむ
      lower.rotation.x = damp(lower.rotation.x, elbow, 14, dt);
      hand.rotation.x = -0.2;
    }

    // ---- ばね（衣装）
    if (this.costume) {
      const flutter = Math.sin(this.time * 19) * (0.06 + 0.16 * Sp);
      const g = gravity;
      S.top.x.v += hipAcc * 0.012;
      S.top.step(dt, -0.25 - v * 0.035, (st.lateral ?? 0) * 0.08);
      b.topknot.rotation.set(S.top.x.x, 0, S.top.y.x);
      S.band1.step(dt, -0.35 - Math.min(1.2, v * 0.1) - (g < 1 ? 0.6 : 0), (st.lateral ?? 0) * 0.1);
      b.bandTail1.rotation.set(S.band1.x.x + flutter * 0.4, 0, S.band1.y.x);
      b.bandTail2.rotation.x = S.band2.step(dt, flutter + S.band1.x.x * 0.2);
      // 羽織の背: 走ると後ろへあおられる
      S.haori.x = S.haori.x ?? 0;
      b.haori.rotation.x = -S.haori.step(dt, Math.min(0.9, v * 0.06) + (g < 1 ? 0.4 : 0));
      // 刀: 腰の上下とひねりで揺れる
      S.sword.x.v += hipAcc * 0.01;
      S.sword.step(dt, 0.38 + v * 0.004, -twist * 0.8 - (st.lateral ?? 0) * 0.03);
      b.sword.rotation.set(S.sword.x.x, 0.16, S.sword.y.x);
    }
  }
}
