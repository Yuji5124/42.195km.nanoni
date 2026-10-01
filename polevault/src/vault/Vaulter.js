import * as THREE from 'three';
import { Figure, SKINS, HAIRS } from '../people/Figure.js';
import { makePose, blendPose, applyPose, P, lookAtWorld } from '../people/Poses.js';
import { Pole } from './Pole.js';
import { RUNWAY, BOX, BAR, PIT, TAKEOFF_X, GRIP, POLE_LEN, BENCH } from '../stadium/field.js';
import { clamp, smoothstep } from '../../../src/core/math.js';

// 棒高跳びの選手（1 人）。競技は真面目に作る（笑いの対象はカメラマンの視線で、競技そのものではない）。
//
//   時刻で決まる試技の流れ（Competition が絶対時刻を渡す。?t= のワープでも同じ姿になる）:
//     歩いて助走路の始まりへ → 儀式（バーを見る・観客に手拍子を求める・ポールを構えて体をゆらす）
//     → 助走（加速・ポールを少しずつ下ろす）→ 突っ込み（両手を頭上へ・先端をボックスへ）
//     → ポール（しなる弧。体は振り上げ → 逆さ → 半ひねり → 突き放し）
//     → 空中（バーの上をうつ伏せで越える / 足りなければバーに触れる）→ 落下（ひねって背中からマット）
//     → 反応（成功: 起き上がって跳ねる・笑顔 / 失敗: 頭を抱える）→ 歩いてベンチへ
//   右利き: 上の手 = 右手、ポールは体の右（カメラ側）に持つ。左足で踏み切る。
//
// 体の向き: 縦の面（x–y）の中の角度 φ（0 = 立つ、π/2 = 頭が助走路側の水平、π = 逆さ）と、体の軸まわりのひねり ψ。

export const T_RUN = 5.2;
export const T_POLE = 1.25;
const G = 9.81;
const HAND_Z = 0.16; // 手（ポール）は助走路の中心線よりカメラ側

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _hL = new THREE.Vector3();
const _hR = new THREE.Vector3();
const _pL = new THREE.Vector3();
const _pR = new THREE.Vector3();

// 体の向き（u = 足 → 頭、f = お腹の向き）→ クォータニオン（モデル: +Y 上、+Z 前、+X 左）
function quatUF(u, f, out = new THREE.Quaternion()) {
  _Y.copy(u).normalize();
  _Z.copy(f).addScaledVector(_Y, -f.dot(_Y)).normalize();
  _X.crossVectors(_Y, _Z);
  _m.makeBasis(_X, _Y, _Z);
  return out.setFromRotationMatrix(_m);
}

// 縦の面の体の角度 φ と、ひねり ψ（ψ が負 = お腹がカメラ側を通る）
function bodyAxes(phi, psi, u, f) {
  u.set(-Math.sin(phi), Math.cos(phi), 0);
  const f0x = Math.cos(phi);
  const f0y = Math.sin(phi);
  // f = f0 cos ψ + (0,0,-1) sin ψ
  f.set(f0x * Math.cos(psi), f0y * Math.cos(psi), -Math.sin(psi));
}

// キーフレーム（[k, v], ...）を smoothstep でつなぐ
function keys(list, k) {
  if (k <= list[0][0]) return list[0][1];
  for (let i = 0; i < list.length - 1; i++) {
    const [k0, v0] = list[i];
    const [k1, v1] = list[i + 1];
    if (k <= k1) {
      const e = (k - k0) / (k1 - k0);
      return v0 + (v1 - v0) * e * e * (3 - 2 * e);
    }
  }
  return list[list.length - 1][1];
}

const ease = (k) => k * k * (3 - 2 * k);

