import * as THREE from 'three';
import { PUNCHES } from '../core/FightCore.js';
import { RING } from '../arena/BoxingArena.js';

// Fighter の状態（FightCore）→ BoxerModel のポーズ。手続き的（アニメーションデータなし）。
//   構え: オーソドックス（左足・左拳が前）。膝を曲げ、あごを引き、軽く弾む
//   パンチ: グローブの目標点を相手の顔へ（2 ボーン IK）。ジャブは速く・ストレートは腰を回して後ろのかかとが上がる・
//           アッパーは沈んでから下から・フックは肘を上げて横から
//   テル（相手の予備動作）: 打つ手を引く・体をためる。最後の 3 割でグローブが光る（見える予告）
//   スリップ: 腰を横へ・上体を傾ける / ガード: 両拳で顔を覆う / 被弾: あごが上がって半歩下がる（痛がらない）
//   ダウン: 片膝をついて、拳をキャンバスへ（倒れ込まない）→ 立ち上がる / 勝利: 両拳を上げる / 休憩: コーナーの椅子
// 選手は何が起きても真顔。

const _v = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const smooth = (t) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// 構え: 肘は体の横にしまう（外に張らない）・膝は軽く曲げるだけ
const STANCE = {
  footL: [0.12, 0, 0.19],
  footR: [-0.14, 0, -0.19],
  gloveL: [0.12, 1.47, 0.32],
  gloveR: [-0.11, 1.43, 0.18],
  elbowL: [0.27, 1.02, -0.04],
  elbowR: [-0.27, 1.0, -0.08],
};

// ポーズのなめらかさ: 目標のポーズへ毎フレーム指数的に近づける（関節ごとの速さ）。
// パンチの拳だけは速く（キレを残す）、体幹はゆっくり（重さ）。
const VEC_KEYS = ['hipRot', 'spine', 'chest', 'head', 'footL', 'footR', 'gloveL', 'gloveR', 'elbowL', 'elbowR', 'kneeL', 'kneeR'];
const SCALAR_KEYS = ['hipY', 'hipX', 'hipZ', 'heelL', 'heelR', 'toeL', 'toeR'];
const RATE = { hipRot: 13, spine: 12, chest: 12, head: 14, footL: 22, footR: 22, gloveL: 20, gloveR: 20, elbowL: 16, elbowR: 16, kneeL: 16, kneeR: 16, hipY: 12, hipX: 12, hipZ: 12, heelL: 16, heelR: 16, toeL: 12, toeR: 12 };

export function smoothPose(state, P, dt, { fast = null, snap = false } = {}) {
  let sm = state.sm;
  if (!sm || snap || Math.hypot((sm.x ?? 0) - P.x, (sm.z ?? 0) - P.z) > 0.8) {
    sm = state.sm = { ...P };
    for (const k of VEC_KEYS) sm[k] = [...(P[k] ?? [0, 0, 0])];
    return sm;
  }
  for (const k of SCALAR_KEYS) {
    const a = 1 - Math.exp(-RATE[k] * dt);
    sm[k] = (sm[k] ?? 0) + ((P[k] ?? 0) - (sm[k] ?? 0)) * a;
  }
  for (const k of VEC_KEYS) {
    const rate = fast && fast[k] ? fast[k] : RATE[k];
    const a = 1 - Math.exp(-rate * dt);
    const t = P[k] ?? [0, 0, 0];
    const v = sm[k];
    v[0] += (t[0] - v[0]) * a;
    v[1] += (t[1] - v[1]) * a;
    v[2] += (t[2] - v[2]) * a;
  }
  sm.x = P.x;
  sm.z = P.z;
  sm.y = P.y;
  // 向きは回り込み（±π）に注意して近づける
  let dy = P.yaw - (sm.yaw ?? P.yaw);
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  sm.yaw = (sm.yaw ?? P.yaw) + dy * (1 - Math.exp(-18 * dt));
  return sm;
}

