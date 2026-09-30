// イベントの司令塔。data/events.js の表を読み、「いつ・どれを」起こすかを決めて、
// カメラ・世界の速さ・点数・文字・エフェクト（TrampolineEffects）をまとめて動かす。
// モード本体は moment('takeoff') のように「今こういう瞬間」と伝えるだけ。

export class TrampolineEventDirector {
  constructor(mode, events, effects) {
    this.mode = mode;
    this.events = events;
    this.byId = Object.fromEntries(events.map((e) => [e.id, e]));
    this.effects = effects;
    this.reset();
  }

  reset() {
    this.active = [];
    this.seen = new Set();
    this.lastAttempt = {}; // id → 最後に起きた試技
    this.count = 0; // 1 ゲームで起きたイベントの数（テンポに使う）
    this.forced = new Set(); // ?event=ID
    this.beginJump();
  }

  // 表の食い違いを探す（テスト用）: 重複した id・知らない on・無いエフェクト・点の形
  problems() {
    const ON = ['attempt', 'takeoff', 'word', 'air', 'descent', 'sync', 'land', 'super', 'sky'];
    const out = [];
    const ids = new Set();
    for (const e of this.events) {
      if (ids.has(e.id)) out.push(`${e.id}: id が重複`);
      ids.add(e.id);
      if (!ON.includes(e.on)) out.push(`${e.id}: on '${e.on}' は無い`);
      for (const f of e.effects ?? []) if (!this.effects[f]) out.push(`${e.id}: effect '${f}' が無い`);
      if (e.score && (!e.score.cat || !e.score.label || e.score.points === undefined)) out.push(`${e.id}: score の形`);
      if (e.on === 'sync' && !e.kind) out.push(`${e.id}: sync なのに kind が無い`);
    }
    return out;
  }

  force(id) {
    if (this.byId[id]) this.forced.add(id);
  }

  // 1 回の跳躍ごとの記録
  beginJump() {
    this.jump = { fired: new Set(), rolled: new Set(), deferred: [] };
  }

  isActive(id) {
    return this.active.some((a) => a.ev.id === id);
  }

  get blocking() {
    return this.active.some((a) => a.ev.block);
  }

  // 今この瞬間に起きうるイベントを判定する
  moment(on, extra = {}) {
    const ctx = this.mode.eventCtx(extra);
    const cands = [];
    for (const ev of this.events) {
      if (ev.on !== on) continue;
      if (!this.eligible(ev, ctx)) continue;
      cands.push(ev);
    }
    if (!cands.length) return [];
    // group ごとに 1 つ（重みで選ぶ）
    const fired = [];
    const groups = new Map();
    for (const ev of cands) {
      if (!ev.group) {
        if (this.fire(ev, ctx)) fired.push(ev);
        continue;
      }
      if (!groups.has(ev.group)) groups.set(ev.group, []);
      groups.get(ev.group).push(ev);
    }
    for (const [group, list] of groups) {
      const busy = this.active.find((a) => a.ev.group === group);
      const forced = list.find((e) => this.forced.has(e.id));
      if (busy && !forced) continue;
      if (busy) this.endNow(busy); // ?event= で指定されたものは、今のカメラの異常を終わらせてでも起こす
      if (forced) {
        if (this.fire(forced, ctx)) fired.push(forced);
        continue;
      }
      let total = 0;
      for (const e of list) total += e.weight ?? 1;
      let r = this.mode.rng.next() * total;
      const pick = list.find((e) => (r -= e.weight ?? 1) <= 0) ?? list[0];
      if (this.fire(pick, ctx)) fired.push(pick);
    }
    return fired;
  }

  eligible(ev, ctx) {
    const forced = this.forced.has(ev.id);
    if (!forced && ctx.level < (ev.level ?? 0)) return false;
    if (ev.once && this.seen.has(ev.id)) return false;
    if (this.jump.fired.has(ev.id) && !ev.repeat) return false;
    if (this.isActive(ev.id)) return false;
    const last = this.lastAttempt[ev.id];
    if (!forced && last !== undefined && ctx.attempt - last <= (ev.cooldown ?? 0) && last !== ctx.attempt) return false;
    if (ev.condition && !ev.condition(ctx)) return false;
    // 確率（'air' は 1 回の跳躍で 1 回だけ抽選。条件を満たした最初の瞬間に）
    const chance = ev.chance ?? 1;
    if (chance >= 1 || forced) return true;
    if (ev.guarantee && ctx.attempt >= ev.guarantee && !this.seen.has(ev.id)) return true;
    if (this.jump.rolled.has(ev.id)) return false;
    this.jump.rolled.add(ev.id);
    return this.mode.rng.next() < chance;
  }

