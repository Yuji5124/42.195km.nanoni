// 陸上競技場（ナイター）の座席表。ちょうど 30,000 席。three.js に依存しない。
// サッカーの群衆描画（soccer/src/crowd の CrowdField / CrowdDirector / NearCrowd）がそのまま読める形
// （count, x, y, z, s, tier, block, row, blocks, blockCount）で出す。
//
// 形: 400m トラック（直線 84.39m・内側の半径 36.5m）を囲むスタジアム形（直線 + 半円）のボウル。
//   直線の半分はちょうど 42.195m（シリーズの数字）。コアは x 軸上の線分 ±42.195、そこからの距離 R0 + d が座席の列。
//   LOWER … 1 周ぜんぶ（25 列・28 ブロック）
//   UPPER … メインスタンド（+Z・カメラの後ろ）とバックスタンド（-Z）の直線だけ（18 列・16 ブロック）
//   自然に並べた席から、メインスタンド上層の中央（放送ブース）を最上段から削って ちょうど 30,000 にする。
// 座標: フィールドの中心が原点、+X が棒高跳びの助走の向き、+Y が上。
// ループ位置 s（ウェーブ用）: メインスタンドの中央（0, +r）= 0 → +X → 東カーブ → バック → 西カーブ → 1。

export const TOTAL_SEATS = 30000;
export const TRACK = { half: 42.195, rIn: 36.5, lanes: 8, lane: 1.22 };
TRACK.rOut = TRACK.rIn + TRACK.lanes * TRACK.lane;
export const CORE = { sx: TRACK.half, sz: 0 };
export const R0 = 50;
export const SEAT_W = 0.5;
const AISLE = 0.55; // ブロックの境目から片側 0.55m（通路 1.1m）

export const TIERS = [
  { id: 0, name: 'LOWER', d0: 0.6, rows: 25, depth: 0.8, rise: 0.42, h0: 1.9, ring: true, straightBlocks: 7, curveBlocks: 7 },
  { id: 1, name: 'UPPER', d0: 22.5, rows: 18, depth: 0.85, rise: 0.56, h0: 14.5, ring: false, straightBlocks: 8, curveBlocks: 0 },
];
for (const t of TIERS) {
  t.d1 = t.d0 + t.rows * t.depth;
  t.top = t.h0 + (t.rows - 1) * t.rise;
}

// 列 d（コアからの距離 R0 + d）の周長
export function perimeter(d) {
  return 4 * CORE.sx + 2 * Math.PI * (R0 + d);
}

// ループ位置 u（0〜1）→ 点。seg = 0 メイン直線 / 1 東カーブ / 2 バック直線 / 3 西カーブ
export function pointAtLoop(d, u, out = {}) {
  const r = R0 + d;
  const sx = CORE.sx;
  const P = perimeter(d);
  let l = (((u % 1) + 1) % 1) * P;
  // メイン直線の中央から +X へ
  const halfS = sx;
  const arc = Math.PI * r;
  if (l < halfS) {
    out.x = l;
    out.z = r;
    out.seg = 0;
  } else if (l < halfS + arc) {
    const a = Math.PI / 2 - (l - halfS) / r; // +Z → +X → -Z
    out.x = sx + r * Math.cos(a);
    out.z = r * Math.sin(a);
    out.seg = 1;
  } else if (l < halfS + arc + 2 * sx) {
    out.x = sx - (l - halfS - arc);
    out.z = -r;
    out.seg = 2;
  } else if (l < halfS + 2 * arc + 2 * sx) {
    const a = -Math.PI / 2 - (l - halfS - arc - 2 * sx) / r;
    out.x = -sx + r * Math.cos(a);
    out.z = r * Math.sin(a);
    out.seg = 3;
  } else {
    out.x = -sx + (l - halfS - 2 * arc - 2 * sx);
    out.z = r;
    out.seg = 0;
  }
  return out;
}

