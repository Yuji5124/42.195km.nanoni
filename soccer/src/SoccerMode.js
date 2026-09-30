import * as THREE from 'three';
import { AudioManager } from '../../src/audio/AudioManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { Particles } from '../../src/fx/Particles.js';
import { createRng, clamp } from '../../src/core/math.js';
import { StadiumLayout, TIERS, pointAt } from './stadium/StadiumLayout.js';
import { StadiumBuilder } from './stadium/StadiumBuilder.js';
import { SeatPlan, KIND } from './crowd/SeatPlan.js';
import { CrowdDirector } from './crowd/CrowdDirector.js';
import { CrowdField } from './crowd/CrowdField.js';
import { NearCrowd } from './crowd/NearCrowd.js';
import { FrontFlag } from './crowd/FrontFlag.js';
import { MatchSim, NAMES } from './match/MatchSim.js';
import { MatchDirector } from './match/MatchDirector.js';
import { Broadcast } from './match/Broadcast.js';
import { ViewRig } from './view/ViewRig.js';
import { SoccerInput } from './input/SoccerInput.js';
import { SearchSystem } from './search/SearchSystem.js';
import { SoccerAudio } from './audio/SoccerAudio.js';
import { SoccerHUD } from './ui/SoccerHUD.js';
import { PerformanceGovernor } from './core/PerformanceGovernor.js';
import { MOMENTS, STORY, NUDGES, HALF_SECONDS, FIRST_SEAT } from './data/timeline.js';

// 『サッカー、なのに。』のモード本体（流れとループ）。
//
//   title → opening（最大 45 秒・スキップ可）→ search（肉眼 → 双眼鏡）→ found（YOUR SEAT FOUND）
//   → travel（反対側の席へ。連打で急ぐ。その間も試合は進む）→ seated（やっと見られる。→ 前の人が立つ → 笛）→ result
//
// 試合（MatchDirector）と席探し（SearchSystem）は同じ時計で動き、CrowdDirector を通してつながる:
//   決定機 → 観客が前のめり / シュート → 立つ / ゴール → 跳ぶ（目の前の旗）/ ウェーブ → 空席が順番に隠れる
//   = 試合が面白くなるほど、空席探しが難しくなる。

const SEATED_EYE = 1.18;
const STAND_EYE = 1.62;
const WHO_FAN = ['すごい前半だった！', '歴史に残るな、これは！', '今のゴール見た!?'];

export class SoccerMode {
  constructor(canvas) {
    this.canvas = canvas;
    this.params = new URLSearchParams(location.search);
    this.auto = this.params.has('auto');
    this.fast = Math.max(1, Math.min(8, +(this.params.get('fast') ?? 1)));
    this.debug = this.params.has('debug');
    this.noRender = this.params.has('norender'); // 入力のテスト用（描画しない）
    // 1 回目は必ず BLOCK 42 · ROW 19 · SEAT 5。?seed を付けるか 2 回目からは seed で席が変わる
    let played = false;
    try {
      played = localStorage.getItem('nanoni.soccer.played') === '1';
    } catch {
      /* 保存できなくても遊べる */
    }
    this.firstPlay = !played && !this.params.has('seed');
    this.seed = this.params.has('seed') ? +this.params.get('seed') : this.firstPlay ? 42195 : Math.floor(Math.random() * 1e6);
    this.rng = createRng(this.seed);
    this.phase = 'boot';
    this.phaseT = 0;
    this.time = 0;
    this.stats = { watched: 0, goalsSeen: 0, realStart: 0, foundBy: 'あなた' };
  }

