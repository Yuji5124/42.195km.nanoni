import { damp } from '../../src/core/math.js';

// 1500m の侍（SamuraiModel）の骨を、走りではなくトランポリンの姿勢で動かす。
//   待機 / 踏み込み / 上昇 / 空中 / 抱え込み（回転）/ 伸身 / 屈身 / バレリーナ / ポーズ / 落下 / 着地 / 着地失敗
// 姿勢は角度の表（POSES）で、いくつかを重みで混ぜる → 姿勢の切り替わりがなめらか。
// 足がベッドに着いている間は脚を IK（SamuraiModel.solveLeg）で解き、膝が自然に曲がる。
//
// 角度の向き（SamuraiModel と同じ）:
//   肩 x +: 腕が前・上へ / 肩 z: 外へ（side を掛ける）/ 肘 x +: 曲げる / 太腿 z（thz）: 外へ開く
//   太腿 x +: 脚が前へ / 膝 x −: 曲げる / 背骨・胸 x −: 前かがみ

const ANKLE_H = 0.075;
const HIP_X = 0.1;

// [L, R] で左右が違う姿勢（バレリーナ）
const P = (o) => ({ hip: 0.93, spine: 0, chest: 0, neck: 0, head: 0, sh: [0.1, 0.1], shz: [0.12, 0.12], el: [0.3, 0.3], th: [0.02, 0.02], thz: [0.03, 0.03], kn: [-0.05, -0.05], an: [0, 0], ...o });

export const POSES = {
  stand: P({}),
  // 踏み込み（ベッドの底）: 腰を落とし、腕を振り下ろす
  crouch: P({ hip: 0.66, spine: -0.3, chest: -0.12, head: 0.25, sh: [-0.5, -0.5], shz: [0.2, 0.2], el: [0.35, 0.35] }),
  // 上昇: 腕を振り上げ、つま先まで伸びる
  rise: P({ spine: 0.06, chest: 0.05, head: 0.1, sh: [2.9, 2.9], shz: [0.22, 0.22], el: [0.1, 0.1], th: [0, 0], kn: [0, 0], an: [-0.65, -0.65] }),
  // 空中（ふつう）: 腕を広げてバランス
  air: P({ sh: [2.3, 2.3], shz: [0.55, 0.55], el: [0.25, 0.25], th: [0.05, 0.05], kn: [-0.08, -0.08], an: [-0.6, -0.6] }),
  // 抱え込み（宙返り）: 膝を胸へ、すねを抱える
  tuck: P({ hip: 0.9, spine: -0.55, chest: -0.45, neck: -0.25, head: -0.2, sh: [0.95, 0.95], shz: [0.25, 0.25], el: [1.7, 1.7], th: [2.3, 2.3], kn: [-2.45, -2.45], an: [-0.5, -0.5] }),
  // 屈身: 脚をまっすぐ前へ、つま先を触る
  pike: P({ spine: -0.85, chest: -0.5, neck: -0.2, sh: [1.55, 1.55], shz: [0.12, 0.12], el: [0.1, 0.1], th: [1.85, 1.85], kn: [0, 0], an: [-0.75, -0.75] }),
  // 伸身（ひねり）: まっすぐ、腕を胸の前でたたむ
  layout: P({ spine: 0.02, sh: [1.1, 1.1], shz: [-0.45, -0.45], el: [2.1, 2.1], th: [0, 0], thz: [0, 0], kn: [0, 0], an: [-0.7, -0.7] }),
  // バレリーナ: 腕は頭の上で輪、右脚はまっすぐ、左脚はパッセ（膝を横へ）
  ballerina: P({ spine: 0.12, chest: 0.08, head: 0.18, sh: [2.75, 2.75], shz: [0.55, 0.55], el: [0.95, 0.95], th: [0.9, 0.02], thz: [0.75, 0.02], kn: [-1.95, 0], an: [-0.65, -0.85] }),
  // ポーズ（大の字）
  star: P({ spine: 0.08, head: 0.12, sh: [2.2, 2.2], shz: [1.05, 1.05], el: [0, 0], th: [0.05, 0.05], thz: [0.55, 0.55], kn: [0, 0], an: [-0.4, -0.4] }),
  // 落下: 脚を下へ、腕を広げて着地の準備
  fall: P({ sh: [1.5, 1.5], shz: [0.85, 0.85], el: [0.2, 0.2], th: [0.2, 0.2], kn: [-0.3, -0.3], an: [-0.25, -0.25] }),
  // 着地: 膝で吸収、腕は前
  land: P({ hip: 0.7, spine: -0.28, chest: -0.1, sh: [1.2, 1.2], shz: [0.25, 0.25], el: [0.35, 0.35] }),
  // 着地失敗: 手足をばたつかせる
  flail: P({ spine: 0.2, sh: [2.4, 1.6], shz: [1.1, 0.9], el: [0.5, 0.2], th: [0.6, 0.2], thz: [0.3, 0.2], kn: [-0.8, -0.3], an: [-0.3, 0.2] }),
};