export class BoxerAnimator {
  constructor(model, fighter) {
    this.model = model;
    this.f = fighter;
    this.time = Math.random() * 10;
    this.slip = 0;
    this.guard = 0;
    this.down = 0;
    this.hit = 0;
    this.walkPhase = 0;
    this.tellGlow = 0;
    this.pose = {};
    this.override = null; // 入場・休憩・勝利などモード側からの上書き
  }

  // 相手の頭（ワールド）をモデルの中の座標へ
  toLocal(world) {
    this.model.root.updateMatrixWorld();
    _inv.copy(this.model.root.matrixWorld).invert();
    const v = _v.copy(world).applyMatrix4(_inv);
    return [v.x, v.y, v.z];
  }

  update(dt, { opponentHead, tell = null } = {}) {
    const f = this.f;
    this.time += dt;
    const t = this.time;
    const act = this.override?.action ?? f.action;
    // なめらかにする値
    const k = (rate) => 1 - Math.exp(-rate * dt);
    this.slip += ((act === 'slip' ? f.slipDir : 0) - this.slip) * k(18);
    this.guard += ((f.guard > 0.5 || act === 'guard' ? 1 : 0) - this.guard) * k(16);
    this.down += ((act === 'down' ? 1 : 0) - this.down) * k(act === 'down' ? 5 : 2.2);
    this.hit = Math.max(this.hit - dt * 3, f.hitT > 0 ? f.hitT / 0.35 : 0);
    this.walkPhase += dt * (f.walk > 0.1 ? 9 : 0);

    const P = this.pose;
    P.x = this.override?.x ?? f.x;
    P.z = this.override?.z ?? f.z;
    P.y = RING.y;
    if (this.override?.y !== undefined) P.y = this.override.y;
    P.yaw = this.override?.yaw ?? f.yaw;

    // ---- 構え（基本）
    const bounce = Math.sin(t * 2 * Math.PI * 1.9) * 0.012;
    let hipY = 0.935 + bounce;
    let hipX = 0;
    let hipZ = 0;
    const hipRot = [0.06, -0.38, 0];
    const spine = [0.08, -0.08, 0];
    const chest = [0.04, -0.06, 0];
    const head = [0.14, 0.5, 0];
    let footL = [...STANCE.footL];
    let footR = [...STANCE.footR];
    let heelR = 0.25;
    let heelL = 0;
    let gloveL = [...STANCE.gloveL];
    let gloveR = [...STANCE.gloveR];
    let elbowL = [...STANCE.elbowL];
    let elbowR = [...STANCE.elbowR];
    // 足さばき: 足は床に置いたまま（すべらない）。体が動いたら 1 歩ずつ踏みかえる（plantFeet）
    // 体重移動: 腰がわずかに左右へ
    hipX += Math.sin(t * 2 * Math.PI * 0.48) * 0.012;
    // 呼吸: 胸が少しふくらむ
    chest[0] += Math.sin(t * 2 * Math.PI * 0.35) * 0.015;
    // ガード
    if (this.guard > 0.01) {
      const g = this.guard;
      // 大きな頭の前（あごと口）を両方のグローブで隠す
      gloveL = lerp3(gloveL, [0.1, 1.6, 0.33], g);
      gloveR = lerp3(gloveR, [-0.1, 1.58, 0.32], g);
      elbowL = lerp3(elbowL, [0.2, 1.12, 0.12], g);
      elbowR = lerp3(elbowR, [-0.2, 1.12, 0.12], g);
      head[0] += 0.2 * g;
      hipY -= 0.03 * g;
      spine[0] += 0.08 * g;
    }
    // スリップ（-1 = 左へ / +1 = 右へ。モデルの左は +X）
    if (Math.abs(this.slip) > 0.01) {
      const s = this.slip;
      hipX = -s * 0.2;
      hipY -= Math.abs(s) * 0.08;
      spine[2] += s * 0.22;
      chest[2] += s * 0.12;
      head[2] -= s * 0.15;
      gloveL = lerp3(gloveL, [gloveL[0] - s * 0.12, gloveL[1] - 0.05, gloveL[2]], Math.abs(s));
      gloveR = lerp3(gloveR, [gloveR[0] - s * 0.12, gloveR[1] - 0.05, gloveR[2]], Math.abs(s));
    }
    // 被弾: あごが上がり、半歩下がる
    if (this.hit > 0.01) {
      const h = this.hit;
      head[0] -= 0.45 * h;
      head[1] += (f.hitDir ?? 0) * 0.5 * h;
      chest[0] -= 0.18 * h;
      hipZ -= 0.08 * h;
      gloveL[1] -= 0.08 * h;
      gloveR[1] -= 0.08 * h;
    }
    // ぐらつき（スタン）: 拳が下がる
    if (act === 'stun' || f.stun > 0.05) {
      const w = Math.sin(t * 5) * 0.06;
      gloveL = lerp3(gloveL, [0.16, 1.2, 0.22], 0.7);
      gloveR = lerp3(gloveR, [-0.16, 1.18, 0.2], 0.7);
      spine[2] += w;
      head[0] += 0.1;
    }

    // ---- パンチ
    this.tellGlow = 0;
    const target = opponentHead ? this.toLocal(opponentHead) : [0, 1.6, 1.1];
    if (act === 'punch' && f.punch) {
      const pu = f.punch;
      const def = PUNCHES[pu.type];
      let e = 0;
      if (pu.phase === 'windup') e = -0.25 * ease(pu.t / def.windup);
      else if (pu.phase === 'strike') e = ease(pu.t / def.strike);
      else e = 1 - smooth(pu.t / def.recover);
      const n = def.hand;
      const home = n === 'L' ? gloveL : gloveR;
      const tgt = [target[0] * 0.92, target[1] - 0.06, target[2] - 0.24];
      let g;
      if (pu.type === 'upper') {
        const low = [n === 'L' ? 0.1 : -0.08, 1.05, 0.22];
        g = e < 0 ? lerp3(home, low, -e * 4) : e < 0.5 ? lerp3(low, [tgt[0], tgt[1] - 0.3, tgt[2] - 0.05], e * 2) : lerp3([tgt[0], tgt[1] - 0.3, tgt[2] - 0.05], tgt, (e - 0.5) * 2);
        hipY -= 0.08 * (1 - Math.abs(e));
        spine[0] -= 0.1 * Math.max(0, e);
        if (n === 'R') elbowR = [-0.25, 0.8, 0.1];
      } else if (pu.type === 'hook') {
        const side = n === 'L' ? 1 : -1;
        const wide = [side * 0.5, tgt[1], 0.22];
        g = e < 0 ? lerp3(home, [side * 0.3, home[1], home[2] - 0.05], -e * 4) : e < 0.6 ? lerp3(home, wide, e / 0.6) : lerp3(wide, tgt, (e - 0.6) / 0.4);
        const el = [side * 0.7, 1.55, 0.05];
        if (n === 'L') elbowL = el;
        else elbowR = el;
        hipRot[1] += side * -0.35 * Math.max(0, e);
      } else {
        g = e < 0 ? lerp3(home, [home[0], home[1] - 0.02, home[2] + e * 0.4], 1) : lerp3(home, tgt, e);
      }
      if (n === 'L') gloveL = g;
      else gloveR = g;
      // 腰の回転（ストレート・アッパーは大きく）
      const turn = pu.type === 'straight' || (pu.type === 'upper' && n === 'R') ? 0.5 : pu.type === 'jab' ? -0.12 : 0.2;
      hipRot[1] += turn * Math.max(0, e);
      chest[1] += turn * 0.6 * Math.max(0, e);
      head[1] -= turn * 1.1 * Math.max(0, e);
      if (pu.type === 'straight') {
        heelR = 0.25 + 0.45 * Math.max(0, e);
        hipZ += 0.07 * Math.max(0, e);
        spine[0] += 0.08 * Math.max(0, e);
      }
      if (pu.type === 'jab') hipZ += 0.04 * Math.max(0, e);
    }
    // テル（相手の予備動作）: 打つ手を引く・ためる
    if (act === 'tell' && tell) {
      const k2 = smooth(tell.k);
      const type = tell.type;
      if (type === 'jab') {
        gloveL = lerp3(gloveL, [0.12, 1.4, 0.12], k2 * 0.8);
        hipY -= 0.03 * k2;
      } else if (type === 'straight') {
        gloveR = lerp3(gloveR, [-0.22, 1.42, -0.12], k2);
        hipRot[1] -= 0.3 * k2;
        heelL = 0.1 * k2;
      } else if (type === 'hook') {
        gloveL = lerp3(gloveL, [0.42, 1.5, 0.05], k2);
        elbowL = [0.7, 1.5, -0.1];
        hipRot[1] += 0.25 * k2;
      } else {
        gloveR = lerp3(gloveR, [-0.12, 0.98, 0.05], k2);
        hipY -= 0.12 * k2;
        spine[0] += 0.12 * k2;
      }
      this.tellGlow = tell.k > 0.62 ? (tell.k - 0.62) / 0.38 : 0;
      this.tellHand = type === 'straight' || type === 'upper' ? 'R' : 'L';
    }

    // ---- ダウン（片膝）
    if (this.down > 0.01) {
      const d = this.down;
      hipY = hipY + (0.58 - hipY) * d;
      footL = lerp3(footL, [0.15, 0, 0.32], d);
      footR = lerp3(footR, [-0.13, 0, -0.52], d);
      heelR = heelR + (1.1 - heelR) * d;
      gloveL = lerp3(gloveL, [0.15, 0.72, 0.36], d);
      gloveR = lerp3(gloveR, [-0.22, 0.14, 0.12], d);
      elbowL = lerp3(elbowL, [0.4, 0.9, 0], d);
      elbowR = lerp3(elbowR, [-0.5, 0.6, -0.1], d);
      hipRot[1] *= 1 - d;
      spine[0] += 0.12 * d;
      head[0] += 0.3 * d;
      head[1] *= 1 - d;
      hipZ *= 1 - d;
      hipX *= 1 - d;
    }

    // ---- モード側の上書き（入場・休憩・勝利）
    const o = this.override;
    if (o?.pose === 'rest') {
      // コーナーの椅子
      hipY = 0.58;
      footL = [0.2, 0, 0.42];
      footR = [-0.2, 0, 0.42];
      heelR = 0;
      gloveL = [0.32, 0.7, 0.28];
      gloveR = [-0.32, 0.7, 0.28];
      elbowL = [0.6, 0.9, -0.2];
      elbowR = [-0.6, 0.9, -0.2];
      hipRot[1] = 0;
      spine[0] = 0.05;
      head[1] = 0;
      head[0] = 0.05 + Math.sin(t * 0.8) * 0.03;
    } else if (o?.pose === 'win') {
      gloveL = [0.28, 2.05, 0.08];
      gloveR = [-0.28, 2.05, 0.08];
      elbowL = [0.6, 1.8, -0.1];
      elbowR = [-0.6, 1.8, -0.1];
      hipRot[1] = 0;
      head[0] = -0.12;
      head[1] = 0;
      hipY = 0.95 + Math.max(0, Math.sin(t * 6)) * 0.05;
    } else if (o?.pose === 'walk') {
      const w = t * 7;
      hipRot[1] = 0;
      head[1] = 0;
      head[0] = 0.05;
      footL = [0.12, Math.max(0, Math.cos(w)) * 0.08, Math.sin(w) * 0.25];
      footR = [-0.12, Math.max(0, -Math.cos(w)) * 0.08, Math.sin(w + Math.PI) * 0.25];
      heelR = 0;
      hipY = 0.95 + Math.abs(Math.cos(w)) * 0.02;
      gloveL = [0.2, 1.1 + Math.sin(w + Math.PI) * 0.03, 0.12 + Math.sin(w + Math.PI) * 0.1];
      gloveR = [-0.2, 1.1 + Math.sin(w) * 0.03, 0.12 + Math.sin(w) * 0.1];
    } else if (o?.pose === 'bow') {
      // 試合後: 相手に一礼（真面目）
      hipRot[1] = 0;
      spine[0] = 0.45;
      head[0] = 0.3;
      head[1] = 0;
      gloveL = [0.2, 1.0, 0.2];
      gloveR = [-0.2, 1.0, 0.2];
      footL = [0.12, 0, 0.05];
      footR = [-0.12, 0, -0.05];
      heelR = 0;
    }

    // 足を床に置く（リングの上で立っている時だけ。入場・休憩・勝利などの特別なポーズとダウンでは使わない）
    P.x = this.override?.x ?? f.x;
    P.z = this.override?.z ?? f.z;
    if (!o?.pose && this.down < 0.05 && act !== 'down') [footL, footR] = this.plantFeet(dt, P.x, P.z, P.yaw, footL, footR);
    else this.plant = null;
    // つま先は腰の向きに少しそろえる（半身の構え）。膝はつま先の方向へ曲げる
    const blade = o?.pose ? 0 : 1 - this.down;
    const toeL = -0.28 * blade;
    const toeR = -0.62 * blade;
    Object.assign(P, { hipY, hipX, hipZ, hipRot, spine, chest, head, footL, footR, heelL, heelR, gloveL, gloveR, elbowL, elbowR, toeL, toeR });
    P.kneeL = [footL[0] + Math.sin(toeL) * 0.6 + 0.03, 0.55, footL[2] + Math.cos(toeL) * 0.6];
    P.kneeR = [footR[0] + Math.sin(toeR) * 0.6 - 0.03, 0.55, footR[2] + Math.cos(toeR) * 0.6];
    if (this.down > 0.5) P.kneeR = [-0.13, -0.2, 0.4];
    // なめらかにしてから当てる（パンチの拳だけ速く）
    const punching = act === 'punch' && f.punch ? PUNCHES[f.punch.type].hand : null;
    const fast = punching ? { [`glove${punching}`]: 42, [`elbow${punching}`]: 30, hipRot: 20, chest: 20 } : act === 'hit' ? { head: 26, chest: 20 } : null;
    const sm = smoothPose(this, P, dt, { fast, snap: this.snapNext });
    // 置いた足はワールドで固定: なめらかにした後の体の位置・向きで足の位置を計算し直す（すべらない）
    if (this.plant) {
      const c = Math.cos(sm.yaw);
      const sn = Math.sin(sm.yaw);
      for (const n of ['L', 'R']) {
        const st = this.plant[n];
        const dx = st.w[0] - sm.x;
        const dz = st.w[1] - sm.z;
        const k = `foot${n}`;
        sm[k][0] = dx * c - dz * sn;
        sm[k][2] = dx * sn + dz * c;
        sm[k][1] = st.lift ?? 0;
      }
    }
    this.model.apply(sm);
    this.model.updateBlink?.(dt);
    this.snapNext = false;
  }

