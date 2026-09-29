// CoursePath: コースの中心線。すべての物体は「s = コース上の前進量、x = 中心線からの横ずれ」で置き、
// ここでワールド座標に変換する。レース判定（順位・衝突・距離）は s / x のまま = カーブがあっても壊れない。
//
// カーブは JSON の curves: [{ fromKm, toKm, turnDeg }] で定義（turnDeg > 0 = 左カーブ）。
// 曲率は sin 形で入り・抜けを滑らかにし、1 単位刻みで向き θ と位置を積分して表にしておく。
//
// 向き θ: 前方 D = (-sin θ, 0, -cos θ)、右 R = (cos θ, 0, -sin θ)。θ = 0 で従来どおり -Z 方向。
// three.js の rotation.y = θ で、ローカル -Z が D、ローカル +X が R に一致する。

const STEP = 1;

export class CoursePath {
  constructor(curves, distance, { startS = -400, endS = 6000 } = {}) {
    this.S0 = startS;
    const n = Math.ceil((endS - startS) / STEP) + 1;
    this.n = n;
    this.theta = new Float64Array(n);
    this.px = new Float64Array(n);
    this.pz = new Float64Array(n);
    this.kappaArr = new Float32Array(n);

    const segs = (curves ?? []).map((c) => {
      const a = distance.kmToUnits(c.fromKm);
      const b = distance.kmToUnits(c.toKm);
      const turn = (c.turnDeg * Math.PI) / 180;
      return { a, b, peak: (turn * Math.PI) / (2 * (b - a)) };
    });
    const kappaAt = (s) => {
      let k = 0;
      for (const seg of segs) {
        if (s > seg.a && s < seg.b) k += seg.peak * Math.sin((Math.PI * (s - seg.a)) / (seg.b - seg.a));
      }
      return k;
    };

    for (let i = 0; i < n - 1; i++) {
      const s = startS + i * STEP;
      const k = kappaAt(s + STEP / 2);
      this.kappaArr[i] = kappaAt(s);
      const mid = this.theta[i] + (k * STEP) / 2;
      this.theta[i + 1] = this.theta[i] + k * STEP;
      this.px[i + 1] = this.px[i] - Math.sin(mid) * STEP;
      this.pz[i + 1] = this.pz[i] - Math.cos(mid) * STEP;
    }
    // s = 0（スタートライン）がワールド原点になるようずらす
    const i0 = Math.round(-startS / STEP);
    const ox = this.px[i0];
    const oz = this.pz[i0];
    for (let i = 0; i < n; i++) {
      this.px[i] -= ox;
      this.pz[i] -= oz;
    }
    this.frame = { x: 0, z: 0, theta: 0, sin: 0, cos: 1 };
  }

  // 中心線上の点と向き（戻り値は使い回しのオブジェクト）
  sample(s) {
    const f = this.frame;
    const u = (s - this.S0) / STEP;
    let i = Math.floor(u);
    let t = u - i;
    let extra = 0;
    if (i < 0) {
      extra = u;
      i = 0;
      t = 0;
    } else if (i >= this.n - 1) {
      extra = u - (this.n - 1);
      i = this.n - 2;
      t = 1;
    }
    const th = this.theta[i] + (this.theta[i + 1] - this.theta[i]) * t;
    const sn = Math.sin(th);
    const cs = Math.cos(th);
    f.theta = th;
    f.sin = sn;
    f.cos = cs;
    f.x = this.px[i] + (this.px[i + 1] - this.px[i]) * t - sn * extra * STEP;
    f.z = this.pz[i] + (this.pz[i + 1] - this.pz[i]) * t - cs * extra * STEP;
    return f;
  }

  // (s, 横 x, 高さ y) → ワールド座標
  toWorld(s, x, y, out) {
    const f = this.sample(s);
    out.set(f.x + f.cos * x, y, f.z - f.sin * x);
    return out;
  }

  heading(s) {
    return this.sample(s).theta;
  }

  // 曲率（> 0 = 左カーブ）
  kappa(s) {
    const i = Math.min(this.n - 1, Math.max(0, Math.floor((s - this.S0) / STEP)));
    return this.kappaArr[i];
  }

  // InstancedMesh 用: (s, x, y) に置き、進行方向 + localYaw を向く行列を書き込む
  // roll: 進行方向を軸にした傾き（> 0 = 左へ傾く）。Ry(yaw)·Rz(roll)·S
  writeMatrix(array, index, s, x, y, localYaw = 0, scale = 1, roll = 0) {
    const f = this.sample(s);
    const wx = f.x + f.cos * x;
    const wz = f.z - f.sin * x;
    const yaw = f.theta + localYaw;
    const c = Math.cos(yaw) * scale;
    const sn = Math.sin(yaw) * scale;
    const o = index * 16;
    if (roll) {
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      array[o] = c * cr; array[o + 1] = sr * scale; array[o + 2] = -sn * cr; array[o + 3] = 0;
      array[o + 4] = -c * sr; array[o + 5] = cr * scale; array[o + 6] = sn * sr; array[o + 7] = 0;
    } else {
      array[o] = c; array[o + 1] = 0; array[o + 2] = -sn; array[o + 3] = 0;
      array[o + 4] = 0; array[o + 5] = scale; array[o + 6] = 0; array[o + 7] = 0;
    }
    array[o + 8] = sn; array[o + 9] = 0; array[o + 10] = c; array[o + 11] = 0;
    array[o + 12] = wx; array[o + 13] = y; array[o + 14] = wz; array[o + 15] = 1;
  }
}