export class Vaulter {
  constructor(scene, info, benchIndex) {
    this.info = info;
    const fig = new Figure({
      build: 'athlete',
      hair: info.hair ?? 'short',
      top: 'singlet',
      bottom: 'shorts',
      extras: info.extras ?? [],
      colors: { skin: info.skin ?? SKINS[1], hair: info.hairColor ?? HAIRS[0], top: info.color, bottom: info.shorts ?? 0x1a1c24, shoe: info.shoe ?? 0xf2f2f2, acc: info.acc ?? 0xffffff, acc2: 0x222222 },
    });
    fig.mesh.castShadow = true;
    fig.u.uRim.value = 0.42;
    this.fig = fig;
    scene.add(fig.root);
    this.pole = new Pole(info.poleColor ?? 0x1c2230, info.tape ?? 0xffd23f);
    scene.add(this.pole.mesh);
    this.pose = makePose();
    this.tgt = makePose();
    this.hipY = fig.B.hipY;
    this.attempts = [];
    this.bench = { x: BENCH.x - BENCH.len / 2 + 1.0 + benchIndex * 1.55, z: BENCH.z - 0.05 };
    this.pos = new THREE.Vector3(this.bench.x, 0, this.bench.z);
    this.yaw = Math.PI;
    this.walkPhase = 0;
    this.phase = { name: 'bench', k: 0 };
    this.look = null;
    this.cheerUntil = -1;
    this.lastT = 0;
    this.poleRest = new THREE.Vector3(this.bench.x + 0.3, 0.03, this.bench.z + 1.1);
    this.state = 'bench';
    this.world = new THREE.Vector3();
  }

  addAttempt(a) {
    this.attempts.push(a);
    this.attempts.sort((x, y) => x.t0 - y.t0);
  }

  // いまの試技（歩き始め〜反応の終わり）
  currentAttempt(t) {
    for (const a of this.attempts) if (t >= a.t0 - a.walkIn && t < a.tEnd) return a;
    return null;
  }

  lastAttemptBefore(t) {
    let last = null;
    for (const a of this.attempts) if (a.tEnd <= t) last = a;
    return last;
  }

  // ------------------------------------------------------------------
  update(t, dt, ctx) {
    this.lastT = t;
    const fig = this.fig;
    const a = this.currentAttempt(t);
    let worldArms = false;
    let rootQ = null;
    const tgt = this.tgt;
    let blendK = 1 - Math.exp(-dt * 10);
    if (a) {
      const r = this.attemptPose(t, a, tgt, ctx);
      worldArms = r.worldArms;
      rootQ = r.rootQ;
      if (r.snap) blendK = 1;
    } else {
      this.idlePose(t, dt, tgt, ctx);
    }
    // 根元（足元）の位置と向き
    if (rootQ) fig.root.quaternion.copy(rootQ);
    else fig.root.quaternion.setFromAxisAngle(_v.set(0, 1, 0), this.yaw);
    fig.root.position.copy(this.pos);
    blendPose(this.pose, tgt, blendK);
    if (this.look && !worldArms) lookAtWorld(fig, this.pose, this.look, { headY: 1.6 });
    applyPose(fig, this.pose, !worldArms);
    if (worldArms) this.solveWorldArms();
    fig.updateFace(dt);
    fig.root.updateMatrixWorld(true);
    this.world.copy(this.pos);
  }

  // 世界の座標の手の目標（_hL _hR）と肘の向き（_pL _pR）で腕を IK
  solveWorldArms() {
    const fig = this.fig;
    fig.root.updateMatrixWorld(true);
    const chest = fig.bones.chest;
    _inv.copy(chest.matrixWorld).invert();
    const tl = _hL.clone().applyMatrix4(_inv);
    const tr = _hR.clone().applyMatrix4(_inv);
    const pl = _pL.clone().applyMatrix4(_inv);
    const pr = _pR.clone().applyMatrix4(_inv);
    fig.armIK('L', tl, pl);
    fig.armIK('R', tr, pr);
  }

