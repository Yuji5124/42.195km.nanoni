import * as THREE from 'three';

// 人の姿勢のライブラリ（観客・審判・スタッフ・ベンチの選手で共有）。
//   姿勢 = 数値の集まり（腰の高さ・背骨/胸/首/頭の角度・脚の角度・両手の目標位置（胸の座標系）・肘の向き）。
//   「今の姿勢」を「目標の姿勢」へ毎フレーム少しずつ近づける（blend）→ 切り替えがなめらか。
//   手は 2 ボーン IK（Figure.armIK）: 祈る・口を押さえる・双眼鏡・看板を掲げる … を手の位置で書ける。
// 胸の座標系: +X = 本人の左、+Y = 上、+Z = 前。大人の体型の値で書き、体の大きさ（腕の長さ）で縮める。

const KEYS = ['hipsY', 'spineX', 'spineY', 'spineZ', 'chestX', 'neckX', 'headX', 'headY', 'headZ', 'thighLX', 'thighLZ', 'kneeL', 'thighRX', 'thighRZ', 'kneeR', 'ankleL', 'ankleR'];
const HANDS = ['hL', 'hR', 'pL', 'pR'];

export function makePose() {
  const p = {};
  for (const k of KEYS) p[k] = 0;
  p.hipsY = 0.86;
  p.hL = [0.2, -0.32, 0.04];
  p.hR = [-0.2, -0.32, 0.04];
  p.pL = [0.6, -0.3, -0.4];
  p.pR = [-0.6, -0.3, -0.4];
  return p;
}

export function copyPose(dst, src) {
  for (const k of KEYS) dst[k] = src[k];
  for (const h of HANDS) {
    dst[h][0] = src[h][0];
    dst[h][1] = src[h][1];
    dst[h][2] = src[h][2];
  }
  return dst;
}

// cur を tgt へ（k = 0〜1）
export function blendPose(cur, tgt, k) {
  for (const key of KEYS) cur[key] += (tgt[key] - cur[key]) * k;
  for (const h of HANDS) for (let i = 0; i < 3; i++) cur[h][i] += (tgt[h][i] - cur[h][i]) * k;
}

const _t = new THREE.Vector3();
const _p = new THREE.Vector3();

// 姿勢を骨へ（arms = false: 腕は呼び出し側が IK する）
export function applyPose(fig, p, arms = true) {
  const B = fig.bones;
  const s = fig.B.upper / 0.26; // 体の大きさ
  B.hips.position.y = p.hipsY;
  B.spine.rotation.set(p.spineX, p.spineY, p.spineZ);
  B.chest.rotation.set(p.chestX, 0, 0);
  B.neck.rotation.set(p.neckX + p.headX * 0.35, p.headY * 0.4, p.headZ * 0.3);
  B.head.rotation.set(p.headX * 0.65, p.headY * 0.6, p.headZ * 0.7);
  B.hipL.rotation.set(p.thighLX, 0, p.thighLZ);
  B.kneeL.rotation.set(p.kneeL, 0, 0);
  B.ankleL.rotation.set(p.ankleL, 0, 0);
  B.hipR.rotation.set(p.thighRX, 0, p.thighRZ);
  B.kneeR.rotation.set(p.kneeR, 0, 0);
  B.ankleR.rotation.set(p.ankleR, 0, 0);
  if (!arms) return;
  for (const side of ['L', 'R']) {
    const h = p[`h${side}`];
    const q = p[`p${side}`];
    const sh = fig.shoulderPos(side);
    // 目標は大人の値 × s。ただし肩からの相対で縮める（肩の位置は体型ごと）
    const sgn = side === 'L' ? 1 : -1;
    const ax = 0.175 * sgn;
    _t.set(sh.x + (h[0] - ax) * s, sh.y + (h[1] - 0.17) * s, sh.z + h[2] * s);
    _p.set(sh.x + q[0] * s, sh.y + q[1] * s, sh.z + q[2] * s);
    fig.armIK(side, _t, _p);
  }
}

