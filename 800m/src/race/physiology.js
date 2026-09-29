// 800m の体。短距離っぽいのに、スタミナ管理が要る。
//
//   effort（努力度）… 0.55 抑える / 0.78 普通 / 0.92 攻める / 1.12 スパート
//   速さ   = 5.2 + 3.6 × effort（m/s）× 疲労 × 効率（リズム）× ドラフト
//   スタミナ = 0〜100。effort 0.6 を超えた分の 1.6 乗で減る → 前半に飛ばすと 400〜650m が苦しい
//     普通（0.78）で 800m 走ると約 58 使う → 残りでラストスパート
//     攻め（0.92）だと 570m 付近で尽きる
//   ドラフト（前の選手の真後ろ）: 消費 -35%、少し速い
//   リズム（足の接地に合わせて入力）: PERFECT が続くと効率 +1.2% まで、消費 -10% まで

import { smoothstep, clamp } from '../core/mathx.js';

export const PHYS = {
  vBase: 5.2,
  vGain: 3.6,
  accel: 2.6,
  decel: 1.9,
  drainK: 9,
  drainPow: 1.6,
  burstExtra: 5,
  regenK: 7,
  effort: { conserve: 0.58, normal: 0.78, push: 0.92, burst: 1.12 },
  lateralSpeed: 2.2,
  draftGap: [0.5, 2.6],
  draftLateral: 0.55,
  blockGap: 0.95,
  blockLateral: 0.55,
};

export function targetSpeed(r) {
  const e = r.effortEff;
  const fatigue = 0.8 + 0.2 * smoothstep(0, 35, r.stamina);
  const eff = 1 + r.rhythmBonus;
  const draft = r.drafting ? 1.012 : 1;
  return (PHYS.vBase + PHYS.vGain * e) * fatigue * eff * draft * r.talent;
}

export function staminaRate(r, cheer) {
  const e = r.effortEff;
  let rate = 0;
  if (e > 0.6) rate -= PHYS.drainK * Math.pow(e - 0.6, PHYS.drainPow);
  else rate += (0.6 - e) * PHYS.regenK;
  if (r.bursting) rate -= PHYS.burstExtra;
  if (rate < 0) {
    let mul = 1;
    if (r.drafting) mul *= r.draftBonus ?? 0.65;
    mul *= 1 - Math.min(0.1, r.rhythmStreak * 0.01);
    rate *= mul;
  }
  // 大歓声は少しだけ背中を押す（勝敗を決めるほどではない）
  if (cheer >= 80) rate += 0.35;
  return rate;
}

// ピッチ（歩/秒）: 速いほど回転が上がる。足の接地（リズム・足音・アニメ）はここから決まる
export function stepFrequency(v) {
  return clamp(2.2 + 0.16 * v, 2.2, 4.1);
}
