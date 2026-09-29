// イベントバス。システム同士は直接呼び合わず、ここを通して知らせる。
// 自動テスト用に直近のイベントを記録する（window.__nanoni.events）。
// 注意: 「偽のバグ表示」などの演出もイベントとして流す。console.error は本物の不具合だけ。

export const EV = {
  RACE_READY: 'RACE_READY',
  ON_YOUR_MARKS: 'ON_YOUR_MARKS',
  SET: 'SET',
  RACE_START: 'RACE_START',
  DISTANCE: 'DISTANCE', // { meters: 100, 200, ... }
  LAP_2: 'LAP_2',
  PLAYER_OVERTAKE: 'PLAYER_OVERTAKE',
  PLAYER_OVERTAKEN: 'PLAYER_OVERTAKEN',
  PLAYER_FIRST: 'PLAYER_FIRST',
  PLAYER_LAST: 'PLAYER_LAST',
  STAMINA_LOW: 'STAMINA_LOW',
  BURST: 'BURST',
  RHYTHM: 'RHYTHM', // { grade: PERFECT | GOOD | MISS, streak }
  FOOTSTEP: 'FOOTSTEP', // { runner, foot }
  CHAOS_UP: 'CHAOS_UP',
  MODIFIER_START: 'MODIFIER_START',
  MODIFIER_END: 'MODIFIER_END',
  NANONI_COMBO: 'NANONI_COMBO',
  NANONI_TEXT: 'NANONI_TEXT',
  FAKE_BUG: 'FAKE_BUG',
  CAMERA_CUT: 'CAMERA_CUT',
  CROWD_REACT: 'CROWD_REACT',
  FINAL_100: 'FINAL_100',
  FINAL_40: 'FINAL_40',
  RUNNER_FINISH: 'RUNNER_FINISH',
  FINISH: 'FINISH', // プレイヤーのゴール
  RACE_END: 'RACE_END', // 全員ゴール / 結果確定
};

export class EventBus {
  constructor() {
    this.handlers = new Map();
    this.log = [];
    this.time = 0;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  emit(type, payload = {}) {
    if (type !== EV.FOOTSTEP && type !== EV.RHYTHM) {
      this.log.push({ t: +this.time.toFixed(2), type, ...payload });
      if (this.log.length > 400) this.log.shift();
    }
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear() {
    this.handlers.clear();
    this.log = [];
  }
}
