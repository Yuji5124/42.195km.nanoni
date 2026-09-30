// 10 万人スタジアムの「論理」座席表。three.js に依存しない（Node でも動く）。
//
// 形: ピッチを囲む角丸長方形のボウル 2 層（LOWER / UPPER）。
//   コア長方形 [-CORE.sx, CORE.sx] × [-CORE.sz, CORE.sz] からの距離 R0 + d の線が「オフセット d の座席の列」。
//   直線部の長さは d によらず、角の円弧だけが伸びる → 通路（ブロックの境目）は放射状にそろう。
//
// 座標: ピッチの中心が原点、ゴールは x = ±52.5。NORTH = +X, SOUTH = -X, EAST = +Z, WEST = -Z。
// ループの位置 s ∈ [0,1): 北の中央（z=0）から始まり、東 → 南 → 西 → 北と一周する。
//
// 座席は TypedArray で持つ（1 人 = 数十バイト、毎フレーム全員を触らない）。
// 画面の点 → 座席 は「層 → 列 → ループ位置 → 座席」を解析的に逆算する（O(1)、全席レイキャストはしない）。

export const TOTAL_SEATS = 100000;
export const CORE = { sx: 40, sz: 23 };
export const R0 = 22;
export const SEAT_W = 0.5;
export const AISLE = 1.1;

// d0: 最前列の内側のオフセット / h0: 最前列の床の高さ / rise: 1 列ごとの高さ / depth: 1 列の奥行き
export const TIERS = [
  { id: 0, name: 'LOWER', d0: 0.6, rows: 34, depth: 0.8, rise: 0.45, h0: 1.7, blocks: 32, firstBlock: 1, northBlock: 5 },
  { id: 1, name: 'UPPER', d0: 29.5, rows: 56, depth: 0.82, rise: 0.6, h0: 20.5, blocks: 64, firstBlock: 33, northBlock: 42 },
];
for (const t of TIERS) {
  t.d1 = t.d0 + t.rows * t.depth;
  t.top = t.h0 + (t.rows - 1) * t.rise;
  t.dRef = (t.d0 + t.d1) / 2;
}

export const SIDES = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

// ---------------------------------------------------------------------------
// ループの区間（9 個: 北の半分 / 北東の角 / 東 / 南東の角 / 南 / 南西の角 / 西 / 北西の角 / 北の半分）
// ---------------------------------------------------------------------------
function segmentsFor(tier) {
  const rho = R0 + tier.dRef;
  const arc = (Math.PI / 2) * rho;
  const lens = [CORE.sz, arc, 2 * CORE.sx, arc, 2 * CORE.sz, arc, 2 * CORE.sx, arc, CORE.sz];
  const total = lens.reduce((a, b) => a + b, 0);
  const frac = lens.map((l) => l / total);
  const cum = [0];
  for (let i = 0; i < frac.length; i++) cum.push(cum[i] + frac[i]);
  cum[cum.length - 1] = 1;
  return { frac, cum };
}
export const SEG = TIERS.map(segmentsFor);
const CORNER = (i) => i === 1 || i === 3 || i === 5 || i === 7;

// 区間 i の、オフセット d での長さ
function segLen(i, d) {
  if (CORNER(i)) return (Math.PI / 2) * (R0 + d);
  return i === 0 || i === 8 ? CORE.sz : i === 4 ? 2 * CORE.sz : 2 * CORE.sx;
}

// ループ位置 s・オフセット d → (x, z) と外向きの法線
export function pointAt(tierId, s, d, out = {}) {
  const { frac, cum } = SEG[tierId];
  s = ((s % 1) + 1) % 1;
  let i = 0;
  while (i < 8 && s >= cum[i + 1]) i++;
  const t = (s - cum[i]) / frac[i];
  const rho = R0 + d;
  const { sx, sz } = CORE;
  let x, z, nx, nz;
  switch (i) {
    case 0: x = sx + rho; z = t * sz; nx = 1; nz = 0; break;
    case 1: { const a = t * Math.PI / 2; nx = Math.cos(a); nz = Math.sin(a); x = sx + rho * nx; z = sz + rho * nz; break; }
    case 2: x = sx - t * 2 * sx; z = sz + rho; nx = 0; nz = 1; break;
    case 3: { const a = Math.PI / 2 + t * Math.PI / 2; nx = Math.cos(a); nz = Math.sin(a); x = -sx + rho * nx; z = sz + rho * nz; break; }
    case 4: x = -sx - rho; z = sz - t * 2 * sz; nx = -1; nz = 0; break;
    case 5: { const a = Math.PI + t * Math.PI / 2; nx = Math.cos(a); nz = Math.sin(a); x = -sx + rho * nx; z = -sz + rho * nz; break; }
    case 6: x = -sx + t * 2 * sx; z = -sz - rho; nx = 0; nz = -1; break;
    case 7: { const a = 1.5 * Math.PI + t * Math.PI / 2; nx = Math.cos(a); nz = Math.sin(a); x = sx + rho * nx; z = -sz + rho * nz; break; }
    default: x = sx + rho; z = -sz + t * sz; nx = 1; nz = 0; break;
  }
  out.x = x;
  out.z = z;
  out.nx = nx;
  out.nz = nz;
  return out;
}

