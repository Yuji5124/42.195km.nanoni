// EventDirector: 距離（raceDistance km）に応じて「世界とゲームルール」を切り替える中心システム。
// イベントは JSON（src/data/*.json）で定義するデータ駆動。
//
// - current: 現在地点で有効なパラメータ（camera / fx / music / crowd / obstacles / cheerMul / rules / pattern / calm）
// - paramAt(key, km): 任意地点のパラメータ（前方のチャンク・観客・障害物の生成に使う）
// - 新しいイベントを通過すると bus に 'event' を流す（UI のキャプション、実況、音、カメラが反応）
//
// segmented（1500m）: 各イベント = 区間。区間に入るたびに状態を defaults に戻してから適用する
//   → 前の区間のカメラ・ルール・エフェクトが次の区間に漏れない。

export class EventDirector {
  constructor(slice, bus) {
    this.slice = slice;
    this.bus = bus;
    this.defaults = slice.defaults;
    this.segmented = !!slice.segmented;
    this.events = [...slice.events].sort((a, b) => a.km - b.km);
    this.reset();
  }

  reset() {
    this.cursor = 0;
    this.current = structuredClone(this.defaults);
    this.lastKm = -Infinity;
    // スタート前（km < 0）の区間は最初から有効にしておく（スタジアムの観客・BGM など）
    if (this.segmented) {
      while (this.cursor < this.events.length && this.events[this.cursor].km < 0) this.applyEvent(this.events[this.cursor++]);
    }
  }

  static apply(state, ev) {
    for (const key of Object.keys(state)) {
      if (ev[key] !== undefined) state[key] = ev[key];
    }
  }

  applyEvent(ev) {
    if (!this.segmented) return EventDirector.apply(this.current, ev);
    for (const key of Object.keys(this.current)) {
      this.current[key] = ev[key] !== undefined ? ev[key] : structuredClone(this.defaults[key]);
    }
  }

  // その地点を含む区間（segmented 用）
  segmentAt(km) {
    let seg = null;
    for (const ev of this.events) {
      if (ev.km > km) break;
      seg = ev;
    }
    return seg;
  }

  paramAt(key, km) {
    if (this.segmented) {
      const seg = this.segmentAt(km);
      return seg && seg[key] !== undefined ? seg[key] : this.defaults[key];
    }
    let value = this.defaults[key];
    for (const ev of this.events) {
      if (ev.km > km) break;
      if (ev[key] !== undefined) value = ev[key];
    }
    return value;
  }

  // 区間パターン（例: side2d）の範囲 [startKm, endKm)
  patternRanges(name) {
    const ranges = [];
    let open = null;
    for (const ev of this.events) {
      if (ev.pattern === undefined) continue;
      if (ev.pattern === name && open === null) open = ev.km;
      else if (ev.pattern !== name && open !== null) {
        ranges.push([open, ev.km]);
        open = null;
      }
    }
    if (open !== null) ranges.push([open, Infinity]);
    return ranges;
  }

  update(km) {
    while (this.cursor < this.events.length && this.events[this.cursor].km <= km) {
      const ev = this.events[this.cursor++];
      const before = { ...this.current };
      this.applyEvent(ev);
      this.bus.emit('event', { event: ev, state: this.current, before });
    }
    this.lastKm = km;
  }

  // デバッグ用: 任意地点にワープしたとき、途中のイベントを静かに適用する
  skipTo(km) {
    while (this.cursor < this.events.length && this.events[this.cursor].km <= km) {
      this.applyEvent(this.events[this.cursor++]);
    }
    this.bus.emit('event', { event: { id: 'warp', km }, state: this.current, before: this.current, silent: true });
  }

  nextEvent() {
    return this.events[this.cursor] ?? null;
  }
}