  // ------------------------------------------------------------------
  // 試技がない時: ベンチに座る / ベンチへ歩いて戻る / 優勝が決まって喜ぶ
  idlePose(t, dt, o, ctx) {
    const last = this.lastAttemptBefore(t);
    const fig = this.fig;
    // 前の試技の後: ベンチへ歩く（試技の終わりの場所 → ベンチ）
    const path = last ? this.walkPath(last) : null;
    const target = _v.set(this.bench.x, 0, this.bench.z);
    let walking = false;
    if (path) {
      const speed = 2.2;
      const d = (t - last.tEnd) * speed;
      const p = pointOnPath(path, d);
      if (p) {
        walking = true;
        this.pos.set(p.x, p.y, p.z);
        this.yaw = Math.atan2(p.dx, p.dz);
        this.walkPhase = d * (Math.PI / 0.95);
        P.walk(o, this.walkPhase, 1.25, this.hipY);
        o.spineX = 0.04;
        o.headX = 0.1;
        fig.setExpr(last.clear ? 'smile' : 'sigh');
      }
    }
    if (!walking) {
      this.pos.copy(target);
      this.yaw = Math.PI;
      P.sitBase(o, { seatY: 0.56 });
      P.lap(o);
      o.headX = 0.05;
      o.headY = 0;
      o.spineX = 0.12;
      fig.setExpr(this.info.benchFace ?? 'neutral');
      // ベンチでの小さな癖（タオル・ストレッチ・水）
      const cyc = (t + this.info.seed * 7) % 14;
      if (cyc < 2.2) P.stretch(o);
      else if (cyc > 9 && cyc < 11) P.chin(o);
    }
    // 優勝が決まった瞬間（ベンチ・歩いている途中でも）
    if (t < this.cheerUntil) {
      P.cheer(o, t);
      o.headX = -0.25;
      fig.setExpr('laugh');
    }
    // 歩いている間はポールを持って帰る / ベンチではベンチの横に置いてある
    if (walking) this.carryPoleRest(t);
    else this.pole.straight(this.poleRest, _w.set(1, 0, 0.02).normalize());
    this.phase = { name: walking ? 'walk' : 'bench', k: 0 };
    void dt;
    void ctx;
  }

  walkPath(a) {
    if (a._path) return a._path;
    // マット → マットの横（カメラ側）→ 助走路の横を通ってベンチへ
    const end = a.endPos ?? new THREE.Vector3(23.4, PIT.h, RUNWAY.z + 0.4);
    const pts = [
      [end.x, end.y, end.z],
      [end.x - 0.4, PIT.h, PIT.z1 - 0.3],
      [end.x - 0.6, 0, PIT.z1 + 1.4],
      [BOX.x - 3, 0, RUNWAY.z + 4.2],
      [this.bench.x + 1.2, 0, RUNWAY.z + 4.4],
      [this.bench.x, 0, this.bench.z],
    ];
    a._path = buildPath(pts);
    return a._path;
  }

  // ------------------------------------------------------------------
  attemptPose(t, a, o, ctx) {
    const fig = this.fig;
    const out = { worldArms: false, rootQ: null, snap: false };
    const start = _v.set(RUNWAY.start, 0, RUNWAY.z);
    if (t < a.t0) {
      // 歩いて助走路の始まりへ（今いる所から、間に合う速さで）
      if (!a._walkFrom) a._walkFrom = this.pos.clone();
      const from = a._walkFrom;
      const k = clamp((t - (a.t0 - a.walkIn)) / a.walkIn, 0, 1);
      const p = from.clone().lerp(start, ease(k));
      const dist = from.distanceTo(start);
      this.pos.copy(p);
      this.pos.y = 0;
      if (dist > 0.3 && k < 0.98) {
        this.yaw = Math.atan2(start.x - from.x, start.z - from.z);
        this.walkPhase = k * dist * (Math.PI / 0.9);
        P.walk(o, this.walkPhase, 1.2, this.hipY);
      } else {
        P.standBase(o, this.hipY);
        P.armsDown(o);
        this.yaw = Math.PI / 2;
      }
      fig.setExpr('serious');
      this.carryPoleRest(t);
      this.phase = { name: 'walkin', k };
      if (t < this.cheerUntil) {
        P.cheer(o, t);
        fig.setExpr('laugh');
      }
      return out;
    }
    if (t < a.tRun) return this.ritual(t, a, o, out);
    if (t < a.tTO) return this.run(t, a, o, out);
    if (t < a.tRel) return this.poleVault(t, a, o, out);
    if (t < a.tLand) return this.flight(t, a, o, out, ctx);
    return this.react(t, a, o, out, ctx);
  }