// (x, z) → オフセット d とループ位置 s（層ごとに s の割り振りが少し違う）
export function locate(tierId, x, z, out = {}) {
  const { sx, sz } = CORE;
  const qx = Math.max(-sx, Math.min(sx, x));
  const qz = Math.max(-sz, Math.min(sz, z));
  const vx = x - qx;
  const vz = z - qz;
  const dist = Math.hypot(vx, vz);
  out.d = dist - R0;
  const { frac, cum } = SEG[tierId];
  let i;
  let t;
  const cx = vx !== 0;
  const cz = vz !== 0;
  if (cx && cz) {
    let a = Math.atan2(vz, vx);
    if (a < 0) a += Math.PI * 2;
    if (x > 0 && z > 0) { i = 1; t = a / (Math.PI / 2); }
    else if (x < 0 && z > 0) { i = 3; t = (a - Math.PI / 2) / (Math.PI / 2); }
    else if (x < 0 && z < 0) { i = 5; t = (a - Math.PI) / (Math.PI / 2); }
    else { i = 7; t = (a - 1.5 * Math.PI) / (Math.PI / 2); }
  } else if (cx) {
    if (x > 0) {
      if (z >= 0) { i = 0; t = z / sz; } else { i = 8; t = (z + sz) / sz; }
    } else { i = 4; t = (sz - z) / (2 * sz); }
  } else if (z > 0) { i = 2; t = (sx - x) / (2 * sx); }
  else { i = 6; t = (x + sx) / (2 * sx); }
  t = Math.max(0, Math.min(1, t));
  out.s = (cum[i] + t * frac[i]) % 1;
  return out;
}

// s0 → s1（s1 > s0、1 を越えてもよい）のオフセット d での弧の長さ
export function arcLen(tierId, s0, s1, d) {
  const { frac, cum } = SEG[tierId];
  let len = 0;
  for (let base = Math.floor(s0); base < s1; base++) {
    for (let i = 0; i < 9; i++) {
      const a = Math.max(s0, base + cum[i]);
      const b = Math.min(s1, base + cum[i + 1]);
      if (b > a) len += ((b - a) / frac[i]) * segLen(i, d);
    }
  }
  return len;
}

// s0 から弧の長さ L だけ進んだ s（arcLen の逆）
export function sAfterArc(tierId, s0, L, d) {
  const { frac, cum } = SEG[tierId];
  let s = s0;
  let left = L;
  for (let guard = 0; guard < 20; guard++) {
    const base = Math.floor(s);
    const u = s - base;
    let i = 0;
    while (i < 8 && u >= cum[i + 1]) i++;
    const segEnd = base + cum[i + 1];
    const rate = segLen(i, d) / frac[i]; // m / s
    const room = (segEnd - s) * rate;
    if (left <= room) return s + left / rate;
    left -= room;
    s = segEnd + 1e-9;
  }
  return s;
}

export function sideOf(s) {
  // 北 = s≈0、東 = 0.25 付近、南 = 0.5、西 = 0.75（角は近い方）
  const k = Math.round((((s % 1) + 1) % 1) * 4) % 4;
  return SIDES[k];
}

// ---------------------------------------------------------------------------
// 座席表の生成
// ---------------------------------------------------------------------------
export class StadiumLayout {
  constructor() {
    this.build();
  }