  async init() {
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.touch = touch;
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b0f22, 240, 1300);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.08, 3200);
    this.camera.layers.enable(1); // layer 1 = 主人公のまわりだけ（近くの 3D 観客・目の前の旗・紙吹雪）

    this.gov = new PerformanceGovernor({ touch, forced: this.params.get('quality'), onChange: (q) => this.applyQuality(q) });
    const q = this.gov.q;

    // ---- 世界
    this.bus = new EventBus();
    this.layout = new StadiumLayout();
    this.stadium = new StadiumBuilder(scene, this.layout);
    const target = this.firstPlay || this.seed === 42195 ? this.layout.findSeat(FIRST_SEAT.block, FIRST_SEAT.row, FIRST_SEAT.seat) : null;
    this.plan = new SeatPlan(this.layout, this.rng, { target });
    this.crowd = new CrowdDirector(this.layout, this.plan, this.rng);
    this.field = new CrowdField(scene, this.layout, this.plan, this.crowd, { a2c: q.a2c, fog: scene.fog });
    this.field.uniforms.uLight.value = 0.66;
    this.near = new NearCrowd(scene, this.layout, this.plan, this.crowd, this.field);
    this.spot = this.stadium.playerSpot();
    this.buildNearAtSpot(q.near);
    this.flag = new FrontFlag(scene);
    this.confetti = new Particles(scene, { capacity: q.confetti, additive: false, confetti: true });
    this.confetti.points.layers.set(1);

    // ---- 試合
    this.sim = new MatchSim(scene);
    this.match = new MatchDirector(this.sim, this.bus, createRng(this.seed + 11), { moments: MOMENTS, halfSeconds: HALF_SECONDS });
    this.broadcast = new Broadcast(renderer, scene, this.stadium, this.match, { crowdField: this.field });
    this.broadcast.setQuality(q.broadcast);

    // ---- 視点・入力・探索
    this.view = new ViewRig(this.camera);
    this.placeAtSpot();
    this.search = new SearchSystem({ layout: this.layout, plan: this.plan, crowd: this.crowd, field: this.field, near: this.near, view: this.view, camera: this.camera, rng: createRng(this.seed + 5) });
    this.input = new SoccerInput(this.canvas, {
      drag: (dx, dy) => this.onDrag(dx, dy),
      release: () => this.view.release(),
      pinch: (s) => this.onPinch(s),
      tap: (x, y) => this.onTap(x, y),
      longPress: (x, y) => this.onLongPress(x, y),
      doubleTap: (x, y) => this.onDoubleTap(x, y),
      wheel: (dy) => this.onPinch(dy > 0 ? 0.9 : 1.1),
      touchStart: () => this.wakeAudio(),
    });

    // ---- 音・HUD
    this.audio = new AudioManager(this.bus);
    this.sAudio = new SoccerAudio(this.audio);
    if (this.params.has('mute')) this.audio.setMuted(true);
    this.hud = new SoccerHUD();
    this.bindUI();
    this.bus.on('match', (ev) => this.onMatch(ev));

    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.resize();
    window.__soccer = this;
    this.setPhase('title');
    this.last = performance.now();
    renderer.setAnimationLoop((now) => this.frame(now));
    if (this.auto || this.params.has('start')) setTimeout(() => this.start(), 300);
  }

  // 主人公のまわりの 3D 観客 + 通路で旗を振る人 + 隣の人
  buildNearAtSpot(max) {
    const sp = this.spot;
    const T = TIERS[0];
    const p = {};
    // 通路の 2 段下（旗の人）
    const r = 12;
    const d = T.d0 + (r + 0.5) * T.depth;
    pointAt(0, sp.s, d, p);
    const yaw = Math.atan2(p.nx, p.nz);
    this.fanPos = new THREE.Vector3(p.x, T.h0 + r * T.rise, p.z);
    this.near.build(new THREE.Vector3(sp.x, sp.y, sp.z), {
      radius: 30,
      max,
      tier: 0,
      extras: [{ x: p.x, y: T.h0 + r * T.rise, z: p.z, yaw, shirt: 0, hair: 0, skin: 1, acc: 2 }],
    });
    this.nearMode = 'spot';
  }

  // 通路の最上段（出入口の踊り場）に立つ: 座っている人の頭より少し上から見渡す
  spotEye(out = new THREE.Vector3()) {
    const sp = this.spot;
    return out.set(sp.x + sp.nx * 0.55, sp.y + STAND_EYE + 0.3, sp.z + sp.nz * 0.55);
  }

  placeAtSpot() {
    const sp = this.spot;
    this.spotEye(this.view.pos);
    // 内側（ピッチ）を向く
    this.view.yaw = this.view.yawT = Math.atan2(-sp.nz, -sp.nx);
    this.view.pitch = this.view.pitchT = -0.05;
    this.view.yawLimit = null;
  }

  applyQuality(q) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.setSize(innerWidth, innerHeight);
    this.field.setA2C(q.a2c);
    this.broadcast.setQuality(q.broadcast);
    if (this.nearMode === 'spot' && Math.abs(this.near.count - q.near) > 200) this.buildNearAtSpot(q.near);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.gov.q.pixelRatio));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.view.setAspect(w / h);
    this.camera.updateProjectionMatrix();
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
    $('toolBtn').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.toggleTool();
    });
    $('ticketBtn').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.showTicket(true);
    });
    $('ticket').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.showTicket(false);
    });
    $('watchBtn').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.watchMatch();
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
      this.skipOpening();
    });
    $('travel').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.travelTap();
    });
    $('result').addEventListener('pointerdown', (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'retry') this.retry();
      else if (a === 'back') this.backToMain();
    });
    // iOS: 最初のタッチで音を起こす（touchend / pointerup でも）
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown']) window.addEventListener(ev, () => this.wakeAudio(), { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && ['search', 'travel', 'seated', 'opening'].includes(this.phase)) this.setPaused(true);
    });
  }

  wakeAudio() {
    this.audio.init();
    this.sAudio.init();
  }

  backToMain() {
    if (history.length > 1) history.back();
    else location.href = '../index.html';
  }

  retry() {
    try {
      localStorage.setItem('nanoni.soccer.played', '1');
    } catch {
      /* 何もしない */
    }
    const q = new URLSearchParams(location.search);
    q.delete('seed');
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

  // ------------------------------------------------------------------
  // 流れ
  // ------------------------------------------------------------------
  start() {
    if (this.phase !== 'title') return;
    this.wakeAudio();
    document.getElementById('intro').classList.add('hidden');
    this.stats.realStart = this.time;
    if (this.params.has('skip') || this.auto) {
      this.skipOpening(true);
      return;
    }
    this.beginOpening();
  }

  // ---- オープニング（最大 45 秒）
  beginOpening() {
    this.setPhase('opening');
    this.hud.blinds(true, true);
    this.sAudio.setMuffle(1, 0.05);
    document.getElementById('skipBtn').classList.remove('hidden');
    const o = document.getElementById('opening');
    o.classList.remove('hidden');
    const show = (html) => (o.innerHTML = html);
    const T = this.tunnelCam();
    this.view.pos.copy(T.back);
    this.view.yaw = this.view.yawT = T.yaw;
    this.view.pitch = this.view.pitchT = 0.02;
    const steps = [
      [0.0, () => show('<div class="o-txt"><div class="o-small">KICK OFF</div><div class="o-num">19:00</div></div>')],
      [1.8, () => show('<div class="o-txt"><div class="o-num">19:00:01</div></div>')],
      [3.3, () => {
        show('<div class="o-phone"><b>● SPORTS LIVE</b><span>MATCH STARTED</span><br><small>JPN 0 - 0 BRA</small></div>');
        this.sAudio.phone();
      }],
      [5.0, () => show('<div class="o-txt">「間に合った。」</div>')],
      [6.6, () => {
        show('<div class="o-gate err">ERROR</div>');
        this.sAudio.gate(false);
      }],
      [7.7, () => {
        show('<div class="o-gate err">ERROR</div>');
        this.sAudio.gate(false);
      }],
      [8.8, () => show('<div class="o-txt">（スマホを裏返す）</div>')],
      [9.9, () => {
        show('<div class="o-gate ok">OPEN</div>');
        this.sAudio.gate(true);
      }],
      [11.2, () => {
        show('');
        this.hud.blinds(false);
      }],
      [12.2, () => {
        this.openingMove = { from: T.back.clone(), to: this.spotEye(), t: 0, dur: 3.2 };
      }],
      [14.0, () => this.sAudio.setMuffle(0, 1.2)],
      [15.4, () => show('<div class="o-txt"><div class="o-num">100,000</div></div>')],
      [17.0, () => {
        show('');
        this.startMatch();
      }],
      [19.2, () => this.showTicket(true, true)],
      [21.0, () => this.hud.say('staff', 'お客様のお席だけ、空いております。', 2.6)],
      [23.6, () => {
        this.showTicket(false);
        this.hud.say('me', 'どこですか？', 2);
      }],
      [25.4, () => this.hud.say('staff', '分かりません。', 2.2)],
      [28.4, () => show('<div><div class="o-title">サッカー、<span class="b">なのに。</span></div><div class="o-find">FIND YOUR SEAT.</div></div>')],
      [31.4, () => this.beginSearch()],
    ];
    this.opening = { steps, i: 0, t: 0 };
  }

  // トンネルの奥（出入口の中）
  tunnelCam() {
    const tn = this.stadium.tunnel;
    const T = TIERS[0];
    const s = (tn.s0 + tn.sA) / 2;
    const p = {};
    pointAt(0, s, tn.dFront + 9, p);
    const back = new THREE.Vector3(p.x, tn.yF + STAND_EYE, p.z);
    void T;
    return { back, yaw: Math.atan2(-p.nz, -p.nx) };
  }

  updateOpening(dt) {
    const o = this.opening;
    if (!o) return;
    o.t += dt;
    while (o.i < o.steps.length && o.t >= o.steps[o.i][0]) {
      o.steps[o.i][1]();
      o.i++;
    }
    const m = this.openingMove;
    if (m) {
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.view.pos.lerpVectors(m.from, m.to, e);
      // 外へ出た瞬間にカメラが開く（少し見上げる）
      this.view.pitchT = -0.05 + Math.sin(k * Math.PI) * 0.18;
      if (k >= 1) this.openingMove = null;
    }
  }

  skipOpening(instant = false) {
    this.opening = null;
    this.openingMove = null;
    document.getElementById('opening').classList.add('hidden');
    this.showTicket(false);
    this.placeAtSpot();
    this.sAudio.setMuffle(0, 0.2);
    this.hud.blinds(false);
    if (this.match.state === 'prematch') this.startMatch();
    if (!instant) this.hud.say('staff', 'お客様のお席だけ、空いております。……どこかは分かりません。', 3);
    this.beginSearch();
  }

  startMatch() {
    this.match.start();
    this.sAudio.whistle('long');
  }

  beginSearch() {
    this.setPhase('search');
    this.opening = null;
    document.getElementById('opening').classList.add('hidden');
    document.getElementById('skipBtn').classList.add('hidden');
    this.hud.show(true);
    this.hud.setSeatsLeft(this.search.seatsLeft);
    this.hud.setPins(this.search.pins, (p) => this.lookAtPin(p));
    this.storyIndex = 0;
    this.nudgeIndex = 0;
    this.lastNudge = this.time;
    this.search.progress();
    // 開発用: ?warp=秒 でその時刻まで一気に進める（描画しない）
    const warp = +(this.params.get('warp') ?? 0);
    if (warp > 0 && !this.warped) {
      this.warped = true;
      while (this.match.realT < warp) this.update(0.05);
    }
    // 旧いストーリー（オープニング中に過ぎたもの）は飛ばす
    while (this.storyIndex < STORY.length && STORY[this.storyIndex].t < this.match.realT - 1 && STORY[this.storyIndex].type === 'line') this.storyIndex++;
  }

  // ---- 物語（ヒント・双眼鏡・ウェーブ）
  updateStory() {
    const now = this.match.realT;
    while (this.storyIndex < STORY.length && STORY[this.storyIndex].t <= now) {
      const s = STORY[this.storyIndex++];
      this.runStory(s);
    }
    // 進展がない時のヒント（40 秒）
    if (this.phase === 'search' && this.time - Math.max(this.search.lastProgress, this.lastNudge) > 40 && this.nudgeIndex < NUDGES.length) {
      const n = NUDGES.slice(this.nudgeIndex).find((x) => this.nudgeOk(x));
      if (n) {
        this.nudgeIndex = NUDGES.indexOf(n) + 1;
        this.hud.say(n.who, this.search.fill(n.text), 4);
        if (n.who === 'pa') this.sAudio.chime();
      } else this.nudgeIndex = NUDGES.length;
      this.lastNudge = this.time;
    }
  }

  nudgeOk(n) {
    const s = this.search;
    if (n.need === 'binoculars') return s.hasBinoculars && !this.usedBinoculars;
    if (n.need === 'block') return s.known.side;
    if (n.need === 'row') return s.known.row;
    return true;
  }

  runStory(s) {
    const search = this.search;
    if (this.phase !== 'search') {
      if (s.type === 'hint') search.learn(s.key);
      if (s.type === 'binoculars') search.giveBinoculars();
      return;
    }
    switch (s.type) {
      case 'line':
        this.hud.say(s.who, search.fill(s.text), 3.2);
        break;
      case 'hint': {
        if (s.who === 'pa') this.sAudio.chime();
        this.hud.say(s.who, search.fill(s.text), 4.6);
        const before = search.seatsLeft;
        search.learn(s.key);
        this.hud.setSeatsLeft(search.seatsLeft, true);
        const f = search.ticketFields();
        const label = { level: `LEVEL: ${f.level}`, side: `SIDE: ${f.side}`, block: `BLOCK: ${f.block}`, row: `ROW: ${f.row}` }[s.key];
        setTimeout(() => this.hud.toast(`HINT  ${label}  ·  ${before.toLocaleString('en-US')} → ${search.seatsLeft.toLocaleString('en-US')} 席`, 4.5), 900);
        break;
      }
      case 'binoculars':
        this.hud.say(s.who, s.text, 3.2);
        search.giveBinoculars();
        this.sAudio.gear();
        this.hud.newTool(true);
        setTimeout(() => this.hud.say('me', this.touch ? '（ダブルタップ か 右下のボタンで双眼鏡）' : '（B キー か ダブルクリック で双眼鏡）', 3.5), 3400);
        break;
      case 'wave':
        this.crowd.startWave({ from: s.from ?? 0.62, lapSeconds: 22, laps: 1.1 });
        this.hud.toast('WAVE  🌊  スタジアムを一周中', 4);
        break;
      case 'crowdcam': {
        const a = search.address;
        const bd = Math.floor(a.block / 10) * 10 + 5;
        const blk = this.layout.blocks.find((b) => b.number === bd && b.tier === a.tier) ?? this.layout.blocks[this.layout.block[search.target]];
        const p = {};
        const T = TIERS[blk.tier];
        pointAt(blk.tier, blk.mid, T.d0 + 18 * T.depth, p);
        this.broadcast.crowdCam(new THREE.Vector3(p.x, T.h0 + 18 * T.rise, p.z), 7);
        this.hud.toast('大型ビジョン: CROWD CAM', 3);
        break;
      }
      case 'staff':
        if (!search.found) {
          this.hud.say('staff', 'お客様！ お席、分かりました！ こちらです！', 3.2);
          this.stats.foundBy = '係員';
          setTimeout(() => this.onFound(), 1800);
        }
        break;
      default:
        break;
    }
  }

  // ---- 見つけた
  onFound() {
    if (this.phase !== 'search') return;
    this.setPhase('found');
    this.search.found = true;
    this.sAudio.found();
    this.hud.hideCard();
    this.hud.watch(false);
    const a = this.search.address;
    this.hud.big('YOUR SEAT FOUND', { sub: this.stats.foundBy === '係員' ? '（係員が見つけた）' : '', seat: `BLOCK ${a.block} · ROW ${a.row} · SEAT ${a.seat}`, cls: 'found', seconds: 3.4 });
    this.stats.foundAt = this.time;
    this.stats.foundClock = this.match.clockText();
    setTimeout(() => {
      this.hud.say('me', '……反対側だ。', 2.2);
      this.hud.big('GO TO YOUR SEAT', { seconds: 2 });
    }, 3500);
    setTimeout(() => this.beginTravel(), 5600);
  }

  // ---- 移動（Vertical Slice 版: トンネルへ入って、連打で急ぐ。その間も試合は進む）
  beginTravel() {
    this.setPhase('travel');
    this.search.setTool('eye');
    this.hud.show(false);
    this.hud.clearTalk();
    const T = this.tunnelCam();
    this.view.lookAt(T.back, 0.6, 1);
    this.travel = { p: 0, speed: 0, heard: '', t: 0, left: [] };
    // 残りの見せ場は移動中に（こもった音で）起きる
    // 見せ場は試合側では起こさず（二重にならないよう done にする）、移動中に音だけで起きる
    const rest = this.match.moments.filter((m) => !m.done && m.t < HALF_SECONDS);
    for (const m of rest) m.done = true;
    const cur = this.match.abortAttack();
    if (cur && cur.t < HALF_SECONDS + 10) rest.unshift(cur);
    this.travel.left = rest.map((m, i) => ({ ...m, done: false, atP: (i + 0.7) / (rest.length + 0.4) }));
    setTimeout(() => {
      this.hud.blinds(true);
      this.sAudio.setMuffle(1, 0.5);
    }, 500);
    setTimeout(() => {
      const el = document.getElementById('travel');
      el.classList.remove('hidden');
      this.renderTravel();
    }, 1100);
  }

  travelTap() {
    if (this.phase !== 'travel' || !this.travel) return;
    this.travel.speed = Math.min(2.2, this.travel.speed + 0.35);
    this.sAudio.footstep(true);
  }

  renderTravel() {
    const tr = this.travel;
    const el = document.getElementById('travel');
    const a = this.search.address;
    const place = `${this.search.hintVars().SIDE_JP}スタンド${a.tier === 1 ? '上段' : '下段'}`;
    el.innerHTML = `<div><div class="tr-head">GO TO YOUR SEAT</div><div class="tr-main">${place}まで、走る。</div>
      <div class="tr-bar"><i style="width:${(tr.p * 100).toFixed(1)}%"></i></div>
      <div class="tr-tap blink">TAP TAP TAP / SPACE 連打で急ぐ</div>
      <div class="tr-clock">${this.match.clockText()}　JPN ${this.match.score.home} - ${this.match.score.away} BRA</div>
      <div class="tr-heard">${tr.heard}</div></div>`;
  }

  updateTravel(dt) {
    const tr = this.travel;
    if (!tr) return;
    tr.t += dt;
    if (this.input.wasPressed('Space')) this.travelTap();
    if (this.auto && Math.random() < dt * 6) this.travelTap();
    tr.speed = Math.max(0, tr.speed - dt * 1.6);
    tr.p = Math.min(1, tr.p + dt * (0.07 + tr.speed * 0.09));
    // 足音
    tr.stepT = (tr.stepT ?? 0) - dt;
    if (tr.stepT <= 0) {
      tr.stepT = 0.34 / (1 + tr.speed * 0.6);
      this.sAudio.footstep(tr.speed > 0.5);
    }
    // 移動中の試合（こもった歓声）: 時計は 45 分へ向けて早送り
    const m = this.match;
    const remain = Math.max(1, (1 - tr.p) / (0.07 + tr.speed * 0.09));
    if (m.clock < 45 * 60) m.fastForward = Math.max(1, (45 * 60 - m.clock) / m.rate / remain);
    for (const mo of tr.left) {
      if (mo.done || tr.p < mo.atP) continue;
      mo.done = true;
      if (mo.outcome === 'goal') {
        m.score[mo.team]++;
        m.goals.push({ team: mo.team, minute: Math.min(45, m.minute), scorer: NAMES[mo.team][mo.scorerIndex ?? 10], offscreen: true });
        this.sAudio.goal(mo.team === 'home');
        tr.heard = mo.team === 'home' ? '（遠くで、ものすごい歓声……）' : '（遠くで、ため息……）';
      } else {
        this.sAudio[mo.outcome === 'save' ? 'save' : 'groan']();
        tr.heard = '（「オォ……」という声が聞こえる）';
      }
    }
    tr.renderT = (tr.renderT ?? 0) - dt;
    if (tr.renderT <= 0) {
      tr.renderT = 0.1;
      this.renderTravel();
    }
    if (tr.p >= 1) this.arriveSeat();
  }

  // ---- 着席
  arriveSeat() {
    const m = this.match;
    m.fastForward = 1;
    if (m.clock < 45 * 60) m.clock = 45 * 60 + 5;
    for (const mo of m.moments) mo.done = true;
    document.getElementById('travel').classList.add('hidden');
    this.travel = null;
    const id = this.search.target;
    const L = this.layout;
    // 自分の席のまわりを 3D に。前の席の人は「立ち上がる人」（CPU で動かす）
    const front = L.seatInRow(L.tier[id], L.row[id] - 1, L.s[id]);
    this.frontSeat = front;
    const p = {};
    pointAt(L.tier[front], L.s[front], TIERS[L.tier[front]].d0 + (L.row[front] + 0.5) * TIERS[L.tier[front]].depth, p);
    const yaw = Math.atan2(p.nx, p.nz);
    this.plan.kind[front] = KIND.TEMP; // 近くの人形としては消し、別の人（上書き）として置く
    this.near.dispose();
    this.near.build(new THREE.Vector3(L.x[id], L.y[id], L.z[id]), {
      radius: 16,
      max: Math.min(700, this.gov.q.near),
      tier: L.tier[id],
      extras: [{ x: L.x[front], y: L.y[front], z: L.z[front], yaw, shirt: 0, hair: 0, skin: 1, acc: 2, block: L.block[front] }],
    });
    this.field.setKind(front, KIND.TEMP);
    this.near.setExtraPose(0, 0, 0, 0);
    this.nearMode = 'seat';
    this.view.pos.set(L.x[id], L.y[id] + SEATED_EYE, L.z[id]);
    this.view.yaw = this.view.yawT = Math.atan2(-p.nz, -p.nx);
    this.view.pitch = this.view.pitchT = -0.32;
    this.view.anim = null;
    this.view.setZoom(1, true);
    this.setPhase('seated');
    this.hud.show(true);
    this.hud.blinds(false);
    this.sAudio.setMuffle(0, 0.6);
    this.crowd.react('calm');
    this.seatedSteps = [
      [0.8, () => this.hud.say('me', 'やっと見られる。', 2.6)],
      [2.6, () => {
        this.broadcast.say('前半、最後のワンプレー！', 5);
        this.hud.say('vision', '「前半、最後のワンプレー！」', 2.6);
        this.match.force({ t: this.match.realT + 6.2, team: 'home', outcome: 'goal', final: 'through', big: true, scorerIndex: 10, last: true });
      }],
    ];
    this.seatedI = 0;
  }

  updateSeated() {
    // 念のため: ラストワンプレーが起きなくても前半は終わる
    if (this.phaseT > 18 && !this.halfEnded) this.endHalf();
    while (this.seatedSteps && this.seatedI < this.seatedSteps.length && this.phaseT >= this.seatedSteps[this.seatedI][0]) {
      this.seatedSteps[this.seatedI][1]();
      this.seatedI++;
    }
  }

  endHalf() {
    if (this.halfEnded) return;
    this.halfEnded = true;
    this.match.whistle('halftime');
    this.sAudio.whistle('end');
    this.crowd.react('whistle');
    const sc = this.match.score;
    this.broadcast.bigText('HALF TIME', `JPN ${sc.home} - ${sc.away} BRA`, 30, '#ffffff');
    setTimeout(() => this.hud.big('HALF TIME', { sub: `JPN ${sc.home} - ${sc.away} BRA`, seconds: 3.5 }), 1200);
    setTimeout(() => this.hud.say('fan', WHO_FAN[0], 2.4), 3000);
    setTimeout(() => this.hud.say('fan', WHO_FAN[1], 2.4), 4600);
    setTimeout(() => this.hud.say('me', '……。', 2.6), 6600);
    setTimeout(() => this.hud.blinds(true), 9000);
    setTimeout(() => this.showResult(), 10000);
  }

  showResult() {
    this.setPhase('result');
    this.hud.show(false);
    const m = this.match;
    const real = this.time - this.stats.realStart;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const hms = (s) => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const goals = m.goals.length;
    const a = this.search.address;
    const rows = [
      ['MATCH TIME', `${m.clockText().replace(/^45:00 \+/, '45:00+')}`],
      ['REAL PLAY TIME', fmt(real)],
      ['MATCH WATCHED', hms(this.stats.watched), true],
      ['GOALS', `${goals}`],
      ['GOALS ACTUALLY SEEN', `${this.stats.goalsSeen} / ${goals}`, true],
      ['SEATS', '100,000'],
      ['SEATS CHECKED', `${this.search.checked.size}`],
      ['FALSE ALARMS', `${this.search.falseAlarms}`],
      ['YOUR SEAT', `BLOCK ${a.block} · ROW ${a.row} · SEAT ${a.seat}`],
      ['FOUND BY', this.stats.foundBy],
    ];
    const el = document.getElementById('result');
    el.innerHTML = `<div class="result-wrap">
      <div class="r-head">HALF TIME · VERTICAL SLICE</div>
      <div class="r-score"><small>MEN'S FOOTBALL FINAL</small>JPN ${m.score.home} - ${m.score.away} BRA</div>
      <div class="r-rows">${rows.map(([k, v, hot], i) => `<div class="r-row${hot ? ' hot' : ''}" style="animation-delay:${0.25 + i * 0.22}s"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="r-title" style="animation-delay:${0.4 + rows.length * 0.22}s">サッカー、<span class="b">なのに。</span></div>
      <div class="r-actions"><button type="button" data-action="retry">もう一度（別の席）</button>${location.hash === '#from-main' ? '<button type="button" data-action="back">← タイトルへ</button>' : ''}</div>
      <div class="r-note">SEED ${this.seed}　·　後半・ハーフタイム・望遠鏡・AI は次の段階で</div>
    </div>`;
    el.classList.remove('hidden');
    this.hud.blinds(false);
    try {
      localStorage.setItem('nanoni.soccer.played', '1');
    } catch {
      /* 何もしない */
    }
  }

  // ------------------------------------------------------------------
  // 試合のイベント → 観客・音・ビジョン・HUD
  // ------------------------------------------------------------------
  onMatch(ev) {
    (this.eventLog ??= []).push(`${ev.t.toFixed(1)} ${this.phase} ${ev.type} ${ev.team ?? ''} ${ev.outcome ?? ''}`);
    if (this.eventLog.length > 80) this.eventLog.shift();
    const home = ev.team === 'home';
    const bc = this.broadcast;
    const sa = this.sAudio;
    const live = this.phase === 'search' || this.phase === 'seated' || this.phase === 'opening' || this.phase === 'found';
    switch (ev.type) {
      case 'kickoff':
        this.crowd.react('kickoff', { team: ev.team });
        if (ev.t > 1) sa.whistle('short');
        bc.say(ev.t < 1 ? 'キックオフ！ 決勝戦が始まりました！' : '試合再開です。', 3);
        break;
      case 'chance':
      case 'bigChance':
        this.crowd.react('chance', { team: ev.team });
        sa.ooh();
        bc.say(home ? 'チャンス！ 日本！' : 'ブラジルのチャンス！', 3);
        if (ev.type === 'bigChance' && this.phase === 'search') {
          this.hud.watch(true);
          clearTimeout(this.watchTimer);
          this.watchTimer = setTimeout(() => this.hud.watch(false), 6000);
        }
        break;
      case 'shot':
        this.crowd.react('shot', { team: ev.team });
        sa.shot();
        this.hud.watch(false);
        this.maybeBlock(ev);
        break;
      case 'goal': {
        this.crowd.react('goal', { team: ev.team });
        sa.goal(home);
        bc.onGoal(ev);
        this.view.shake(home ? 1 : 0.2);
        const seen = this.ballVisible(false) && !this.blocked();
        ev.goal.seen = seen && live;
        if (ev.goal.seen) this.stats.goalsSeen++;
        const sc = ev.score;
        this.hud.setScore(sc.home, sc.away);
        this.hud.toast(`GOAL  JPN ${sc.home} - ${sc.away} BRA  ·  ${ev.scorer} ${ev.goal.minute}'`, 5);
        if (home) {
          this.emitConfetti();
          this.near.setExtraPose(0, 1, 1, 1);
          this.fanJump = 9;
        }
        if (this.phase === 'search') {
          const n = this.match.goals.length;
          const line = home ? (n === 1 ? '見えない。' : n < 4 ? 'また見えない。' : '……見えない。') : '（なにか起きた……？）';
          setTimeout(() => this.hud.say('me', line, 2.4), 1600);
        }
        if (this.phase === 'seated') setTimeout(() => this.endHalf(), 1700);
        break;
      }
      case 'save':
        this.crowd.react('save', { team: ev.team });
        sa.save();
        bc.say('止めたー！ ナイスセーブ！', 3);
        break;
      case 'miss':
        this.crowd.react('miss', { team: ev.team });
        sa.groan();
        bc.say(ev.outcome === 'post' ? 'ポスト！！ 惜しい！' : '枠の外……！', 3);
        break;
      case 'corner':
        bc.say(home ? '日本、コーナーキック。' : 'ブラジルのコーナー。', 3);
        break;
      case 'addedTime':
        bc.bigText(`+${ev.minutes}`, 'ADDITIONAL TIME', 4, '#3dff8b');
        this.hud.toast(`ADDITIONAL TIME  +${ev.minutes}`, 4);
        break;
      default:
        break;
    }
  }

  // 肝心なところ（シュート）で、ボールが見えていたら前の人・旗が入る
  maybeBlock(ev) {
    if (this.phase === 'seated') {
      // 着席後: 前の席の人が立ち上がる
      this.near.setExtraPose(0, 1, 0.9, 0);
      setTimeout(() => this.hud.say('me', 'えっ', 1.6), 500);
      this.frontStanding = true;
      return;
    }
    if (this.phase !== 'search') return;
    const important = ev.outcome === 'goal' || ev.outcome === 'post' || this.hudWatching;
    if (!important) return;
    if (this.ballVisible(true) || this.hudWatching) {
      this.flag.wave(6.5);
      this.near.setExtraPose(0, 1, 1, 0.8);
      this.fanJump = 6.5;
      this.stats.blocks = (this.stats.blocks ?? 0) + 1;
    } else if (ev.outcome === 'goal') {
      this.flag.wave(6);
    }
  }

  blocked() {
    return this.flag.active > 0.2 || this.frontStanding;
  }

  // ボールが画面に入っているか（center: 画面の中央付近だけ）
  ballVisible(center) {
    const b = this.sim.ball.pos;
    const v = new THREE.Vector3(b.x, b.y, b.z).project(this.camera);
    if (v.z > 1 || v.z < -1) return false;
    if (center) return Math.hypot(v.x * this.camera.aspect, v.y) < 0.26;
    return Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
  }

  emitConfetti() {
    // 上の段から目の前へ
    const c = this.camera.position;
    const f = this.view.forward(new THREE.Vector3());
    for (let k = 0; k < 3; k++) {
      this.confetti.emit({ x: c.x + f.x * (6 + k * 5) + (Math.random() - 0.5) * 8, y: c.y + 8, z: c.z + f.z * (6 + k * 5) + (Math.random() - 0.5) * 8, spread: 3, vy: -1, color: [[0.12, 0.25, 0.9], [1, 1, 1], [1, 0.82, 0.2], [0.9, 0.1, 0.2]], size: 0.1, life: 6, gravity: 0.9, drag: 1.6, count: Math.floor(this.confetti.cap / 6) });
    }
  }

  // ------------------------------------------------------------------
  // 入力
  // ------------------------------------------------------------------
  canLook() {
    return this.phase === 'search' || this.phase === 'title' || this.phase === 'seated';
  }

  onDrag(dx, dy) {
    if (!this.canLook() || this.paused) return;
    this.view.drag(-dx, dy, innerHeight);
  }

  onPinch(s) {
    if (this.phase !== 'search' || this.paused) return;
    const before = this.search.tool;
    this.search.zoomBy(s);
    if (this.search.tool !== before) this.onToolChanged();
    else if (Math.abs(s - 1) > 0.02) {
      this.zoomSoundT = (this.zoomSoundT ?? 0) - 1;
      if (this.zoomSoundT <= 0) {
        this.sAudio.zoom(s > 1);
        this.zoomSoundT = 4;
      }
    }
  }

  onTap(x, y) {
    if (this.paused) return;
    if (this.phase === 'title') return this.start();
    if (this.phase === 'travel') return this.travelTap();
    if (this.phase !== 'search') return;
    // 調べる: 0.35 秒スキャンしてから結果（ダブルタップなら取り消し）
    const ret = this.hud.reticle(x, y);
    this.sAudio.scan();
    clearTimeout(this.inspectTimer);
    this.inspectTimer = setTimeout(() => {
      const res = this.search.inspect(x, y);
      this.showInspect(res, ret);
    }, 340);
    this.pendingReticle = ret;
  }

  showInspect(res, ret) {
    this.hud.card(res);
    if (res.kind === 'target') {
      ret?.classList.add('ok');
      this.hud.card({ ...res, text: 'あなたの席……！ 空いている！' });
      setTimeout(() => this.onFound(), 700);
    } else if (res.kind === 'far' || res.kind === 'none') {
      ret?.classList.add('no');
      this.sAudio.resultFar();
    } else {
      ret?.classList.add('no');
      this.sAudio.resultNo();
    }
    this.lastInspect = res;
  }

  onLongPress(x, y) {
    if (this.phase !== 'search' || this.paused) return;
    const pin = this.search.addPin(x, y);
    if (!pin) return;
    this.sAudio.pin();
    this.hud.setPins(this.search.pins, (p) => this.lookAtPin(p));
    this.hud.toast(`候補 ${pin.letter} に登録  ·  ${this.layout.label(pin.seat).replace(/ · SEAT \d+/, '')}`, 2.5);
    if (this.touch && !this.auto && navigator.vibrate) navigator.vibrate(12);
  }

  onDoubleTap() {
    if (this.phase !== 'search' || this.paused) return;
    clearTimeout(this.inspectTimer);
    this.pendingReticle?.remove();
    this.toggleTool();
  }

  toggleTool() {
    if (this.phase !== 'search') return;
    if (!this.search.hasBinoculars) {
      this.hud.say('me', '（双眼鏡があれば……）', 1.8);
      return;
    }
    this.search.toggleTool();
    this.onToolChanged();
  }

  onToolChanged() {
    if (this.search.tool === 'binoculars') {
      this.usedBinoculars = true;
      this.hud.newTool(false);
      this.sAudio.gear();
      this.sAudio.zoom(true);
    } else this.sAudio.zoom(false);
  }

  lookAtPin(p) {
    if (this.phase !== 'search') return;
    this.view.lookAt(this.search.seatWorld(p.seat, new THREE.Vector3()), 0.6);
    this.sAudio.focus();
  }

  showTicket(show, silent = false) {
    this.hud.ticket(show, this.search?.ticketFields() ?? { level: '?????', side: '?????', block: '??', row: '??', seat: '?' }, this.search?.seatsLeft ?? 100000);
    if (show && !silent) this.sAudio.gear();
  }

  // 試合を見る（誘惑）: ボールへ振り向く
  watchMatch() {
    if (this.phase !== 'search') return;
    this.hud.watch(false);
    this.hudWatching = true;
    const b = this.sim.ball.pos;
    this.view.lookAt(new THREE.Vector3(b.x, 1, b.z), 0.45, this.search.tool === 'binoculars' ? 4 : 1);
    if (this.search.tool === 'binoculars') this.search.binoZoom = 4;
    this.stats.watchPressed = (this.stats.watchPressed ?? 0) + 1;
    setTimeout(() => (this.hudWatching = false), 7000);
  }

  // ------------------------------------------------------------------
  // ループ
  // ------------------------------------------------------------------
  frame(now) {
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    this.gov.sample(realDt);
    this.input.update();
    if (!this.paused) {
      for (let i = 0; i < this.fast; i++) this.update(realDt);
    }
    this.jsMs = performance.now() - t0;
    this.render();
    this.input.endFrame();
  }

  update(dt) {
    this.time += dt;
    this.phaseT += dt;
    const input = this.input;
    // キー
    if (input.wasPressed('Escape') && this.phase !== 'title' && this.phase !== 'result') this.setPaused(!this.paused);
    if (input.wasPressed('KeyM')) document.getElementById('muteBtn').dispatchEvent(new Event('pointerdown'));
    if (this.phase === 'title' && (input.wasPressed('Space') || input.wasPressed('Enter'))) this.start();
    if (this.phase === 'search') {
      if (input.wasPressed('KeyB')) this.toggleTool();
      if (input.wasPressed('KeyT')) this.showTicket(document.getElementById('ticket').classList.contains('hidden'));
      if (input.wasPressed('Space') && !document.getElementById('watchBtn').classList.contains('hidden')) this.watchMatch();
      const ax = input.lookAxis();
      if (ax.x || ax.y) this.view.drag(ax.x * 320 * dt * (this.view.zoom > 2 ? 0.8 : 1), ax.y * 320 * dt, innerHeight * (this.view.zoom > 2 ? 1 : 1));
      if (ax.z) this.onPinch(1 + ax.z * dt * 1.5);
    }
    if (this.phase === 'opening') {
      this.updateOpening(dt);
      if (input.wasPressed('Space') || input.wasPressed('Enter')) this.skipOpening();
    }
    if (this.phase === 'title') {
      this.view.yawT += dt * 0.04;
    }
    if (this.phase === 'search' || this.phase === 'found') this.updateStory();
    if (this.phase === 'travel') this.updateTravel(dt);
    if (this.phase === 'seated') this.updateSeated();
    if (this.auto) this.autopilot(dt);

    // 試合・観客
    const tm = performance.now();
    this.match.update(dt);
    this.matchMs = performance.now() - tm;
    const tc = performance.now();
    this.crowd.update(dt);
    this.crowdMs = performance.now() - tc;
    this.search.update(dt);
    this.view.update(dt);
    this.view.apply();
    this.stadium.update(dt, this.time);
    this.broadcast.update(dt);
    this.confetti.update(dt, this.time);
    this.confetti.setPointScale((this.renderer.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    // 目の前の旗・ゴールで跳ぶ人
    const b = this.sim.ball.pos;
    this.flag.update(dt, this.camera, this.fanPos, this.hudWatching || this.flag.active > 0 ? new THREE.Vector3(b.x, b.y, b.z) : null);
    if (this.fanJump > 0) {
      this.fanJump -= dt;
      if (this.fanJump <= 0 && this.nearMode === 'spot') this.near.setExtraPose(0, 0, 0, 0);
    }

    // 音: 盛り上がり = 立っている人の割合
    let st = 0;
    for (let i = 0; i < this.crowd.nb; i += 3) st += this.crowd.current(i)[0];
    st /= Math.ceil(this.crowd.nb / 3);
    const wave = this.crowd.uniforms.uWave.value.z * 0.3;
    this.sAudio.update(dt, { excite: clamp(0.15 + st * 0.9 + wave, 0, 1), playing: this.match.state === 'live' || this.phase === 'title' });

    // 試合を見ていた時間（ボールが画面の中央付近 + 遮られていない）
    if ((this.phase === 'search' || this.phase === 'seated') && this.match.state === 'live' && !this.blocked() && this.ballVisible(true)) this.stats.watched += dt;

    // HUD
    if (this.phase === 'search' || this.phase === 'seated' || this.phase === 'found') {
      const m = this.match;
      this.hud.setClock(m.clockText());
      this.hud.setScore(m.score.home, m.score.away);
      this.hud.setCompass(this.view.yaw);
      this.hud.setTool(this.search.tool, this.search.hasBinoculars, this.view.zoom);
      this.hud.updateMarkers(this.phase === 'search' ? this.search.pins : [], (id) => this.search.screenOf(id));
    }
    if (this.debug) this.updateDev(dt);
  }

  render() {
    if (this.noRender) return;
    const size = this.renderer.getDrawingBufferSize(this._size ?? (this._size = new THREE.Vector2()));
    this.field.update(this.camera, size.y);
    this.renderer.info.reset();
    this.broadcast.render();
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------
  // 開発用
  // ------------------------------------------------------------------
  updateDev(dt) {
    this.devT = (this.devT ?? 0) - dt;
    if (this.devT > 0) return;
    this.devT = 0.5;
    const r = this.renderer.info;
    const vis = this.visibleCrowd();
    this.hud.dev(
      [
        `FPS ${this.gov.fps.toFixed(0)}  ${this.gov.q.name}  PR ${this.renderer.getPixelRatio().toFixed(2)}`,
        `draw ${r.render.calls}  tris ${(r.render.triangles / 1000).toFixed(0)}k`,
        `geo ${r.memory.geometries}  tex ${r.memory.textures}  buffers≈${this.bufferMB()}MB`,
        `JS ${this.jsMs?.toFixed(2)}ms  match ${this.matchMs?.toFixed(2)}  crowd ${this.crowdMs?.toFixed(3)}`,
        `vision ${this.broadcast.renderMs.toFixed(2)}ms  pick ${this.search.pickMs?.toFixed(3) ?? '-'}ms`,
        `crowd logical 100,000  visible ~${vis.toLocaleString('en-US')}  near3D ${this.near.count}`,
        `phase ${this.phase}  t ${this.match.realT.toFixed(1)}  ${this.match.clockText()}`,
        `target ${this.layout.label(this.search.target)}`,
      ].join('\n')
    );
  }

  // シーンの頂点バッファ + ビジョンの描画先の概算（MB）
  bufferMB() {
    if (this._mb) return this._mb;
    const seen = new Set();
    let bytes = 0;
    this.scene.traverse((o) => {
      const g = o.geometry;
      if (!g || seen.has(g)) return;
      seen.add(g);
      for (const a of Object.values(g.attributes)) bytes += a.array?.byteLength ?? 0;
      if (g.index) bytes += g.index.array.byteLength;
    });
    bytes += this.broadcast.rt.width * this.broadcast.rt.height * 4;
    this._mb = (bytes / 1048576).toFixed(1);
    return this._mb;
  }

  // 視野に入っているブロックの座席数の合計（概算）
  visibleCrowd() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let n = 0;
    const sph = new THREE.Sphere();
    const p = {};
    for (const b of this.layout.blocks) {
      const T = TIERS[b.tier];
      pointAt(b.tier, b.mid, (T.d0 + T.d1) / 2, p);
      sph.center.set(p.x, (T.h0 + T.top) / 2, p.z);
      sph.radius = 26;
      if (fr.intersectsSphere(sph)) n += this.layout.blockCount[b.index];
    }
    return n;
  }

  // 自動操縦（スモークテスト用）: 見回す → 双眼鏡 → 候補 → 本物を見つける
  autopilot(dt) {
    if (this.phase !== 'search') return;
    this.autoT = (this.autoT ?? 0) + dt;
    const s = this.search;
    if (Math.floor(this.autoT * 0.7) !== Math.floor((this.autoT - dt) * 0.7)) {
      const x = innerWidth * (0.3 + Math.random() * 0.4);
      const y = innerHeight * (0.3 + Math.random() * 0.3);
      this.showInspect(s.inspect(x, y), null);
      if (Math.random() < 0.2) this.onLongPress(x, y);
      this.view.drag((Math.random() - 0.5) * 200, (Math.random() - 0.5) * 40, innerHeight);
    }
    if (s.hasBinoculars && s.tool === 'eye' && this.autoT > 60) this.toggleTool();
    const findAt = +(this.params.get('findAt') ?? 150);
    if (this.match.realT > findAt && !s.found && this.phase === 'search') {
      // 目標へ向いて、画面上の位置を調べる
      if (!this.autoAim) {
        this.autoAim = true;
        if (s.tool !== 'binoculars' && s.hasBinoculars) this.toggleTool();
        this.view.lookAt(s.targetWorld(), 0.3, s.tool === 'binoculars' ? 8 : 1);
        s.binoZoom = 8;
      } else if (!this.view.anim) {
        const sc = s.screenOf(s.target);
        this.showInspect(s.inspect(sc.x, sc.y), null);
        this.autoAim = false;
      }
    }
  }

  state() {
    return {
      phase: this.phase,
      t: this.match.realT,
      clock: this.match.clockText(),
      score: { ...this.match.score },
      goals: this.match.goals.length,
      found: this.search.found,
      checked: this.search.checked.size,
      falseAlarms: this.search.falseAlarms,
      seatsLeft: this.search.seatsLeft,
      tool: this.search.tool,
      fps: this.gov.fps,
      quality: this.gov.q.name,
      calls: this.renderer.info.render.calls,
      tris: this.renderer.info.render.triangles,
      watched: this.stats.watched,
      goalsSeen: this.stats.goalsSeen,
      target: this.layout.label(this.search.target),
      play: this.match.play?.name,
    };
  }
}
