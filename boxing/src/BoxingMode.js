import * as THREE from 'three';
import { AudioManager } from '../../src/audio/AudioManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { createRng, clamp } from '../../src/core/math.js';
import { CrowdDirector } from '../../soccer/src/crowd/CrowdDirector.js';
import { CrowdField } from '../../soccer/src/crowd/CrowdField.js';
import { NearCrowd } from '../../soccer/src/crowd/NearCrowd.js';
import { SoccerAudio } from '../../soccer/src/audio/SoccerAudio.js';
import { PerformanceGovernor } from '../../soccer/src/core/PerformanceGovernor.js';
import { ArenaLayout, ArenaPlan } from './arena/ArenaLayout.js';
import { BoxingArena, RING } from './arena/BoxingArena.js';
import { BoxerModel } from './fighters/BoxerModel.js';
import { BoxerAnimator, RefereeAnimator } from './fighters/BoxerAnimator.js';
import { FightCore } from './core/FightCore.js';
import { CameraRig } from './view/CameraRig.js';
import { BoxingFx } from './view/BoxingFx.js';
import { BoxingInput } from './input/BoxingInput.js';
import { BoxingHUD } from './ui/BoxingHUD.js';
import { BoxingAudio } from './audio/BoxingAudio.js';
import { SystemDirector, ROUND_SEC } from './systems/SystemDirector.js';
import { Show } from './show/Show.js';

// 『ボクシング、なのに。』のモード本体（流れとループ）。
//
//   title → walkin（入場・約 15 秒・スキップ可）→ ready（ROUND n → FIGHT!）→ fight → roundEnd → interval（コーナーで休む）
//   → … ROUND 1 / 2 / 3 / FINAL → finish（KO / 判定）→ result
//
// 試合（FightCore）は 1 つだけ。ゲームシステム（SystemDirector）が変わっても、相手・HP・ラウンド・時間はそのまま続く。
// 周り（Show）: HYPE・観客・実況・情報パネル・テロップ・リプレイ・CM。選手とレフェリーと勝敗は茶化さない。

const ROUNDS = 4;
const ROUND_NAMES = ['', 'ROUND 1', 'ROUND 2', 'ROUND 3', 'FINAL ROUND'];
const INTERVAL_SEC = 13;
const GET_UP = [0.75, 0.7, 0.65, 0.6];

export class BoxingMode {
  constructor(canvas) {
    this.canvas = canvas;
    this.params = new URLSearchParams(location.search);
    this.auto = this.params.has('auto');
    this.fast = Math.max(1, Math.min(8, +(this.params.get('fast') ?? 1)));
    this.debug = this.params.has('debug');
    this.noRender = this.params.has('norender');
    this.seed = this.params.has('seed') ? +this.params.get('seed') : Math.floor(Math.random() * 1e6);
    this.rng = createRng(this.seed);
    this.phase = 'boot';
    this.phaseT = 0;
    this.time = 0;
    this.round = 0;
    this.roundT = 0;
    this.downState = null;
    this.baseRules = { aggression: 1, dmgMul: 1, playerDmgMul: 1 };
    this.roundStats = [];
    this.result = null;
    this.hype = 0;
  }

  async init() {
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.touch = touch;
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04050b);
    scene.fog = new THREE.Fog(0x04050b, 60, 160);
    this.scene = scene;

    this.gov = new PerformanceGovernor({ touch, forced: this.params.get('quality'), onChange: (q) => this.applyQuality(q) });
    const q = this.gov.q;

    // ---- 会場・観客（サッカーの群衆描画をそのまま使う: 約 2 万人を 1 draw call）
    this.bus = new EventBus();
    this.arena = new BoxingArena(scene);
    this.layout = new ArenaLayout();
    this.plan = new ArenaPlan(this.layout, createRng(this.seed + 3));
    this.crowd = new CrowdDirector(this.layout, this.plan, createRng(this.seed + 4));
    this.field = new CrowdField(scene, this.layout, this.plan, this.crowd, { a2c: q.a2c, fog: scene.fog });
    this.field.uniforms.uCore.value.set(0, 0); // 全員リング（原点）を向く
    this.field.uniforms.uLight.value = 0.55;
    this.near = new NearCrowd(scene, this.layout, this.plan, this.crowd, this.field);
    // 入場のピンスポット（花道を歩く人を追う）
    this.followSpot = new THREE.SpotLight(0xfff4e6, 0, 30, 0.3, 0.5, 0);
    scene.add(this.followSpot, this.followSpot.target);
    this.buildNear(q.near);

