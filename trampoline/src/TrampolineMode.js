import * as THREE from 'three';
import { EffectManager } from '../../src/fx/EffectManager.js';
import { AudioManager } from '../../src/audio/AudioManager.js';
import { CheerSystem } from '../../src/race/CheerSystem.js';
import { EventBus } from '../../src/core/EventBus.js';
import { clamp, lerp, createRng } from '../../src/core/math.js';
import { TrampolineArena } from './TrampolineArena.js';
import { TrampolineBed } from './TrampolineBed.js';
import { TrampolineController } from './TrampolineController.js';
import { TrampolineCameraDirector } from './TrampolineCameraDirector.js';
import { TrampolineInput } from './TrampolineInput.js';
import { TrampolineTime } from './TrampolineTime.js';
import { TrampolineTyping, WORDS } from './TrampolineTyping.js';
import { TrampolineScoring } from './TrampolineScoring.js';
import { TrampolineJudges } from './TrampolineJudges.js';
import { TrampolineHUD } from './TrampolineHUD.js';
import { TrampolineAudio } from './TrampolineAudio.js';
import { PHYS } from './TrampolinePhysics.js';
import { TrampolineEventDirector } from './TrampolineEventDirector.js';
import { EFFECTS } from './TrampolineEffects.js';
import { EVENTS } from './data/events.js';
import { TrampolineBackground } from './TrampolineBackground.js';
import { TrampolineSky } from './TrampolineSky.js';
import { TrampolineGhosts } from './TrampolineGhosts.js';
import { TrampolineDrama } from './TrampolineDrama.js';
import { TrampolineSkyJump, BASE, PEAK } from './TrampolineSkyJump.js';
import { BED } from './TrampolinePhysics.js';

// 『トランポリン、なのに。』のモード本体（状態の流れとループ）。
//
//   intro → ready → bounce（小さく弾む。SPACE で踏み込み）→ air（スロー + タイピング）→ landed → result → 次の試技
//   10 回の試技のあと final。
//   天井 OPEN 後: bounce → super（超反発 10m → 30m → 50m）→ sky（空の旅）→ return（会場へ落ちてくる）→ landed
//
// 「なのに」の演出はすべて data/events.js（表）→ TrampolineEventDirector（いつ起こすか）→ TrampolineEffects（中身）。
// このファイルは「今、跳んだ / 打ち終えた / 落ち始めた / 着地した」を司令塔へ伝えるだけ。
// テンポ（level）: 試技 1〜2 普通 → 3〜4 少し変 → 5〜6 かなり変 → 7〜 意味不明（→ 天井 OPEN → 空）
//
// 時間は 2 つ（TrampolineTime）: 世界の時間 gameDt（スロー・ヒットストップ）と UI の時間 realDt。
// 選手・ベッド・観客は gameDt、カメラ・タイピング・HUD は realDt で動く。

export const ATTEMPTS = 10;
const TAU = Math.PI * 2;

// 何もしない時の弾み（ウォームアップで少しずつ高く）
const WARMUP = [0.7, 1.1, 1.5, 1.8];
// 天井 OPEN 後の超反発（m）。最後の 1 回で屋根より高く → 空へ
const SUPER = [10, 30, 50, 160];
const SUPER_CALL = ['10 メートル。', '30 メートル。', '50 メートル……屋根の高さを超えています。', ''];

// 試技ごとの実況（真面目）
const CALLS = [
  '第{n}試技。侍、ベッドに入ります。',
  '第{n}試技です。会場が静まります。',
  '第{n}試技。集中しています。',
  '第{n}試技。審判団が見守ります。',
];

// 空の上の練習（URL で試技・イベントを指定）: ?attempt=5 など
export class TrampolineMode {
  constructor(canvas) {
    this.canvas = canvas;
    this.params = new URLSearchParams(location.search);
    this.seed = +(this.params.get('seed') ?? Math.floor(Math.random() * 1e6));
    this.rng = createRng(this.seed);
    this.auto = this.params.has('auto');
    this.fast = +(this.params.get('fast') ?? 1);
    this.phase = 'intro';
    this.phaseT = 0;
    this.attempt = 0;
  }