  build() {
    const tmp = [];
    this.rows = []; // rows[tier][r] = { start, count, d, y }
    this.blocks = []; // グローバルなブロック番号順（0..95）: { tier, number, s0, s1, side }
    for (const tier of TIERS) {
      const tierRows = [];
      const nb = tier.blocks;
      const k0 = tier.northBlock - tier.firstBlock; // 北の中央にくるブロック
      for (let k = 0; k < nb; k++) {
        const s0 = (k - k0 - 0.5) / nb;
        const s1 = s0 + 1 / nb;
        const mid = (((s0 + s1) / 2) % 1 + 1) % 1;
        this.blocks.push({ tier: tier.id, number: tier.firstBlock + k, s0, s1, mid, side: sideOf(mid), index: this.blocks.length });
      }
      for (let r = 0; r < tier.rows; r++) {
        const d = tier.d0 + (r + 0.5) * tier.depth;
        const y = tier.h0 + r * tier.rise;
        const row = [];
        for (let k = 0; k < nb; k++) {
          const blk = this.blocks[this.blocks.length - nb + k];
          const len = arcLen(tier.id, blk.s0 + (blk.s0 < 0 ? 1 : 0), blk.s1 + (blk.s0 < 0 ? 1 : 0), d);
          const avail = len - AISLE;
          const n = Math.floor(avail / SEAT_W);
          const pad = AISLE + (avail - n * SEAT_W) / 2;
          const sStart = blk.s0 + (blk.s0 < 0 ? 1 : 0);
          for (let j = 0; j < n; j++) {
            const s = sAfterArc(tier.id, sStart, pad + (j + 0.5) * SEAT_W, d) % 1;
            row.push({ s, block: blk.index, num: j + 1, tier: tier.id, r });
          }
        }
        row.sort((a, b) => a.s - b.s);
        tierRows.push({ seats: row, d, y });
      }
      this.rows.push(tierRows);
      for (const tr of tierRows) tmp.push(tr);
    }

    // ちょうど 100,000 席にする: 南スタンド上層の中央（大型ビジョンの下の放送ブース）を最上段から座席なしにする
    let total = tmp.reduce((a, r) => a + r.seats.length, 0);
    this.naturalTotal = total;
    const upper = this.rows[1];
    const booth = this.blocks.filter((b) => b.tier === 1 && Math.abs(b.mid - 0.5) < 1.6 / TIERS[1].blocks).map((b) => b.index);
    this.boothBlocks = booth;
    this.boothRows = 0;
    for (let r = upper.length - 1; total > TOTAL_SEATS && r >= 0; r--) {
      const row = upper[r].seats;
      const inBooth = row.filter((x) => booth.includes(x.block));
      let drop;
      if (inBooth.length <= total - TOTAL_SEATS) drop = new Set(inBooth);
      else drop = new Set(inBooth.sort((a, b) => Math.abs(a.s - 0.5) - Math.abs(b.s - 0.5)).slice(0, total - TOTAL_SEATS));
      upper[r].seats = row.filter((x) => !drop.has(x));
      total -= drop.size;
      this.boothRows++;
    }
    this.count = total;

    const N = total;
    this.x = new Float32Array(N);
    this.y = new Float32Array(N);
    this.z = new Float32Array(N);
    this.s = new Float32Array(N);
    this.tier = new Uint8Array(N);
    this.block = new Uint8Array(N);
    this.row = new Uint8Array(N); // 0 始まり（表示は +1）
    this.num = new Uint8Array(N);
    const p = {};
    let id = 0;
    for (const tier of TIERS) {
      for (let r = 0; r < tier.rows; r++) {
        const tr = this.rows[tier.id][r];
        tr.start = id;
        tr.count = tr.seats.length;
        for (const seat of tr.seats) {
          pointAt(tier.id, seat.s, tr.d, p);
          this.x[id] = p.x;
          this.y[id] = tr.y;
          this.z[id] = p.z;
          this.s[id] = seat.s;
          this.tier[id] = tier.id;
          this.block[id] = seat.block;
          this.row[id] = r;
          this.num[id] = seat.num;
          id++;
        }
        delete tr.seats;
      }
    }
    // ブロックごとの座席数・範囲（ヒントの「残り何席」用）
    this.blockCount = new Uint32Array(this.blocks.length);
    for (let i = 0; i < N; i++) this.blockCount[this.block[i]]++;
  }

  // ---- 住所
  address(id) {
    const b = this.blocks[this.block[id]];
    return { level: TIERS[b.tier].name, side: b.side, block: b.number, row: this.row[id] + 1, seat: this.num[id], tier: b.tier };
  }

  label(id) {
    const a = this.address(id);
    return `BLOCK ${a.block} · ROW ${a.row} · SEAT ${a.seat}`;
  }

  findSeat(blockNumber, row, seat) {
    const bi = this.blocks.findIndex((b) => b.number === blockNumber);
    if (bi < 0) return -1;
    const tier = this.blocks[bi].tier;
    const tr = this.rows[tier][row - 1];
    if (!tr) return -1;
    for (let i = tr.start; i < tr.start + tr.count; i++) if (this.block[i] === bi && this.num[i] === seat) return i;
    return -1;
  }