// ---------------------------------------------------------------------------
// 姿勢の部品（out に書き込む）。t = 時間（揺れ・繰り返し）
export const P = {
  sitBase(o, { seatY = 0.5 } = {}) {
    o.hipsY = seatY;
    o.thighLX = -1.5;
    o.thighRX = -1.5;
    o.thighLZ = 0.06;
    o.thighRZ = -0.06;
    o.kneeL = 1.45;
    o.kneeR = 1.45;
    o.ankleL = 0;
    o.ankleR = 0;
    o.spineX = 0.04;
    return o;
  },
  standBase(o, hipY) {
    o.hipsY = hipY;
    o.thighLX = 0;
    o.thighRX = 0;
    o.thighLZ = 0.03;
    o.thighRZ = -0.03;
    o.kneeL = 0.02;
    o.kneeR = 0.02;
    o.ankleL = 0;
    o.ankleR = 0;
    o.spineX = 0;
    return o;
  },
  armsDown(o) {
    o.hL = [0.21, -0.32, 0.04];
    o.hR = [-0.21, -0.32, 0.04];
    o.pL = [0.6, -0.2, -0.5];
    o.pR = [-0.6, -0.2, -0.5];
  },
  lap(o) {
    o.hL = [0.11, -0.17, 0.27];
    o.hR = [-0.11, -0.17, 0.27];
    o.pL = [0.5, -0.5, -0.1];
    o.pR = [-0.5, -0.5, -0.1];
  },
  pray(o) {
    o.hL = [0.016, 0.3, 0.2];
    o.hR = [-0.016, 0.3, 0.2];
    o.pL = [0.4, -0.6, 0.1];
    o.pR = [-0.4, -0.6, 0.1];
    o.headX = 0.32;
  },
  clap(o, t) {
    const open = Math.abs(Math.sin(t * 7));
    o.hL = [0.015 + 0.07 * open, 0.12, 0.29];
    o.hR = [-0.015 - 0.07 * open, 0.12, 0.29];
    o.pL = [0.5, -0.5, 0];
    o.pR = [-0.5, -0.5, 0];
  },
  cheer(o, t) {
    const w = Math.sin(t * 6) * 0.06;
    o.hL = [0.3 + w, 0.74, 0.08];
    o.hR = [-0.3 + w, 0.74, 0.08];
    o.pL = [0.7, 0.4, -0.3];
    o.pR = [-0.7, 0.4, -0.3];
  },
  fist(o, t) {
    const k = Math.max(0, Math.sin(t * 9));
    o.hR = [-0.18, 0.5 + 0.18 * k, 0.12];
    o.pR = [-0.7, 0.2, -0.2];
  },
  coverMouth(o) {
    o.hL = [0.03, 0.33, 0.18];
    o.hR = [-0.03, 0.33, 0.18];
    o.pL = [0.5, -0.6, 0.1];
    o.pR = [-0.5, -0.6, 0.1];
  },
  wipeTears(o, t) {
    o.hR = [-0.05, 0.4 + 0.015 * Math.sin(t * 5), 0.16];
    o.pR = [-0.4, -0.6, 0.1];
    o.hL = [0.06, 0.05, 0.22];
    o.pL = [0.5, -0.5, 0];
    o.headX = 0.25;
  },
  holdSign(o, t) {
    const b = Math.sin(t * 3) * 0.03;
    o.hL = [0.24, 0.44 + b, 0.32];
    o.hR = [-0.24, 0.44 - b, 0.32];
    o.pL = [0.7, -0.2, 0];
    o.pR = [-0.7, -0.2, 0];
  },
  binoculars(o) {
    o.hL = [0.055, 0.4, 0.2];
    o.hR = [-0.055, 0.4, 0.2];
    o.pL = [0.5, -0.4, 0];
    o.pR = [-0.5, -0.4, 0];
  },
  phone(o) {
    o.hR = [-0.07, 0.38, 0.4];
    o.pR = [-0.5, -0.3, 0];
    o.hL = [0.11, -0.17, 0.27];
    o.pL = [0.5, -0.5, -0.1];
  },
  eat(o, t) {
    const k = (Math.sin(t * 2.4) + 1) / 2;
    const up = k > 0.75 ? 1 : 0;
    o.hR = up ? [-0.02, 0.33, 0.16] : [-0.1, -0.02, 0.26];
    o.pR = [-0.5, -0.5, 0];
    o.hL = [0.08, -0.04, 0.26];
    o.pL = [0.5, -0.5, 0];
  },
  armsCrossed(o) {
    o.hL = [-0.09, 0.03, 0.17];
    o.hR = [0.09, 0.05, 0.19];
    o.pL = [0.6, -0.3, 0.1];
    o.pR = [-0.6, -0.3, 0.1];
  },
  handsOnHead(o) {
    o.hL = [0.12, 0.52, 0.03];
    o.hR = [-0.12, 0.52, 0.03];
    o.pL = [0.8, 0.3, 0];
    o.pR = [-0.8, 0.3, 0];
  },
  chin(o) {
    o.hR = [-0.02, 0.29, 0.17];
    o.pR = [-0.3, -0.6, 0.2];
    o.hL = [0.0, 0.04, 0.17];
    o.pL = [0.5, -0.5, 0];
  },
  wave(o, t) {
    o.hR = [-0.32 + 0.08 * Math.sin(t * 9), 0.6, 0.12];
    o.pR = [-0.8, 0.0, -0.2];
  },
  stretch(o) {
    o.hL = [0.14, 0.78, -0.04];
    o.hR = [-0.14, 0.78, -0.04];
    o.pL = [0.6, 0.6, -0.3];
    o.pR = [-0.6, 0.6, -0.3];
  },
  behindBack(o) {
    o.hL = [0.07, -0.26, -0.17];
    o.hR = [-0.07, -0.26, -0.17];
    o.pL = [0.6, -0.2, -0.3];
    o.pR = [-0.6, -0.2, -0.3];
  },
  clipboard(o, t, writing = false) {
    o.hL = [0.05, -0.0, 0.27];
    o.pL = [0.5, -0.5, 0];
    o.hR = writing ? [-0.05 + 0.03 * Math.sin(t * 5), 0.01 + 0.01 * Math.sin(t * 11), 0.29] : [-0.2, -0.3, 0.06];
    o.pR = [-0.5, -0.5, -0.1];
  },
  flagUp(o, t) {
    o.hR = [-0.22, 0.7 + 0.02 * Math.sin(t * 4), 0.14];
    o.pR = [-0.8, 0.1, -0.2];
  },
  shadeEyes(o) {
    o.hR = [-0.02, 0.48, 0.16];
    o.pR = [-0.6, 0.1, 0.1];
  },
  talkHands(o, t) {
    const k = Math.sin(t * 3.1);
    o.hR = [-0.16, 0.0 + 0.06 * k, 0.28];
    o.pR = [-0.5, -0.5, -0.1];
    o.hL = [0.16, -0.02 - 0.05 * k, 0.26];
    o.pL = [0.5, -0.5, -0.1];
  },
  hug(o) {
    o.hL = [-0.1, 0.12, 0.42];
    o.hR = [0.1, 0.14, 0.42];
    o.pL = [0.8, -0.1, 0];
    o.pR = [-0.8, -0.1, 0];
  },
  reachUp(o, side = 'R') {
    if (side === 'R') {
      o.hR = [-0.12, 0.62, 0.32];
      o.pR = [-0.6, 0, 0];
    } else {
      o.hL = [0.12, 0.62, 0.32];
      o.pL = [0.6, 0, 0];
    }
  },
  walk(o, phase, amt = 1, hipY = 0.86) {
    const s = Math.sin(phase);
    o.hipsY = hipY - 0.02 * amt + 0.02 * Math.abs(Math.cos(phase)) * amt;
    o.thighLX = -0.42 * s * amt;
    o.thighRX = 0.42 * s * amt;
    o.kneeL = 0.08 + 0.55 * Math.max(0, Math.sin(phase + 1.2)) * amt;
    o.kneeR = 0.08 + 0.55 * Math.max(0, Math.sin(phase + 1.2 + Math.PI)) * amt;
    o.thighLZ = 0.02;
    o.thighRZ = -0.02;
    o.hL = [0.2, -0.3, 0.04 - 0.12 * s * amt];
    o.hR = [-0.2, -0.3, 0.04 + 0.12 * s * amt];
    o.pL = [0.6, -0.2, -0.5];
    o.pR = [-0.6, -0.2, -0.5];
  },
  jog(o, phase, hipY = 0.86) {
    const s = Math.sin(phase);
    o.hipsY = hipY - 0.05 + 0.04 * Math.abs(Math.cos(phase));
    o.thighLX = -0.7 * s - 0.1;
    o.thighRX = 0.7 * s - 0.1;
    o.kneeL = 0.3 + 1.0 * Math.max(0, Math.sin(phase + 1.3));
    o.kneeR = 0.3 + 1.0 * Math.max(0, Math.sin(phase + 1.3 + Math.PI));
    o.spineX = 0.1;
    o.hL = [0.18, -0.12, 0.1 - 0.16 * s];
    o.hR = [-0.18, -0.12, 0.1 + 0.16 * s];
    o.pL = [0.4, -0.6, -0.6];
    o.pR = [-0.4, -0.6, -0.6];
  },
};

// 頭（と少し胴）をワールドの点へ向ける
const _l = new THREE.Vector3();
export function lookAtWorld(fig, o, target, { headY = 1.45, maxYaw = 1.25, torso = 0.25 } = {}) {
  _l.copy(target);
  fig.root.worldToLocal(_l);
  const yaw = Math.atan2(_l.x, _l.z);
  const pitch = Math.atan2(_l.y - headY, Math.hypot(_l.x, _l.z));
  const y = Math.max(-maxYaw, Math.min(maxYaw, yaw));
  o.headY = y * (1 - torso);
  o.spineY = y * torso;
  o.headX = Math.max(-0.5, Math.min(0.6, -pitch)) + (o.headX > 0.2 ? o.headX * 0.5 : 0);
}