  // 足の踏みかえ: 足の位置はワールドで固定し、体（root）が動いて目標から離れたら、弧を描いて 1 歩で置き直す。
  // 片足ずつ（もう片方が着地している時だけ）。大きく離れたら（押し戻し・瞬間移動）すぐ置き直す。
  plantFeet(dt, x, z, yaw, fl, fr) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const toW = (f) => [x + f[0] * c + f[2] * s, z - f[0] * s + f[2] * c];
    const toL = (w) => {
      const dx = w[0] - x;
      const dz = w[1] - z;
      return [dx * c - dz * s, dx * s + dz * c];
    };
    if (!this.plant) this.plant = { L: { w: toW(fl), t: 1 }, R: { w: toW(fr), t: 1 } };
    const out = [];
    for (const n of ['L', 'R']) {
      const ft = n === 'L' ? fl : fr;
      const want = toW(ft);
      const st = this.plant[n];
      const other = this.plant[n === 'L' ? 'R' : 'L'];
      const d = Math.hypot(want[0] - st.w[0], want[1] - st.w[1]);
      if (d > 0.7) {
        st.w = want;
        st.t = 1;
      } else if (st.t >= 1 && (d > 0.08 && other.t >= 1 || d > 0.22)) {
        st.from = st.w;
        st.t = 0;
      }
      let lift = 0;
      if (st.t < 1) {
        st.t = Math.min(1, st.t + dt / 0.17);
        const e = st.t * st.t * (3 - 2 * st.t);
        st.w = [st.from[0] + (want[0] - st.from[0]) * e, st.from[1] + (want[1] - st.from[1]) * e];
        lift = Math.sin(Math.PI * st.t) * 0.055;
      }
      st.lift = ft[1] + lift;
      const l = toL(st.w);
      out.push([l[0], ft[1] + lift, l[1]]);
    }
    return out;
  }
}

