// 『競歩、なのに。』のモード本体（ブラウザ）。intro → live（約 7 分の決勝 + ゴール後）→ endcard → result
//   中身（レース・配信の数字・ACTION・コメント欄）は Session。ここは 3D・画面・音・入力をつなぐだけ。
//   intro の間も配信は続いている（後ろで自動で歩き、コメント欄も流れている）。オンエアで最初からやり直す。
//
// 開発用の URL パラメータ: ?seed=N ?auto=serious|balance|flame ?fast=N ?norender ?mute ?start ?t=秒 ?cam=back ?quality=low

import { Session } from './Session.js';
import { Autopilot } from './Autopilot.js';
import { RaceWalkScene } from './scene/RaceWalkScene.js';
import { StreamHUD, clockStr } from './ui/StreamHUD.js';
import { ChatView } from './ui/ChatView.js';
import { ActionPanel } from './ui/ActionPanel.js';
import { buildResult } from './ui/Result.js';
import { RWInput } from './input/RWInput.js';
import { RWAudio } from './audio/RWAudio.js';
import { AudioManager } from '../../src/audio/AudioManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { createRng } from '../../src/core/math.js';
import { PerformanceGovernor } from '../../soccer/src/core/PerformanceGovernor.js';
import { RACE, LAP } from './race/track.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export class RaceWalkGame {
  constructor() {
    this.params = new URLSearchParams(location.search);
    this.seed = this.params.has('seed') ? +this.params.get('seed') : Math.floor(Math.random() * 1e6);
    this.fast = Math.max(1, Math.min(8, +(this.params.get('fast') ?? 1)));
    this.noRender = this.params.has('norender');
    this.autoStyle = this.params.get('auto');
    this.phase = 'boot';
    this.paused = false;
    this.time = 0;
    this.fromMain = location.hash === '#from-main';
    this.redMarks = {};
    this.slowT = 0;
    this.screenT = 0;
    this.shake = 0;
    this.padSel = 0;
  }

  async init() {
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
    this.touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (this.touch) document.body.classList.add('touch');
    this.canvas = $('game');
    this.center = $('center');
    this.gov = new PerformanceGovernor({ touch: this.touch, forced: this.params.get('quality'), onChange: () => this.resize() });
    this.scene = new RaceWalkScene(this.canvas, { seed: this.seed, touch: this.touch });
    this.hud = new StreamHUD();
    this.chatView = new ChatView({ list: $('chat'), pins: $('pins'), spot: $('spot'), rate: $('chatRate') });
    this.panel = new ActionPanel({ root: $('actions'), label: $('ctxLabel'), onPick: (id) => this.pick(id) });
    this.audioMgr = new AudioManager(new EventBus());
    this.audio = new RWAudio(this.audioMgr);
    if (this.params.has('mute')) this.audioMgr.setMuted(true);
    this.input = new RWInput();
    this.newSession(this.seed, true);
    this.bindUI();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.center);
    window.__rw = this;
    this.setPhase('intro');
    if (this.params.has('start') || this.autoStyle) this.start();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  newSession(seed, demo = false) {
    this.session = new Session({ seed });
    if (!this.scene.sim) this.scene.addWalkers(this.session.sim);
    else this.scene.rebind(this.session.sim);
    const style = demo ? 'serious' : this.autoStyle;
    this.auto = style ? new Autopilot(this.session, style, createRng(seed + 77)) : null;
    this.redMarks = {};
    if (this.params.get('cam') === 'back' && !demo) this.session.setFaceCam(false);
  }

  setPhase(p) {
    this.phase = p;
    document.body.dataset.phase = p;
    $('intro').classList.toggle('hidden', p !== 'intro');
    $('result').classList.toggle('hidden', p !== 'result');
    $('endcard').classList.toggle('hidden', p !== 'endcard');
    $('pad').classList.toggle('hidden', !(this.touch && p === 'live'));
  }

  start() {
    if (this.phase !== 'intro' && this.phase !== 'result') return;
    this.audio.init();
    this.newSession(this.phase === 'result' ? this.seed + 1 + Math.floor(Math.random() * 1000) : this.seed);
    this.chatView.clear();
    this.panel.clear();
    this.hud.reset();
    this.scene.resetBoards();
    this.paused = false;
    $('pause').classList.add('hidden');
    this.setPhase('live');
    // 開発用: 途中から（自動で歩いて進める）
    const warp = +(this.params.get('t') ?? 0);
    if (warp > 0) {
      const ap = this.auto ?? new Autopilot(this.session, 'serious', createRng(this.seed + 5));
      let keep = [];
      while (this.session.t < warp && !this.session.ended) {
        ap.step();
        this.session.step(1 / 30);
        keep = keep.concat(this.session.chat.drain()).slice(-30);
        this.session.drainNotices();
      }
      this.chatView.push(keep, 0, 1);
    }
  }

  // ------------------------------------------------------------ 入力
  bindUI() {
    $('intro').addEventListener('pointerdown', (e) => {
      if (e.target.closest('#back')) return;
      this.start();
    });
    $('back').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.backToMain();
    });
    $('pause').addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-action="back"]')) return this.backToMain();
      this.setPaused(false);
    });
    $('result').addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'retry') this.start();
      else if (a === 'back') this.backToMain();
    });
    $('muteBtn').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.audio.init();
      const m = this.audioMgr.toggleMute();
      e.currentTarget.classList.toggle('off', m);
    });
    // タッチ
    const pad = $('pad');
    pad.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-btn]')?.dataset.btn;
      if (!b) return;
      e.preventDefault();
      if (b === 'left') this.input.touchLat = -1;
      if (b === 'right') this.input.touchLat = 1;
      if (b === 'up') this.input.press('ArrowUp');
      if (b === 'down') this.input.press('ArrowDown');
      if (b === 'space') this.input.press('Space');
      if (b === 'cam') this.input.press('KeyC');
    });
    const up = () => (this.input.touchLat = 0);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    pad.addEventListener('pointerleave', up);
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, () => this.audio.init(), { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase === 'live') this.setPaused(true);
    });
  }

  pick(id) {
    if (this.phase !== 'live' || this.paused) return;
    const r = this.session.doAction(id);
    if (r) this.panel.hit(id);
  }

  setPaused(p) {
    this.paused = p;
    $('pause').classList.toggle('hidden', !p);
    $('pause').querySelector('.p-back').classList.toggle('hidden', false);
  }

  // タイトルへ: タイトルから来ていれば「戻る」（タイトルの状態がそのまま残る）。そうでなければタイトルを開く
  backToMain() {
    let fromTitle = false;
    try {
      const r = new URL(document.referrer);
      fromTitle = r.origin === location.origin && !/\/(racewalk|800m|trampoline|soccer|boxing|polevault|nanoni-generator)\//.test(r.pathname);
    } catch {
      fromTitle = false;
    }
    if (this.fromMain && fromTitle && history.length > 1) history.back();
    else location.href = '../index.html';
  }

  controls() {
    const inp = this.input;
    const sim = this.session.sim;
    if (inp.any('KeyM')) e_toggleMute(this);
    if (this.phase === 'intro') {
      if (inp.any('Space', 'Enter')) this.start();
      if (inp.any('Escape')) this.backToMain();
      return;
    }
    if (this.phase === 'result') {
      if (inp.any('Space', 'Enter')) this.start();
      if (inp.any('Escape', 'KeyT')) this.backToMain();
      return;
    }
    if (this.phase !== 'live') return;
    if (inp.any('KeyP', 'Escape')) this.setPaused(!this.paused);
    if (this.paused || this.auto) return;
    if (inp.any('ArrowUp', 'KeyW')) sim.ctl.pace = Math.min(4, sim.ctl.pace + 1);
    if (inp.any('ArrowDown', 'KeyS')) sim.ctl.pace = Math.max(0, sim.ctl.pace - 1);
    sim.ctl.lat = inp.lat();
    if (inp.any('Space')) sim.ctl.space = true;
    for (let k = 1; k <= 6; k++) if (inp.any(`Digit${k}`, `Numpad${k}`)) this.pick(this.session.actions.list[k - 1]?.id);
    if (inp.any('KeyC')) this.session.setFaceCam(!this.session.faceCam);
    // ゲームパッド: LB/RB で選んで X で押す
    const list = this.session.actions.list;
    if (inp.any('PadPrev')) this.padSel = (this.padSel + list.length - 1) % Math.max(1, list.length);
    if (inp.any('PadNext')) this.padSel = (this.padSel + 1) % Math.max(1, list.length);
    if (inp.any('PadOk') && list[this.padSel]) this.pick(list[this.padSel].id);
  }

  // ------------------------------------------------------------ ループ
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const realDt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.gov.sample(realDt);
    this.input.pollPad();
    this.controls();
    const s = this.session;
    const dt = realDt;
    if (!this.paused && (this.phase === 'intro' || this.phase === 'live' || this.phase === 'endcard')) {
      const steps = this.phase === 'live' ? this.fast : 1;
      for (let k = 0; k < steps; k++) {
        if (this.auto) this.auto.step();
        s.step(dt);
      }
      this.time += dt;
      this.handleNotices();
      const comments = s.chat.drain();
      const rate = this.chatView.update(this.time);
      this.chatView.push(comments, this.time, rate);
      if (this.phase !== 'intro') for (const c of comments) this.pingFor(c);
      const ac = s.actionCtx();
      this.panel.render(this.phase === 'live' ? s.actions.list : [], s.actions.mode, ac.rem);
      this.hud.update(dt, s);
      this.updateBoards(dt);
      const P = s.sim.player;
      this.audio.update(dt, { excitement: Math.min(1, s.drama() * 0.8 + s.metrics.heat * 0.03), fatigue: Math.max(0, Math.min(1, (0.62 - P.E) / 0.55)), moving: P.v > 1 && this.phase === 'live', final: P.rem < 400 && this.phase === 'live', playing: this.phase !== 'intro' });
    }
    if (!this.noRender) {
      this.shake = Math.max(0, this.shake - dt * 2);
      const say = s.say;
      const speaking = say && s.t - say.t < Math.min(4, 0.8 + say.text.length * 0.08) && !/^（|^…/.test(say.text);
      this.scene.update(dt, { phase: this.phase, camMode: s.faceCam ? 'face' : 'back', session: s, actions: s.actions, speaking, shake: this.shake, onStep: (v, f) => this.phase === 'live' && this.audio.step(v, f) });
      this.scene.render();
    }
    this.input.endFrame();
  }

  pingFor(c) {
    if (c.kind === 'sc') {
      if (c.amount >= 1000) this.audio.superchat(c.amount);
    } else if (c.hl) this.audio.ping('hl');
    else if (Math.random() < 0.25) this.audio.ping('n');
  }

  // ------------------------------------------------------------ 出来事 → 画面・音・3D
  handleNotices() {
    const s = this.session;
    const hud = this.hud;
    const live = this.phase === 'live' || this.phase === 'endcard';
    for (const n of s.drainNotices()) {
      if (!live) continue;
      switch (n.type) {
        case 'qte':
          this.audio.qte();
          break;
        case 'trip':
          hud.toast('つまずいた — 立て直した', 'y');
          this.audio.trip();
          this.shake = 0.6;
          break;
        case 'fall':
          hud.big('転倒', 'red', 1.8);
          this.audio.fall();
          this.shake = 1.2;
          break;
        case 'paddle':
          this.scene.paddle(n.judge, n.type);
          if (n.player) {
            hud.toast(`審判 J${n.judge}：黄色パドル <b>${n.type === '~' ? '〜 浮いている' : '＜ 膝が曲がっている'}</b>`, 'y');
            this.audio.paddle();
          }
          break;
        case 'red':
          (this.redMarks[n.id] ??= []).push(n.type);
          this.scene.drawBoard(s.sim, this.redMarks);
          if (n.player) {
            hud.toast(`<b>赤カード ${n.count} 枚目</b>（J${n.judge} ${n.type}）${n.count === 2 ? ' あと 1 枚でペナルティ' : ''}`, 'r');
            hud.big(`RED CARD ${n.count}`, 'red', 1.6);
            this.audio.red();
          }
          break;
        case 'penalty':
          if (n.player) hud.big('ペナルティゾーン<small>30 秒 その場で待機</small>', 'red', 3);
          else hud.toast(`${n.name} がペナルティゾーンへ`, 'r');
          break;
        case 'penaltyEnd':
          if (n.player) hud.toast('ペナルティ終了 — レースに戻る', 'p');
          break;
        case 'dq':
          if (n.player) {
            hud.big('失格<small>DISQUALIFIED</small>', 'red', 4);
            this.audio.red();
          } else hud.toast(`${n.name} 失格`, 'r');
          break;
        case 'overtake':
          hud.toast(`▲ ${n.rank}位${n.who ? `（${n.who}を抜いた）` : ''}`, 'p');
          this.audio.overtake(n.rank === 1);
          break;
        case 'overtaken':
          hud.toast(`▼ ${n.rank}位${n.who ? `（${n.who}に抜かれた）` : ''}`);
          break;
        case 'leader':
          if (n.player) hud.big('先頭！', 'cyan', 1.4);
          break;
        case 'lap':
          this.scene.stadium.drawLap(n.left);
          hud.toast(`残り ${n.left} 周`);
          break;
        case 'bell':
          this.scene.stadium.drawLap(1);
          this.audio.bell();
          hud.big('ラスト 1 周', 'pink', 1.8);
          break;
        case 'remain':
          if (n.m === 100) hud.big('残り 100m', 'pink', 1.4);
          break;
        case 'finish':
          if (n.player) {
            hud.big(`${n.place}位 フィニッシュ<small>${clockStr(n.time, 2)}</small>`, n.place === 1 ? '' : 'cyan', 4.5);
            this.audio.finish(n.place === 1);
          } else if (n.place === 1) hud.toast(`${n.name} が 1 着でフィニッシュ`);
          break;
        case 'kick':
          if (n.near) hud.toast(`${n.name} がスパート！`);
          break;
        case 'surge':
          hud.toast('真壁が仕掛けた（残り 1200m）');
          break;
        case 'water':
          hud.toast('💧 給水');
          break;
        case 'waterMiss':
          if (n.want && !n.reach) hud.toast('給水を取れなかった（レーン 2 まで出る）', 'y');
          break;
        case 'action':
          hud.say(n.say);
          if (n.id === 'sleep') this.audio.sleep();
          else this.audio.click();
          if (n.big) this.shake = 0.5;
          break;
        case 'ccuSpike':
          hud.big(`同接 ${fmt(n.ccu)}<small>人が見ている</small>`, '', 2.4);
          this.audio.spike();
          break;
        case 'heat':
          if (n.up && n.level >= 2) {
            hud.big(n.level === 3 ? '🔥 大炎上 🔥' : '🔥 炎上', 'red', 2);
            this.audio.flame();
          }
          break;
        case 'end':
          this.setPhase('endcard');
          setTimeout(() => this.showResult(), 2600);
          break;
      }
    }
  }

  updateBoards(dt) {
    const s = this.session;
    const sim = s.sim;
    this.slowT -= dt;
    if (this.slowT <= 0) {
      this.slowT = 0.2;
      if (!sim.player.finished) this.scene.stadium.drawClock2(sim.clock);
      if (sim.player.inPenalty) this.scene.stadium.drawPenalty(sim.player.penaltyLeft);
      else if (this.penaltyShown) this.scene.stadium.drawPenalty(null);
      this.penaltyShown = sim.player.inPenalty;
    }
    this.screenT -= dt;
    if (this.screenT <= 0) {
      this.screenT = 2;
      const lead = sim.order[0];
      const rows = sim.order.slice(0, 5).map((w) => ({ name: w.a.name, nat: w.a.nat, player: w.player, gap: w === lead ? (w.finished ? clockStr(RACE.clock0 + w.finishT, 2) : 'LEADER') : w.dq ? 'DQ' : w.finished ? clockStr(RACE.clock0 + w.finishT, 2) : `+${Math.max(0, (lead.d - w.d) / 4.5).toFixed(1)}` }));
      this.scene.stadium.drawRaceScreen(rows, `LAP ${Math.min(25, 21 + Math.floor(Math.max(0, lead.d) / LAP))}/25`);
    }
  }

  showResult() {
    const r = this.session.result();
    $('result').innerHTML = buildResult(r, { fromMain: this.fromMain });
    $('result').scrollTop = 0;
    this.setPhase('result');
  }

  resize() {
    const w = this.center.clientWidth;
    const h = this.center.clientHeight;
    if (!w || !h) return;
    const pr = Math.min(devicePixelRatio || 1, this.gov.q.pixelRatio, 1.75);
    this.scene.resize(w, h, pr);
    this.hud.stripEls = null;
    $('hStrip').innerHTML = '';
  }

  // テスト用
  state() {
    const s = this.session;
    const P = s.sim.player;
    const m = s.metrics;
    return {
      phase: this.phase,
      t: s.t,
      rem: P.rem,
      rank: s.sim.shownRank,
      place: P.place,
      dq: P.dq,
      E: P.E,
      ccu: Math.round(m.ccu),
      peak: Math.round(m.peak),
      subs: Math.round(m.subs),
      sc: m.sc,
      heat: m.heat,
      flames: m.flames,
      shown: s.chat.shown,
      actions: s.actions.count,
      mode: s.actions.mode,
      list: s.actions.list.map((a) => a.id),
      fps: this.gov.fps,
      quality: this.gov.q.name,
      domChat: document.querySelectorAll('#chat .c').length,
    };
  }
}

function e_toggleMute(g) {
  g.audio.init();
  const m = g.audioMgr.toggleMute();
  $('muteBtn').classList.toggle('off', m);
}

