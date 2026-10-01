// 3 万人の「誰が座っているか」。soccer の SeatPlan と同じ形（kind / look / zoneOfBlock）で、
// CrowdField（ビルボード 1 draw call）と NearCrowd（近くの 3D 人形）がそのまま読める。
//   look = [服 | 髪 << 4, 肌 | 小物 << 2, r1, r2]
//   服の色は soccer/src/crowd/SeatPlan.js の SHIRTS のパレット番号（16 色）
//   小物: bit0 帽子 / bit1 マフラー / bit2 小旗（日の丸）
// 夜の陸上競技場: 服はばらばら（チームカラーの集団はいない）。日の丸の小旗とタオルが少し。

// ブロックの性格（観客の反応をまとめて動かす単位）
export const ZONE = { MAIN: 0, BACK: 1, CURVE: 2, UPPER: 3 };

const SHIRTS_MIX = [2, 2, 2, 4, 4, 5, 5, 6, 6, 6, 7, 7, 8, 1, 11, 12, 13, 14, 3, 0, 15, 4, 6, 2];

export class CrowdPlan {
  constructor(layout, rng) {
    const N = layout.count;
    this.kind = new Uint8Array(N);
    this.look = new Uint8Array(N * 4);
    this.zoneOfBlock = new Uint8Array(layout.blocks.length);
    for (const b of layout.blocks) {
      if (b.tier === 1) this.zoneOfBlock[b.index] = ZONE.UPPER;
      else if (b.seg === 0) this.zoneOfBlock[b.index] = ZONE.MAIN;
      else if (b.seg === 2) this.zoneOfBlock[b.index] = ZONE.BACK;
      else this.zoneOfBlock[b.index] = ZONE.CURVE;
    }
    for (let i = 0; i < N; i++) {
      const shirt = SHIRTS_MIX[Math.floor(rng.next() * SHIRTS_MIX.length)];
      const hair = rng.next() < 0.7 ? 0 : rng.next() < 0.55 ? 1 : rng.next() < 0.6 ? 2 : 3;
      const skin = rng.next() < 0.75 ? Math.floor(rng.next() * 2) : Math.floor(rng.next() * 4);
      let acc = 0;
      if (rng.next() < 0.08) acc |= 1;
      if (rng.next() < 0.06) acc |= 2;
      if (rng.next() < 0.035) acc |= 4;
      const o = i * 4;
      this.look[o] = shirt | (hair << 4);
      this.look[o + 1] = skin | (acc << 2);
      this.look[o + 2] = Math.floor(rng.next() * 256);
      this.look[o + 3] = Math.floor(rng.next() * 256);
      // ところどころ空席（売店・トイレ）
      this.kind[i] = rng.next() < 0.012 ? 2 : 0;
    }
  }
}