// 点 (x, z) → コアからの距離 d と、最寄りの区分（直線 / カーブ）での位置
export function locate(x, z, out = {}) {
  const sx = CORE.sx;
  const cx = Math.max(-sx, Math.min(sx, x));
  const dx = x - cx;
  const r = Math.hypot(dx, z);
  out.d = r - R0;
  out.onStraight = Math.abs(x) <= sx;
  return out;
}

// 「その点のスタンドの表面の高さ」（ピント・視線の判定用）。スタンドの外なら -1
export function standHeightAt(x, z) {
  const { d, onStraight } = locate(x, z);
  const L = TIERS[0];
  const U = TIERS[1];
  if (d < 0) return -1;
  if (d <= L.d1) return L.h0 + Math.max(0, (d - L.d0) / L.depth) * L.rise;
  if (onStraight && d >= U.d0 - 1.5 && d <= U.d1) return U.h0 + Math.max(0, (d - U.d0) / U.depth) * U.rise;
  if (d < U.d0 - 1.5) return L.top + 1.2; // 1 階の後ろの通路・壁
  return -1;
}

export class StadiumLayout {
  constructor() {
    this.blocks = [];
    this.rows = [];
    const seats = [];
    for (const T of TIERS) {
      const first = this.blocks.length;
      // ブロック: 直線は x で等分、カーブは角度で等分
      const segBlocks = [];
      const segs = T.ring ? [0, 1, 2, 3] : [0, 2];
      for (const seg of segs) {
        const n = seg % 2 === 0 ? T.straightBlocks : T.curveBlocks;
        const list = [];
        for (let k = 0; k < n; k++) {
          const b = { index: this.blocks.length, tier: T.id, seg, k, n, number: this.blocks.length + 1 };
          this.blocks.push(b);
          list.push(b);
        }
        segBlocks[seg] = list;
      }
      const tierRows = [];
      for (let r = 0; r < T.rows; r++) {
        const d = T.d0 + (r + 0.5) * T.depth;
        const y = T.h0 + r * T.rise;
        const rad = R0 + d;
        const start = seats.length;
        const push = (x, z, seg, blk, u) => seats.push({ x, y, z, s: u, tier: T.id, block: blk.index, row: r, seg });
        const P = perimeter(d);
        for (const seg of segs) {
          const list = segBlocks[seg];
          if (seg % 2 === 0) {
            // 直線: x = -sx..sx をブロックに分け、通路を空けて SEAT_W ごとに
            const sx = CORE.sx;
            const bw = (2 * sx) / list.length;
            for (let k = 0; k < list.length; k++) {
              const x0 = -sx + k * bw + AISLE;
              const x1 = -sx + (k + 1) * bw - AISLE;
              const n = Math.floor((x1 - x0) / SEAT_W);
              const pad = (x1 - x0 - n * SEAT_W) / 2;
              for (let j = 0; j < n; j++) {
                let x = x0 + pad + (j + 0.5) * SEAT_W;
                // メイン直線は +X へ、バック直線は -X へ（ループの向き）
                const blk = seg === 0 ? list[k] : list[list.length - 1 - k];
                const z = seg === 0 ? rad : -rad;
                let l;
                if (seg === 0) l = x >= 0 ? x : P + x;
                else l = sx + Math.PI * rad + (sx - x);
                push(x, z, seg, blk, l / P);
              }
            }
          } else {
            // カーブ: 角度で分ける（通路は放射状）
            const n = list.length;
            for (let k = 0; k < n; k++) {
              const a0 = (k / n) * Math.PI;
              const a1 = ((k + 1) / n) * Math.PI;
              const len = (a1 - a0) * rad - 2 * AISLE;
              const m = Math.floor(len / SEAT_W);
              const pad = (len - m * SEAT_W) / 2;
              for (let j = 0; j < m; j++) {
                const t = a0 + (AISLE + pad + (j + 0.5) * SEAT_W) / rad;
                let x, z, l;
                if (seg === 1) {
                  const a = Math.PI / 2 - t;
                  x = CORE.sx + rad * Math.cos(a);
                  z = rad * Math.sin(a);
                  l = CORE.sx + t * rad;
                } else {
                  const a = -Math.PI / 2 - t;
                  x = -CORE.sx + rad * Math.cos(a);
                  z = rad * Math.sin(a);
                  l = 3 * CORE.sx + Math.PI * rad + t * rad;
                }
                push(x, z, seg, list[k], l / P);
              }
            }
          }
        }
        tierRows.push({ start, count: seats.length - start, d, y });
      }
      this.rows.push(tierRows);
      void first;
    }
    // ちょうど 30,000: メインスタンド上層の中央を最上段から削る（放送ブース）
    let excess = seats.length - TOTAL_SEATS;
    this.boothRows = 0;
    this.booth = null;
    if (excess > 0) {
      const U = TIERS[1];
      // 何列ぶん削るか: 中央の幅 W を広げながら最上段から
      const removed = new Set();
      outer: for (let r = U.rows - 1; r >= 0; r--) {
        // この列の中央から外へ 1 席ずつ
        const rowSeats = [];
        seats.forEach((q, i) => {
          if (!removed.has(i) && q.tier === 1 && q.seg === 0 && q.row === r) rowSeats.push(i);
        });
        rowSeats.sort((a, b) => Math.abs(seats[a].x) - Math.abs(seats[b].x));
        const maxPerRow = Math.round(rowSeats.length * 0.7);
        for (let k = 0; k < Math.min(maxPerRow, rowSeats.length); k++) {
          removed.add(rowSeats[k]);
          excess--;
          if (excess <= 0) break outer;
        }
      }
      const kept = seats.filter((q, i) => !removed.has(i));
      // 放送ブースの範囲（見た目用）
      let bx = 0;
      let bRow = U.rows;
      removed.forEach((i) => {
        bx = Math.max(bx, Math.abs(seats[i].x));
        bRow = Math.min(bRow, seats[i].row);
      });
      this.booth = { half: bx + SEAT_W, row: bRow };
      seats.length = 0;
      seats.push(...kept);
    }
    // 行の開始位置を作り直す
    const N = seats.length;
    this.count = N;
    this.x = new Float32Array(N);
    this.y = new Float32Array(N);
    this.z = new Float32Array(N);
    this.s = new Float32Array(N);
    this.tier = new Uint8Array(N);
    this.block = new Uint8Array(N);
    this.row = new Uint8Array(N);
    this.seg = new Uint8Array(N);
    seats.forEach((q, i) => {
      this.x[i] = q.x;
      this.y[i] = q.y;
      this.z[i] = q.z;
      this.s[i] = q.s;
      this.tier[i] = q.tier;
      this.block[i] = q.block;
      this.row[i] = q.row;
      this.seg[i] = q.seg;
    });
    this.blockCount = new Uint32Array(this.blocks.length);
    for (let i = 0; i < N; i++) this.blockCount[this.block[i]]++;
    // 席の検索用: (tier, row) ごとの範囲
    this.rowIndex = TIERS.map((T) => Array.from({ length: T.rows }, () => []));
    for (let i = 0; i < N; i++) this.rowIndex[this.tier[i]][this.row[i]].push(i);
  }

  // 同じ列で隣（左右 0.45〜0.65m）の席
  neighbor(id, dir = 1) {
    const list = this.rowIndex[this.tier[id]][this.row[id]];
    const k = list.indexOf(id);
    const j = list[k + dir];
    if (j === undefined) return -1;
    const dd = Math.hypot(this.x[j] - this.x[id], this.z[j] - this.z[id]);
    return dd < 0.7 ? j : -1;
  }

  // その席から観客が向く方向（フィールドの中心線）の yaw（Figure の前 = +Z）
  facingYaw(id) {
    return facingYaw(this.x[id], this.z[id]);
  }
}

export function facingYaw(x, z) {
  const qx = Math.max(-CORE.sx, Math.min(CORE.sx, x));
  return Math.atan2(qx - x, 0 - z);
}