  // 儀式: バーを見る → （手拍子を求める）→ ポールを構えてゆれる
  ritual(t, a, o, out) {
    const fig = this.fig;
    const dur = a.tRun - a.t0;
    const k = (t - a.t0) / dur;
    const left = a.tRun - t;
    this.yaw = Math.PI / 2;
    const rock = left < 1.4 ? Math.sin((1.4 - left) * 4.5) * 0.12 : 0;
    this.pos.set(RUNWAY.start + rock, 0, RUNWAY.z);
    P.standBase(o, this.hipY);
    o.spineX = 0.05;
    fig.setExpr('serious');
    // ポールを立てて持つ → 最後に構える
    const carry = smoothstep(1.3, 0.4, left);
    const pelvis = this.pelvisFromRoot();
    const R = _hR.set(pelvis.x - 0.05, pelvis.y + 0.05, pelvis.z + 0.22);
    const ang = THREE.MathUtils.degToRad(84 - carry * 16);
    const dir = _w.set(Math.cos(ang), Math.sin(ang), -0.04).normalize();
    const L = _hL.copy(R).addScaledVector(dir, 0.6);
    _pR.set(pelvis.x - 0.4, pelvis.y + 0.1, pelvis.z + 0.6);
    _pL.set(pelvis.x - 0.3, pelvis.y + 0.2, pelvis.z - 0.5);
    let worldArms = true;
    // 手拍子を求める（左手を上げて振る。ポールは右手だけ）
    const clapK = this.info.clapper ? Math.max(0, Math.min(1, Math.min((k - 0.18) / 0.08, (0.62 - k) / 0.08))) : 0;
    if (clapK > 0) {
      _hL.set(pelvis.x + 0.1, pelvis.y + 0.95 + 0.08 * Math.sin(t * 7) * clapK, pelvis.z - 0.25);
      _hL.lerpVectors(L, _hL, clapK);
      _pL.set(pelvis.x, pelvis.y, pelvis.z - 0.8);
      fig.setExpr(clapK > 0.5 ? 'shout' : 'serious');
    }
    // 最後の一瞬: バーをにらむ
    if (k < 0.18 || left < 2.5) o.headX = -0.12;
    const tip = _v.copy(R).addScaledVector(dir, GRIP);
    this.pole.straight(tip, dir.clone().negate());
    this.phase = { name: 'ritual', k, clap: clapK };
    out.worldArms = worldArms;
    return out;
  }