    // ---- 選手・レフェリー・試合
    this.core = new FightCore(createRng(this.seed + 7), { playerHp: 100, enemyHp: 120 });
    this.P = new BoxerModel('samurai');
    this.E = new BoxerModel('champion');
    this.R = new BoxerModel('referee');
    scene.add(this.P.root, this.E.root, this.R.root);
    // コーナーの椅子（インターバルだけ）
    const stoolMat = new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.7 });
    this.stools = ['red', 'blue'].map((c) => {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12), stoolMat);
      seat.position.y = 0.5;
      g.add(seat);
      for (let k = 0; k < 3; k++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.5, 5), stoolMat);
        const a = (k / 3) * Math.PI * 2;
        leg.position.set(Math.cos(a) * 0.14, 0.25, Math.sin(a) * 0.14);
        g.add(leg);
      }
      const p = this.cornerSeat(c);
      // 椅子は腰の少し後ろ
      g.position.set(p.x - Math.sin(p.yaw) * 0.12, RING.y, p.z - Math.cos(p.yaw) * 0.12);
      g.visible = false;
      scene.add(g);
      return g;
    });
    this.animP = new BoxerAnimator(this.P, this.core.player);
    this.animE = new BoxerAnimator(this.E, this.core.enemy);
    this.animR = new RefereeAnimator(this.R);

    // ---- 視点・画面・入力・音
    this.rig = new CameraRig(innerWidth / innerHeight);
    this.fx = new BoxingFx(renderer, scene, this.rig.camera);
    if (this.params.has('nofx')) this.fx.enabled = false;
    this.input = new BoxingInput();
    this.audio = new AudioManager(this.bus);
    this.sAudio = new SoccerAudio(this.audio);
    this.bAudio = new BoxingAudio(this.audio, this.sAudio);
    if (this.params.has('mute')) this.audio.setMuted(true);
    this.hud = new BoxingHUD();
    this.layer = document.getElementById('sysLayer');
    this.systems = new SystemDirector(this);
    this.show = new Show(this);
    this.core.on((ev) => this.onFight(ev));
    this.bindUI();

    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.resize();
    window.__boxing = this;
    this.placeTitle();
    this.setPhase('title');
    this.last = performance.now();
    renderer.setAnimationLoop((now) => this.frame(now));
    if (this.auto || this.params.has('start') || this.params.has('round')) setTimeout(() => this.start(), 300);
  }

  // リングサイド（床の席）は全部 3D の人形 + 妙に盛り上がっている人（花道の手前）
  buildNear(max) {
    const x = -1.6;
    const z = 6.35;
    this.near.build(new THREE.Vector3(0, 0, 0), {
      radius: 60,
      max: Math.min(max, 760),
      tier: 0,
      core: { sx: 0, sz: 0 },
      extras: [{ x, y: 0, z, yaw: Math.atan2(-(0 - x), -(0 - z)), shirt: 8, hair: 0, skin: 1, acc: 2, scale: 1.05 }],
    });
  }

  applyQuality(q) {
    this.resize();
    this.field.setA2C(q.a2c);
    this.fx.bloom.enabled = q.name !== 'VERY LOW';
    if (Math.abs(this.near.count - Math.min(q.near, 760)) > 150) this.buildNear(q.near);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    const pr = Math.min(devicePixelRatio, this.gov.q.pixelRatio, 1.75);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.rig.setAspect(w / h);
    this.fx.setSize(w, h, pr);
  }

  bindUI() {
    const $ = (id) => document.getElementById(id);
    const fromMain = location.hash === '#from-main';
    document.querySelectorAll('.back-btn').forEach((b) => b.classList.toggle('hidden', !fromMain));
    $('intro').addEventListener('pointerdown', (e) => {
      if (e.target.closest('#back')) return;
      this.start();
    });
    $('back').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.backToMain();
    });
    $('muteBtn').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.wakeAudio();
      const m = this.audio.toggleMute();
      e.currentTarget.classList.toggle('off', m);
    });
    $('pause').addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-action="back"]')) return this.backToMain();
      this.setPaused(false);
    });
    $('skipBtn').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.skip();
    });
    $('replay').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.show.skipReplay();
    });
    $('result').addEventListener('pointerdown', (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'retry') this.retry();
      else if (a === 'back') this.backToMain();
    });
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown']) window.addEventListener(ev, () => this.wakeAudio(), { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && ['fight', 'ready', 'interval', 'walkin'].includes(this.phase)) this.setPaused(true);
    });
    if (this.touch) {
      $('pad').classList.remove('hidden');
      document.body.classList.add('touch');
    }
  }

  wakeAudio() {
    this.bAudio.init();
  }

  backToMain() {
    if (history.length > 1) history.back();
    else location.href = '../index.html';
  }

  retry() {
    const q = new URLSearchParams(location.search);
    q.delete('round');
    q.set('start', '1');
    location.search = q.toString();
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause').classList.toggle('hidden', !p);
    if (p) this.input.releaseAll();
  }

  setPhase(p) {
    this.phase = p;
    this.phaseT = 0;
    document.body.dataset.phase = p;
  }

  // 半透明の自分（正面固定カウンター）
  setGhost(on) {
    const m = this.P.mat;
    m.transparent = on;
    m.opacity = on ? 0.22 : 1;
    m.depthWrite = !on;
    m.needsUpdate = true;
  }

  // ------------------------------------------------------------------
  // 流れ
  // ------------------------------------------------------------------
  start() {
    if (this.phase !== 'title') return;
    this.wakeAudio();
    document.getElementById('intro').classList.add('hidden');
    for (const st of this.stools) st.visible = false;
    const r = +(this.params.get('round') ?? 0);
    if (r >= 1 && r <= ROUNDS) {
      this.round = r - 1;
      this.enterRing();
      this.nextRound();
      return;
    }
    if (this.params.has('skip')) {
      this.enterRing();
      this.nextRound();
      return;
    }
    this.setPhase('walkin');
    document.getElementById('skipBtn').classList.remove('hidden');
    this.show.onWalkin();
    this.bAudio.cheer(1.5);
  }

  skip() {
    if (this.phase === 'walkin') {
      this.enterRing();
      this.nextRound();
    } else if (this.phase === 'interval' && this.phaseT > 1) this.nextRound();
  }

  // 2 人をリングの中へ
  enterRing() {
    document.getElementById('skipBtn').classList.add('hidden');
    this.followSpot.intensity = 0;
    for (const st of this.stools) st.visible = false;
    this.animP.override = null;
    this.animE.override = null;
    this.core.resetPositions();
  }

  nextRound() {
    for (const st of this.stools) st.visible = false;
    this.round++;
    this.roundT = 0;
    this.core.resetPositions();
    this.animP.override = null;
    this.animE.override = null;
    const d = [1, 1.1, 1.2, 1.3][this.round - 1];
    this.core.difficulty = d;
    this.baseRules = { aggression: [1, 1.1, 1.2, 1.35][this.round - 1], dmgMul: [0.3, 0.28, 0.27, 0.28][this.round - 1], playerDmgMul: 1 };
    this.roundStats[this.round] = { pDmg: 0, eDmg: 0, pKD: 0, eKD: 0, landed: 0, dodges: 0 };
    document.getElementById('skipBtn').classList.add('hidden');
    this.hud.show(true);
    this.hud.setRound(ROUND_NAMES[this.round]);
    this.systems.startRound(this.round);
    this.setPhase('ready');
    this.hud.big(ROUND_NAMES[this.round], { cls: this.round === ROUNDS ? 'y' : '', dur: 1.3 });
    this.show.onRoundStart(this.round);
  }

  beginFight() {
    this.setPhase('fight');
    this.core.running = true;
    this.hud.big('FIGHT!', { cls: 'c', dur: 0.8 });
    this.bAudio.gong(1);
    this.bAudio.cheer(1);
  }

  endRound() {
    this.core.running = false;
    this.setPhase('roundEnd');
    this.bAudio.gong(3);
    this.hud.big(`END OF ${ROUND_NAMES[this.round]}`, { dur: 2 });
    this.show.onRoundEnd(this.round);
  }

  beginInterval() {
    this.systems.clear();
    // コーナーで少し回復（両者とも最大の 25%）
    for (const f of [this.core.player, this.core.enemy]) f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.25);
    this.setPhase('interval');
    this.animP.override = { action: 'rest', pose: 'rest', ...this.cornerSeat('red') };
    this.animE.override = { action: 'rest', pose: 'rest', ...this.cornerSeat('blue') };
    this.fx.setLook('broadcast');
    this.hud.setSystem('INTERVAL', '次のラウンドのゲームシステムは…？', [['SPACE', 'スキップ']], false);
    for (const st of this.stools) st.visible = true;
    document.getElementById('skipBtn').classList.remove('hidden');
    this.show.onInterval(this.round);
  }

  cornerSeat(c) {
    const p = this.arena.corners[c];
    return { x: p.x * 0.97, z: p.z * 0.97, yaw: Math.atan2(-p.x, -p.z) };
  }

  // ------------------------------------------------------------------
  // 試合のイベント
  // ------------------------------------------------------------------
  onFight(ev) {
    const rs = this.roundStats[this.round];
    const P = this.core.player;
    switch (ev.type) {
      case 'land':
        rs.pDmg += ev.dmg;
        rs.landed++;
        this.bAudio.punch('land', ev.counter ? 1.6 : ev.punch === 'jab' ? 0.7 : 1.1);
        this.rig.kick(ev.counter ? 0.9 : ev.punch === 'jab' ? 0.25 : 0.5);
        if (ev.counter) this.fx.flash(0.25);
        break;
      case 'blocked':
        rs.pDmg += ev.dmg * 0.5;
        this.bAudio.punch('block');
        break;
      case 'guardBreak':
        this.bAudio.punch('block', 1.5);
        break;
      case 'whiff':
        if (ev.who === 'player') this.bAudio.whoosh();
        break;
      case 'hit':
        rs.eDmg += ev.dmg;
        this.bAudio.punch('hurt');
        this.rig.kick(0.7);
        this.fx.glitchBurst(0.3);
        break;
      case 'guardHit':
        rs.eDmg += ev.dmg * 0.5;
        this.bAudio.punch('block');
        break;
      case 'dodge':
        rs.dodges++;
        this.bAudio.whoosh();
        break;
      case 'perfect':
        rs.dodges++;
        this.bAudio.whoosh();
        this.bAudio.perfect();
        break;
      case 'down':
        this.startDown(ev.who);
        break;
      default:
        break;
    }
    void P;
    this.systems.onFight(ev);
    this.show.onFight(ev);
  }

  onSystemChange(dir) {
    this.bAudio.systemChange();
    this.fx.glitchBurst(0.8);
    this.show.onSystemChange(dir);
  }

  onUsedTo(sys) {
    this.show.onUsedTo(sys);
  }

  // ---- ダウン: レフェリーがカウント。相手は ROUND 3 までは必ず立つ（FINAL は立てない = KO）/ 自分は J K の連打で立つ
  startDown(who) {
    const f = who === 'player' ? this.core.player : this.core.enemy;
    const rs = this.roundStats[this.round];
    if (who === 'player') rs.pKD++;
    else rs.eKD++;
    this.core.running = false;
    const final = who === 'enemy' && this.round === ROUNDS;
    this.downState = {
      who,
      f,
      t: 0,
      count: 0,
      final,
      getUpAt: 5 + Math.floor(this.rng.next() * 3),
      need: 7 + (f.downs - 1) * 4,
      mash: 0,
      up: false,
    };
    this.hud.big('DOWN!', { cls: 'y', dur: 1.2 });
    this.bAudio.roar();
    this.show.onDown(who, final);
  }

  updateDown(dt) {
    const d = this.downState;
    d.t += dt;
    if (d.up) return;
    const count = Math.floor(d.t - 0.8);
    if (count > d.count && count >= 1 && count <= 10) {
      d.count = count;
      this.bAudio.count(count);
      this.hud.big(String(count), { dur: 0.7, small: d.who === 'player' ? `J K を連打で立つ（${Math.min(d.mash, d.need)} / ${d.need}）` : '' });
      if (count === 10) {
        this.knockout(d.who === 'player' ? 'enemy' : 'player', 'KO');
        return;
      }
    }
    if (d.who === 'enemy') {
      if (!d.final && count >= d.getUpAt) this.getUp();
    } else {
      if (this.input.wasPressed('KeyJ') || this.input.wasPressed('KeyK') || this.input.wasPressed('Space') || (this.auto && Math.random() < 0.25)) d.mash++;
      if (d.mash >= d.need && count >= 2) this.getUp();
    }
  }

  getUp() {
    const d = this.downState;
    d.up = true;
    this.core.getUp(d.f, GET_UP[Math.min(3, d.f.downs - 1)]);
    this.core.resetPositions();
    this.downState = null;
    this.core.running = true;
    this.hud.big('FIGHT!', { cls: 'c', dur: 0.7 });
    this.show.onGetUp(d.who);
  }

  knockout(winner, how) {
    this.downState = null;
    this.core.running = false;
    this.result = { winner, how, round: this.round, time: this.clockText() };
    this.setPhase('finish');
    this.bAudio.gong(4);
    this.hud.big(how === 'TKO' ? 'T.K.O.' : 'K.O.', { cls: 'y', dur: 3 });
    this.show.onFinish(this.result);
  }

  // 判定（3 人のジャッジ・10 点法）
  decision() {
    const cards = [0, 1, 2].map((j) => {
      let p = 0;
      let e = 0;
      for (let r = 1; r <= ROUNDS; r++) {
        const s = this.roundStats[r];
        if (!s) continue;
        const bias = (Math.sin(j * 7.1 + r * 3.3) * 0.5 + 0.5) * 6 - 3;
        const pp = s.pDmg + s.dodges * 1.2 + bias;
        const ee = s.eDmg * 1.1 - bias;
        let rp = 10;
        let re = 10;
        if (pp > ee + 1) re = 9;
        else if (ee > pp + 1) rp = 9;
        rp -= s.pKD;
        re -= s.eKD;
        p += rp;
        e += re;
      }
      return { p, e };
    });
    const pw = cards.filter((c) => c.p > c.e).length;
    const ew = cards.filter((c) => c.e > c.p).length;
    const winner = pw > ew ? 'player' : ew > pw ? 'enemy' : 'draw';
    const how = winner === 'draw' ? 'DRAW' : pw === 3 || ew === 3 ? '判定（3-0）' : `判定（${Math.max(pw, ew)}-${Math.min(pw, ew)}）`;
    this.result = { winner, how, round: ROUNDS, time: '3:00', cards };
    this.setPhase('finish');
    this.hud.big('判定', { dur: 2.4, small: 'JUDGES SCORECARDS' });
    this.show.onFinish(this.result);
  }

  // ------------------------------------------------------------------
  // ループ
  // ------------------------------------------------------------------
  frame(now) {
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    this.gov.sample(realDt);
    // ポーズの切り替えは止まっている間も受け付ける
    if (this.input.wasPressed('Escape') && !['title', 'result', 'finish'].includes(this.phase)) this.setPaused(!this.paused);
    if (!this.paused) {
      for (let i = 0; i < this.fast; i++) this.update(realDt);
    }
    this.jsMs = performance.now() - t0;
    this.render(realDt);
    this.input.endFrame();
  }

  update(dt) {
    this.time += dt;
    if (!this.show.blocking) this.phaseT += dt;
    const input = this.input;
    if (input.wasPressed('KeyM')) document.getElementById('muteBtn').dispatchEvent(new Event('pointerdown'));
    if (this.phase === 'title' && (input.wasPressed('Space') || input.wasPressed('Enter'))) this.start();
    if ((this.phase === 'walkin' || this.phase === 'interval') && input.wasPressed('Space') && this.phaseT > 0.4) this.skip();
    if (this.phase === 'result' && input.wasPressed('Space') && this.phaseT > 1.5) this.retry();

    // リプレイ中は試合を止める（Show が選手を動かす）
    if (this.show.blocking) {
      this.show.update(dt);
      this.crowd.update(dt);
      this.arena.update(dt, this.time);
      this.updateAudio(dt);
      return;
    }

    let ts = 1;
    if (this.phase === 'title') this.updateTitle(dt);
    else if (this.phase === 'walkin') this.updateWalkin(dt);
    else if (this.phase === 'ready') {
      if (this.phaseT > 1.5 && !this.readyGo) {
        this.readyGo = true;
        this.beginFight();
      }
    } else if (this.phase === 'fight') {
      ts = this.systems.timeScale;
      const dtF = dt * ts;
      if (this.downState) this.updateDown(dtF);
      else {
        let raw = input.fight();
        if (this.auto) raw = this.autopilot(raw);
        const fin = this.systems.input(raw);
        this.core.update(dtF, fin);
        this.roundT += dtF;
        this.systems.update(dtF, this.roundT);
        if (this.roundT >= ROUND_SEC && !this.downState && this.phase === 'fight') {
          if (this.round >= ROUNDS) this.endRound();
          else this.endRound();
        }
      }
    } else if (this.phase === 'roundEnd') {
      if (this.phaseT > 2.6) {
        if (this.round >= ROUNDS) this.decision();
        else this.beginInterval();
      }
    } else if (this.phase === 'interval') {
      if (this.phaseT > INTERVAL_SEC) this.nextRound();
    } else if (this.phase === 'finish') this.updateFinish(dt);
    if (this.phase !== 'ready') this.readyGo = false;

    // 選手の見た目
    const dtA = dt * ts;
    const tell = this.core.tellProgress();
    const headE = this.E.headWorld(this._hE ?? (this._hE = new THREE.Vector3()));
    const headP = this.P.headWorld(this._hP ?? (this._hP = new THREE.Vector3()));
    this.animP.update(dtA, { opponentHead: headE });
    this.animE.update(dtA, { opponentHead: headP, tell });
    const d = this.downState;
    const Pf = this.core.player;
    const Ef = this.core.enemy;
    const raise = this.phase === 'finish' && this.result?.winner !== 'draw' && this.phaseT > 3 ? (this.result.winner === 'player' ? this.animP.pose : this.animE.pose) : null;
    this.animR.update(dtA, { px: Pf.x, pz: Pf.z, ex: Ef.x, ez: Ef.z, down: d ? { x: d.f.x, z: d.f.z } : null, count: d ? d.t - 0.8 : 0, raise });

    // カメラ
    if (this.show.happen.camera(this.rig, dt)) {
      // ハプニング: カメラがよそを映している
    } else if (this.phase === 'fight' || this.phase === 'ready' || this.phase === 'roundEnd') {
      if (this.systems.primary) this.systems.camera(this.rig, dt);
    } else if (this.phase === 'interval') this.cameraInterval(dt);
    else if (this.phase === 'finish') this.cameraFinish(dt);
    this.rig.apply(dt);
    this.fx.setCamera(this.rig.camera);

    // 周り
    this.show.update(dt);
    this.crowd.update(dt);
    this.arena.update(dt, this.time);
    this.fx.update(dt, { hype: this.hype });
    this.updateAudio(dt);
    this.updateHUD();
    if (this.debug) this.updateDev(dt);
  }

  updateAudio(dt) {
    this.bAudio.update(dt, clamp(0.2 + this.hype * 0.75, 0, 1));
  }

  clockText() {
    const rem = Math.max(0, ROUND_SEC - this.roundT) * (180 / ROUND_SEC);
    const s = Math.ceil(rem);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  updateHUD() {
    if (!['ready', 'fight', 'roundEnd', 'interval', 'finish'].includes(this.phase)) return;
    const P = this.core.player;
    const E = this.core.enemy;
    this.hud.setHP(P.hp / P.maxHp, E.hp / E.maxHp);
    this.hud.setClock(this.phase === 'interval' ? 'REST' : this.show.happen.clockText ?? this.clockText(), this.phase === 'fight' && ROUND_SEC - this.roundT < 10);
    // 相手のパンチの予告（システムが自分で出す時は出さない）
    const tell = this.core.tellProgress();
    const sys = this.systems.primary?.id;
    const on = this.phase === 'fight' && tell && E.action === 'tell' && sys !== 'qte' && sys !== 'top' && !this.downState && this.show.happen.camHold <= 0;
    if (on) {
      const v = this.E.gloveWorld(this.animE.tellHand ?? 'R', this._g ?? (this._g = new THREE.Vector3()));
      v.project(this.rig.camera);
      const sc = document.body.classList.contains('lshape') ? 0.72 : 1;
      const x = ((v.x + 1) / 2) * innerWidth * sc;
      const y = ((1 - v.y) / 2) * innerHeight * sc;
      this.hud.tellMark(x, y, tell.k, v.z < 1 && x > 0 && x < innerWidth && y > 0 && y < innerHeight);
    } else this.hud.tellMark(0, 0, 0, false);
  }

  // ---- タイトル: 会場をゆっくり回る
  placeTitle() {
    this.core.resetPositions();
    this.animP.override = { action: 'rest', pose: 'rest', ...this.cornerSeat('red') };
    this.animE.override = { action: 'idle', x: 0.9, z: 0.4, yaw: -Math.PI / 2 };
    this.stools[0].visible = true;
    this.fx.setLook('broadcast');
  }

  updateTitle(dt) {
    const a = this.time * 0.06;
    this.rig.aim(new THREE.Vector3(Math.cos(a) * 13, 6.5, Math.sin(a) * 13), new THREE.Vector3(0, RING.y + 1, 0), 45, 2, dt);
  }

  // ---- 入場: 侍が花道を歩く → リングへ
  updateWalkin(dt) {
    const t = this.phaseT;
    const walkX = -14.5 + Math.min(t, 8) * 1.3;
    const fs = this.followSpot;
    fs.intensity = t < 8 ? 9 : Math.max(0, fs.intensity - dt * 12);
    if (t < 8) {
      this.animP.override = { action: 'rest', pose: 'walk', x: walkX, z: 0, y: 0, yaw: Math.PI / 2 };
      this.animE.override = { action: 'idle', x: 1.4, z: 1.2, yaw: -2.3 };
      fs.position.set(walkX + 2, 11, 3);
      fs.target.position.set(walkX, 0.8, 0);
      this.rig.aim(new THREE.Vector3(walkX + 3.4, 1.5, 0.9), new THREE.Vector3(walkX, 1.4, 0), 42, 3, dt);
    } else if (t < 13) {
      if (!this.walkCut) {
        this.walkCut = true;
        this.rig.cut();
        this.show.onWalkinRing();
      }
      const c = this.cornerSeat('red');
      this.animP.override = { action: 'idle', x: c.x * 0.8, z: c.z * 0.8, yaw: Math.PI / 4 };
      const a = 2.2 + (t - 8) * 0.12;
      this.rig.aim(new THREE.Vector3(Math.cos(a) * 7.5, RING.y + 2.6, Math.sin(a) * 7.5), new THREE.Vector3(0, RING.y + 1.1, 0), 40, 2, dt);
    } else if (t < 15.5) {
      this.animP.override = { action: 'idle', pose: 'walk', x: -0.9, z: 0, yaw: Math.PI / 2 };
      this.animE.override = { action: 'idle', pose: 'walk', x: 0.9, z: 0, yaw: -Math.PI / 2 };
      this.rig.aim(new THREE.Vector3(0, RING.y + 1.7, 4.8), new THREE.Vector3(0, RING.y + 1.35, 0), 36, 3, dt);
    } else {
      this.walkCut = false;
      this.enterRing();
      this.nextRound();
    }
  }

  cameraInterval(dt) {
    const c = this.arena.corners.red;
    const t = this.phaseT;
    const s = Math.floor(t / 4.5) % 3;
    const look = new THREE.Vector3(c.x, RING.y + 0.9, c.z);
    let pos;
    if (s === 0) pos = new THREE.Vector3(c.x + 2.4, RING.y + 1.5, c.z + 1.3);
    else if (s === 1) {
      const b = this.arena.corners.blue;
      pos = new THREE.Vector3(b.x - 2.2, RING.y + 1.4, b.z - 1.4);
      look.set(b.x, RING.y + 0.9, b.z);
    } else {
      pos = new THREE.Vector3(Math.cos(t * 0.1) * 9, RING.y + 4, Math.sin(t * 0.1) * 9);
      look.set(0, RING.y + 0.5, 0);
    }
    if (s !== this.intShot) {
      this.intShot = s;
      this.rig.cut();
    }
    this.rig.aim(pos, look, 38, 2, dt);
  }

  updateFinish(dt) {
    const r = this.result;
    const t = this.phaseT;
    if (r.winner !== 'draw' && t > 3) {
      const win = r.winner === 'player' ? this.animP : this.animE;
      const lose = r.winner === 'player' ? this.animE : this.animP;
      win.override = { action: 'win', pose: 'win' };
      // 負けた方も立ち上がって礼（真面目に）
      if (t > 4.5) lose.override = { action: 'idle', pose: 'bow' };
    }
    if (t > (r.cards ? 10 : 8.5) && this.phase === 'finish') {
      this.setPhase('result');
      this.show.showResult(r);
    }
    void dt;
  }

  cameraFinish(dt) {
    const a = this.phaseT * 0.18 + 0.6;
    const P = this.core.player;
    const E = this.core.enemy;
    const mid = new THREE.Vector3((P.x + E.x) / 2, RING.y + 1.2, (P.z + E.z) / 2);
    this.rig.aim(new THREE.Vector3(mid.x + Math.cos(a) * 4.2, RING.y + 1.8, mid.z + Math.sin(a) * 4.2), mid, 40, 2, dt);
  }

  // ------------------------------------------------------------------
  render() {
    if (this.noRender) return;
    const size = this.renderer.getDrawingBufferSize(this._size ?? (this._size = new THREE.Vector2()));
    this.renderer.info.reset();
    this.show.renderJumbo();
    this.field.update(this.rig.camera, size.y);
    if (this.show.renderOverride(size)) return;
    this.fx.render();
    this.show.renderExtras(size);
  }

  // ------------------------------------------------------------------
  // 自動操縦（スモークテスト用）
  autopilot(raw) {
    const c = this.core;
    const P = c.player;
    const tell = c.tellProgress();
    const r = { slip: 0, moveAxis: 0, jab: false, straight: false, guard: false, special: false };
    this.autoT = (this.autoT ?? 0) + 1 / 60;
    const sys = this.systems.primary?.id;
    if (tell && c.enemy.action === 'tell') {
      if (sys === 'qte') {
        const p = this.systems.primary.prompt;
        if (p && tell.k > 0.5 && !this.systems.primary.ok) this.input.press(p.code), this.input.release(p.code);
      } else if (c.rules.mode === 'axis') r.moveAxis = -1;
      else if (c.rules.mode === 'circle') r.moveAxis = 1;
      else if (tell.left < 0.22 && P.action === 'idle' && Math.random() < 0.8) r.slip = Math.random() < 0.5 ? -1 : 1;
      else if (Math.random() < 0.1) r.guard = true;
    } else if (c.counterWindow > 0 && Math.random() < 0.3) r.straight = true;
    else if (Math.random() < 0.04) r[Math.random() < 0.6 ? 'jab' : 'straight'] = true;
    else if (c.rules.mode === 'axis') r.moveAxis = c.dist > 1.25 ? 1 : 0;
    void raw;
    return r;
  }

  updateDev(dt) {
    this.devT = (this.devT ?? 0) - dt;
    if (this.devT > 0) return;
    this.devT = 0.5;
    const r = this.renderer.info;
    const c = this.core;
    document.getElementById('dev').classList.remove('hidden');
    document.getElementById('dev').textContent = [
      `FPS ${this.gov.fps.toFixed(0)}  ${this.gov.q.name}  PR ${this.renderer.getPixelRatio().toFixed(2)}`,
      `draw ${r.render.calls}  tris ${(r.render.triangles / 1000).toFixed(0)}k  JS ${this.jsMs?.toFixed(2)}ms`,
      `crowd ${this.layout.count.toLocaleString('en-US')}  near3D ${this.near.count}`,
      `phase ${this.phase}  R${this.round}  t ${this.roundT.toFixed(1)}  sys ${this.systems.name}`,
      `P ${c.player.hp.toFixed(0)} ${c.player.action}  E ${c.enemy.hp.toFixed(0)} ${c.enemy.action}  dist ${c.dist.toFixed(2)}`,
      `hype ${this.hype.toFixed(2)}`,
    ].join('\n');
  }

  state() {
    const c = this.core;
    return {
      phase: this.phase,
      round: this.round,
      t: this.roundT,
      clock: this.clockText(),
      sys: this.systems.name,
      ids: this.systems.ids.join(','),
      changes: this.systems.changes,
      seen: this.systems.seen.size,
      pHp: c.player.hp,
      eHp: c.enemy.hp,
      pDowns: c.player.downs,
      eDowns: c.enemy.downs,
      landed: c.player.stats.landed,
      thrown: c.player.stats.thrown,
      dodges: c.player.stats.dodges,
      hype: this.hype,
      result: this.result,
      fps: this.gov.fps,
      calls: this.renderer.info.render.calls,
      tris: this.renderer.info.render.triangles,
    };
  }
}
