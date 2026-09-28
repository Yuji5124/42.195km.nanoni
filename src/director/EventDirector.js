// EventDirector: 距離（raceDistance km）に応じて「世界とゲームルール」を切り替える中心システム。
// イベントは JSON（src/data/*.json）で定義するデータ駆動。
//
// - current: 現在地点で有効なパラメータ（camera / fx / music / crowd / obstacles / cheerMul / rules / pattern / calm）
// - paramAt(key, km): 任意地点のパラメータ（前方のチャンク・観客・障害物の生成に使う）
// - 新しいイベントを通過すると bus に 'event' を流す（UI のキャプション、実況、音、カメラが反応）

export class EventDirector {
  constructor(slice, bus) {
    this.slice = slice;
    this.bus = bus;
    this.defaults = slice.defaults;
    this.events = [...slice.events].sort((a, b) => a.km - b.km);
    this.reset();
  }

  reset() {
    this.cursor = 0;
    this.current = structuredClone(this.defaults);
    this.lastKm = -Infinity;
  }

  static apply(state, ev) {
    for (const key of Object.keys(state)) {
      if (ev[key] !== undefined) state[key] = ev[key];
    }
  }

  paramAt(key, km) {
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
      EventDirector.apply(this.current, ev);
      this.bus.emit('event', { event: ev, state: this.current, before });
    }
    this.lastKm = km;
  }

  // デバッグ用: 任意地点にワープしたとき、途中のイベントを静かに適用する
  skipTo(km) {
    while (this.cursor < this.events.length && this.events[this.cursor].km <= km) {
      EventDirector.apply(this.current, this.events[this.cursor++]);
    }
    this.bus.emit('event', { event: { id: 'warp', km }, state: this.current, before: this.current, silent: true });
  }

  nextEvent() {
    return this.events[this.cursor] ?? null;
  }
}
