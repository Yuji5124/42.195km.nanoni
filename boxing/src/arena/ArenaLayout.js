// 大会場（アリーナ）の座席表。サッカーの群衆描画（soccer/src/crowd の CrowdField / CrowdDirector / NearCrowd）が
// そのまま読める形（count, x, y, z, s, tier, block, row, blocks, blockCount）で出す。three.js に依存しない。
//
// 形: リング（原点）を囲む角丸長方形。層ごとにコア（±sx × ±sz、角の半径 r0 + d）が違う。
//   FLOOR … リングのすぐ周りの床の平らな席（リングサイド → 床の後ろ）
//   LOWER … 1 階スタンド（段）
//   UPPER … 2 階スタンド（段・急）
// ブロックは角度で分ける（放射状の通路）。s = ループ上の位置（0〜1、ウェーブ用）。

export const BOWL_CORE = { sx: 8, sz: 6, r0: 6 };
const FLOOR_CORE = { sx: 2.2, sz: 2.2, r0: 3.2 };
export const ARENA_TIERS = [
  { id: 0, name: 'FLOOR', core: FLOOR_CORE, d0: 1.5, rows: 7, depth: 0.9, rise: 0, h0: 0, blocks: 8, flat: true },
  { id: 1, name: 'LOWER', core: BOWL_CORE, d0: 1.2, rows: 22, depth: 0.85, rise: 0.46, h0: 1.4, blocks: 24 },
  { id: 2, name: 'UPPER', core: BOWL_CORE, d0: 21.5, rows: 28, depth: 0.85, rise: 0.62, h0: 13.5, blocks: 30 },
];
for (const t of ARENA_TIERS) {
  t.d1 = t.d0 + t.rows * t.depth;
  t.top = t.h0 + (t.rows - 1) * t.rise;
}
const SEAT_W = 0.54;

// 角丸長方形（コア ±sx × ±sz、角の半径 r0 + d）の周長と、弧長 L の点
export function perimeter(d, core = BOWL_CORE) {
  const { sx, sz, r0 } = core;
  return 4 * sx + 4 * sz + 2 * Math.PI * (r0 + d);
}

export function pointAtArc(d, L, out = {}, core = BOWL_CORE) {
  const { sx, sz, r0 } = core;
  const r = r0 + d;
  const q = (Math.PI / 2) * r;
  const segs = [2 * sz, q, 2 * sx, q, 2 * sz, q, 2 * sx, q];
  const P = segs.reduce((a, b) => a + b, 0);
  let l = ((L % P) + P) % P;
  // 東（+X）の辺の真ん中から反時計回り
  l += sz;
  if (l >= P) l -= P;
  let i = 0;
  while (l > segs[i]) {
    l -= segs[i];
    i = (i + 1) % 8;
  }
  const t = l / segs[i];
  let x, z;
  switch (i) {
    case 0: x = sx + r; z = -sz + t * 2 * sz; break;
    case 1: { const a = t * Math.PI / 2; x = sx + r * Math.cos(a); z = sz + r * Math.sin(a); break; }
    case 2: x = sx - t * 2 * sx; z = sz + r; break;
    case 3: { const a = Math.PI / 2 + t * Math.PI / 2; x = -sx + r * Math.cos(a); z = sz + r * Math.sin(a); break; }
    case 4: x = -sx - r; z = sz - t * 2 * sz; break;
    case 5: { const a = Math.PI + t * Math.PI / 2; x = -sx + r * Math.cos(a); z = -sz + r * Math.sin(a); break; }
    case 6: x = -sx + t * 2 * sx; z = -sz - r; break;
    default: { const a = 1.5 * Math.PI + t * Math.PI / 2; x = sx + r * Math.cos(a); z = -sz + r * Math.sin(a); break; }
  }
  out.x = x;
  out.z = z;
  return out;
}

