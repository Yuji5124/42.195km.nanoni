// 競歩の動き（姿勢の数値を作る。骨への反映は polevault/src/people/Poses.js の applyPose）。
//   位相 φ: 左のかかとが着く = 0、右のかかとが着く = π。
//   競歩らしさ: 接地から垂直まで膝を伸ばす（曲がる = ベントニー）・骨盤を大きく回す・遊脚側の骨盤が落ちる・
//               肘 90° で腕を前後に強く振る（手は胸の前まで）・上下動が小さい・速い小刻みのピッチ。
//   疲れ（f 0〜1）: 腕が下がる・振りが小さい・前に倒れる・頭が揺れる・歩幅が縮む・左右にふらつく。
//   浮き（lc）: 両足が離れる瞬間ができる（腰が上がる・膝が曲がって走りに近づく）。

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const sm = (k) => {
  const x = clamp(k);
  return x * x * (3 - 2 * x);
};

function keys(tbl, x) {
  for (let i = 0; i < tbl.length - 1; i++) {
    const [x0, y0] = tbl[i];
    const [x1, y1] = tbl[i + 1];
    if (x >= x0 && x <= x1) return y0 + (y1 - y0) * sm((x - x0) / Math.max(1e-6, x1 - x0));
  }
  return tbl[tbl.length - 1][1];
}

const P = Math.PI;
// 足首（φ / π）: かかと接地でつま先が上 → 立脚中期 0 → 蹴り出し → 遊脚でつま先を上げる
const ANKLE = [
  [0, -0.26],
  [0.25, 0],
  [0.6, 0.06],
  [0.92, 0.48],
  [1.12, 0.22],
  [1.5, -0.12],
  [2, -0.26],
];

// 片脚（ph = その脚の位相 0〜2π）
function leg(ph, A, bk, lc, fat) {
  const thigh = -A * Math.cos(ph) - 0.04;
  let knee;
  const x = ph / P;
  if (x < 0.55) knee = -0.03 + (0.06 + bk * 0.42) * Math.sin((x / 0.55) * P) * (bk > 0.05 ? 1 : 0.2);
  else if (x < 1) knee = 0.5 * sm((x - 0.55) / 0.45) + bk * 0.1;
  else if (x < 1.3) knee = 0.5 + (0.62 + 0.25 * lc) * sm((x - 1) / 0.3);
  else knee = (1.12 + 0.25 * lc) * (1 - sm((x - 1.3) / 0.62));
  knee = Math.max(-0.04, knee) * (1 - 0.15 * fat) + (x < 0.55 ? 0 : 0.08 * fat);
  const ankle = keys(ANKLE, x);
  return [thigh, knee, ankle];
}

// st: { phase, v, fat, lc, bk, t, hipRest, arm, armK }
// 戻り値（体の外側の動き）: { yaw, roll, sway, bob }
export function racewalk(o, st, out) {
  const { phase, fat, lc, bk, t } = st;
  const v = st.v;
  const A = clamp(0.34 + 0.05 * (v - 4.2), 0.18, 0.5) * (1 - 0.18 * Math.max(0, fat - 0.4)) * clamp(v / 2.2, 0.15, 1);
  const ph = ((phase % TAU) + TAU) % TAU;
  const [tL, kL, aL] = leg(ph, A, bk, lc, fat);
  const [tR, kR, aR] = leg((ph + P) % TAU, A, bk, lc, fat);
  o.thighLX = tL;
  o.kneeL = kL;
  o.ankleL = aL;
  o.thighRX = tR;
  o.kneeR = kR;
  o.ankleR = aR;
  o.thighLZ = 0.035;
  o.thighRZ = -0.035;
  // 腰の高さ（立脚の脚の角度から。競歩は上下動を小さくする）+ 浮き
  const L = 0.97;
  const drop = L - L * Math.cos(A * Math.cos(ph));
  o.hipsY = st.hipRest - 0.02 - drop * 0.5 + lc * 0.045 * Math.max(0, Math.cos(2 * ph)) - 0.02 * fat;
  // 胴: 少し前傾。疲れ・浮きで前に倒れる
  o.spineX = 0.05 + 0.11 * fat + 0.05 * lc;
  o.chestX = 0.02 + 0.04 * fat;
  // 頭: 疲れると下がる・揺れる
  o.headX = -0.04 + 0.16 * fat * fat + 0.05 * fat * Math.sin(2 * ph);
  o.headY = 0.04 * Math.sin(ph) * (0.4 + fat);
  o.headZ = 0.07 * fat * Math.sin(ph + 0.6) + 0.04 * fat * fat * Math.sin(t * 1.7);
  o.neckX = 0.02;
  // 骨盤（ひねり・遊脚側が落ちる）と、逆にひねる胸
  const yaw = -0.17 * Math.cos(ph) * clamp(v / 3, 0.2, 1);
  const roll = 0.07 * Math.sin(ph) * clamp(v / 3, 0.2, 1);
  o.spineY = -yaw * 1.25;
  o.spineZ = -roll * 0.7 + 0.05 * fat * fat * Math.sin(t * 1.3);
  // 腕（肘 90°・前は胸の前まで、後ろは腰の横まで）。疲れると下がって振りが小さい
  const amp = 1 - 0.38 * fat;
  armSwing(o, 'L', -Math.cos(ph) * amp, fat);
  armSwing(o, 'R', Math.cos(ph) * amp, fat);
  out.yaw = yaw;
  out.roll = roll;
  out.sway = 0.028 * Math.sin(ph) * (1 + 1.8 * fat) + 0.06 * fat * fat * Math.sin(t * 1.25 + 0.4);
  out.bob = 0;
  return out;
}

