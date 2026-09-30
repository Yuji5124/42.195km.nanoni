import { TIERS } from '../stadium/StadiumLayout.js';

// 10 万席の「誰が座っているか」。1 席 = 数バイト（TypedArray）。
//
// kind（見た目の種類）:
//   0 普通の観客
//   1 空席（あなたの席。1 つだけ）
//   2 一時的な空席（トイレ・売店。あとで戻ってくる）
//   3 荷物が置いてある
//   4 子供（小さくて、遠くから見ると空席っぽい）
//   5 座席と同じ色の上着でフードをかぶって寝ている人（双眼鏡でも空席に見える）
// 遠くから「空席っぽく見える」のは 1〜5。本物は 1 だけ。
export const KIND = { PERSON: 0, TARGET: 1, TEMP: 2, BAG: 3, KID: 4, HOOD: 5 };
export const EMPTYISH = (k) => k >= 1 && k <= 5;

// 服の色（シェーダーのパレットと同じ順番）
export const SHIRTS = [
  0x1c3f9e, // 0 日本代表（青）
  0x16307a, // 1 濃い青
  0xd9dde4, // 2 白
  0x2a55c4, // 3 明るい青
  0x1d2436, // 4 紺
  0x6f747e, // 5 グレー
  0x202127, // 6 黒
  0xb3a07c, // 7 ベージュ
  0xa8303e, // 8 赤
  0xe8c62e, // 9 ブラジル（黄）
  0x1c8a4a, // 10 緑
  0x7ea9d6, // 11 水色
  0xc47394, // 12 ピンク
  0xc9702f, // 13 オレンジ
  0x5f5e3f, // 14 カーキ
  0xc9d3e6, // 15 白（アウェイユニ）
];
export const HAIR = [0x141414, 0x2e1f16, 0x5a3b25, 0x8f8f8f];
export const SKIN = [0xf1c7a3, 0xe0ac86, 0xc98e6a, 0x8d5a3b];
export const SEAT_COLOR = 0x2b8e9a;
export const BAGS = [0x7a2a2a, 0x2a4a7a, 0x3a3a3a, 0xc0a060];

// 応援の種類（ブロックごと）
export const ZONE = { HOME: 0, AWAY: 1, ULTRAS: 2 };

const HOME_SHIRTS = [0, 0, 0, 0, 1, 1, 1, 3, 3, 2, 2, 15, 4, 4, 5, 6, 6, 7, 8, 12, 13, 0, 1, 3];
const AWAY_SHIRTS = [9, 9, 9, 9, 9, 10, 10, 2, 5, 6];
const ULTRA_SHIRTS = [0, 0, 1, 3, 0, 1, 3, 2];

export class SeatPlan {
  constructor(layout, rng, { target = null } = {}) {
    this.layout = layout;
    const N = layout.count;
    this.kind = new Uint8Array(N);
    // look: [shirt | hair << 4, skin | acc << 2, r1, r2]
    this.look = new Uint8Array(N * 4);
    this.zoneOfBlock = new Uint8Array(layout.blocks.length);
    for (const b of layout.blocks) {
      if (b.tier === 0 && b.number >= 9 && b.number <= 11) this.zoneOfBlock[b.index] = ZONE.AWAY;
      else if (b.tier === 1 && b.number >= 50 && b.number <= 52) this.zoneOfBlock[b.index] = ZONE.AWAY;
      else if (b.tier === 0 && b.number >= 3 && b.number <= 7) this.zoneOfBlock[b.index] = ZONE.ULTRAS;
    }

    // あなたの席
    this.target = target ?? this.pickTarget(rng);
    const decoyNear = (id) => {
      // 本物のすぐ隣にはデコイを置かない（見分けがつかない嫌がらせにしない）
      const t = this.target;
      return layout.tier[id] === layout.tier[t] && Math.abs(layout.row[id] - layout.row[t]) <= 1 && Math.abs(layout.s[id] - layout.s[t]) < 0.0012;
    };

    for (let i = 0; i < N; i++) {
      const zone = this.zoneOfBlock[layout.block[i]];
      const pal = zone === ZONE.AWAY ? AWAY_SHIRTS : zone === ZONE.ULTRAS ? ULTRA_SHIRTS : HOME_SHIRTS;
      const shirt = pal[Math.floor(rng.next() * pal.length)];
      const hair = rng.next() < 0.78 ? 0 : rng.next() < 0.6 ? 1 : rng.next() < 0.7 ? 2 : 3;
      const skin = Math.floor(rng.next() * 4);
      let acc = 0;
      if (rng.next() < (zone === ZONE.ULTRAS ? 0.05 : 0.07)) acc |= 1; // 帽子
      if (rng.next() < (zone === ZONE.ULTRAS ? 0.75 : 0.22)) acc |= 2; // マフラー
      if (rng.next() < (zone === ZONE.ULTRAS ? 0.12 : 0.03)) acc |= 4; // 小旗・タオル
      const o = i * 4;
      this.look[o] = shirt | (hair << 4);
      this.look[o + 1] = skin | (acc << 2);
      this.look[o + 2] = Math.floor(rng.next() * 256);
      this.look[o + 3] = Math.floor(rng.next() * 256);

      let k = KIND.PERSON;
      if (zone !== ZONE.ULTRAS && i !== this.target && !decoyNear(i)) {
        const u = rng.next();
        if (u < 0.002) k = KIND.HOOD;
        else if (u < 0.0032) k = KIND.KID;
        else if (u < 0.0044) k = KIND.BAG;
        else if (u < 0.0062) k = KIND.TEMP;
      }
      this.kind[i] = k;
    }
    this.kind[this.target] = KIND.TARGET;
    this.decoyCount = 0;
    for (let i = 0; i < N; i++) if (EMPTYISH(this.kind[i]) && i !== this.target) this.decoyCount++;
  }

  // 上層の、端でも最上段でもない席（大型ビジョンで隠れない列）
  pickTarget(rng) {
    const L = this.layout;
    const T = TIERS[1];
    for (let guard = 0; guard < 1000; guard++) {
      const blocks = L.blocks.filter((b) => b.tier === 1 && !L.boothBlocks.includes(b.index) && this.zoneOfBlock[b.index] === ZONE.HOME);
      const b = blocks[Math.floor(rng.next() * blocks.length)];
      const r = 6 + Math.floor(rng.next() * (T.rows - 26));
      const tr = L.rows[1][r];
      const ids = [];
      for (let i = tr.start; i < tr.start + tr.count; i++) if (L.block[i] === b.index) ids.push(i);
      if (ids.length < 8) continue;
      return ids[2 + Math.floor(rng.next() * (ids.length - 4))];
    }
    return L.findSeat(42, 19, 5);
  }

  zone(id) {
    return this.zoneOfBlock[this.layout.block[id]];
  }

  looksEmpty(id) {
    return EMPTYISH(this.kind[id]);
  }
}