  fire(ev, ctx) {
    const m = this.mode;
    this.forced.delete(ev.id);
    this.seen.add(ev.id);
    this.jump.fired.add(ev.id);
    this.lastAttempt[ev.id] = ctx.attempt;
    this.count++;
    const inst = { ev, t: 0, ctx, done: false, data: {} };
    // カメラを握っているイベント（観客ドラマ・FACE LOCK・見失い）の最中は、他のイベントはカメラを動かさない
    const held = this.active.some((a) => a.ev.holdCamera);
    this.active.push(inst);
    if (ev.cameraMode && (!held || ev.holdCamera)) m.cam.set(ev.cameraMode, { cut: true });
    if (ev.comment) m.hud.comment(ev.comment, 3.4);
    for (const name of ev.effects ?? []) this.effects[name]?.start?.(m, inst);
    if (ev.timeScale) m.applyAirScale();
    if (ev.score && !ev.scoreOn) this.award(inst, ctx);
    else if (ev.score && ev.scoreOn === 'land') this.jump.deferred.push(inst);
    m.onEvent?.(ev, inst);
    return true;
  }

  award(inst, ctx) {
    const ev = inst.ev;
    const s = ev.score;
    const pts = typeof s.points === 'function' ? s.points(ctx) : s.points;
    if (ev.message) this.mode.nanoni(ev.message, s.cat, s.label, pts);
    else this.mode.scoring.add(s.cat, s.label, pts);
  }

  // 空中で有効なイベントが掛けるスローの倍率
  get timeScale() {
    let k = 1;
    for (const a of this.active) if (a.ev.timeScale) k *= a.ev.timeScale;
    return k;
  }

  // 着地: 着地時に加点するイベントを確定し、'air' の間だけのイベントを終わらせる
  land() {
    const ctx = this.mode.eventCtx({});
    for (const inst of this.jump.deferred) {
      if (!inst.ev.scoreIf || inst.ev.scoreIf(ctx)) this.award(inst, ctx);
    }
    this.jump.deferred = [];
    for (const a of this.active) if (a.ev.duration === 'air') a.done = true;
  }

  update(realDt) {
    const m = this.mode;
    for (const a of this.active) {
      a.t += realDt;
      for (const name of a.ev.effects ?? []) this.effects[name]?.update?.(m, a, realDt);
      // duration が無いイベントは一瞬（点と文字だけ）
      if (a.ev.duration === undefined || (typeof a.ev.duration === 'number' && a.t >= a.ev.duration)) a.done = true;
    }
    if (!this.active.some((a) => a.done)) return;
    const ending = this.active.filter((a) => a.done);
    this.active = this.active.filter((a) => !a.done);
    for (const a of ending) {
      for (const name of a.ev.effects ?? []) this.effects[name]?.end?.(m, a);
      if (a.ev.score && a.ev.scoreOn === 'end') this.award(a, m.eventCtx({}));
      if (a.ev.timeScale) m.applyAirScale();
      // このイベントがカメラを動かしていたら、今の場面のカメラへ戻す
      if (a.ev.cameraMode && m.cam.shot === a.ev.cameraMode) m.cam.set(m.defaultShot(), { dur: 0.5 });
    }
  }

  endNow(inst) {
    this.active = this.active.filter((a) => a !== inst);
    for (const name of inst.ev.effects ?? []) this.effects[name]?.end?.(this.mode, inst);
    if (inst.ev.timeScale) this.mode.applyAirScale();
  }

  // 試技をまたいで残さない
  clear() {
    for (const a of this.active) for (const name of a.ev.effects ?? []) this.effects[name]?.end?.(this.mode, a);
    this.active = [];
  }
}