// レフェリー: 2 人の横で見守る / ダウンではカウント（腕を振る）/ 勝者の手を上げる
export class RefereeAnimator {
  constructor(model) {
    this.model = model;
    this.x = 0;
    this.z = 1.4;
    this.yaw = 0;
    this.time = 0;
    this.mode = 'watch';
    this.countArm = 0;
    this.pose = {};
  }

  update(dt, { px, pz, ex, ez, down = null, count = 0, raise = null }) {
    this.time += dt;
    const t = this.time;
    // 立ち位置: 2 人を結ぶ線の横、少し離れて
    const cx = (px + ex) / 2;
    const cz = (pz + ez) / 2;
    const ax = ex - px;
    const az = ez - pz;
    const al = Math.hypot(ax, az) || 1;
    // 自分（赤）から見て左側に立つ（肩越しのカメラの反対側）
    let tx = cx + (az / al) * 1.6;
    let tz = cz - (ax / al) * 1.6;
    let look = [cx, cz];
    if (down) {
      tx = down.x + (down.x > 0 ? -0.9 : 0.9);
      tz = down.z + 0.6;
      look = [down.x, down.z];
    }
    if (raise) {
      tx = raise.x + 0.45;
      tz = raise.z + 0.25;
      look = [0, -5];
    }
    const lim = RING.half - 0.4;
    tx = Math.max(-lim, Math.min(lim, tx));
    tz = Math.max(-lim, Math.min(lim, tz));
    const dx = tx - this.x;
    const dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    const sp = Math.min(dist * 3, 2.2);
    if (dist > 0.02) {
      this.x += (dx / dist) * sp * dt;
      this.z += (dz / dist) * sp * dt;
    }
    const want = Math.atan2(look[0] - this.x, look[1] - this.z);
    let dy = want - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 6);
    const walking = sp > 0.3;
    const w = t * 8;
    const P = this.pose;
    P.x = this.x;
    P.z = this.z;
    P.y = RING.y;
    P.yaw = this.yaw;
    P.hipY = 0.96 + (walking ? Math.abs(Math.cos(w)) * 0.015 : 0);
    P.hipRot = [0, 0, 0];
    P.spine = [0.05, 0, 0];
    P.chest = [0, 0, 0];
    P.head = [0.05, 0, 0];
    P.footL = walking ? [0.11, Math.max(0, Math.cos(w)) * 0.06, Math.sin(w) * 0.18] : [0.12, 0, 0.02];
    P.footR = walking ? [-0.11, Math.max(0, -Math.cos(w)) * 0.06, Math.sin(w + Math.PI) * 0.18] : [-0.12, 0, -0.02];
    P.heelL = 0;
    P.heelR = 0;
    P.gloveL = [0.22, 0.95, 0.1];
    P.gloveR = [-0.22, 0.95, 0.1];
    P.elbowL = [0.5, 1.0, -0.2];
    P.elbowR = [-0.5, 1.0, -0.2];
    if (down) {
      // カウント: 右腕を上げて振り下ろす（1 秒ごと）
      const ph = (count % 1 + 1) % 1;
      const up = ph < 0.5 ? smooth(ph * 2) : 1 - smooth((ph - 0.5) * 2);
      P.gloveR = lerp3([-0.25, 1.0, 0.35], [-0.2, 2.0, 0.25], up);
      P.elbowR = [-0.6, 1.4, 0];
      P.spine = [0.25, 0, 0];
      P.head = [0.15, 0, 0];
    }
    if (raise) {
      P.gloveL = [0.3, 2.1, 0.05];
      P.elbowL = [0.6, 1.8, 0];
    }
    P.kneeL = [P.footL[0] * 1.3, 0.55, P.footL[2] + 0.6];
    P.kneeR = [P.footR[0] * 1.3, 0.55, P.footR[2] + 0.6];
    this.model.apply(smoothPose(this, P, dt));
  }
}
