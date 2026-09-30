// 採点。内部は 8 つの部門に分けて集計する（表示は「PERFECT LANDING +1000」のような内訳リスト）。
//   TECHNIQUE … 回転・技・高さ
//   TYPING    … 打った文字・速さ・正確さ
//   LANDING   … 着地
//   AUDIENCE  … 観客が跳んだ・観客ドラマ
//   CAMERA    … カメラの異常（顔しか見えない・間に合わなかった）
//   BACKGROUND… 花火・飛行機など背景との偶然の一致
//   ACCIDENT  … 失敗（着地失敗でも点になる）
//   NANONI    … 「〜なのに。」
// 審判（5 人）は最後まで真面目に 10 点満点で採点する。

export const CATEGORIES = ['TECHNIQUE', 'TYPING', 'LANDING', 'AUDIENCE', 'CAMERA', 'BACKGROUND', 'ACCIDENT', 'NANONI'];

export class TrampolineScoring {
  constructor(attempts = 10) {
    this.attempts = attempts;
    this.reset();
  }

  reset() {
    this.total = 0;
    this.history = [];
    this.items = [];
    this.byCat = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    this.listeners = [];
  }

  onAdd(fn) {
    this.listeners.push(fn);
  }

  begin() {
    this.items = [];
  }

  // 1 項目。同じ label は 1 回の試技で 1 回だけ（重複の演出で点が暴走しない）
  add(cat, label, points, opts = {}) {
    if (!opts.repeat && this.items.some((i) => i.label === label)) return 0;
    const pts = Math.round(points);
    const item = { cat, label, points: pts, big: opts.big ?? pts >= 2500 };
    this.items.push(item);
    for (const fn of this.listeners) fn(item);
    return pts;
  }

  get attemptSum() {
    let s = 0;
    for (const i of this.items) s += i.points;
    return s;
  }

  // 試技の終わり: 審判の点（execution 0〜10）を足して確定
  finish(execution, judgeRng, attempt = this.history.length + 1) {
    // 5 人の審判: 平均 execution のまわりに少しばらつく（最高と最低を除いた平均が公式）
    const cards = [];
    for (let i = 0; i < 5; i++) cards.push(Math.max(0, Math.min(10, Math.round((execution + (judgeRng() - 0.5) * 0.6) * 10) / 10)));
    const sorted = [...cards].sort((a, b) => a - b);
    const official = (sorted[1] + sorted[2] + sorted[3]) / 3;
    const judgePts = Math.round(official * 100);
    this.add('TECHNIQUE', `JUDGES ${official.toFixed(2)}`, judgePts, { repeat: true });
    const sum = this.attemptSum;
    for (const i of this.items) this.byCat[i.cat] += i.points;
    this.total += sum;
    const rec = { items: [...this.items], sum, cards, official, attempt };
    this.history.push(rec);
    return rec;
  }
}
