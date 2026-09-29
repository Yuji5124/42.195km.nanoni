// TV ディレクター: 「いま誰を映すと面白いか」（InterestScore）を数えて、中継カメラの被写体を選ぶ。
// 点数: 主人公 / 先頭 / 接戦 / 追い上げ（速度差）/ スパート / 最下位 / バテかけ + 少しの気まぐれ（seed）
// 固定ステップで動く（ボットの CAMERA 性格が「映っている」かどうかを見るので、決定的にしておく）

export class TvDirector {
  reset(bank, core) {
    this.rng = bank.stream('director');
    this.pick = core.playerIndex;
    this.hold = 0;
    this.scores = new Array(core.n).fill(0);
  }

  step(dt, core) {
    this.hold -= dt;
    if (this.hold > 0) return;
    const rs = core.runners;
    let avgV = 0;
    for (const r of rs) avgV += r.v;
    avgV /= rs.length;
    let best = core.playerIndex;
    let bestS = -Infinity;
    for (const r of rs) {
      if (r.finished) {
        this.scores[r.index] = -1;
        continue;
      }
      let s = r.isPlayer ? 2.2 : 0;
      if (r.rank === 1) s += 2;
      if (r.rank === core.n) s += 0.6;
      for (const o of rs) if (o !== r && !o.finished && Math.abs(o.d - r.d) < 1.2 && Math.abs(o.off - r.off) < 1.6) s += 1.1;
      s += (r.v - avgV) * 1.4;
      if (r.bursting) s += 1.2;
      if (r.stamina < 15) s += 0.8;
      if (r.index === this.pick) s -= 0.9; // 同じ人ばかり映さない
      s += this.rng.next() * 0.8;
      this.scores[r.index] = s;
      if (s > bestS) {
        bestS = s;
        best = r.index;
      }
    }
    this.pick = best;
    this.hold = this.rng.range(2.4, 4);
  }
}