  async init() {
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
    const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.quality = { crowd3d: isTouch ? 700 : 1400 };

    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 2400);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060f);
    scene.fog = new THREE.Fog(0x0a0c1e, 90, 700);
    this.scene = scene;

    this.bus = new EventBus();
    this.arena = new TrampolineArena(scene, this.quality);
    this.bed = new TrampolineBed(this.arena.group);
    this.athlete = new TrampolineController(scene);
    this.judges = new TrampolineJudges(this.arena.group);
    this.cam = new TrampolineCameraDirector(this.camera);
    this.cam.judgePoint.copy(this.judges.center);
    this.time = new TrampolineTime();
    this.typing = new TrampolineTyping(this.seed + 7);
    this.scoring = new TrampolineScoring(ATTEMPTS);
    this.cheer = new CheerSystem(this.bus);
    this.hud = new TrampolineHUD();
    this.input = new TrampolineInput(document.getElementById('ui'));
    this.audio = new AudioManager(this.bus);
    this.sfx = new TrampolineAudio(this.audio);
    if (this.params.has('mute')) this.audio.setMuted(true);

    // EffectManager（1500m のポストエフェクト・パーティクル）: コースは無いので、道の代わりの簡単な座標変換を渡す
    const path = { toWorld: (s, x, y, out) => out.set(x, y, -s), sample: () => ({ x: 0, z: 0, theta: 0, cos: 1, sin: 0 }) };
    this.fxPlayer = { s: 0, x: 0, y: 0, dashing: false, boostTimer: 0, grounded: true };
    this.fx = new EffectManager(renderer, scene, this.camera, path);

    // world: 会場まるごと（空の旅ではこれを縮めて下げる）。選手・背景・空は world の外
    this.world = new THREE.Group();
    scene.add(this.world);
    this.world.add(this.arena.group, this.arena.ground);
    this.skyJump = new TrampolineSkyJump(this.world, this.arena, this.rng);
    this.sky = new TrampolineSky(scene);
    this.bg = new TrampolineBackground(scene, this.arena, this.rng);
    this.ghosts = new TrampolineGhosts(scene, this.athlete, isTouch ? 3 : 4);
    this.drama = new TrampolineDrama(scene, this.arena, this.fx);
    this.director = new TrampolineEventDirector(this, EVENTS, EFFECTS);

    this.scoring.onAdd((item) => this.onScore(item));
    this.bindUI();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    if (this.params.has('debug') || this.auto) window.__tramp = this;

    this.toIntro();
    this.last = performance.now();
    renderer.setAnimationLoop((now) => this.frame(now));
    if (this.auto) setTimeout(() => this.startGame(), 400);
  }

  bindUI() {
    const fromMain = location.hash === '#from-main';
    document.querySelectorAll('.back-btn, .f-back').forEach((b) => b.classList.toggle('hidden', !fromMain));
    // ポーズ中も 42.195km のタイトルへ戻れる
    document.getElementById('back').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.backToMain();
    });
    document.getElementById('final').addEventListener('pointerdown', (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'retry') this.startGame();
      else if (a === 'back') this.backToMain();
    });
    document.getElementById('muteBtn').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.audio.init();
      const m = this.audio.toggleMute();
      e.currentTarget.classList.toggle('off', m);
    });
    document.getElementById('pause').addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-action="back"]')) return this.backToMain();
      this.setPaused(false);
    });
    const wake = () => this.audio.init();
    window.addEventListener('keydown', wake);
    window.addEventListener('pointerdown', wake);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase !== 'intro' && this.phase !== 'final') this.setPaused(true);
    });
  }

  // 42.195km、なのに。のタイトルから来た時（#from-main）だけ戻れる
  backToMain() {
    if (history.length > 1) history.back();
    else location.href = '../index.html';
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.resize(w, h);
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause').classList.toggle('hidden', !p);
  }

  setPhase(p) {
    this.phase = p;
    this.phaseT = 0;
    document.body.dataset.phase = p;
  }

  // ------------------------------------------------------------------
  // 流れ
  // ------------------------------------------------------------------
  toIntro() {
    this.setPhase('intro');
    this.hud.show(false);
    this.cam.set('INTRO', { cut: true });
    document.getElementById('intro').classList.remove('hidden');
    this.hud.hideFinal();
    this.audio.setMusic('title');
  }

  startGame() {
    document.getElementById('intro').classList.add('hidden');
    this.hud.hideFinal();
    this.hud.hideResult();
    this.hud.clearFeed();
    this.hud.show(true);
    this.audio.init();
    this.audio.setMusic(null);
    this.audio.cheerSwell(1.5);
    this.scoring.reset();
    this.scoring.onAdd((item) => this.onScore(item));
    this.cheer.reset();
    this.director.reset();
    this.dramaSeen = new Set();
    for (const id of (this.params.get('event') ?? '').split(',').filter(Boolean)) this.director.force(id);
    this.hud.setTotal(0);
    this.attempt = +(this.params.get('attempt') ?? 1) - 1;
    this.nextAttempt();
  }

  nextAttempt() {
    this.hud.hideResult();
    this.judges.hide();
    this.director.clear();
    this.bg.clearJump();
    this.attempt++;
    if (this.attempt > ATTEMPTS) return this.toFinal();
    this.setPhase('ready');
    this.scoring.begin();
    this.director.beginJump();
    this.hud.setAttempt(this.attempt, ATTEMPTS);
    this.hud.setStats({ height: 0, rotation: 0, landing: '-', score: 0 });
    this.arena.drawBoard({ name: 'SAMURAI  JPN', attempt: this.attempt, of: ATTEMPTS, last: this.scoring.history.at(-1)?.sum ?? 0, total: this.scoring.total });
    this.hud.comment(CALLS[(this.attempt - 1) % CALLS.length].replace('{n}', this.attempt), 2.6);
    // 試技の前は中継らしく、ときどき別の角度から
    this.cam.set(this.attempt % 3 === 0 ? 'JUDGE' : this.attempt % 3 === 1 ? 'WIDE' : 'HIGH', { dur: 1.1 });
    this.superStage = 0;
    this.director.moment('attempt'); // 天井 OPEN はここ
    this.warm = 0;
    this.athlete.physics.setNextApex(WARMUP[0]);
    this.stompArmed = false;
    this.stompFired = false;
    this.bounceT = 0;
    this.landing = '-';
    this.air = null;
  }

  toFinal() {
    this.setPhase('final');
    this.hud.hideWord();
    this.hud.meter(false);
    this.cam.set('INTRO', { dur: 2 });
    this.audio.setMusic('stadium');
    this.audio.applause();
    this.arena.drawBoard({ name: 'SAMURAI  JPN', attempt: ATTEMPTS, of: ATTEMPTS, last: this.scoring.history.at(-1)?.sum ?? 0, total: this.scoring.total, note: 'FINAL' });
    this.hud.showFinal(this.scoring, { note: '最後まで、トランポリンの採点でした。' });
  }

  // ------------------------------------------------------------------
  // 踏み込み
  // ------------------------------------------------------------------
  // タイミングの良さ（0〜1）: ベッドに着く瞬間〜沈んでいる間に押すほど良い
  stompQuality() {
    const ph = this.athlete.physics;
    if (!ph.contact) {
      if (ph.vy > 0) return 0.2; // 上っている途中（早すぎ）
      return clamp(1 - ph.timeToLand() / 0.5, 0.25, 1);
    }
    if (ph.vy < 0) return clamp(1 - this.contactT / 0.28, 0.4, 1); // 沈んでいる途中
    return 0.3; // 戻り始めてから（遅い）→ 次に沈んだ時に踏む
  }

  armStomp(q) {
    if (this.stompArmed || this.stompFired) return;
    this.stompArmed = true;
    this.stompQ = q;
  }

  // ベッドの底で踏み込みが決まった
  fireStomp() {
    const ph = this.athlete.physics;
    const q = this.stompQ;
    this.stompArmed = false;
    this.stompFired = true;
    // 天井が開いたあとは、どんな踏み込みでも超反発（10m から）
    const apex = this.skyReady ? SUPER[0] : lerp(3.2, 8.4, Math.pow(q, 0.8));
    ph.launchV = Math.sqrt(2 * PHYS.g * apex);
    this.time.hit(0.06 + q * 0.07);
    this.cam.shake(0.35 + q * 0.5);
    this.sfx.stomp(q);
    this.bed.flash(0.8 + q);
    this.fx.flash(0.08 + q * 0.12);
    this.cheer.hype(0.05 + q * 0.12);
    this.hud.meter(false);
    this.stompLabel = q > 0.85 ? 'PERFECT' : q > 0.6 ? 'GOOD' : 'EARLY / LATE';
  }

  // ------------------------------------------------------------------
  // 空中
  // ------------------------------------------------------------------
  beginAir(ev) {
    this.setPhase('air');
    const ph = this.athlete.physics;
    const q = this.stompQ ?? 0.5;
    const apex = ev.apex;
    // スローの強さ: 「ゆっくりな部分」が実時間で budget 秒になるように決める（= 入力できる時間）
    const tUp = ev.v / PHYS.g;
    const tFall = Math.sqrt((2 * 0.6 * apex) / PHYS.g);
    const budget = lerp(4.2, 6.8, q) * (this.input.isTouch ? 1.35 : 1); // スマホはボタンで打つので少し長く
    const slow = clamp((tUp + tFall) / budget, 0.06, 0.3);
    this.air = { apex, maxH: 0, q, slow, slowMul: 1, descent: false, t: 0, faceT: 1.05, wordAt: -9 };
    this.time.to(slow, 9);
    this.cam.set('FACE', { cut: true });
    this.sfx.whoosh(1);
    this.sfx.ooh(1 + q);
    this.typing.begin(Math.min(2, this.level), this.time.real, this.firstWord());
    this.athlete.setTargets({ flip: 0, twist: 0, spin: 0 });
    // 背景の予定（この跳躍の間のどこかで、勝手に起きる）。見せ場の保証が要る時だけ頂点に合わせる
    const force = new Set();
    for (const e of EVENTS) {
      if (e.on === 'sync' && e.guarantee && this.attempt >= e.guarantee && !this.director.seen.has(e.id) && this.level >= (e.level ?? 0)) force.add(e.kind);
    }
    for (const id of this.director.forced) if (this.director.byId[id]?.kind) force.add(this.director.byId[id].kind);
    this.bg.scheduleJump({ tApex: tUp, tLand: tUp * 2, level: this.level, force });
    this.director.beginJump();
    this.director.moment('takeoff');
    void ph;
  }

  // テンポ: 最初はちゃんとしたスポーツ → 少し変 → かなり変 → 意味不明
  get level() {
    const a = this.attempt;
    let l = a <= 2 ? 0 : a <= 4 ? 1 : a <= 6 ? 2 : 3;
    if (l < 3 && a >= 4 && this.director.count >= 20) l++; // なのにが続くと、早めに壊れていく
    return l;
  }

  // 最初の単語（最初の 2 回は練習、4 回目はバレリーナを見せる）
  firstWord() {
    if (this.attempt === 1) return 'FLIP';
    if (this.attempt === 2) return 'SPIN';
    if (this.attempt === 4 && !this.director.seen.has('BALLERINA')) return 'BALLERINA';
    if (this.attempt === 8) return 'FLIP';
    return null;
  }

  // 空中のスロー = 踏み込みで決まる基本 × 自分で打った SLOW × イベント（バレリーナ）
  applyAirScale() {
    const a = this.air;
    if (!a || this.phase !== 'air' || a.descent || a.capped) return;
    this.time.to(clamp(a.slow * a.slowMul * this.director.timeScale, 0.03, 0.3), 5);
  }

  // イベントが終わった後に戻るカメラ
  defaultShot() {
    const hold = this.director.active.find((a) => a.ev.holdCamera && a.ev.cameraMode);
    if (hold) return hold.ev.cameraMode;
    switch (this.phase) {
      case 'air':
        if (this.cam.faceLock) return 'FACE';
        return this.director.isActive('BALLERINA') ? 'ORBIT' : 'WIDE';
      case 'result':
        return 'RESULT';
      case 'super':
        return 'HIGH';
      case 'sky':
        return this.skyJump.stage === 'fall' ? 'DOWN' : 'SKY';
      case 'return':
        return 'TELE';
      case 'intro':
      case 'final':
        return 'INTRO';
      default:
        return 'WIDE';
    }
  }

  // イベントの条件に渡す「今の状況」
  eventCtx(extra) {
    const ath = this.athlete;
    const ph = ath.physics;
    const sum = this.typing.summary();
    return {
      level: this.level,
      attempt: this.attempt,
      phase: this.phase,
      airT: this.air?.t ?? 0,
      ascending: ph.vy > 0 && !ph.contact,
      height: ph.height,
      rotSpeed: ath.rotSpeed,
      visualRotSpeed: ath.rotSpeed * this.time.scale,
      timeScale: this.time.scale,
      revs: (Math.abs(ath.flip) + Math.abs(ath.twist) + Math.abs(ath.spin)) / TAU,
      attemptSum: this.scoring.attemptSum,
      failed: this.landing === 'FAIL',
      typedNothing: !sum.correct && !sum.miss,
      words: sum.words,
      eventCount: this.director.count,
      superStage: this.superStage ?? 0,
      zone: this.skyJump?.zone,
      ...extra,
    };
  }

  updateAir(realDt) {
    const a = this.air;
    const ath = this.athlete;
    const ph = ath.physics;
    a.t += realDt;
    a.maxH = Math.max(a.maxH, ph.height);
    // 顔のアップは跳んだ直後だけ → 中継のカメラへ
    if (a.faceT > 0) {
      a.faceT -= realDt;
      if (a.faceT <= 0 && this.cam.shot === 'FACE' && !this.cam.faceLock) this.cam.set(this.defaultShot(), { dur: 0.9 });
    }
    // タイピング（UI の時間で受け付ける）
    for (const ch of this.input.takeLetters()) this.typeKey(ch);
    this.autoType(realDt);
    const tg = this.typing.targets();
    ath.setTargets(tg);
    ath.setTrick(this.currentTrick());
    // 落ちてきて、頂点の 4 割まで下がったら世界の時間を戻す（着地は普通の速さで）
    if (!a.descent && ph.vy < 0 && ph.height < a.maxH * 0.4) {
      a.descent = true;
      this.time.to(1, 2.4);
      this.director.moment('descent');
    }
    // 空中が長くなりすぎたら（SLOW・HIGH・バレリーナの重ねがけ）、世界の時間を少しずつ戻す
    if (!a.capped && !a.descent && a.t > (this.director.isActive('BALLERINA') ? 9 : 7)) {
      a.capped = true;
      this.time.to(1, 1.4);
    }
    this.director.moment('air');
    this.hud.showWord(this.typing, { touch: this.input.isTouch });
  }

  currentTrick() {
    const t = this.typing;
    const ath = this.athlete;
    if (t.word && t.typed > 0) return WORDS[t.word].trick;
    // 回りきるまでは技の姿勢のまま
    if (ath.backlog > 0.15) return t.trick();
    const last = t.done[t.done.length - 1];
    if (last && (last.word === 'POSE' || last.word === 'BALLERINA') && this.time.real - (this.lastWordAt ?? 0) < 1.2) return WORDS[last.word].trick;
    return null;
  }

  typeKey(ch) {
    const r = this.typing.key(ch, this.time.real);
    if (!r) return;
    if (!r.ok) {
      this.sfx.miss();
      return;
    }
    this.sfx.letter();
    if (r.complete) this.onWord(r.word, r.fast);
  }

  // 単語を打ち終わった
  onWord(word, fast) {
    const d = WORDS[word];
    const a = this.air;
    const ph = this.athlete.physics;
    this.lastWordAt = this.time.real;
    a.wordAt = this.time.game;
    this.sfx.word(this.typing.done.length);
    this.cheer.hype(0.03);
    if (d.lift && (a.lifts = (a.lifts ?? 0) + 1) <= 2) {
      // 空中なのに、さらに上へ（1 回の跳躍で 2 回まで）
      ph.vy = Math.max(ph.vy, 0) + d.lift;
      if (a.descent) {
        a.descent = false;
        this.applyAirScale();
      }
      this.sfx.whoosh(1.2);
    }
    if (d.slow) {
      a.slowMul *= d.slow;
      this.applyAirScale();
    }
    if (d.pose) this.arena.flashStorm(0.5);
    this.director.moment('word', { word, fast });
  }

  // ------------------------------------------------------------------
  // SKY JUMP（天井 OPEN のあと）
  // ------------------------------------------------------------------
  startSky() {
    this.setPhase('sky');
    const ph = this.athlete.physics;
    ph.y = BASE + BED.top;
    ph.vy = 0;
    this.skyJump.start();
    this.bg.clearJump();
    // 会場に残っている紙吹雪・火花は消す（世界が動くので、空中に浮いて見えてしまう）
    this.fx.sparks.clear();
    this.fx.confetti.clear();
    this.bg.sparks.clear();
    this.air = { apex: PEAK, maxH: 0, q: 1, slow: 0.6, slowMul: 1, descent: false, t: 0, faceT: 0, wordAt: -9, fromSky: true };
    this.time.to(0.6, 3);
    this.typing.begin(2, this.time.real, 'FLIP');
    this.athlete.setTargets({ flip: 0, twist: 0, spin: 0 });
    this.director.moment('sky', { skyEvent: 'exit' });
    this.cam.set('TELE', { cut: true });
    this.skyShotT = 0;
    this.audio.setMusic('tension');
    this.sfx.wind(1.5);
  }

  updateSky(realDt) {
    const a = this.air;
    const sj = this.skyJump;
    a.t += realDt;
    for (const ch of this.input.takeLetters()) this.typeKey(ch);
    this.autoType(realDt);
    this.athlete.setTargets(this.typing.targets());
    this.athlete.setTrick(this.currentTrick());
    let steer = this.input.steer;
    if (this.auto && sj.stage === 'fall') steer = clamp(sj.drift.x * 0.9, -1, 1);
    const ev = sj.update(realDt, steer);
    a.maxH = Math.max(a.maxH, sj.alt);
    this.sky.setAltitude(sj.alt);
    this.hud.zone(sj.zone);
    if (ev === 'zone') this.director.moment('sky', { zone: sj.zone });
    if (ev === 'peak') {
      this.hud.comment('最高点です。', 2.4);
      this.audio.setMusic(null);
    }
    if (ev === 'fall') {
      this.hud.comment('戻ってきます。', 2.6);
      this.cam.set('DOWN', { dur: 1.2 });
      this.audio.setMusic('tension');
    }
    // 上りは横から → 超望遠 → 横から… と中継が切り替わる。帰りは真上から（帰る場所が見える）
    this.skyShotT += realDt;
    if (sj.stage === 'rise' && this.skyShotT > 3) {
      this.skyShotT = 0;
      // 超望遠は低い所だけ（高すぎると点にしか見えない）
      const next = this.cam.shot === 'SKY' && sj.alt < 3000 ? 'TELE' : 'SKY';
      if (next !== this.cam.shot) this.cam.set(next, { cut: true });
    }
    if (sj.stage === 'hang' && this.cam.shot !== 'SKY') this.cam.set('SKY', { dur: 1 });
    const falling = sj.stage === 'fall';
    this.hud.radar(falling, sj.radar().x);
    this.hud.showSteer(falling && this.input.isTouch);
    if (this.phaseT % 2.2 < realDt) this.sfx.wind(falling ? 1.4 : 1);
    this.hud.showWord(this.typing, { touch: this.input.isTouch && !falling });
    if (ev === 'enter') this.endSky();
  }

  // 会場の上空 60m まで戻ってきた → ここからは本物の物理で落ちる（超望遠・観客が静まる）
  endSky() {
    const sj = this.skyJump;
    this.returnGrade = sj.returnGrade;
    this.returnDrift = sj.drift.x;
    sj.stop();
    this.sky.setAltitude(0);
    this.hud.zone(null);
    this.hud.radar(false);
    this.hud.showSteer(false);
    this.typing.end();
    this.hud.hideWord();
    // 落ちてくる間に回転を 1 回転の倍数へそろえる（途中の単語の分は回りきる）
    const ath = this.athlete;
    ath.setTargets({ flip: Math.round(ath.flipTarget / TAU), twist: Math.round(ath.twistTarget / TAU), spin: Math.round(ath.spinTarget / TAU) });
    ath.setTrick(null);
    const ph = ath.physics;
    ph.y = BASE + BED.top;
    ph.vy = -22;
    ph.contact = false;
    this.athlete.x = clamp(this.returnDrift, -6, 6);
    this.setPhase('return');
    this.time.to(0.45, 4);
    this.cam.set('TELE', { cut: true });
    this.audio.setMusic(null);
    this.audio.hush(2.4);
    this.hud.comment('……戻ってきました。', 2.6);
  }

  updateReturn(realDt) {
    // 戻ってくる場所: 中央 / 少しずれ / はしっこ
    const g = this.returnGrade;
    const tx = g === 'PERFECT' ? 0 : g === 'GOOD' ? Math.sign(this.returnDrift) * 1.0 : Math.sign(this.returnDrift) * 2.05;
    this.athlete.x += (tx - this.athlete.x) * Math.min(1, realDt * 2.5);
    if (this.athlete.physics.height < 14 && this.cam.shot === 'TELE') this.cam.set('WIDE', { dur: 0.6 });
  }

  // 着地
  land(ev) {
    const a = this.air;
    const ath = this.athlete;
    const t = this.typing;
    t.end();
    this.hud.hideWord();
    const err = ath.landingError();
    let grade = err < 0.1 ? 'PERFECT' : err < 0.24 ? 'GOOD' : err < 0.42 ? 'OK' : 'FAIL';
    if (a.fromSky && this.returnGrade === 'EDGE') grade = 'FAIL'; // はしっこ: 転ぶ
    const failed = grade === 'FAIL';
    const revs = (Math.abs(ath.flip) + Math.abs(ath.twist) + Math.abs(ath.spin)) / TAU;
    a.revs = revs;
    ath.settle(failed);
    ath.physics.setNextApex(failed ? 0.12 : 0.3);
    this.time.to(1, 30);
    this.landing = grade;
    this.cam.shake(failed ? 0.5 : 0.3 + Math.min(0.4, ev.v / 30));
    if (failed) this.sfx.fail();
    else this.sfx.land(grade === 'PERFECT');
    this.scoreJump(err, grade, a);
    this.director.land();
    this.director.moment('land', { fromSky: !!a.fromSky, returnGrade: this.returnGrade });
    if (a.fromSky) {
      // 帰ってきた: 屋根は何事もなかったように閉まる
      this.arena.openRoof(false);
      this.skyReady = false;
      this.superStage = 0;
      this.audio.cheerSwell(4);
      this.audio.applause();
      this.cheer.hype(0.8);
      this.athlete.x = 0;
    }
    this.bg.clearJump();
    const sum = this.scoring.attemptSum;
    this.cheer.hype(clamp(sum / 9000, 0.05, 0.6));
    if (!failed) this.fx.confettiBurst({ x: 0, y: 1, z: 0 }, Math.min(260, 40 + sum / 40), 6);
    this.setPhase('landed');
  }

  // 1 回の跳躍の採点（内訳）
  scoreJump(err, grade, a) {
    const s = this.scoring;
    const sum = this.typing.summary();
    if (a.fromSky) s.add('TECHNIQUE', `HEIGHT ${(a.maxH / 1000).toFixed(1)}km`, 3000);
    else s.add('TECHNIQUE', `HEIGHT ${a.maxH.toFixed(1)}m`, a.maxH * 100);
    // 打ち終わった単語（同じ単語はまとめる）
    const counts = {};
    for (const w of sum.words) counts[w] = (counts[w] ?? 0) + 1;
    // 同じ技の繰り返しは少しずつ価値が下がる（1, 0.8, 0.64, …）→ 打ちまくるだけでは点が暴走しない
    for (const [w, n] of Object.entries(counts)) s.add('TECHNIQUE', n > 1 ? `${w} ×${n}` : w, (WORDS[w].tech * (1 - Math.pow(0.8, n))) / 0.2);
    if (sum.partial) s.add('TECHNIQUE', `${sum.partial}…（途中）`, WORDS[this.typing.word].tech * this.typing.progress * 0.5);
    if (sum.correct) s.add('TYPING', `TYPING ${sum.correct}文字`, Math.min(60, sum.correct) * 30);
    if (sum.fastWords) s.add('TYPING', 'FAST INPUT', Math.min(6, sum.fastWords) * 250);
    if (sum.miss === 0 && sum.correct >= 4) s.add('TYPING', 'NO MISS', 300);
    // 同じ単語の連続（FLIP FLIP FLIP）
    let run = 1;
    let best = 1;
    let bestW = null;
    for (let i = 1; i < sum.words.length; i++) {
      run = sum.words[i] === sum.words[i - 1] ? run + 1 : 1;
      if (run > best) {
        best = run;
        bestW = sum.words[i];
      }
    }
    if (best >= 3) s.add('TYPING', `${bestW} CHAIN ×${best}`, best * 220);
    // 着地
    if (grade === 'PERFECT') s.add('LANDING', 'PERFECT LANDING', 1000);
    else if (grade === 'GOOD') s.add('LANDING', 'GOOD LANDING', 500);
    else if (grade === 'OK') s.add('LANDING', 'LANDING', 200);
    else s.add('ACCIDENT', '着地失敗', 150); // 「着地失敗、なのに。」は data/events.js（LANDING_FAIL）
    // 審判（execution 0〜10）
    let e = 9.35 - err * 5 - sum.miss * 0.08 + Math.min(0.45, sum.words.length * 0.09);
    if (grade === 'FAIL') e = 5.2 + this.rng.next() * 1.2;
    this.execution = clamp(e, 0, 9.9);
  }

  // 「〜なのに。」: 大きな文字 + 内訳
  nanoni(big, cat, label, points) {
    const p = this.scoring.add(cat, label, points);
    if (!p) return 0;
    this.hud.nanoni(big, p);
    this.sfx.nanoni();
    return p;
  }

  onScore(item) {
    this.hud.feed(item);
  }

  finishAttempt() {
    const rec = this.scoring.finish(this.execution ?? 8, () => this.rng.next(), this.attempt);
    this.setPhase('result');
    this.hud.clearFeed(); // 内訳は結果の表にまとめて出る
    this.hud.showResult(rec, this.attempt, ATTEMPTS, this.scoring.total);
    this.hud.setTotal(this.scoring.total);
    this.judges.show(rec.cards);
    this.sfx.judges();
    this.cam.set('RESULT', { dur: 0.8 });
    this.arena.drawBoard({ name: 'SAMURAI  JPN', attempt: this.attempt, of: ATTEMPTS, last: rec.sum, total: this.scoring.total });
    this.hud.comment(`審判の採点です。E スコア ${rec.official.toFixed(2)}。`, 3);
  }

  // ------------------------------------------------------------------
  // 自動操縦（?auto）: 踏み込みとタイピングを代わりにやる（テスト用）
  // ------------------------------------------------------------------
  autoStomp() {
    if (!this.auto || this.phase !== 'bounce' || this.stompArmed || this.stompFired) return;
    const ph = this.athlete.physics;
    if (this.warm >= 2 && ph.contact && ph.vy < 0 && this.contactT > 0.02) this.armStomp(this.stompQuality());
  }

  autoType(realDt) {
    if (!this.auto || !this.typing.active) return;
    // ?fast で世界を早送りしても、打つ速さ（文字/秒）は人間のまま
    this.autoAcc = (this.autoAcc ?? 0) + (realDt / this.fast) * (this.params.get('cps') ? +this.params.get('cps') : 5.5);
    while (this.autoAcc >= 1) {
      this.autoAcc -= 1;
      const t = this.typing;
      // 着地の直前は新しい単語を打ち始めない（回りきれないので）
      if (t.typed === 0 && this.athlete.physics.vy < 0 && this.athlete.physics.timeToLand() < 0.6) return;
      const ch = this.rng.chance(0.04) ? 'Q' : t.word[t.typed];
      this.typeKey(ch);
    }
  }

  // ------------------------------------------------------------------
  // ループ
  // ------------------------------------------------------------------
  frame(now) {
    const realDt = Math.min(0.05, (now - this.last) / 1000) * this.fast;
    this.last = now;
    this.renderer.info.reset();
    if (this.input.pressed('Escape') && this.phase !== 'intro' && this.phase !== 'final') this.setPaused(!this.paused);
    if (this.paused) {
      if (this.input.confirm()) this.setPaused(false);
      this.input.endFrame();
      this.input.takeLetters();
      this.fx.render();
      return;
    }
    const gameDt = this.time.update(realDt);
    this.step(realDt, gameDt);
    this.input.endFrame();
  }

  step(realDt, gameDt) {
    this.phaseT += realDt;
    const ath = this.athlete;
    const ph = ath.physics;
    const input = this.input;
    const typingPhase = this.phase === 'air' || this.phase === 'sky';
    if (!typingPhase) input.takeLetters();
    if (input.pressed('KeyM') && !typingPhase) this.audio.toggleMute();

    switch (this.phase) {
      case 'intro':
        if (input.confirm()) this.startGame();
        break;
      case 'ready':
        if (this.phaseT > 1.4 && !this.director.blocking) {
          this.setPhase('bounce');
          this.cam.set('WIDE', { dur: 0.8 });
        }
        break;
      case 'bounce': {
        this.bounceT += realDt;
        if (input.stomp()) this.armStomp(this.stompQuality());
        this.autoStomp();
        // 踏み込みのメーター: 落ちてくるほど伸びる（着いた瞬間〜沈む間 = 今！）
        let m = 0;
        if (!ph.contact && ph.vy < 0) m = clamp(1 - ph.timeToLand() / 0.9, 0, 1) * 0.82;
        else if (ph.contact && ph.vy < 0) m = 1;
        const label = this.stompArmed ? '踏み込み！' : this.bounceT > 6 ? 'ベッドが沈む瞬間に SPACE（スマホはタップ）' : 'ベッドが沈む瞬間に踏み込む';
        this.hud.meter(!this.stompFired, m, label);
        break;
      }
      case 'air':
        this.updateAir(realDt);
        break;
      case 'super': {
        // 超反発の間は世界を少し早送り（待たせない）。最後の 1 回で 60m を超えたら空へ
        this.time.to(1.7, 4);
        if (this.superStage === SUPER.length - 1 && ph.y > BASE + BED.top && ph.vy > 0) this.startSky();
        break;
      }
      case 'sky':
        this.updateSky(realDt);
        break;
      case 'return':
        this.updateReturn(realDt);
        break;
      case 'landed':
        // 観客ドラマの途中なら、終わるまで待つ（選手は背景で跳び続ける）
        if (this.phaseT > (this.landing === 'FAIL' ? 2.4 : 1.7) && !this.director.blocking) this.finishAttempt();
        break;
      case 'result':
        if (this.phaseT > 4.6 || (this.phaseT > 1 && input.confirm()) || (this.auto && this.phaseT > 2.2)) this.nextAttempt();
        break;
      case 'final':
        if (this.phaseT > 1 && input.confirm()) this.startGame();
        if (this.auto && this.phaseT > 3 && this.params.has('loop')) this.startGame();
        break;
    }

    // ---- 世界（gameDt）
    const stompHeld = (this.stompArmed || this.stompFired) && ph.contact;
    const hurry = this.phase === 'air' && ph.vy < 0 ? clamp(1 - ph.timeToLand() / 0.45, 0, 1) : 0;
    const boost = 1 + Math.min(3, this.typing.fastWords * 0.5);
    const wasContact = ph.contact;
    ath.update(gameDt, { stomp: stompHeld, hurry, boost, freeze: this.phase === 'sky', onEvent: (ev) => this.onPhysics(ev) });
    this.contactT = ph.contact ? (wasContact ? this.contactT + gameDt : 0) : 0;
    this.ghosts.update(gameDt);
    // 背景（勝手に動いている）→ 偶然の一致
    const trick = ath.trick;
    const syncs = this.bg.update(gameDt, {
      airborne: this.phase === 'air',
      vy: ph.vy,
      height: ph.height,
      wordAge: this.air ? this.time.game - this.air.wordAt : 9,
      pose: trick === 'star' || trick === 'ballerina',
      rotSpeed: ath.rotSpeed,
      timeToLand: ph.timeToLand(),
    });
    for (const sy of syncs) {
      this.cam.syncPoint.copy(sy.point);
      this.director.moment('sync', { sync: sy });
    }
    this.bed.update(gameDt, ph.d, ath.x, ath.z);
    this.cheer.update(gameDt, { running: false, crowdDensity: 0.7 });
    this.arena.update(gameDt, this.cheer.excitement, realDt);
    this.judges.update(realDt);
    this.drama.update(realDt, this.hud);
    this.director.update(realDt);

    // ---- HUD
    if (['air', 'landed', 'bounce', 'super', 'sky', 'return'].includes(this.phase)) {
      const revs = (Math.abs(ath.flip) + Math.abs(ath.twist) + Math.abs(ath.spin)) / TAU;
      const h = this.phase === 'sky' ? this.skyJump.alt : this.phase === 'landed' ? this.air?.maxH ?? ph.height : ph.height;
      this.hud.setStats({ height: h, rotation: revs, landing: this.landing, score: this.scoring.attemptSum });
    }
    if (this.phase !== 'bounce') this.hud.meter(false);
    this.hud.update(realDt);

    // ---- カメラ（realDt）
    ath.com(this._com ?? (this._com = new THREE.Vector3()));
    this.cam.update(realDt, { com: this._com, head: ath.headPos, headFwd: ath.headFwd, headUp: ath.headUp, faceDir: ath.faceDir, height: ph.height, airborne: ath.airborne, world: this.world });
    this.sky.follow(this.camera);

    // ---- 音・エフェクト（realDt）
    this.audio.update(realDt, { excitement: this.cheer.excitement, playing: this.phase !== 'intro' });
    this.sfx.update();
    this.fx.update(realDt, { player: this.fxPlayer, tier: 0, excitement: this.cheer.excitement, playing: false });
    this.fx.render();
  }

  onPhysics(ev) {
    const ph = this.athlete.physics;
    if (ev.type === 'touch') {
      this.sfx.boing(clamp(ev.v / 12, 0.1, 1));
      if (this.phase === 'air' || this.phase === 'return') this.land(ev);
    } else if (ev.type === 'bottom') {
      if (this.phase === 'super') {
        // 超反発: 着くたびに高くなる
        this.superStage = Math.min(SUPER.length - 1, this.superStage + 1);
        ph.launchV = Math.sqrt(2 * PHYS.g * SUPER[this.superStage]);
        this.time.hit(0.1);
        this.cam.shake(0.6 + this.superStage * 0.2);
        this.sfx.stomp(1);
        this.bed.flash(2 + this.superStage);
        this.arena.bump(0.3 + this.superStage * 0.25, 0.3 + this.superStage * 0.2);
        this.director.moment('super');
      } else if (this.stompArmed) this.fireStomp();
      else if (this.phase === 'bounce' || this.phase === 'ready' || this.phase === 'intro') {
        // ウォームアップ: 少しずつ高く
        this.warm = Math.min((this.warm ?? 0) + 1, WARMUP.length - 1);
        ph.launchV = Math.sqrt(2 * PHYS.g * (this.phase === 'intro' ? 0.9 : WARMUP[this.warm]));
      } else if (this.phase === 'result' || this.phase === 'landed') {
        ph.launchV = Math.sqrt(2 * PHYS.g * (this.athlete.failT > 0 ? 0.08 : 0.45));
      }
    } else if (ev.type === 'takeoff') {
      if (this.stompFired && this.phase === 'bounce') {
        this.stompFired = false;
        if (this.skyReady) {
          this.setPhase('super');
          this.superStage = 0;
        } else this.beginAir(ev);
      }
      if (this.phase === 'super') {
        const call = SUPER_CALL[this.superStage];
        if (call) this.hud.comment(call, 2.2);
        this.cam.set(['WIDE', 'HIGH', 'ROOF', 'TELE'][this.superStage], { dur: 0.5 });
        this.sfx.whoosh(1 + this.superStage);
      }
    }
  }

  // テスト用の状態
  state() {
    const ph = this.athlete.physics;
    return {
      phase: this.phase,
      attempt: this.attempt,
      total: this.scoring.total,
      attemptSum: this.scoring.attemptSum,
      height: +ph.height.toFixed(2),
      scale: +this.time.scale.toFixed(3),
      word: this.typing.word,
      typed: this.typing.typed,
      done: this.typing.done.map((d) => d.word),
      landing: this.landing,
      shot: this.cam.shot,
      fps: Math.round(this.fx.fps ?? 0),
      quality: this.fx.quality,
      calls: this.renderer.info.render.calls,
      level: this.level,
      rot: +this.athlete.rotSpeed.toFixed(1),
      events: this.director.active.map((a) => a.ev.id),
      alt: Math.round(this.skyJump.alt),
      zone: this.skyJump.active ? this.skyJump.zone : null,
      drift: +this.skyJump.drift.x.toFixed(2),
      seen: [...this.director.seen],
    };
  }
}
