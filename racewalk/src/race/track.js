// 400m トラックの形（three.js に依存しない）。棒高跳びの競技場（polevault/src/stadium/StadiumLayout.js の TRACK）と同じ寸法。
//   直線 84.39m（半分 = 42.195m）・内側の半径 36.5m・レーン幅 1.22m。計測線は縁石から 30cm（半径 36.8m）→ 1 周 400.0m。
// 進む向き: 反時計回り（内側が左）。ホームストレート（+Z 側・メインスタンドの前）を +X へ。フィニッシュはホームストレートの端。
//
// s = フィニッシュラインからの計測線の距離（0〜400）。y = 計測線からの外側へのずれ（m）。
//   s 0〜115.6   東カーブ
//     115.6〜200 バックストレート（-X へ）
//     200〜315.6 西カーブ
//     315.6〜400 ホームストレート（+X へ）→ フィニッシュ

import { TRACK } from '../../../polevault/src/stadium/StadiumLayout.js';

export { TRACK };
export const SX = TRACK.half; // 42.195
export const RM = TRACK.rIn + 0.3; // 計測線の半径
export const ARC = Math.PI * RM;
export const STRAIGHT = 2 * SX;
export const LAP = 2 * ARC + 2 * STRAIGHT; // ≒ 400.0
export const SEG = { eastEnd: ARC, backEnd: ARC + STRAIGHT, westEnd: 2 * ARC + STRAIGHT };

// レース: 10000m 競歩の 8000m 通過（残り 5 周）から
export const RACE = { total: 10000, from: 8000, dist: 2000, clock0: 31 * 60 + 46.2 };

// 周回の中の位置（s）の置きもの
export const JUDGES = [
  { id: 1, s: 34, y: -1.35 },
  { id: 2, s: 92, y: -1.35 },
  { id: 3, s: 150, y: -1.35 },
  { id: 4, s: 236, y: -1.35 },
  { id: 5, s: 296, y: -1.35 },
  { id: 6, s: 352, y: -1.35 },
];
export const WATER = { s: 166, y: 3.5, reach: 2.0 }; // 給水所（バックストレートのレーン 3〜4 に机）。レーン 2 まで出ないと取れない
export const PENALTY = { s: 330, y: 7.6, sec: 30 }; // ペナルティゾーン（ホームストレートの始まり・レーン 7）
export const BOARD = { s: 384, y: -4.2 }; // 警告掲示板（フィニッシュの手前の芝）
export const LAP_BOARD = { s: 6, y: 11.2 }; // 周回板（フィニッシュの先の外）

// s, y → 位置と進む向き（out: { x, z, dx, dz, curve }）
export function trackPoint(s, y = 0, out = {}) {
  let l = ((s % LAP) + LAP) % LAP;
  const r = RM + y;
  if (l < SEG.eastEnd) {
    const th = l / RM;
    out.x = SX + r * Math.sin(th);
    out.z = r * Math.cos(th);
    out.dx = Math.cos(th);
    out.dz = -Math.sin(th);
    out.curve = 1;
  } else if (l < SEG.backEnd) {
    out.x = SX - (l - SEG.eastEnd);
    out.z = -r;
    out.dx = -1;
    out.dz = 0;
    out.curve = 0;
  } else if (l < SEG.westEnd) {
    const th = (l - SEG.backEnd) / RM;
    out.x = -SX - r * Math.sin(th);
    out.z = -r * Math.cos(th);
    out.dx = -Math.cos(th);
    out.dz = Math.sin(th);
    out.curve = 1;
  } else {
    out.x = -SX + (l - SEG.westEnd);
    out.z = r;
    out.dx = 1;
    out.dz = 0;
    out.curve = 0;
  }
  return out;
}

// カーブでは外を歩くほど 1 歩で進む計測線の距離が短い（外を回ると損）
export function progressFactor(s, y) {
  const l = ((s % LAP) + LAP) % LAP;
  const curve = l < SEG.eastEnd || (l >= SEG.backEnd && l < SEG.westEnd);
  return curve ? RM / (RM + Math.max(-0.25, y)) : 1;
}

// 周回の中の位置 s が [a, b) に入ったか（周をまたぐ）
export function crossed(prev, cur, mark) {
  const a = Math.floor((prev - mark) / LAP);
  const b = Math.floor((cur - mark) / LAP);
  return b > a;
}

export function yawOf(dx, dz) {
  return Math.atan2(dx, dz);
}
