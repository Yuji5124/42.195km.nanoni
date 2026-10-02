// 1 回の配信（レース + 配信の数字 + ACTION + コメント欄）をつなぐ。three.js にも DOM にも依存しない。
//   ブラウザ（RaceWalkGame）でも Node（tools/balance.mjs）でも同じつなぎ方で動く。
//
//   左（ActionSystem）→ 中央（RaceSim）→ 右（LiveChatSystem）→ 左 … の循環:
//     ACTION を押す → レースへ効く（止まる・フォームが崩れる…）＋ 数字が動く ＋ コメント欄が反応する
//     レースの出来事 → コメント欄が反応する（人格ごと・記憶あり）＋ 数字が動く
//     コメント欄（アンチの名指し・スパチャ・「疲れてる？」）→ 左に新しい選択肢が出る

import { createRng } from '../../src/core/math.js';
import { RaceSim } from './race/RaceSim.js';
import { JUDGES, LAP, SEG, RACE } from './race/track.js';
import { StreamingMetrics } from './stream/StreamingMetrics.js';
import { ActionSystem, wrongName } from './stream/ActionSystem.js';
import { LiveChatSystem } from './chat/LiveChatSystem.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

export function fmtLap(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

export class Session {
  constructor({ seed = 1, onNotice = () => {} } = {}) {
    this.seed = seed;
    this.onNotice = onNotice;
    this.rng = createRng(seed);
    this.notices = [];
    this.sim = new RaceSim({ rng: createRng(seed + 1), emit: (t, d) => this.onRace(t, d) });
    this.metrics = new StreamingMetrics({
      rng: createRng(seed + 2),
      onSuperchat: (sc) => this.chat?.addSuperchat(sc),
      onEvent: (t, d) => this.onMetric(t, d),
    });
    this.chat = new LiveChatSystem({ rng: createRng(seed + 3), metrics: this.metrics });
    this.actions = new ActionSystem({ sim: this.sim, metrics: this.metrics, rng: createRng(seed + 4), onAction: (info) => this.onAction(info) });
    this.faceCam = true;
    this.tripT = -99;
    this.lapT = 0;
    this.laptime = '1:31';
    this.lastLap = 0;
    this.ended = false;
    this.finishInfo = null;
    this.say = null; // 配信者のセリフ（字幕）
    this.attDecay = 0;
    this.camRival = 0;
    this.crowdHype = 0;
  }

  get t() {
    return this.sim.t;
  }

  notice(type, data = {}) {
    const n = { type, t: this.sim.t, ...data };
    this.notices.push(n);
    this.onNotice(n);
  }

  drainNotices() {
    const n = this.notices;
    this.notices = [];
    return n;
  }

  // ---------------------------------------------------------------- 毎フレーム
  step(dt) {
    const sim = this.sim;
    const m = this.metrics;
    // 炎上 → 審判の注目・集中力
    this.actions.attentionBonus = Math.max(0, this.actions.attentionBonus - dt * 0.004);
    sim.attention = 1 + m.heat * 0.055 + this.actions.attentionBonus;
    sim.heatFocus = m.heat;
    sim.step(dt);
    if (this.camRival > 0) this.camRival -= dt;
    if (this.crowdHype > 0) this.crowdHype -= dt;
    m.update(dt, { drama: this.drama(), faceCam: this.faceCam });
    const cc = this.chatCtx();
    this.chat.update(dt, cc);
    const ac = this.actionCtx();
    this.chat.updatePressure(
      dt,
      this.actions.list.filter((a) => a.tempt).map((a) => a.id),
    );
    this.actions.update(dt, ac, this.chat.pressure);
    if (sim.done && !this.ended && sim.doneT > 1.5) {
      this.ended = true;
      this.notice('end');
    }
  }

  // レースの盛り上がり（0〜1）: 上位で・接戦で・終盤ほど
  drama() {
    const sim = this.sim;
    const P = sim.player;
    if (P.dq) return 0.25;
    if (P.finished) return P.place === 1 ? 0.95 : 0.5;
    const prog = clamp(P.d / RACE.dist);
    const rank = sim.shownRank;
    const top = rank === 1 ? 1 : rank <= 3 ? 0.85 : rank <= 5 ? 0.55 : 0.3;
    const near = Math.min(Math.abs(sim.gapTo(P, sim.ahead()) || 9), Math.abs(sim.gapTo(sim.behind() ?? P, P) || 9));
    const close = Math.exp(-near / 2.5);
    let d = 0.12 + 0.6 * prog * prog * top * (0.5 + 0.5 * close);
    if (P.rem < 400) d += 0.22 * top;
    if (P.rem < 120) d += 0.15 * top;
    return clamp(d);
  }

  lapPos(w = this.sim.player) {
    return (((w.d % LAP) + LAP) % LAP);
  }

  chatCtx() {
    const sim = this.sim;
    const P = sim.player;
    const lead = sim.order[0];
    const ahead = sim.ahead();
    const behind = sim.behind();
    return {
      rem: P.rem,
      pos: sim.shownRank,
      gap: lead === P ? 0 : lead.finished ? sim.t - lead.finishT + P.rem / Math.max(3, P.v) : sim.gapTo(P, lead),
      gapAhead: ahead ? ahead.d - P.d : 0,
      laps: sim.lapsToGo,
      leader: lead.a.short,
      ahead: ahead?.a.short ?? null,
      behind: behind?.a.short ?? null,
      ccu: this.metrics.ccu,
      heat: this.metrics.heat,
      finished: P.finished,
      dq: P.dq,
      place: P.place,
      laptime: this.laptime,
      reds: P.red,
      fatigueLevel: sim.fatigueLevel,
      inPenalty: P.inPenalty,
    };
  }

  actionCtx() {
    const sim = this.sim;
    const P = sim.player;
    const lp = this.lapPos();
    let nearJudge = false;
    for (const j of JUDGES) {
      const ahead = (((j.s - lp) % LAP) + LAP) % LAP;
      if (ahead > 3 && ahead < 24) nearJudge = true;
    }
    const mk = sim.walkers.find((w) => w.id === 'makabe');
    const lap = Math.floor(Math.max(0, P.d) / LAP);
    return {
      t: sim.t,
      rem: P.rem,
      rank: sim.shownRank,
      fatigueLevel: sim.fatigueLevel,
      fatigueShown: sim.fatigueLevel >= 1 && sim.t - this.chat.fatigueTalkT < 16,
      tripT: this.tripT,
      anti: this.chat.anti,
      sc: this.chat.sc,
      nearJudge,
      nearMakabe: mk && Math.abs(mk.d - P.d) < (P.finished ? 30 : 6) && !mk.dq,
      nearWater: sim.nearWater() && !P.finished && !P.dq,
      drinkLap: P.drinkLap === lap,
      inPenalty: P.inPenalty || P.penaltyPending,
      homeStraight: lp > SEG.westEnd + 4 && lp < LAP - 6,
      finished: P.finished,
      dq: P.dq,
      readLine: null,
    };
  }

  // ---------------------------------------------------------------- ACTION
  doAction(idOrKey) {
    const c = this.actionCtx();
    const item = typeof idOrKey === 'number' ? this.actions.list[idOrKey - 1] : this.actions.list.find((x) => x.id === idOrKey);
    if (!item) return null;
    if (item.id === 'look' || item.id === 'readall') c.readLine = this.chat.pickReadable() ?? 'がんばれ';
    return this.actions.trigger(item.id, c);
  }

  onAction(info) {
    const a = info.action;
    const c = info.c;
    this.say = { text: info.say, t: this.sim.t, id: a.id };
    const buzz = (a.stream?.buzz ?? 0) * info.novelty;
    this.chat.event(a.event, { buzz, clip: a.clip ?? null, wrong: c.sc ? wrongName(c.sc.name) : '' });
    if (a.rivalCam) this.camRival = a.rivalCam;
    if (a.crowd) this.crowdHype = 4;
    this.notice('action', { id: a.id, say: info.say, label: info.label, tempt: !!a.tempt, big: !!a.big });
  }

  setFaceCam(face) {
    if (face === this.faceCam) return;
    this.faceCam = face;
    this.chat.event('cam', { face });
    this.notice('cam', { face });
  }

  // ---------------------------------------------------------------- レースの出来事
  onRace(type, d) {
    const m = this.metrics;
    const sim = this.sim;
    const P = sim.player;
    switch (type) {
      case 'tripStart':
        this.notice('qte', { window: d.window });
        return;
      case 'trip':
        this.tripT = sim.t;
        m.impulse({ buzz: 0.05, fun: 0.08 });
        break;
      case 'fall':
        this.tripT = sim.t;
        m.impulse({ buzz: 0.16, fun: 0.15, heat: 0.3, label: '決勝で転倒', clip: 1 });
        break;
      case 'overtake':
        m.impulse({ buzz: d.rank === 1 ? 0.07 : 0.03, trust: 0.01 });
        break;
      case 'overtaken':
        m.impulse({ buzz: 0.01 });
        break;
      case 'bell':
        m.impulse({ buzz: 0.06 });
        break;
      case 'paddle':
        if (d.player) m.impulse({ heat: 0.25, buzz: 0.03 });
        break;
      case 'red':
        if (d.player) m.impulse({ heat: 0.5, buzz: 0.1, trust: -0.03 });
        break;
      case 'penalty':
        if (d.player) m.impulse({ buzz: 0.3, heat: 1, label: 'ペナルティゾーン入り' });
        break;
      case 'dq':
        if (d.player) {
          m.finale({ dq: true });
          this.finishInfo = { dq: true };
        }
        break;
      case 'finish':
        if (d.player) {
          m.finale({ place: d.place });
          this.finishInfo = { place: d.place, time: d.time };
        }
        break;
      case 'kick':
        d.near = Math.abs((sim.walkers.find((w) => w.id === d.id)?.d ?? 0) - P.d) < 30;
        break;
      case 'lap':
      case 'remain':
        break;
    }
    if (type === 'lap' || type === 'bell') {
      const lt = sim.t - this.lapT;
      this.lapT = sim.t;
      this.laptime = fmtLap(lt + (this.lastLap === 0 ? 0.6 : 0));
      this.lastLap++;
    }
    this.chat.event(type, d);
    this.notice(type, d);
  }

  onMetric(type, d) {
    this.chat.event(type, d);
    this.notice(type, d);
  }

  // ---------------------------------------------------------------- 結果
  result() {
    const sim = this.sim;
    const P = sim.player;
    const m = this.metrics.snapshot();
    return {
      place: P.dq ? null : P.place || P.rank,
      dq: P.dq,
      time: P.finished ? RACE.clock0 + P.finishT : null,
      peak: m.peak,
      subs0: 150000,
      subs: m.subs,
      subsGain: m.subsGain,
      sc: m.sc,
      scCount: m.scCount,
      likes: m.likes,
      dislikes: m.dislikes,
      flames: m.flames,
      yellows: sim.stats.yellows,
      reds: sim.stats.reds,
      falls: sim.stats.falls,
      trips: sim.stats.trips,
      comments: m.comments + this.chat.shown,
      clipViews: m.clipViews,
      moments: [...this.metrics.moments].sort((a, b) => b.views - a.views).slice(0, 4),
      stories: this.chat.stories(),
      actions: this.actions.count,
      left: this.chat.left,
      converted: this.chat.converted,
      standings: sim.order.map((w) => ({ name: w.a.name, short: w.a.short, nat: w.a.nat, bib: w.a.bib, player: w.player, dq: w.dq, time: w.finished ? RACE.clock0 + w.finishT : null, place: w.place })),
      history: this.metrics.history,
    };
  }
}