function armSwing(o, side, s, fat) {
  // 肘 90°: 上腕が後ろ 45° → 前 35°。前腕は上腕に直角（後ろでは腰の横、前では胸の前まで）
  const sg = side === 'L' ? 1 : -1;
  const k = (s + 1) / 2;
  const back = [0.2, -0.18, -0.02];
  const front = [0.1, 0.08, 0.33];
  const bulge = Math.sin(P * k);
  const h = [back[0] + (front[0] - back[0]) * k, back[1] + (front[1] - back[1]) * k - 0.06 * bulge, back[2] + (front[2] - back[2]) * k + 0.08 * bulge];
  // 疲れ: 腕が下がる・肘が開く
  h[1] -= 0.13 * fat;
  h[2] -= 0.05 * fat;
  h[0] += 0.03 * fat;
  o[`h${side}`] = [h[0] * sg, h[1], h[2]];
  o[`p${side}`] = [0.35 * sg, -0.45, -0.7];
}

// 走る（ACTION「走る」・失格覚悟）
export function run(o, st, out) {
  const ph = st.phase;
  const s = Math.sin(ph);
  o.hipsY = st.hipRest - 0.04 + 0.06 * Math.abs(Math.cos(ph));
  o.thighLX = -0.8 * s - 0.15;
  o.thighRX = 0.8 * s - 0.15;
  o.kneeL = 0.35 + 1.25 * Math.max(0, Math.sin(ph + 1.3));
  o.kneeR = 0.35 + 1.25 * Math.max(0, Math.sin(ph + 1.3 + P));
  o.ankleL = 0.2;
  o.ankleR = 0.2;
  o.spineX = 0.18;
  o.spineY = 0;
  o.spineZ = 0;
  o.headX = -0.05;
  o.hL = [0.16, -0.05, 0.12 - 0.22 * s];
  o.hR = [-0.16, -0.05, 0.12 + 0.22 * s];
  o.pL = [0.4, -0.6, -0.6];
  o.pR = [-0.4, -0.6, -0.6];
  out.yaw = 0;
  out.roll = 0;
  out.sway = 0;
  return out;
}

// 立っている（ペナルティゾーン・ゴールの後）: 息が荒いと肩が上下する
export function stand(o, st, out, style = 'hips') {
  const br = Math.sin(st.t * (2.2 + 2.5 * st.fat)) * (0.01 + 0.025 * st.fat);
  o.hipsY = st.hipRest - 0.01;
  o.thighLX = 0;
  o.thighRX = 0;
  o.thighLZ = 0.06;
  o.thighRZ = -0.06;
  o.kneeL = 0.03;
  o.kneeR = 0.03;
  o.ankleL = 0;
  o.ankleR = 0;
  o.spineX = 0.04 + br;
  o.spineY = 0;
  o.spineZ = 0;
  o.chestX = br;
  o.headX = 0.05 + 0.1 * st.fat;
  o.headY = 0;
  o.headZ = 0;
  if (style === 'knees') {
    // ひざに手をつく（ゴールの後）
    o.spineX = 0.85 + br;
    o.hipsY = st.hipRest - 0.07;
    o.kneeL = 0.35;
    o.kneeR = 0.35;
    o.thighLX = -0.3;
    o.thighRX = -0.3;
    o.headX = -0.3;
    o.hL = [0.16, -0.5, 0.28];
    o.hR = [-0.16, -0.5, 0.28];
    o.pL = [0.6, 0, -0.2];
    o.pR = [-0.6, 0, -0.2];
  } else if (style === 'win') {
    const w = Math.sin(st.t * 7) * 0.05;
    o.hL = [0.32 + w, 0.75, 0.1];
    o.hR = [-0.32 + w, 0.75, 0.1];
    o.pL = [0.7, 0.4, -0.3];
    o.pR = [-0.7, 0.4, -0.3];
    o.headX = -0.25;
  } else {
    // 腰に手
    o.hL = [0.26, -0.27, -0.02];
    o.hR = [-0.26, -0.27, -0.02];
    o.pL = [0.9, 0.1, 0.1];
    o.pR = [-0.9, 0.1, 0.1];
  }
  out.yaw = 0;
  out.roll = 0;
  out.sway = 0;
  return out;
}

