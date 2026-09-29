// 論理トラック（Logical track）。400m トラックの幾何をここだけで持つ。
// 見た目のトラックがどれだけ波打っても・ねじれても、レースの距離はこの関数で決まる。
//
//   直線 84.39m × 2 + 半円（第 1 レーン計測線の半径 36.8m）× 2 = 400m
//   d … レース距離（0〜800m、第 1 レーンの計測線に沿って測る）
//   off … 計測線からの外側へのずれ（m）。レーン幅 1.22m、8 レーン
//
// ワールド配置: ホームストレートは z = +R（メインスタンド側）を +X へ走る。
// フィニッシュラインはホームストレートの終わり（x = +L/2）。そのまま第 1 コーナー（左回り）へ入る。
// 800m のスタートはフィニッシュラインと同じ位置（2 周）。

export const TRACK = {
  straight: 84.39,
  radius: 36.8,
  laneWidth: 1.22,
  lanes: 8,
  lap: 400,
  race: 800,
};

const L = TRACK.straight;
const R = TRACK.radius;
const BEND = Math.PI * R;
const S1 = BEND; // 第 1〜2 コーナーの終わり
const S2 = BEND + L; // バックストレートの終わり
const S3 = 2 * BEND + L; // 第 3〜4 コーナーの終わり

export const MAX_OFF = TRACK.laneWidth * TRACK.lanes - 0.35;

export function lapPos(d) {
  const p = d % TRACK.lap;
  return p < 0 ? p + TRACK.lap : p;
}

export function isBend(d) {
  const p = lapPos(d);
  return p < S1 || (p >= S2 && p < S3);
}

// 曲線区間で外側を走ると、同じ一歩でも進む距離が減る（R / (R + off)）
export function progressFactor(d, off) {
  return isBend(d) ? R / (R + Math.max(0, off)) : 1;
}

// レーン番号（1〜8）→ そのレーンの中央の off
export function laneCenter(lane) {
  return (lane - 1) * TRACK.laneWidth + 0.31;
}

// (d, off) → ワールド座標 {x, z} と進行方向 {hx, hz}（単位ベクトル）、右方向（外側）{rx, rz}
export function trackPoint(d, off, out = {}) {
  const p = lapPos(d);
  const r = R + off;
  let x;
  let z;
  let hx;
  let hz;
  if (p < S1) {
    const th = p / R;
    x = L / 2 + r * Math.sin(th);
    z = r * Math.cos(th);
    hx = Math.cos(th);
    hz = -Math.sin(th);
  } else if (p < S2) {
    const t = p - S1;
    x = L / 2 - t;
    z = -r;
    hx = -1;
    hz = 0;
  } else if (p < S3) {
    const th = (p - S2) / R;
    x = -L / 2 - r * Math.sin(th);
    z = -r * Math.cos(th);
    hx = -Math.cos(th);
    hz = Math.sin(th);
  } else {
    const t = p - S3;
    x = -L / 2 + t;
    z = r;
    hx = 1;
    hz = 0;
  }
  out.x = x;
  out.z = z;
  out.hx = hx;
  out.hz = hz;
  // 右手（外側）= 進行方向 × 上
  out.rx = -hz;
  out.rz = hx;
  out.heading = Math.atan2(-hx, -hz); // three.js の rotation.y（前方 = -Z）
  return out;
}

// 曲率（左回り、1/m）: 表示の傾きなどに使う
export function curvature(d) {
  return isBend(d) ? 1 / R : 0;
}

export const SEGMENTS = { S1, S2, S3, BEND };