const KEYS = ['hip', 'spine', 'chest', 'neck', 'head'];
const PAIRS = ['sh', 'shz', 'el', 'th', 'thz', 'kn', 'an'];

export class TrampolinePoser {
  constructor(model) {
    this.model = model;
    this.cur = structuredClone(POSES.stand);
    this.mix = structuredClone(POSES.stand);
    this.time = 0;
  }

  // weights: { pose名: 重み } → 目標の姿勢（重みの平均）
  blend(weights) {
    const out = this.mix;
    let total = 0;
    for (const w of Object.values(weights)) total += w;
    total = Math.max(1e-4, total);
    for (const k of KEYS) out[k] = 0;
    for (const k of PAIRS) out[k] = [0, 0];
    for (const [name, w0] of Object.entries(weights)) {
      const p = POSES[name];
      if (!p || w0 <= 0) continue;
      const w = w0 / total;
      for (const k of KEYS) out[k] += p[k] * w;
      for (const k of PAIRS) {
        out[k][0] += p[k][0] * w;
        out[k][1] += p[k][1] * w;
      }
    }
    return out;
  }

  // st: { dt, weights, grounded（足がベッド上）, footY（ベッドの沈みで下がった足の高さ、腰から見て）, rate（姿勢の変わる速さ）, wobble }
  update(st) {
    const dt = Math.min(0.05, st.dt);
    this.time += dt;
    const target = this.blend(st.weights);
    const rate = st.rate ?? 12;
    const c = this.cur;
    for (const k of KEYS) c[k] = damp(c[k], target[k], rate, dt);
    for (const k of PAIRS) {
      c[k][0] = damp(c[k][0], target[k][0], rate, dt);
      c[k][1] = damp(c[k][1], target[k][1], rate, dt);
    }
    const m = this.model;
    const wob = st.wobble ?? 0;
    m.hips.position.y = c.hip;
    m.hips.rotation.set(0, 0, Math.sin(this.time * 17) * 0.1 * wob);
    m.spine.rotation.set(c.spine, 0, 0);
    m.chest.rotation.set(c.chest, 0, 0);
    m.neck.rotation.set(c.neck, 0, 0);
    m.head.rotation.set(c.head, Math.sin(this.time * 3.1) * 0.05 * wob, 0);
    for (const side of [-1, 1]) {
      const i = side < 0 ? 0 : 1;
      const arm = m.arms[side];
      arm.shoulder.rotation.set(c.sh[i] + Math.sin(this.time * 20 + side) * wob * 0.6, 0, side * c.shz[i]);
      arm.elbow.rotation.set(c.el[i], 0, 0);
      const leg = m.legs[side];
      if (st.grounded) {
        // ベッドの上: 足を固定して IK（腰が下がると膝が曲がる）
        m.solveLeg(leg, side, side * HIP_X, ANKLE_H, side * 0.02, 0);
      } else {
        leg.thigh.rotation.set(c.th[i], 0, side * c.thz[i]); // thz: 外へ開く
        leg.knee.rotation.set(c.kn[i], 0, 0);
        leg.ankle.rotation.set(c.an[i], 0, 0);
      }
    }
  }
}