  // 列の中で s に最も近い座席（二分探索）
  seatInRow(tierId, r, s) {
    const tr = this.rows[tierId][r];
    if (!tr || tr.count === 0) return -1;
    s = ((s % 1) + 1) % 1;
    let lo = tr.start;
    let hi = tr.start + tr.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.s[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    // lo と lo-1 と（ループの端なら）反対側を比べる
    let best = lo;
    let bd = circDist(this.s[lo], s);
    const cands = [lo - 1, lo + 1, tr.start, tr.start + tr.count - 1];
    for (const c of cands) {
      if (c < tr.start || c >= tr.start + tr.count) continue;
      const dd = circDist(this.s[c], s);
      if (dd < bd) {
        bd = dd;
        best = c;
      }
    }
    return best;
  }

  // 座席の前後左右（同じ層の列 ±dr、s ±ds の範囲）: 候補探し用
  neighbors(id, radiusSeats, out = []) {
    out.length = 0;
    const tier = this.tier[id];
    const r0 = this.row[id];
    const T = TIERS[tier];
    const rr = Math.max(0, Math.ceil(radiusSeats * (SEAT_W / T.depth)));
    const rs = Math.ceil(radiusSeats);
    for (let r = Math.max(0, r0 - rr); r <= Math.min(T.rows - 1, r0 + rr); r++) {
      const c = this.seatInRow(tier, r, this.s[id]);
      if (c < 0) continue;
      const tr = this.rows[tier][r];
      for (let k = -rs; k <= rs; k++) {
        let j = c + k;
        if (j < tr.start) j += tr.count;
        else if (j >= tr.start + tr.count) j -= tr.count;
        out.push(j);
      }
    }
    return out;
  }

  // 層の表面（人の胸の高さ）の高さ
  surfaceY(tierId, d) {
    const T = TIERS[tierId];
    return T.h0 + ((d - T.d0) / T.depth - 0.5) * T.rise + 0.85;
  }

  // レイ（原点 o・単位ベクトル v）→ いちばん手前の座席 id（無ければ -1）
  // 各層の「胸の高さの面」とレイの交点を粗い刻み + 二分法で求め、そこから列と s を逆算する
  pick(ox, oy, oz, vx, vy, vz, maxT = 520) {
    let bestT = Infinity;
    let best = -1;
    const loc = {};
    for (const T of TIERS) {
      const f = (t) => {
        const x = ox + vx * t;
        const z = oz + vz * t;
        locate(T.id, x, z, loc);
        if (loc.d < T.d0 - 0.3 || loc.d > T.d1 + 0.3) return NaN;
        return oy + vy * t - this.surfaceY(T.id, loc.d);
      };
      let prevT = 0;
      let prev = f(0);
      const step = 0.8;
      for (let t = step; t < Math.min(maxT, bestT); t += step) {
        const v = f(t);
        if (!Number.isNaN(v) && !Number.isNaN(prev) && prev > 0 && v <= 0) {
          let a = prevT;
          let b = t;
          for (let k = 0; k < 18; k++) {
            const m = (a + b) / 2;
            const fm = f(m);
            if (!Number.isNaN(fm) && fm > 0) a = m;
            else b = m;
          }
          const hitT = (a + b) / 2;
          if (hitT < bestT) {
            locate(T.id, ox + vx * hitT, oz + vz * hitT, loc);
            const r = Math.max(0, Math.min(T.rows - 1, Math.floor((loc.d - T.d0) / T.depth)));
            const id = this.seatInRow(T.id, r, loc.s);
            if (id >= 0) {
              bestT = hitT;
              best = id;
            }
          }
          break;
        }
        // レイが層の外から面の下に入った場合（手前の層の真下）も、面より上から入った時だけ当たりにする
        prev = v;
        prevT = t;
      }
    }
    this.lastPickT = bestT;
    return best;
  }

  // ブロックに含まれる座席 id の範囲を列ごとに列挙（コールバック）
  forEachInBlock(blockIndex, fn) {
    const b = this.blocks[blockIndex];
    const T = TIERS[b.tier];
    for (let r = 0; r < T.rows; r++) {
      const tr = this.rows[b.tier][r];
      for (let i = tr.start; i < tr.start + tr.count; i++) if (this.block[i] === blockIndex) fn(i);
    }
  }
}

function circDist(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}
