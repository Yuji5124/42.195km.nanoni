import * as THREE from 'three';
import { EventBus } from '../../src/core/EventBus.js';
import { AudioManager } from '../../src/audio/AudioManager.js';
import { createRng, clamp } from '../../src/core/math.js';
import { createAnimalInstances, setAnimalLook, CAT_LOOKS } from '../../src/world/AnimalModel.js';
import { CrowdDirector, POSE } from '../../soccer/src/crowd/CrowdDirector.js';
import { CrowdField } from '../../soccer/src/crowd/CrowdField.js';
import { NearCrowd } from '../../soccer/src/crowd/NearCrowd.js';
import { PerformanceGovernor } from '../../soccer/src/core/PerformanceGovernor.js';
import { StadiumLayout, CORE, pointAtLoop, standHeightAt } from './stadium/StadiumLayout.js';
import { CrowdPlan, ZONE } from './stadium/CrowdPlan.js';
import { StadiumBuilder } from './stadium/StadiumBuilder.js';
import { CAM_POS, RUNWAY, BAR, SCREEN, TOWERS } from './stadium/field.js';
import { NightSky, dirFromAzEl } from './sky/NightSky.js';
import { Birds } from './sky/Birds.js';
import { Competition } from './vault/Competition.js';
import { SpecialCrowd } from './people/SpecialCrowd.js';
import { StoryDirector } from './story/StoryDirector.js';
import { BroadcastCamera } from './camera/BroadcastCamera.js';
import { Subjects } from './camera/Subjects.js';
import { ShotJudge, analyzePixels } from './camera/ShotJudge.js';
import { PostFX } from './fx/PostFX.js';
import { PVInput } from './input/PVInput.js';
import { HUD } from './ui/HUD.js';
import { Commentary } from './show/Commentary.js';
import { PVAudio } from './audio/PVAudio.js';
import { Epilogue } from './show/Epilogue.js';
import { buildResult, lastWords } from './show/Result.js';

// 『棒高跳び、なのに。』のモード本体（流れとループ）。
//   title → live（3 分の生中継。0:00〜0:15 は放送開始: 独り言 → 本番 5 秒前 → ON AIR）→ offair → epilogue → result
// 競技（Competition）と観客の物語（StoryDirector）は時刻で決まる。プレイヤーのものはカメラ（BroadcastCamera）だけ。
// 何をテレビに映したかで、視聴率（ShotJudge）・Cheers・今日の給料が決まる。