// 寝ている（寝たふり・倒れ込む）: 仰向け。手は頭の後ろ
export function lying(o, st, out) {
  o.hipsY = st.hipRest;
  o.thighLX = -0.05;
  o.thighRX = 0.02;
  o.thighLZ = 0.12;
  o.thighRZ = -0.1;
  o.kneeL = 0.15;
  o.kneeR = 0.4;
  o.ankleL = 0.3;
  o.ankleR = 0.3;
  o.spineX = 0;
  o.spineY = 0;
  o.spineZ = 0;
  o.chestX = 0;
  o.headX = -0.1;
  o.headY = 0.25;
  o.headZ = 0;
  o.hL = [0.16, 0.5, -0.1];
  o.hR = [-0.16, 0.5, -0.1];
  o.pL = [0.8, 0.6, 0.2];
  o.pR = [-0.8, 0.6, 0.2];
  out.yaw = 0;
  out.roll = 0;
  out.sway = 0;
  return out;
}

// 腕の動き（ACTION）で、腕振りを上書きする（k = 0〜1 で混ぜる）
export function armOverride(o, mode, t, k) {
  if (!mode || k <= 0) return;
  const set = (side, h, p) => {
    const cur = o[`h${side}`];
    o[`h${side}`] = [cur[0] + (h[0] - cur[0]) * k, cur[1] + (h[1] - cur[1]) * k, cur[2] + (h[2] - cur[2]) * k];
    if (k > 0.5) o[`p${side}`] = p;
  };
  switch (mode) {
    case 'wave':
      set('R', [-0.3 + 0.09 * Math.sin(t * 10), 0.62, 0.16], [-0.8, 0, -0.2]);
      break;
    case 'thumb':
      set('R', [-0.08, 0.1, 0.42], [-0.6, -0.4, 0]);
      break;
    case 'phone':
      set('L', [0.03, 0.2, 0.33], [0.5, -0.5, 0]);
      o.headX += 0.32 * k;
      break;
    case 'drink':
      set('L', [0.04, 0.33, 0.16], [0.5, -0.5, 0]);
      o.headX -= 0.25 * k;
      break;
    case 'peace':
      set('R', [-0.14, 0.4, 0.24], [-0.7, -0.2, 0]);
      break;
    case 'point':
      set('R', [-0.08, -0.25, 0.52], [-0.6, 0.2, 0]);
      break;
    case 'flap': {
      const f = Math.sin(t * 9) * 0.07;
      set('L', [0.34 + f, -0.4, -0.02], [0.6, 0.3, -0.2]);
      set('R', [-0.34 - f, -0.4, -0.02], [-0.6, 0.3, -0.2]);
      break;
    }
    case 'bow':
      o.spineX += 0.55 * k;
      o.headX += 0.2 * k;
      set('L', [0.12, -0.3, 0.18], [0.6, 0, -0.3]);
      set('R', [-0.12, -0.3, 0.18], [-0.6, 0, -0.3]);
      break;
    case 'flex':
      set('L', [0.34, 0.22, 0.06], [0.8, -0.3, 0]);
      set('R', [-0.34, 0.22, 0.06], [-0.8, -0.3, 0]);
      break;
    case 'hype': {
      const w = Math.sin(t * 8) * 0.06;
      set('L', [0.3 + w, 0.72, 0.1], [0.7, 0.4, -0.3]);
      set('R', [-0.3 + w, 0.72, 0.1], [-0.7, 0.4, -0.3]);
      break;
    }
    case 'stretch':
      set('L', [0.12, 0.8, -0.04], [0.6, 0.6, -0.3]);
      set('R', [-0.12, 0.8, -0.04], [-0.6, 0.6, -0.3]);
      break;
    case 'shake':
      set('R', [-0.06, -0.08, 0.5], [-0.6, -0.4, 0]);
      break;
  }
}