  pelvisFromRoot() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.pose.hipsY, this.pos.z);
  }

  // 助走の距離（0〜D）: 指数的に加速
  runX(tau) {
    const c = 1.15;
    const f = (x) => x - c * (1 - Math.exp(-x / c));
    const D = TAKEOFF_X - RUNWAY.start;
    return RUNWAY.start + (D * f(Math.max(0, tau))) / f(T_RUN);
  }

  run(t, a, o, out) {
    const fig = this.fig;
    const tau = t - a.tRun;
    const x = this.runX(tau);
    const x2 = this.runX(tau + 0.02);
    const v = (x2 - x) / 0.02;
    const D = TAKEOFF_X - RUNWAY.start;
    // 踏み切りで左足が後ろに伸びるように位相をそろえる
    const step = 1.86;
    const phiTO = (Math.PI * D) / step;
    const off = -Math.PI / 2 - phiTO;
    const phi = (Math.PI * (x - RUNWAY.start)) / step + off;
    this.yaw = Math.PI / 2;
    this.pos.set(x, 0, RUNWAY.z);
    const amt = clamp(v / 6, 0.4, 1);
    const s = Math.sin(phi);
    o.hipsY = this.hipY - 0.06 + 0.05 * Math.abs(Math.cos(phi));
    o.thighLX = -0.75 * s * amt - 0.15;
    o.thighRX = 0.75 * s * amt - 0.15;
    o.kneeL = 0.25 + 1.25 * Math.max(0, Math.sin(phi + 1.25)) * amt;
    o.kneeR = 0.25 + 1.25 * Math.max(0, Math.sin(phi + 1.25 + Math.PI)) * amt;
    o.thighLZ = 0.02;
    o.thighRZ = -0.02;
    o.ankleL = 0.2;
    o.ankleR = 0.2;
    o.spineX = 0.3 - 0.2 * clamp(tau / 2.2, 0, 1);
    o.headX = -0.1;
    o.headY = 0;
    o.spineY = 0;
    fig.setExpr(tau > T_RUN - 0.8 ? 'shout' : 'serious');
    // ポール: 立てた角度 → 少しずつ下ろす → 突っ込み（上の手が頭上へ・先端がボックスへ）
    const left = a.tTO - t;
    const plantK = ease(clamp(1 - left / 0.5, 0, 1));
    const pelvis = _v.set(x, o.hipsY, RUNWAY.z);
    const carryTop = new THREE.Vector3(pelvis.x - 0.06, pelvis.y + 0.04 + 0.03 * Math.sin(phi * 2), pelvis.z + 0.22);
    const lean = o.spineX;
    const overTop = new THREE.Vector3(pelvis.x + Math.sin(lean) * 1.0 + 0.08, pelvis.y + 1.02 * Math.cos(lean) + 0.36, RUNWAY.z + HAND_Z);
    const top = carryTop.lerp(overTop, plantK);
    const carryAng = THREE.MathUtils.degToRad(70 - 48 * smoothstep(0, T_RUN - 0.9, tau));
    const toBox = Math.atan2(0.02 - overTop.y, BOX.x - 0.02 - overTop.x);
    const ang = carryAng + (toBox - carryAng) * plantK;
    const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), (RUNWAY.z - top.z) * 0.12 * plantK).normalize();
    const tip = top.clone().addScaledVector(dir, GRIP);
    this.pole.straight(tip, dir.clone().negate());
    _hR.copy(top);
    _hL.copy(top).addScaledVector(dir, 0.62);
    _pR.set(pelvis.x - 0.5, pelvis.y + 0.2 * plantK, pelvis.z + 0.6);
    _pL.set(pelvis.x - 0.2, pelvis.y + 0.1, pelvis.z - 0.6);
    // 腕を振る代わりにポールを持つ（ゆれる）
    out.worldArms = true;
    this.phase = { name: left < 0.5 ? 'plant' : 'run', k: tau / T_RUN, speed: v };
    a._toTop = top.clone();
    return out;
  }

  // ポールの局面: 上の手 H = ボックス + L(k)(cos θ, sin θ)
  poleVault(t, a, o, out) {
    const fig = this.fig;
    const k = clamp((t - a.tTO) / T_POLE, 0, 1);
    const box = new THREE.Vector3(BOX.x - 0.02, 0.02, RUNWAY.z + HAND_Z * 0.3);
    const H0 = a._toTop ?? new THREE.Vector3(TAKEOFF_X, 2.36, RUNWAY.z + HAND_Z);
    const th0 = Math.atan2(H0.y - box.y, H0.x - box.x);
    const th1 = THREE.MathUtils.degToRad(93);
    const th = th0 + (th1 - th0) * Math.pow(ease(k), 1.15);
    const L0 = Math.min(GRIP, H0.distanceTo(box));
    const Lmin = 3.5 + 0.25 * (1 - (a.power ?? 1));
    const L = k < 0.42 ? L0 + (Lmin - L0) * ease(k / 0.42) : Lmin + (GRIP - Lmin) * ease(clamp((k - 0.42) / 0.46, 0, 1));
    const H = new THREE.Vector3(box.x + L * Math.cos(th), box.y + L * Math.sin(th), RUNWAY.z + HAND_Z);
    this.pole.bent(box, H);
    // 体
    const phi = keys([[0, 0.12], [0.2, 0.55], [0.42, 1.75], [0.6, 2.7], [0.78, 3.08], [1, 3.14]], k);
    const psi = -Math.PI * ease(clamp((k - 0.7) / 0.25, 0, 1));
    const u = new THREE.Vector3();
    const f = new THREE.Vector3();
    bodyAxes(phi, psi, u, f);
    const q = quatUF(u, f, new THREE.Quaternion());
    // 骨盤 = 手 - u × 腕と胴の長さ（引きつけの間は少し近い）
    const reach = keys([[0, 1.02], [0.55, 1.0], [0.75, 0.86], [0.92, 0.92], [1, 1.02]], k);
    const pelvis = H.clone().addScaledVector(u, -reach).addScaledVector(f, -0.1);
    pelvis.z = RUNWAY.z;
    o.hipsY = this.hipY;
    this.pos.copy(pelvis).sub(_w.set(0, this.hipY, 0).applyQuaternion(q));
    o.thighLX = keys([[0, -1.1], [0.22, -1.5], [0.45, -2.25], [0.62, -1.5], [0.8, -0.25], [1, -0.1]], k);
    o.thighRX = keys([[0, 0.35], [0.22, -1.2], [0.45, -2.2], [0.62, -1.5], [0.8, -0.25], [1, -0.1]], k);
    o.kneeL = keys([[0, 1.5], [0.22, 1.5], [0.45, 0.3], [0.62, 0.1], [1, 0.05]], k);
    o.kneeR = keys([[0, 0.2], [0.22, 1.3], [0.45, 0.3], [0.62, 0.1], [1, 0.05]], k);
    o.thighLZ = 0.03;
    o.thighRZ = -0.03;
    o.spineX = keys([[0, 0.0], [0.22, 0.3], [0.45, 0.42], [0.62, 0.15], [0.8, -0.08], [1, 0]], k);
    o.spineY = 0;
    o.headX = keys([[0, -0.2], [0.4, 0.2], [0.8, 0.35], [1, 0.3]], k);
    o.headY = 0;
    o.ankleL = 0.4;
    o.ankleR = 0.4;
    fig.setExpr(k < 0.3 ? 'shout' : 'serious');
    // 手はポールを握る
    _hR.copy(H);
    this.pole.pointAt(GRIP - 0.6, _hL);
    _hL.z -= 0.05;
    const back = f.clone().negate();
    _pR.copy(pelvis).addScaledVector(back, 0.5).add(_w.set(0, 0, 0.5));
    _pL.copy(pelvis).addScaledVector(back, 0.5).add(_w.set(0, 0, -0.5));
    out.worldArms = true;
    out.rootQ = q;
    out.snap = true;
    a._rel = { pelvis: pelvis.clone(), H: H.clone(), th };
    this.phase = { name: k < 0.35 ? 'rise' : k < 0.8 ? 'invert' : 'push', k, bend: this.pole.bend };
    return out;
  }

  // 空中: 骨盤は放物線。頂点でバーの上（うつ伏せ）→ ひねって背中から落ちる
  flight(t, a, o, out, ctx) {
    const fig = this.fig;
    const tau = t - a.tRel;
    const fl = this.flightParams(a);
    const px = fl.rel.x + fl.vx * tau;
    const py = fl.rel.y + fl.vy * tau - 0.5 * G * tau * tau;
    const pelvis = new THREE.Vector3(px, Math.max(PIT.h + 0.16, py), RUNWAY.z - 0.05 * tau);
    const ka = clamp(tau / fl.ta, 0, 1); // 頂点まで
    const kf = clamp((tau - fl.ta) / Math.max(0.1, fl.T - fl.ta), 0, 1); // 落下
    const phi = tau < fl.ta ? Math.PI - (Math.PI / 2) * ease(ka) : Math.PI / 2 - 0.25 * ease(kf);
    const psi = -Math.PI - Math.PI * ease(clamp((tau - fl.ta - 0.12) / 0.5, 0, 1));
    const u = new THREE.Vector3();
    const f = new THREE.Vector3();
    bodyAxes(phi, psi, u, f);
    const q = quatUF(u, f, new THREE.Quaternion());
    o.hipsY = this.hipY;
    this.pos.copy(pelvis).sub(_w.set(0, this.hipY, 0).applyQuaternion(q));
    // バー越え: 脚を下ろし（くの字）→ 胸を反らす → 腕を振り上げる → 落下は V 字
    o.thighLX = keys([[0, -0.15], [0.6, -0.9], [1, -0.7]], ka) * (1 - kf) + -1.3 * kf;
    o.thighRX = o.thighLX;
    o.kneeL = keys([[0, 0.05], [1, 0.35]], ka) * (1 - kf) + 0.9 * kf;
    o.kneeR = o.kneeL;
    o.spineX = keys([[0, 0], [0.8, -0.35], [1, -0.45]], ka) * (1 - kf) + 0.35 * kf;
    o.headX = 0.45 * (1 - kf) + 0.2 * kf;
    o.headY = 0;
    o.spineY = 0;
    fig.setExpr(a.clear ? (kf > 0.4 ? 'surprised' : 'serious') : kf > 0.2 ? 'worried' : 'serious');
    // 腕: 頭の上・背中側へ振り上げる（うつ伏せの時は空の方 = バーに触れないように）
    const up = 1 - kf * 0.6;
    o.hL = [0.26, 0.5 * up + 0.1, -0.42 * up];
    o.hR = [-0.26, 0.5 * up + 0.1, -0.42 * up];
    o.pL = [0.7, 0.1, 0.2];
    o.pR = [-0.7, 0.1, 0.2];
    out.rootQ = q;
    out.snap = true;
    // ポールは離れて、まっすぐに戻ってから助走路側へ倒れる
    this.poleAfterRelease(t, a);
    // バーを越える瞬間（骨盤がバーの面を通る）
    const crossing = Math.abs(px - BAR.x) < 0.35;
    this.phase = { name: tau < fl.ta + 0.1 ? 'clear' : 'fall', k: tau / fl.T, overBar: crossing, apex: Math.abs(tau - fl.ta) < 0.12 };
    if (!a._crossed && px >= BAR.x - 0.1) {
      a._crossed = true;
      ctx?.onCross?.(this, a, pelvis);
    }
    return out;
  }

  flightParams(a) {
    if (a._fl) return a._fl;
    a._fl = Vaulter.planFlight(a.height, a.margin);
    return a._fl;
  }

  // 突き放しの瞬間の骨盤（ポールの局面の終わり k = 1 と同じ式）
  static releasePelvis() {
    const th1 = THREE.MathUtils.degToRad(93);
    const bx = BOX.x - 0.02;
    return new THREE.Vector3(bx + GRIP * Math.cos(th1) - 0.1, 0.02 + GRIP * Math.sin(th1) + 1.02, RUNWAY.z);
  }

  // 空中の放物線（バーの高さと余裕 margin から）: 頂点でバーの真上を通る
  static planFlight(height, margin) {
    const relPelvis = Vaulter.releasePelvis();
    const apexY = height + 0.14 + margin;
    const dy = Math.max(0.05, apexY - relPelvis.y);
    const vy = Math.sqrt(2 * G * dy);
    const ta = vy / G;
    const vx = Math.max(1.2, (BAR.x + 0.05 - relPelvis.x) / ta);
    const yLand = PIT.h + 0.16;
    const T = ta + Math.sqrt((2 * Math.max(0.2, apexY - yLand)) / G);
    return { vy, vx, ta, T, apexY, rel: relPelvis };
  }

  poleAfterRelease(t, a) {
    const box = new THREE.Vector3(BOX.x - 0.02, 0.02, RUNWAY.z + HAND_Z * 0.3);
    const tau = t - a.tRel;
    const th0 = THREE.MathUtils.degToRad(93);
    // まっすぐに戻る（0.15 秒）→ 助走路側へ倒れる（加速）
    const fall = Math.max(0, tau - 0.25);
    const th = Math.min(Math.PI - 0.02, th0 + 0.15 * Math.min(1, tau / 0.25) + 0.9 * fall * fall);
    const dir = new THREE.Vector3(Math.cos(th), Math.sin(th), 0.05);
    this.pole.straight(box, dir.normalize());
  }

  // 着地 → 起き上がる → 反応
  react(t, a, o, out, ctx) {
    const fig = this.fig;
    const tau = t - a.tLand;
    const fl = this.flightParams(a);
    const landX = clamp(fl.rel.x + fl.vx * (a.tLand - a.tRel), PIT.x0 + 1.2, PIT.x1 - 0.8);
    this.poleAfterRelease(t, a);
    if (tau < 1.6) {
      // 背中で着地 → 弾む → 起き上がって座る
      const bounce = Math.max(0, Math.sin(tau * 9)) * 0.12 * Math.exp(-tau * 5);
      const kSit = ease(clamp((tau - 0.55) / 0.7, 0, 1));
      const phi = (Math.PI / 2 - 0.25) * (1 - kSit) + 0.15 * kSit;
      const u = new THREE.Vector3();
      const f = new THREE.Vector3();
      bodyAxes(phi, -2 * Math.PI, u, f);
      const q = quatUF(u, f, new THREE.Quaternion());
      const pelvis = new THREE.Vector3(landX, PIT.h + 0.16 + bounce, RUNWAY.z - 0.08);
      o.hipsY = this.hipY;
      this.pos.copy(pelvis).sub(_w.set(0, this.hipY, 0).applyQuaternion(q));
      o.thighLX = -1.3 * (1 - kSit) + -1.55 * kSit;
      o.thighRX = o.thighLX;
      o.kneeL = 0.9 * (1 - kSit) + 0.6 * kSit;
      o.kneeR = o.kneeL;
      o.spineX = 0.3 * (1 - kSit) + 0.25 * kSit;
      o.headX = 0.3 - 0.4 * kSit;
      o.headY = kSit * 0.9; // 振り返ってバーを見る（左）
      o.spineY = 0;
      if (a.clear) {
        P.cheer(o, t);
        o.hL[1] = 0.7 * kSit + 0.2;
        o.hR[1] = 0.7 * kSit + 0.2;
        fig.setExpr(kSit > 0.3 ? 'laugh' : 'surprised');
      } else {
        if (kSit > 0.3) P.handsOnHead(o);
        else P.lap(o);
        fig.setExpr(kSit > 0.3 ? 'worried' : 'surprised');
      }
      out.rootQ = q;
      out.snap = tau < 0.6;
      this.phase = { name: tau < 0.5 ? 'land' : 'react', k: tau / 1.6, smile: a.clear && kSit > 0.5 };
      if (!a._landed) {
        a._landed = true;
        ctx?.onLand?.(this, a);
      }
      a.endPos = new THREE.Vector3(landX, PIT.h, RUNWAY.z + 0.3);
      return out;
    }
    // マットの上に立って、カメラ（メインスタンド）の方を向いて喜ぶ / 悔しがる
    const k2 = clamp((tau - 1.6) / 0.5, 0, 1);
    this.pos.set(landX, PIT.h, RUNWAY.z + 0.3);
    this.yaw = Math.PI / 2 - (Math.PI / 2) * ease(k2) + 0.0001;
    P.standBase(o, this.hipY);
    o.spineY = 0;
    if (a.clear) {
      const jump = Math.max(0, Math.sin((tau - 1.6) * 7)) * 0.22 * (tau < 3.4 ? 1 : 0);
      this.pos.y += jump;
      if (a.final || a.record) {
        P.cheer(o, t);
        o.headX = -0.3;
      } else if (tau < 2.6) P.cheer(o, t);
      else P.fist(o, t);
      fig.setExpr('laugh');
      o.headY = 0;
    } else {
      if (tau < 2.5) P.handsOnHead(o);
      else P.armsDown(o);
      o.headX = 0.3;
      o.headY = Math.sin(tau * 3) * 0.3;
      fig.setExpr(tau < 2.5 ? 'worried' : 'sigh');
    }
    a.endPos = this.pos.clone();
    a.endPos.y = PIT.h;
    this.phase = { name: 'react', k: 1, smile: a.clear };
    return out;
  }

  carryPoleRest(t) {
    // 歩いている間: 右手でポールを立てて持つ
    const pelvis = this.pelvisFromRoot();
    const dirF = _w.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const R = new THREE.Vector3(pelvis.x - dirF.z * 0.22, pelvis.y + 0.05, pelvis.z + dirF.x * 0.22);
    const dir = new THREE.Vector3(dirF.x * 0.25, 1, dirF.z * 0.25).normalize();
    this.pole.straight(R.clone().addScaledVector(dir, GRIP), dir.clone().negate());
    void t;
    void POLE_LEN;
  }

  // ---- 撮影の判定用
  headWorld(out = new THREE.Vector3()) {
    return this.fig.headWorld(out);
  }

  centerWorld(out = new THREE.Vector3()) {
    return this.fig.hipsWorld(out);
  }
}

// ---- 折れ線の道（[x, y, z] の列）
function buildPath(pts) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2], (b[1] - a[1]) * 0.3);
    segs.push({ a, b, len, at: total });
    total += len;
  }
  return { segs, total };
}

function pointOnPath(path, d) {
  if (d >= path.total) return null;
  for (const s of path.segs) {
    if (d <= s.at + s.len) {
      const k = (d - s.at) / Math.max(1e-6, s.len);
      return {
        x: s.a[0] + (s.b[0] - s.a[0]) * k,
        y: s.a[1] + (s.b[1] - s.a[1]) * k,
        z: s.a[2] + (s.b[2] - s.a[2]) * k,
        dx: s.b[0] - s.a[0],
        dz: s.b[2] - s.a[2],
      };
    }
  }
  return null;
}