export class ArenaLayout {
  constructor() {
    const seats = [];
    this.blocks = [];
    this.rows = [];
    for (const T of ARENA_TIERS) {
      const first = this.blocks.length;
      for (let k = 0; k < T.blocks; k++) {
        const a0 = (k / T.blocks) * Math.PI * 2;
        this.blocks.push({ index: this.blocks.length, tier: T.id, number: this.blocks.length + 1, a0, a1: a0 + (Math.PI * 2) / T.blocks, mid: (k + 0.5) / T.blocks });
      }
      const tierRows = [];
      for (let r = 0; r < T.rows; r++) {
        const d = T.d0 + (r + 0.5) * T.depth;
        const y = T.h0 + r * T.rise;
        const P = perimeter(d, T.core);
        const n = Math.floor(P / SEAT_W);
        const start = seats.length;
        const p = {};
        for (let j = 0; j < n; j++) {
          const u = (j + 0.5) / n;
          pointAtArc(d, u * P, p, T.core);
          let ang = Math.atan2(p.z, p.x);
          if (ang < 0) ang += Math.PI * 2;
          const bk = Math.floor((ang / (Math.PI * 2)) * T.blocks) % T.blocks;
          // 通路: ブロックの境目の近く（角度 × 半径が 0.6m 以内）は席を作らない
          const edge = Math.min(ang - this.blocks[first + bk].a0, this.blocks[first + bk].a1 - ang) * Math.hypot(p.x, p.z);
          if (edge < 0.6) continue;
          // FLOOR: リングの入場通路（-X 側 = 赤コーナーの後ろ）を空ける
          if (T.flat && p.x < -5 && Math.abs(p.z) < 1.8) continue;
          seats.push({ x: p.x, y, z: p.z, s: u, tier: T.id, block: first + bk, row: r });
        }
        tierRows.push({ start, count: seats.length - start, d, y });
      }
      this.rows.push(tierRows);
    }
    const N = seats.length;
    this.count = N;
    this.x = new Float32Array(N);
    this.y = new Float32Array(N);
    this.z = new Float32Array(N);
    this.s = new Float32Array(N);
    this.tier = new Uint8Array(N);
    this.block = new Uint8Array(N);
    this.row = new Uint8Array(N);
    seats.forEach((q, i) => {
      this.x[i] = q.x;
      this.y[i] = q.y;
      this.z[i] = q.z;
      this.s[i] = q.s;
      this.tier[i] = q.tier;
      this.block[i] = q.block;
      this.row[i] = q.row;
    });
    this.blockCount = new Uint32Array(this.blocks.length);
    for (let i = 0; i < N; i++) this.blockCount[this.block[i]]++;
  }
}

// 誰が座っているか（soccer の SeatPlan と同じ形: kind / look / zoneOfBlock）
//   ZONE: 0 = 赤コーナー（侍）の応援 / 1 = 青コーナーの応援 / 2 = 応援団（ずっと立って跳ぶ）
const RED = [8, 8, 8, 8, 2, 2, 6, 6, 4, 5, 7, 12, 13, 8, 2, 6, 14];
const BLUE = [0, 1, 3, 3, 11, 2, 6, 4, 0, 15];
const CHEER = [8, 8, 2, 8, 2, 8];

export class ArenaPlan {
  constructor(layout, rng) {
    const N = layout.count;
    this.kind = new Uint8Array(N);
    this.look = new Uint8Array(N * 4);
    this.zoneOfBlock = new Uint8Array(layout.blocks.length);
    for (const b of layout.blocks) {
      // 青コーナー（+X 側）の後ろの 1 階 = 青の応援。赤コーナーの後ろの 2 階 = 応援団
      const ang = ((b.a0 + b.a1) / 2) % (Math.PI * 2);
      const east = ang < 0.5 || ang > Math.PI * 2 - 0.5;
      const west = Math.abs(ang - Math.PI) < 0.45;
      if (b.tier === 1 && east) this.zoneOfBlock[b.index] = 1;
      else if (b.tier === 2 && west) this.zoneOfBlock[b.index] = 2;
    }
    for (let i = 0; i < N; i++) {
      const zone = this.zoneOfBlock[layout.block[i]];
      const pal = zone === 1 ? BLUE : zone === 2 ? CHEER : RED;
      const shirt = pal[Math.floor(rng.next() * pal.length)];
      const hair = rng.next() < 0.75 ? 0 : rng.next() < 0.6 ? 1 : rng.next() < 0.7 ? 2 : 3;
      const skin = Math.floor(rng.next() * 4);
      let acc = 0;
      if (rng.next() < 0.06) acc |= 1;
      if (rng.next() < (zone === 2 ? 0.7 : 0.12)) acc |= 2;
      if (rng.next() < (zone === 2 ? 0.2 : 0.04)) acc |= 4;
      const o = i * 4;
      this.look[o] = shirt | (hair << 4);
      this.look[o + 1] = skin | (acc << 2);
      this.look[o + 2] = Math.floor(rng.next() * 256);
      this.look[o + 3] = Math.floor(rng.next() * 256);
      // ところどころ空席（売店・トイレ）: 満員に見えすぎないように少しだけ
      this.kind[i] = rng.next() < 0.004 ? 2 : 0;
    }
  }
}