export const LIVE_SEC = 180;
const ON_AIR = 12.5;
const END_T = 180.6;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class PoleVaultMode {
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
    this.t = 0;
    this.time = 0;
    this.paused = false;
    this.shotCool = 0;
    this.capture = null;
    this.lockT = 0;
    this.lockEvalT = 0;
    this.mutterCool = 0;
    this.heard = new Set();
  }

  async init() {
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.touch = touch;
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03050c);
    scene.fog = new THREE.Fog(0x0a0f1e, 140, 700);
    this.scene = scene;
    this.bus = new EventBus();

    this.gov = new PerformanceGovernor({ touch, forced: this.params.get('quality'), onChange: (q) => this.applyQuality(q) });
    const q = this.gov.q;

    // ---- 光（夜のナイター: 上からの白い照明 + 向こう側からの逆光）
    scene.add(new THREE.HemisphereLight(0x7d8cc4, 0x1c1a16, 0.5));
    scene.add(new THREE.AmbientLight(0x404858, 0.25));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.3);
    key.position.set(-20, 70, 95);
    key.target.position.set(6, 0, RUNWAY.z);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -34, right: 34, top: 22, bottom: -22, near: 20, far: 200 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    const back = new THREE.DirectionalLight(0xc8d8ff, 1.5);
    back.position.set(60, 55, -90);
    back.target.position.set(10, 0, RUNWAY.z);
    scene.add(back, back.target);
    this.keyLight = key;
    this.backLight = back;

    // ---- スタジアム・競技・物語（座席を決めてから観客を作る）
    this.stadium = new StadiumBuilder(scene);
    this.layout = new StadiumLayout();
    this.plan = new CrowdPlan(this.layout, createRng(this.seed + 3));
    this.comp = new Competition(scene, createRng(this.seed + 11), this.bus, this.stadium);
    this.stories = new StoryDirector({ rng: createRng(this.seed + 21), comp: this.comp, layout: this.layout, plan: this.plan, bus: this.bus });
    const force = (this.params.get('story') ?? '').split(',').filter(Boolean);
    this.stories.select(force);
    this.stories.reserveSeats();

    // ---- 観客 3 万人（ビルボード 1 draw call + 撮影台の後ろの 3D の人形 + 物語の人）
    this.crowd = new CrowdDirector(this.layout, this.plan, createRng(this.seed + 4));
    this.crowd.ultras = [];
    this.crowd.set(this.crowd.all, POSE.SIT, { spread: 0 });
    this.blocks = {
      main: this.layout.blocks.filter((b) => this.plan.zoneOfBlock[b.index] === ZONE.MAIN).map((b) => b.index),
      back: this.layout.blocks.filter((b) => this.plan.zoneOfBlock[b.index] === ZONE.BACK).map((b) => b.index),
      curve: this.layout.blocks.filter((b) => this.plan.zoneOfBlock[b.index] === ZONE.CURVE).map((b) => b.index),
      upper: this.layout.blocks.filter((b) => this.plan.zoneOfBlock[b.index] === ZONE.UPPER).map((b) => b.index),
      all: this.layout.blocks.map((b) => b.index),
    };
    this.field = new CrowdField(scene, this.layout, this.plan, this.crowd, { a2c: q.a2c, fog: scene.fog });
    this.field.uniforms.uCore.value.set(CORE.sx, 0.01);
    this.field.uniforms.uLight.value = 0.7;
    this.field.uniforms.uSeat.value.set(0x24305a);
    for (const c of this.field.uniforms.uShirts.value) {
      const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      c.setRGB(c.r * 0.72 + l * 0.18, c.g * 0.72 + l * 0.18, c.b * 0.72 + l * 0.18);
    }
    this.near = new NearCrowd(scene, this.layout, this.plan, this.crowd, this.field);
    this.buildNear(q.near);
    this.specials = new SpecialCrowd(scene, this.layout, this.field);
    this.stories.spawn(scene, this.specials);

    // ---- 夜空・鳥（月はカメラから見てバーの少し上へ昇ってくる）
    this.sky = new NightSky(scene, CAM_POS, { moonAz: -0.893, moonEl: 0.157, rng: createRng(this.seed + 9) });
    const moonDirAt = (t) => {
      const k = Math.min(1, t / 180);
      return dirFromAzEl(-0.893 + 0.015 * k, 0.157 + 0.045 * k, new THREE.Vector3());
    };
    this.birds = new Birds(scene, { camPos: CAM_POS, moonDirAt, tower: TOWERS[1] });
    this.scheduleEvents();

    // ---- カメラ・画面・入力
    this.camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 2200);
    this.cam = new BroadcastCamera(this.camera, CAM_POS);
    this.cam.aimAt(new THREE.Vector3(RUNWAY.start + 6, 1.6, RUNWAY.z), true);
    this.cam.pullFocus(this.cam.pos.distanceTo(new THREE.Vector3(RUNWAY.start + 6, 1.6, RUNWAY.z)));
    this.post = new PostFX(renderer, scene, this.camera);
    this.input = new PVInput(this.canvas, {
      lock: () => this.onLockClick(),
      focus: () => this.onFocusClick(),
      lockChange: (on) => this.onPointerLock(on),
    });
    this.buildSubjects();

    // ---- 中継（画面・実況・採点・音）
    this.hud = new HUD();
    this.judge = new ShotJudge({ rng: createRng(this.seed + 31) });
    this.commentary = new Commentary({ hud: this.hud, rng: createRng(this.seed + 41), comp: this.comp });
    this.audio = new AudioManager(this.bus);
    this.pva = new PVAudio(this.audio);
    if (this.params.has('mute')) this.audio.setMuted(true);
    this.epilogue = new Epilogue(this);
    this.listen();
    this.thumbCanvas = document.createElement('canvas');
    this.thumbCanvas.width = 256;
    this.thumbCanvas.height = 144;
    this.anaCanvas = document.createElement('canvas');
    this.anaCanvas.width = 160;
    this.anaCanvas.height = 90;
    this.bindUI();

    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.resize();
    window.__pv = this;
    this.setPhase('title');
    this.last = performance.now();
    renderer.setAnimationLoop((now) => this.frame(now));
    if (this.auto || this.params.has('start')) setTimeout(() => this.start(), 300);
  }

  // 撮影台の後ろ（メインスタンド 1 階）の席を 3D の人形に
  buildNear(max) {
    this.near.build(new THREE.Vector3(CAM_POS.x, CAM_POS.y, CAM_POS.z), { radius: 26, max: Math.min(max, 800), tier: 0, core: { sx: CORE.sx, sz: 0 } });
  }

  applyQuality(q) {
    this.resize();
    this.field.setA2C(q.a2c);
    this.post.bloomOn = q.name !== 'VERY LOW';
    this.keyLight.castShadow = q.name !== 'VERY LOW';
    if (Math.abs(this.near.count - Math.min(q.near, 800)) > 150) this.buildNear(q.near);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    const pr = Math.min(devicePixelRatio, this.gov.q.pixelRatio, 1.75);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.cam.setAspect(w / h);
    this.post.setSize(w, h, pr);
  }

  // ---- 人のいない出来事（流れ星・飛行機・ウェーブ・照明・猫）
  scheduleEvents() {
    const rng = createRng(this.seed + 51);
    this.events = {};
    for (const s of this.stories.active) {
      const ev = s.event;
      if (!ev) continue;
      if (ev.type === 'meteor') {
        this.sky.scheduleMeteor(s.start, -1.5 + rng.next() * 1.0, 0.3 + rng.next() * 0.2, 0.14, -0.5);
        // クライマックスにもう 1 つ（半分の確率・月の近く）
        if (rng.next() < 0.5) this.sky.scheduleMeteor(171.5 + rng.next() * 3, -0.95, 0.27, 0.1, -0.7);
        this.events.meteor = s;
      } else if (ev.type === 'plane') {
        this.sky.schedulePlane(s.start, 40, -2.7, -0.2, 0.42);
        this.events.plane = s;
      } else this.events[ev.type] = s;
    }
    if (this.events.cat) {
      this.cat = createAnimalInstances('cat', 1);
      setAnimalLook(this.cat, 0, CAT_LOOKS[Math.floor(rng.next() * CAT_LOOKS.length)]);
      this.cat.count = 0;
      this.scene.add(this.cat);
    }
  }

  // ---- 被写体の名簿
  buildSubjects() {
    const S = new Subjects();
    this.subjects = S;
    for (const id in this.comp.vaulters) {
      const v = this.comp.vaulters[id];
      S.add({ id: `athlete:${id}`, kind: 'athlete', label: v.info.name, en: v.info.en, size: 1.85, weight: 1.5, vaulter: v, pos: (o) => v.fig.hipsWorld(o).add(_w.set(0, 0.25, 0)) });
    }
    for (const n of this.specials.list) {
      const kind = n.kind === 'npc' || n.kind === 'athlete' ? 'npc' : n.kind === 'judge' ? 'judge' : n.kind === 'staff' ? 'staff' : 'field';
      S.add({
        id: `npc:${n.role}`,
        kind,
        label: n.label,
        en: n.storyObj?.label ?? (kind === 'judge' ? 'Judge' : 'Spectator'),
        get size() {
          return n.act.stand || !n.seated ? 1.55 : 1.0;
        },
        weight: n.story ? 1.2 : kind === 'judge' ? 1.1 : 0.8,
        npc: n,
        pos: (o) => n.fig.headWorld(o).add(_w.set(0, -0.28, 0)),
      });
    }
    S.add({ id: 'bar', kind: 'bar', label: 'バー', en: 'Bar', size: 0.35, weight: 0.2, pos: (o) => o.copy(this.stadium.bar.position) });
    S.add({ id: 'moon', kind: 'moon', label: '月', en: 'Moon', weight: 0.9, angular: () => this.sky.moonSize * 1.15, pos: (o) => o.copy(this.sky.moon.position) });
    S.add({ id: 'birds', kind: 'birds', label: '2 羽の鳥', en: 'Two Birds', size: 1.3, weight: 1.1, active: () => this.birds.pair[0].visible, pos: (o) => this.birds.center(o) });
    TOWERS.forEach((tw, i) => S.add({ id: `tower${i}`, kind: 'light', label: '照明塔', en: 'Floodlight', size: 9, weight: 0.4, pos: (o) => o.copy(this.stadium.towerHeads[i]) }));
    this.stadium.lamps.slice(0, 26).forEach((p, i) => {
      if (i % 4) return;
      S.add({ id: `lamp${i}`, kind: 'light', label: '屋根の照明', en: 'Roof Lights', size: 5, weight: 0.3, pos: (o) => o.copy(p) });
    });
    S.add({ id: 'screen', kind: 'screen', label: '大型ビジョン', en: 'Big Screen', size: SCREEN.h, weight: 0.35, pos: (o) => o.set(SCREEN.x, SCREEN.y, SCREEN.z) });
    S.add({ id: 'meteor', kind: 'meteor', label: '流れ星', en: 'Shooting Star', weight: 2, angular: () => 0.03, active: () => this.sky.meteorActive, pos: (o) => this.sky.meteorPoint(o) });
    S.add({ id: 'plane', kind: 'plane', label: '飛行機', en: 'Airplane', weight: 0.6, angular: () => 0.012, active: () => this.sky.plane.visible, pos: (o) => o.copy(this.sky.plane.position) });
    if (this.cat) S.add({ id: 'cat', kind: 'cat', label: '猫', en: 'Cat', size: 0.45, weight: 1.4, active: () => this.cat.count > 0, pos: (o) => o.copy(this.catPos ?? _w.set(0, -100, 0)) });
    if (this.events.wave) S.add({ id: 'wave', kind: 'wave', label: 'ウェーブ', en: 'Crowd Wave', size: 14, weight: 0.8, active: () => this.crowd.waveActive, pos: (o) => this.wavePoint(o) });
    if (this.events.flicker) S.add({ id: 'flicker', kind: 'flicker', label: '照明のちらつき', en: 'Light Flicker', size: 12, weight: 1.2, active: () => this.flickerOn, pos: (o) => o.copy(this.stadium.towerHeads[1]) });
  }

  wavePoint(o) {
    const w = this.crowd.uniforms.uWave.value;
    const p = pointAtLoop(10, w.x);
    return o.set(p.x, 6.5, p.z);
  }

  // ---- 競技のイベント → 観客・音・実況・視聴率
  listen() {
    const B = this.blocks;
    const C = this.crowd;
    const on = (type, fn) => this.bus.on(type, (e) => fn(e));
    const pos = (a) => this.comp.vaulters[a.id].fig.hipsWorld(new THREE.Vector3());
    const comm = (type) => on(type, (e) => this.commentary.onEvent(type, e, this.t));
    for (const tp of ['vault:ready', 'vault:run', 'vault:clear', 'vault:fail', 'vault:out', 'vault:winner', 'vault:record']) comm(tp);
    on('vault:ready', (e) => {
      const a = e.a;
      if (a.final) {
        C.set([...B.main, ...B.back, ...B.curve, ...B.upper], POSE.LEAN, { spread: 1.5, stagger: 0.6 });
        C.later(3.5, () => C.set([...B.back, ...B.curve], POSE.PHONE, { spread: 2, stagger: 0.8 }));
      }
      if (e.athlete.clapper) {
        const at = a.t0 + (a.tRun - a.t0) * 0.2;
        this.clapAt = { t: at, until: a.tTO, a };
      }
      this.updateScreen(a);
    });
    on('vault:run', (e) => {
      if (!this.clapAt || this.clapAt.a !== e.a) C.set([...B.main, ...B.back, ...B.curve], POSE.LEAN, { spread: 0.8 });
    });
    on('vault:takeoff', (e) => {
      C.set([...B.main, ...B.back, ...B.curve, ...B.upper], POSE.HALF, { spread: 0.4, stagger: 0.1 });
      this.pva.plant(pos(e.a), this.cam);
      setTimeout(() => this.pva.bend(pos(e.a), this.cam), 150);
    });
    on('vault:release', (e) => this.pva.release(pos(e.a), this.cam));
    on('vault:land', (e) => this.pva.mat(pos(e.a), this.cam));
    on('bar:bounce', (e) => this.pva.barClatter(e.pos, this.cam, e.v));
    on('vault:clear', (e) => {
      const a = e.a;
      this.pva.stopClap();
      if (a.final) return;
      C.set([...B.main, ...B.back, ...B.curve, ...B.upper], POSE.CHEER, { spread: 0.4, stagger: 0.12 });
      C.later(3.2, () => C.set(B.all, POSE.CLAP, { spread: 1.2, stagger: 0.4 }));
      C.later(6, () => C.set(B.all, POSE.SIT, { spread: 2.5, stagger: 0.8 }));
      this.pva.cheer(a.height >= 6 ? 1.15 : 0.9);
      this.judge.boost(0.6);
      this.updateScreen(a, true);
    });
    on('vault:fail', (e) => {
      const a = e.a;
      this.pva.stopClap();
      C.set([...B.main, ...B.back, ...B.curve], POSE.HEAD, { spread: 0.4 });
      C.later(2.2, () => C.set(B.all, POSE.SIT, { spread: 2.5, stagger: 0.6 }));
      this.pva.groan();
      this.updateScreen(a, true);
    });
    on('vault:winner', () => {
      C.set(B.all, POSE.CHEER, { spread: 0.5, stagger: 0.1 });
      C.later(4, () => C.set(B.all, POSE.STAND, { spread: 1.5 }));
      this.pva.cheer(1.3);
      this.judge.boost(1.6);
      this.stadium.drawScreen({ big: 'WINNER', note: '高嶺 ソラ JPN' });
    });
    on('vault:record', (e) => {
      C.set(B.all, POSE.JUMP, { spread: 0.25, stagger: 0.08 });
      C.later(6, () => C.set(B.all, POSE.CHEER, { spread: 1.2 }));
      this.pva.roarRecord();
      this.judge.boost(3);
      this.stadium.drawScreen({ big: e.wr ? '6.35 WR' : '6.05 MR', note: e.wr ? '世界新記録' : '大会新記録' });
    });
    on('story:hint', (e) => this.onHint(e));
  }

  updateScreen(a, after = false) {
    const ath = this.comp.byId[a.id];
    this.stadium.drawScreen({
      name: ath.name,
      nat: `${ath.nat} · ${ath.en}`,
      height: `${a.height.toFixed(2)}`,
      marks: this.comp.marksText(a.id, a.height),
      note: after ? (a.clear ? 'CLEARED' : 'FAILED') : `ATTEMPT ${a.no}`,
    });
  }

  // ヒント: 主人公が「ん？」・微弱な枠・小さな声
  onHint(e) {
    const npc = e.npc;
    if (this.phase !== 'live') return;
    const off = this.cam.offsetTo(npc.fig.headWorld(_v));
    const near = Math.abs(off.dyaw) < this.cam.fovRad * 1.6 + 0.2 && Math.abs(off.dpitch) < 0.5;
    if (near && this.mutterCool <= 0 && ['face', 'stand', 'glint', 'marker'].includes(e.kind)) {
      this.hud.say('ん？', 2.2);
      this.mutterCool = 14;
    }
    if (e.kind === 'stand' || e.kind === 'face') this.pva.voice(npc.fig.headWorld(new THREE.Vector3()), this.cam);
    // 画面の中なら、ごく薄い枠（一瞬）
    const p = npc.fig.headWorld(_v).project(this.camera);
    if (Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1) this.hud.hint(((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight);
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
    $('pause').addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-action="back"]')) return this.backToMain();
      this.setPaused(false);
    });
    $('epi').addEventListener('pointerdown', () => this.epilogue.skip());
    $('result').addEventListener('pointerdown', (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'retry') this.retry();
      else if (a === 'back') this.backToMain();
    });
    $('muteBtn').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.wakeAudio();
      const m = this.audio.toggleMute();
      e.currentTarget.classList.toggle('off', m);
    });
    // タッチのボタン
    $('pad').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-btn]')?.dataset.btn;
      if (!b) return;
      e.stopPropagation();
      if (b === 'shot') this.input.press('Space');
      if (b === 'lock') this.onLockClick();
      if (b === 'focus') this.onFocusClick();
      if (b === 'wide') this.touchWide = true;
      if (b === 'zin') this.touchZoom = 1;
      if (b === 'zout') this.touchZoom = -1;
    });
    const up = () => {
      this.touchWide = false;
      this.touchZoom = 0;
    };
    $('pad').addEventListener('pointerup', up);
    $('pad').addEventListener('pointercancel', up);
    $('pad').addEventListener('pointerleave', up);
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown']) window.addEventListener(ev, () => this.wakeAudio(), { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase === 'live') this.setPaused(true);
    });
    if (this.touch) {
      $('pad').classList.remove('hidden');
      document.body.classList.add('touch');
      this.input.dragMode = true;
    }
  }

  wakeAudio() {
    this.pva.init();
  }

  backToMain() {
    if (history.length > 1) history.back();
    else location.href = '../index.html';
  }

  retry() {
    const q = new URLSearchParams(location.search);
    q.delete('t');
    q.delete('seed');
    q.set('start', '1');
    location.search = q.toString();
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause').classList.toggle('hidden', !p);
    if (p) {
      this.input.exitLock();
      this.input.releaseAll();
    } else if (this.phase === 'live' && !this.touch && !this.auto) this.input.requestLock();
  }

  setPhase(p) {
    this.phase = p;
    this.phaseT = 0;
    document.body.dataset.phase = p;
    // 開発用: ?norender&renderAt=epilogue（そこまでは描画しない）
    if (this.params.get('renderAt') === p) {
      this.noRender = false;
      this.fast = 1;
    }
  }

  onPointerLock(on) {
    document.body.classList.toggle('locked', on);
    if (!on && this.phase === 'live' && !this.paused && !this.input.dragMode && !this.auto && this.t > 0.5) this.setPaused(true);
  }

  // ---- 左クリック: 画面の中央に近い被写体をロック（もう一度で解除）
  onLockClick() {
    if (this.phase !== 'live') return;
    if (this.locked) {
      this.unlock();
      return;
    }
    const items = this.items ?? [];
    let best = null;
    let bd = 1e9;
    for (const it of items) {
      if (['moon', 'light', 'screen', 'bar', 'wave', 'flicker'].includes(it.s.kind)) continue;
      const r = Math.hypot(it.ndc.x * this.camera.aspect, it.ndc.y);
      const reach = 0.16 + it.frac * 0.9;
      if (r < reach && r < bd) {
        bd = r;
        best = it;
      }
    }
    if (!best) {
      this.hud.cue('NO TARGET', { dur: 0.6 });
      this.pva.lockBeep(false);
      return;
    }
    const s = best.s;
    this.locked = s;
    this.lockT = 0;
    this.lockLost = 0;
    this.lockEvalT = 0;
    this.cam.lock = { getPos: (o) => s.pos(o) };
    this.pva.lockBeep(true);
  }

  unlock() {
    this.locked = null;
    this.cam.lock = null;
    this.hud.lock(null);
  }

  // ---- 右クリック: 画面の中央にピントを合わせ直す（速い）
  onFocusClick() {
    if (this.phase !== 'live') return;
    this.cam.pullFocus(this.centerDistance(), true);
    this.afFlash = 0.6;
    this.pva.focusTick();
  }

  // 画面の中央の距離（被写体 → 地面 → スタンド → 空）
  centerDistance() {
    const items = this.items ?? [];
    let best = null;
    let bd = 1e9;
    for (const it of items) {
      if (it.s.angular) continue;
      const r = Math.hypot(it.ndc.x * this.camera.aspect, it.ndc.y);
      if (r < Math.max(0.08, it.frac * 0.8) && r < bd) {
        bd = r;
        best = it;
      }
    }
    if (best) return best.dist;
    const f = this.cam.forward(_v).clone();
    const o = this.cam.pos;
    for (let d = 2; d < 260; d *= 1.08) {
      const x = o.x + f.x * d;
      const y = o.y + f.y * d;
      const z = o.z + f.z * d;
      if (y <= 0) return d;
      const h = standHeightAt(x, z);
      if (h >= 0 && y <= h + 0.6) return d;
    }
    return 800;
  }

  // ------------------------------------------------------------------
  start() {
    if (this.phase !== 'title') return;
    this.wakeAudio();
    document.getElementById('intro').classList.add('hidden');
    this.hud.showVF(true);
    this.hud.fade(false);
    this.input.enabled = true;
    if (!this.touch && !this.auto) this.input.requestLock();
    this.setPhase('live');
    this.t = 0;
    this.cam.aimAt(new THREE.Vector3(RUNWAY.start + 6, 1.6, RUNWAY.z), true);
    this.cam.zoom = this.cam.zoomT = 1.6;
    const warp = +(this.params.get('t') ?? 0);
    if (warp > 0) this.warpTo(warp);
    if (this.params.has('aim')) {
      const [x, y, z] = this.params.get('aim').split(',').map(Number);
      this.devAim = new THREE.Vector3(x, y, z);
      this.cam.aimAt(this.devAim, true);
    }
    if (this.params.has('zoom')) this.cam.zoomT = this.cam.zoom = +this.params.get('zoom');
    // 開発用: ?role=mother&frame=0.4（その人を画面の 4 割の大きさで追う）
    if (this.params.has('role')) this.devRole = { role: this.params.get('role'), frame: +(this.params.get('frame') ?? 0.4) };
    // 開発用: ?settle=3（描画せずに 3 秒ぶんカメラを落ち着かせる。時刻は hold なら進まない）
    const settle = +(this.params.get('settle') ?? 0);
    for (let i = 0; i < settle * 30; i++) this.update(1 / 30, true);
  }

  warpTo(t) {
    const step = 1 / 20;
    while (this.t < t) {
      this.t += step;
      this.updateWorld(step);
      this.opening(this.t, true);
    }
    this.commentary.queue.length = 0;
    // 早送りの間は「ふつうの中継」だったことにする
    const j = this.judge;
    if (j.onAir) {
      j.v = j.floor(this.t);
      j.sumT = this.t - ON_AIR;
      j.sumV = j.v * j.sumT;
      j.cheers = j.sumV * 8;
    }
  }

  goOnAir(silent = false) {
    this.judge.onAir = true;
    this.hud.showLive(true);
    this.hud.tally('onair');
    if (silent) return;
    this.hud.cue('ON AIR', { cls: 'r', small: 'MEN’S POLE VAULT FINAL', dur: 1.6 });
    this.pva.onAirChime();
    this.commentary.line('こんばんは。ナイトゲームズ東京、男子棒高跳び決勝です。', 'A', { pri: 3, dur: 4 }, this.t);
    this.commentary.line('今夜は風もなく、いい条件ですね。', 'B', { pri: 3, dur: 3.5 }, this.t);
  }

  // ------------------------------------------------------------------
  frame(now) {
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    this.gov.sample(realDt);
    this.input.pollPad();
    if ((this.input.wasPressed('Escape') || this.input.wasPressed('KeyP') || this.input.pad?.start) && this.phase === 'live') this.setPaused(!this.paused);
    if (this.input.wasPressed('KeyM')) document.getElementById('muteBtn').dispatchEvent(new Event('pointerdown'));
    if (!this.paused) for (let i = 0; i < this.fast; i++) this.update(realDt, i === this.fast - 1);
    this.jsMs = performance.now() - t0;
    this.render(realDt);
    this.input.endFrame();
  }

  update(dt, lastSub) {
    this.time += dt;
    this.phaseT += dt;
    const input = this.input;
    if (this.phase === 'title') {
      if (input.wasPressed('Space') || input.wasPressed('Enter')) this.start();
      this.cam.yawT = -2.0 + Math.sin(this.time * 0.07) * 0.8;
      this.cam.pitchT = 0.06 + Math.sin(this.time * 0.05) * 0.06;
      // タイトルの間は放送の時刻を進めない（試技・物語の拍を先に消費しない）。会場の空気だけ
      this.comp.update(0, dt);
      this.specials.update(0, dt, this.npcCtx(0));
      this.birds.update(0, dt);
      this.sky.update(dt, 0, this.camera);
      this.crowd.update(dt);
      this.stadium.update(dt, this.time);
      this.cam.update(dt);
      this.cam.apply();
      this.audioTick(dt);
      return;
    }
    if (this.phase === 'live') this.updateLive(dt, lastSub);
    else if (this.phase === 'offair') this.updateOffAir(dt);
    else if (this.phase === 'epilogue') this.updateEpilogue(dt);
    else if (this.phase === 'result') {
      if (input.wasPressed('Space') && this.phaseT > 1.5) this.retry();
      this.camera.position.set(Math.cos(this.time * 0.05) * 90, 40, Math.sin(this.time * 0.05) * 90);
      this.camera.lookAt(0, 4, 0);
      if (this.camera.fov !== 50) {
        this.camera.fov = 50;
        this.camera.updateProjectionMatrix();
      }
      this.post.set({ focus: 90, zoom: 1, time: this.time });
    }
    this.hud.update(dt);
    this.commentary.update(dt);
  }

  // 世界（競技・物語・観客・空）を時刻 t まで進める
  updateWorld(dt, tOverride = null) {
    const t = tOverride ?? this.t;
    this.comp.update(t, dt);
    const ctx = this.npcCtx(t);
    this.stories.update(t, dt, ctx);
    this.specials.update(t, dt, ctx);
    this.birds.update(t, dt);
    this.sky.update(dt, t, this.camera);
    this.crowd.update(dt);
    this.stadium.update(dt, this.time);
    this.updateEvents(t, dt);
    // 手拍子（儀式で求められた）
    if (this.clapAt && t >= this.clapAt.t && !this.clapAt.started) {
      this.clapAt.started = true;
      this.crowd.set([...this.blocks.main, ...this.blocks.back, ...this.blocks.curve], POSE.CLAP, { spread: 0.6, stagger: 0.2 });
      this.pva.startClap(t, this.clapAt.until);
    }
  }

  npcCtx(t) {
    const a = this.comp.activeAt(t);
    const focus = a ? this.comp.vaulters[a.id].fig.headWorld(new THREE.Vector3()) : new THREE.Vector3(BAR.x, 3, RUNWAY.z);
    return {
      camera: this.camera,
      camForward: this.camera.getWorldDirection(new THREE.Vector3()),
      fovRad: THREE.MathUtils.degToRad(this.camera.fov),
      focusPoint: focus,
      barPoint: new THREE.Vector3(BAR.x, this.comp.barHeight, RUNWAY.z),
      cameraPos: this.camera.position.clone(),
      moonPoint: this.sky.moon.position.clone(),
      birdPoint: this.birds.pair[0].visible ? this.birds.center(new THREE.Vector3()) : null,
      screenPoint: new THREE.Vector3(SCREEN.x, SCREEN.y, SCREEN.z),
      athleteHead: (id) => this.comp.vaulters[id]?.fig.headWorld(new THREE.Vector3()),
    };
  }

  // 出来事: ウェーブ・照明のちらつき・猫
  updateEvents(t, dt) {
    const ev = this.events;
    if (ev.wave && t >= ev.wave.start && !this._waveDone) {
      this._waveDone = true;
      this.crowd.startWave({ from: 0.35, lapSeconds: 20, laps: 1.5, width: 0.022 });
    }
    if (ev.flicker) {
      const k = t - ev.flicker.start;
      this.flickerOn = k > 0 && k < 2.6;
      const m = this.stadium.towerLampMat;
      const on = !this.flickerOn || Math.sin(k * 37) * Math.sin(k * 13) > 0.1;
      m.color.setScalar(on ? 7 : 0.4);
      this.backLight.intensity = on ? 1.5 : 0.6;
    }
    if (this.cat) {
      const k = (t - ev.cat.start) / 26;
      if (k > 0 && k < 1) {
        this.cat.count = 1;
        const from = new THREE.Vector3(-14, 0, 33);
        const to = new THREE.Vector3(34, 0, 16);
        const p = from.clone().lerp(to, k);
        p.z += Math.sin(k * 9) * 1.5;
        // 途中で座って毛づくろい
        const sit = k > 0.42 && k < 0.6;
        if (!sit || !this.catPos) this.catPos = p;
        const dir = to.clone().sub(from).normalize();
        const m = new THREE.Matrix4().compose(this.catPos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dir.x, -dir.z)), new THREE.Vector3(1.2, 1.2, 1.2));
        this.cat.setMatrixAt(0, m);
        this.cat.instanceMatrix.needsUpdate = true;
        const an = this.cat.geometry.attributes.iAnim;
        an.setXYZ(0, t * 9, sit ? 0 : 1, 0);
        an.needsUpdate = true;
      } else this.cat.count = 0;
    }
    void dt;
  }

  judgeCtx(items) {
    return {
      t: this.t,
      comp: this.comp,
      sky: this.sky,
      birds: this.birds,
      stories: this.stories,
      cam: this.cam,
      shake: clamp((this.cam.panSpeed - 0.35) / 1.4, 0, 1) * clamp(this.cam.zoom / 4, 0.3, 1),
      allSubjects: this.subjects.list,
      storyAi: (id) => this.stories.storyById(id)?.ai,
      items,
    };
  }

  updateLive(dt, lastSub) {
    const input = this.input;
    this.t += this.params.has('hold') ? 0 : dt;
    const t = this.t;
    // ---- 放送開始（0:00〜0:15）
    this.opening(t);
    // ---- 操作
    if (this.auto) this.autopilot(dt);
    else this.controlCamera(dt);
    if (this.devAim) {
      this.cam.aimAt(this.devAim);
      this.cam.pullFocus(this.devAim.distanceTo(this.cam.pos), true);
    }
    if (this.devRole) {
      const r = this.devRole.role;
      const p = r.startsWith('athlete:') ? this.comp.vaulters[r.slice(8)].fig.hipsWorld(new THREE.Vector3()) : r === 'moon' ? this.sky.moon.position.clone() : r === 'birds' ? this.birds.center(new THREE.Vector3()) : this.stories.roles[r]?.fig.headWorld(new THREE.Vector3()).add(new THREE.Vector3(0, -0.2, 0));
      if (p) {
        this.cam.aimAt(p);
        const dist = p.distanceTo(this.cam.pos);
        this.cam.zoomT = clamp((2 * dist * Math.tan(THREE.MathUtils.degToRad(this.cam.baseFov) / 2) * this.devRole.frame) / 1.6, 1, 50);
        this.cam.pullFocus(dist, true);
      }
    }
    this.updateWorld(dt);
    this.cam.update(dt);
    this.cam.apply();
    // ---- 画面の分析（何が映っているか）
    const items = this.subjects.frame(this.camera, this.cam, t);
    this.items = items;
    this.judge.tick(dt, items, this.judgeCtx(items));
    // AF: 中央の被写体へゆっくり（ロック中はロックが優先）
    if (!this.locked && !this.devAim) {
      this.afT = (this.afT ?? 0) - dt;
      if (this.afT <= 0) {
        this.afT = 0.2;
        const d = this.centerDistance();
        if (Math.abs(Math.log(d / this.cam.focusT)) > 0.04) this.cam.pullFocus(d, false);
      }
    }
    this.updateLock(dt, items);
    // ---- SHOT
    this.shotCool -= dt;
    const shotPressed = input.wasPressed('Space') || input.pad?.shot || this.autoShot;
    this.autoShot = false;
    if (shotPressed && this.shotCool <= 0 && t > 0.5) {
      this.shotCool = 0.6;
      this.capture = { lock: false };
      this.pva.shutter();
      this.post.flash = 0.35;
    }
    if (input.pad?.lock) this.onLockClick();
    if (input.pad?.focus) this.onFocusClick();
    // ---- 実況（カメラが何を映しているか）・客席の声（指向性マイク）
    const a = this.comp.activeAt(t);
    const av = a ? this.comp.vaulters[a.id] : null;
    if (this.judge.onAir) this.commentary.onCamera(t, dt, { main: this.judge.main, shotPhase: av?.phase?.name, judge: this.judge, active: !!a });
    this.overheard(items);
    this.footsteps(a, av);
    // ---- 画面
    if (lastSub) {
      this.hud.viewfinder(this.cam, t, this.judge.shots.length, this.locked ? 'LOCK' : this.afFlash > 0 ? 'AF*' : 'AF');
      const main = this.judge.main;
      this.hud.focusOk(!main || main.sharp > 0.6);
      if (this.judge.onAir) this.hud.stats(this.judge, t, true);
      this.updateLower(a, items);
    }
    this.afFlash = Math.max(0, (this.afFlash ?? 0) - dt);
    this.mutterCool -= dt;
    this.audioTick(dt);
    // ---- 終わり
    if (t >= END_T) this.offAir();
    if (this.debug && lastSub) this.updateDev(dt);
  }

  opening(t, silent = false) {
    const o = (this.op ??= new Set());
    const at = (k, time, fn) => {
      if (t >= time && !o.has(k)) {
        o.add(k);
        if (!silent || k === 'onair') fn();
      }
    };
    at('m1', 0.6, () => this.hud.say('今月ちょっと厳しいんだよな。', 3.4));
    at('tip', 1.2, () => this.hud.cue('', { small: this.touch ? 'ドラッグ: カメラ ・ ピンチ: ズーム ・ SHOT で撮影' : 'マウス: カメラ ・ ホイール: ズーム ・ SPACE: SHOT ・ 左クリック: ロック', dur: 7 }));
    at('m2', 4.2, () => this.hud.say('今日、数字取れないとまずい。', 3.4));
    at('m3', 7.8, () => this.hud.say('頼むから何か起きてくれ。', 3.2));
    at('d1', 9.4, () => this.commentary.line('本番 5 秒前。', 'D', { pri: 4, dur: 1.4 }, t));
    at('d2', 10.6, () => this.commentary.line('4、3……', 'D', { pri: 4, dur: 1.6 }, t));
    at('onair', ON_AIR, () => this.goOnAir(silent));
  }

  // 撮っている人の声（指向性マイク）: 物語の say を、十分に寄っている時だけ
  overheard(items) {
    for (const it of items) {
      const n = it.s.npc;
      if (!n?.beat || it.frac < 0.07) continue;
      const bt = n.beat;
      if (bt.say && !this.heard.has(bt)) {
        this.heard.add(bt);
        this.hud.sub(bt.say, 'voice', 3.2);
      }
      if (bt.cm && !this.heard.has(`${bt.at}cm`)) {
        this.heard.add(`${bt.at}cm`);
        this.commentary.line(bt.cm, 'A', { pri: 2 }, this.t);
      }
    }
  }

  footsteps(a, v) {
    if (!a || !v || v.phase.name !== 'run') return;
    const x = v.fig.root.position.x;
    const step = Math.floor((x - RUNWAY.start) / 1.86);
    if (step !== this._step) {
      this._step = step;
      this.pva.step(v.fig.hipsWorld(new THREE.Vector3()), this.cam, v.phase.speed ?? 6);
    }
  }

  // 下の帯（選手の名前・高さ・記録）: 選手が画面にいる時
  updateLower(a, items) {
    let info = null;
    const it = items.find((q) => q.s.kind === 'athlete' && q.frac > 0.06);
    if (it) {
      const ath = it.s.vaulter.info;
      const at = a && a.id === ath.id ? a : null;
      info = { name: ath.name, nat: ath.nat, height: at ? `${at.height.toFixed(2)}m` : `BEST ${this.comp.bestOf(ath.id).toFixed(2)}m`, marks: this.comp.marksText(ath.id).split('  ').slice(-3).join('  ') };
    }
    this.hud.lower(info);
  }

  updateLock(dt, items) {
    const s = this.locked;
    if (!s) return;
    this.lockT += dt;
    const it = items.find((q) => q.s === s);
    if (!it) {
      this.lockLost += dt;
      if (this.lockLost > 1.5) this.unlock();
      else {
        const p = s.pos(_v).project(this.camera);
        this.hud.lock(((clamp(p.x, -1, 1) + 1) / 2) * innerWidth, ((1 - clamp(p.y, -1, 1)) / 2) * innerHeight, 60, 'LOST', true);
      }
      return;
    }
    this.lockLost = 0;
    const x = ((it.ndc.x + 1) / 2) * innerWidth;
    const y = ((1 - it.ndc.y) / 2) * innerHeight;
    this.hud.lock(x, y, it.frac * innerHeight * 1.1, `LOCK ${s.label}`);
    // 一定時間ロックした映像も評価する（3 秒ごと・控えめ）
    this.lockEvalT += dt;
    if (this.lockEvalT >= 3 && it.frac > 0.05) {
      this.lockEvalT = 0;
      this.capture = { lock: true };
    }
  }

  controlCamera(dt) {
    const input = this.input;
    const m = input.consumeMouse();
    const H = innerHeight;
    const fast = input.down_('ShiftLeft') || input.down_('ShiftRight') || !!input.pad?.fast;
    if (m.dx || m.dy) this.cam.push(m.dx, m.dy, H, fast);
    if (m.wheel) this.cam.zoomBy(Math.exp(-m.wheel * 0.0016));
    if (m.pinch !== 1) this.cam.zoomBy(m.pinch);
    let kx = 0;
    let ky = 0;
    if (input.down_('ArrowLeft') || input.down_('KeyA')) kx -= 1;
    if (input.down_('ArrowRight') || input.down_('KeyD')) kx += 1;
    if (input.down_('ArrowUp') || input.down_('KeyW')) ky += 1;
    if (input.down_('ArrowDown') || input.down_('KeyS')) ky -= 1;
    const pad = input.pad;
    if (pad) {
      kx += pad.lx;
      ky -= pad.ly;
    }
    if (kx || ky) this.cam.stick(kx, ky, dt, fast);
    let zr = this.touchZoom ?? 0;
    if (input.down_('KeyE')) zr += 1;
    if (input.down_('KeyQ')) zr -= 1;
    if (pad) zr += -pad.ry + pad.rt - pad.lt;
    if (zr) this.cam.zoomBy(Math.exp(zr * 1.6 * dt));
    this.cam.setWide(input.down_('KeyR') || !!pad?.wide || !!this.touchWide);
  }

  audioTick(dt) {
    const t = this.phase === 'title' ? 0 : this.t;
    const a = this.comp.activeAt(t);
    const hush = a?.final && t > a.t0 + 2 && t < a.tTO ? 1 : 0;
    const standing = this.crowd.current(this.blocks.main[2] ?? 0)[0];
    const bpos = this.birds.pair[0].visible ? this.birds.center(new THREE.Vector3()) : null;
    let birdsNear = false;
    if (bpos) {
      const off = this.cam.offsetTo(bpos);
      birdsNear = off.dist < 200 && Math.abs(off.dyaw) < this.cam.fovRad;
    }
    this.pva.update(dt, { cam: this.cam, excite: clamp(0.22 + standing * 0.55, 0, 1), hush, t, birdPos: bpos, birdsNear });
  }

  // ------------------------------------------------------------------
  // SHOT の処理（描画の直後に呼ぶ: キャンバスの画像を読む）
  processCapture() {
    const c = this.capture;
    this.capture = null;
    const src = this.renderer.domElement;
    let feats = null;
    try {
      const g = this.anaCanvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(src, 0, 0, this.anaCanvas.width, this.anaCanvas.height);
      const d = g.getImageData(0, 0, this.anaCanvas.width, this.anaCanvas.height).data;
      feats = analyzePixels(d, this.anaCanvas.width, this.anaCanvas.height);
      const tg = this.thumbCanvas.getContext('2d');
      tg.drawImage(src, 0, 0, this.thumbCanvas.width, this.thumbCanvas.height);
    } catch {
      feats = null;
    }
    const items = this.items ?? [];
    const shot = this.judge.evaluate(items, this.judgeCtx(items), feats, { lock: c.lock });
    const cap = this.captureStories(shot, items);
    if (c.lock && !cap?.isNew) {
      if (shot.points > 0) this.hud.pop('LOCK', shot.points);
      return;
    }
    try {
      shot.thumb = this.thumbCanvas.toDataURL('image/jpeg', 0.72);
    } catch {
      shot.thumb = null;
    }
    if (c.lock) {
      this.hud.pop(`LOCK・${shot.label}`, shot.points);
      return;
    }
    this.hud.judge(shot, this.thumbCanvas);
    shot.lines.forEach((_, i) => setTimeout(() => this.pva.aiBlip(i), 120 + i * 170));
    // 内訳のポップ（大きいもの 2 つ）
    const names = { sport: 'SPORT', composition: 'COMPOSITION', timing: 'TIMING', emotion: 'EMOTION', story: 'STORY', beauty: 'BEAUTY', rarity: 'RARITY', unexpected: 'UNEXPECTED' };
    Object.entries(shot.V)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .forEach(([k, v]) => this.hud.pop(k === 'sport' ? shot.label : names[k], v));
    if (shot.master) {
      this.hud.cue(shot.master === 2 ? 'MIRACLE SHOT' : 'MASTER SHOT', { cls: 'y', small: 'AI CAMERA JUDGE', dur: 2.4 });
      this.pva.master();
    }
    if (this.judge.spike > 0) this.pva.smallCheer();
    this.commentary.onShot(shot, this.t);
  }

  // 物語を撮った（エピローグの材料）
  captureStories(shot, items) {
    let cap = null;
    if (shot.story?.npc) cap = this.stories.capture(shot.story.npc, shot);
    else if (shot.story?.story) cap = this.stories.capture(shot.story.story, shot);
    for (const it of items) {
      const n = it.s.npc;
      if (n?.story && n.beat && it.frac > 0.05 && n !== shot.story?.npc) this.stories.capture(n, { ...shot, points: shot.points * 0.3 });
    }
    if (items.some((it) => it.s.kind === 'birds' && it.frac > 0.004)) this.stories.capture('birds', shot);
    if (shot.lines.includes('MOON DETECTED') && shot.V.beauty >= 300) this.stories.capture('sky', shot);
    for (const k of ['meteor', 'plane', 'cat', 'wave', 'flicker']) {
      const ev = this.events[k];
      if (ev && items.some((it) => it.s.kind === k)) this.stories.capture(ev.id, shot);
    }
    return cap;
  }

  // ------------------------------------------------------------------
  offAir() {
    this.setPhase('offair');
    this.judge.onAir = false;
    this.unlock();
    this.input.exitLock();
    this.input.enabled = false;
    this.hud.tally('off');
    this.hud.cue('OFF AIR', { small: 'BROADCAST ENDED', dur: 2 });
    this.commentary.line('はい、お疲れさまー。', 'D', { pri: 5, dur: 2.5 }, this.t);
    this.judge.storyCount = [...this.stories.captured.keys()].filter((k) => !['sky', 'birds'].includes(k)).length;
    setTimeout(() => this.hud.say(lastWords(this.judge.average), 3), 900);
  }

  updateOffAir(dt) {
    this.t += dt;
    this.updateWorld(dt);
    this.cam.update(dt);
    this.cam.apply();
    this.audioTick(dt);
    if (this.phaseT > 1.8) this.hud.fade(true);
    if (this.phaseT > 3.2) {
      this.hud.showLive(false);
      this.hud.showVF(false);
      this.hud.lower(null);
      document.getElementById('judge').classList.add('hidden');
      this.epilogue.build();
      this.setPhase('epilogue');
      document.getElementById('epi').classList.remove('hidden');
      this.epilogue.start();
      setTimeout(() => this.hud.fade(false), 200);
    }
  }

  updateEpilogue(dt) {
    const ctx = this.npcCtx(this.t);
    this.specials.update(this.t, dt, ctx);
    this.sky.update(dt, this.t, this.camera);
    this.crowd.update(dt);
    this.stadium.update(dt, this.time);
    this.epilogue.update(dt);
    if (this.input.wasPressed('Space') || this.input.wasPressed('Enter')) this.epilogue.skip();
    this.pva.update(dt, { cam: null, excite: 0.12, hush: 0.6, t: this.t });
    if (this.epilogue.done) this.showResult();
  }

  showResult() {
    this.setPhase('result');
    document.getElementById('epi').classList.add('hidden');
    const el = document.getElementById('result');
    el.innerHTML = buildResult(this);
    el.classList.remove('hidden');
  }

  // ------------------------------------------------------------------
  // 自動操縦（スモークテスト・デモ）: 試技の時は選手を、物語の山場ではその人を、ときどき月を撮る
  autopilot(dt) {
    const t = this.t;
    const a = this.comp.activeAt(t);
    let target = null;
    let frame = 0.3;
    let moon = false;
    const story = this.specials.list.filter((n) => n.beat && n.interest >= 0.8).sort((x, y) => y.interest - x.interest)[0];
    const v = a ? this.comp.vaulters[a.id] : null;
    const ph = v?.phase?.name;
    if (v && ['run', 'plant', 'rise', 'invert', 'push', 'clear', 'fall', 'land'].includes(ph)) {
      target = v.fig.hipsWorld(new THREE.Vector3());
      frame = ph === 'run' ? 0.3 : 0.45;
      if (['rise', 'invert', 'push', 'clear'].includes(ph) && t > 150 && this.sky.moonVisible) {
        target = new THREE.Vector3(BAR.x, this.comp.barHeight + 1.2, RUNWAY.z);
        frame = 0.1;
      }
    } else if (story && Math.floor(t / 7) % 2 === 0) {
      target = story.fig.headWorld(new THREE.Vector3());
      frame = 0.35;
    } else if (Math.floor(t / 11) % 5 === 2) {
      target = this.sky.moon.position.clone();
      moon = true;
    } else if (v) {
      target = v.fig.headWorld(new THREE.Vector3());
      frame = 0.4;
    } else {
      target = this.stories.roles.judgeChief.fig.headWorld(new THREE.Vector3());
      frame = 0.3;
    }
    this.cam.aimAt(target);
    const dist = target.distanceTo(this.cam.pos);
    // 被写体（約 1.8m）が画面の縦の frame を占める倍率
    const want = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.cam.baseFov) / 2) * frame) / 1.8;
    this.cam.zoomT = clamp(moon ? 6 : want, 1, 40);
    this.autoShotT = (this.autoShotT ?? 0) - dt;
    const key = ph === 'clear' && v.phase.apex;
    if (this.autoShotT <= 0 || (key && this.autoShotT < 2)) {
      this.autoShot = true;
      this.autoShotT = 3.5 + this.rng.next() * 3;
    }
  }

  // ------------------------------------------------------------------
  render(dt) {
    if (this.noRender) {
      if (this.capture) this.processCaptureNoRender();
      return;
    }
    const size = this.renderer.getDrawingBufferSize(this._size ?? (this._size = new THREE.Vector2()));
    this.renderer.info.reset();
    this.field.update(this.camera, size.y);
    if (this.phase === 'live' || this.phase === 'offair' || this.phase === 'title') {
      const c = this.cam;
      const pxPerRad = size.y / c.fovRad;
      this.post.set({ focus: c.focus, zoom: c.zoom, smearX: clamp(-c.yawV * pxPerRad * 0.012, -18, 18), smearY: clamp(c.pitchV * pxPerRad * 0.012, -18, 18), time: this.time });
    }
    this.post.render(dt);
    if (this.capture) this.processCapture();
  }

  processCaptureNoRender() {
    const c = this.capture;
    this.capture = null;
    const items = this.items ?? [];
    const shot = this.judge.evaluate(items, this.judgeCtx(items), null, { lock: c.lock });
    this.captureStories(shot, items);
  }

  updateDev(dt) {
    this.devT = (this.devT ?? 0) - dt;
    if (this.devT > 0) return;
    this.devT = 0.5;
    const r = this.renderer.info;
    const el = document.getElementById('dev');
    el.classList.remove('hidden');
    const j = this.judge;
    el.textContent = [
      `FPS ${this.gov.fps.toFixed(0)}  ${this.gov.q.name}  PR ${this.renderer.getPixelRatio().toFixed(2)}`,
      `draw ${r.render.calls}  tris ${(r.render.triangles / 1000).toFixed(0)}k  JS ${this.jsMs?.toFixed(2)}ms`,
      `crowd ${this.layout.count.toLocaleString('en-US')}  near3D ${this.near.count}  special ${this.specials.list.length}`,
      `t ${this.t.toFixed(1)}  zoom ${this.cam.zoom.toFixed(1)}  focus ${this.cam.focus.toFixed(1)}  q ${j.q.toFixed(2)}  v ${j.v.toFixed(1)}`,
      `main ${j.main?.s.id ?? '-'}  items ${this.items?.length ?? 0}`,
      `stories ${this.stories.active.map((s) => s.id).join(',')}`,
    ].join('\n');
  }

  state() {
    const j = this.judge;
    const last = j.shots[j.shots.length - 1];
    return {
      phase: this.phase,
      t: this.t,
      fps: this.gov.fps,
      calls: this.renderer.info.render.calls,
      tris: this.renderer.info.render.triangles,
      v: j.v,
      peak: j.peak,
      avg: j.average,
      cheers: Math.round(j.cheers),
      points: j.points,
      shots: j.shots.length,
      missed: j.missed,
      stats: j.stats,
      pay: j.pay(this.phase === 'result').total,
      stories: this.stories.active.map((s) => s.id),
      captured: [...this.stories.captured.keys()],
      specials: this.specials.list.length,
      winner: this.comp.winner,
      record: this.comp.record,
      epilogue: this.epilogue.scenes?.map((s) => s.story.id),
      lastShot: last ? { ai: last.ai, pts: last.points, lines: last.lines, label: last.label } : null,
    };
  }
}
