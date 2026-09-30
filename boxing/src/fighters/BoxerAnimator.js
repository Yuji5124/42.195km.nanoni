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

const STANCE = {
  footL: [0.13, 0, 0.2],
  footR: [-0.15, 0, -0.2],
  gloveL: [0.08, 1.45, 0.3],
  gloveR: [-0.07, 1.41, 0.15],
  elbowL: [0.42, 0.95, -0.15],
  elbowR: [-0.42, 0.95, -0.25],
};

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
    const bounce = Math.sin(t * 2 * Math.PI * 1.9) * 0.014;
    let hipY = 0.9 + bounce;
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
    // 足さばき（小さく交互に）
    const shuffle = Math.sin(t * 2 * Math.PI * 0.95) * 0.03;
    footL[2] += shuffle;
    footR[2] -= shuffle * 0.6;
    if (f.walk > 0.1) {
      const w = this.walkPhase;
      footL[2] += Math.sin(w) * 0.12;
      footR[2] += Math.sin(w + Math.PI) * 0.12;
      footL[1] = Math.max(0, Math.cos(w)) * 0.05;
      footR[1] = Math.max(0, -Math.cos(w)) * 0.05;
    }
    // ガード
    if (this.guard > 0.01) {
      const g = this.guard;
      gloveL = lerp3(gloveL, [0.075, 1.6, 0.21], g);
      gloveR = lerp3(gloveR, [-0.075, 1.58, 0.2], g);
      elbowL = lerp3(elbowL, [0.18, 1.1, 0.1], g);
      elbowR = lerp3(elbowR, [-0.18, 1.1, 0.1], g);
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
      const tgt = [target[0] * 0.92, target[1] - 0.04, target[2] - 0.12];
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

    Object.assign(P, { hipY, hipX, hipZ, hipRot, spine, chest, head, footL, footR, heelL, heelR, gloveL, gloveR, elbowL, elbowR });
    P.kneeL = [footL[0] * 1.3 + 0.05, 0.55, footL[2] + 0.6];
    P.kneeR = [footR[0] * 1.3 - 0.05, 0.55, footR[2] + 0.6];
    if (this.down > 0.5) P.kneeR = [-0.13, -0.2, 0.4];
    this.model.apply(P);
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
    let tx = cx - (az / al) * 1.5;
    let tz = cz + (ax / al) * 1.5;
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
    this.model.apply(P);
  }
}
