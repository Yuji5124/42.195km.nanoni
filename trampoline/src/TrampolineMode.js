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

// 『トランポリン、なのに。』のモード本体（状態の流れとループ）。
//
//   intro → ready → bounce（小さく弾む。SPACE で踏み込み）→ air（スロー + タイピング）→ landed → result → 次の試技
//   10 回の試技のあと final。
//
// 時間は 2 つ（TrampolineTime）: 世界の時間 gameDt（スロー・ヒットストップ）と UI の時間 realDt。
// 選手・ベッド・観客は gameDt、カメラ・タイピング・HUD は realDt で動く。

export const ATTEMPTS = 10;
const TAU = Math.PI * 2;

// 何もしない時の弾み（ウォームアップで少しずつ高く）
const WARMUP = [0.7, 1.1, 1.5, 1.8];

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
    document.getElementById('pause').addEventListener('pointerdown', () => this.setPaused(false));
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
    this.hud.setTotal(0);
    this.attempt = +(this.params.get('attempt') ?? 1) - 1;
    this.nextAttempt();
  }

  nextAttempt() {
    this.hud.hideResult();
    this.judges.hide();
    this.attempt++;
    if (this.attempt > ATTEMPTS) return this.toFinal();
    this.setPhase('ready');
    this.scoring.begin();
    this.hud.setAttempt(this.attempt, ATTEMPTS);
    this.hud.setStats({ height: 0, rotation: 0, landing: '-', score: 0 });
    this.arena.drawBoard({ name: 'SAMURAI  JPN', attempt: this.attempt, of: ATTEMPTS, last: this.scoring.history.at(-1)?.sum ?? 0, total: this.scoring.total });
    this.hud.comment(CALLS[(this.attempt - 1) % CALLS.length].replace('{n}', this.attempt), 2.6);
    this.cam.set('WIDE', { dur: 1.1 });
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
    const apex = lerp(3.2, 8.4, Math.pow(q, 0.8)) * (this.apexMul ?? 1);
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
    const budget = lerp(4.2, 6.8, q);
    const slow = clamp((tUp + tFall) / budget, 0.06, 0.3);
    this.air = { apex, maxH: 0, q, slow, slowMul: 1, descent: false, t: 0, faceT: 1.05, rotShown: 0 };
    this.time.to(slow, 9);
    this.cam.set('FACE', { cut: true });
    this.sfx.whoosh(1);
    this.sfx.ooh(1 + q);
    const level = this.attempt <= 2 ? 0 : this.attempt <= 4 ? 1 : 2;
    const first = this.attempt === 1 ? 'FLIP' : this.attempt === 2 ? 'SPIN' : null;
    this.typing.begin(level, this.time.real, first);
    this.athlete.setTargets({ flip: 0, twist: 0, spin: 0 });
    void ph;
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
      if (a.faceT <= 0 && this.cam.shot === 'FACE') this.cam.set('WIDE', { dur: 0.9 });
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
    }
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
    this.sfx.word(this.typing.done.length);
    this.cheer.hype(0.03);
    if (d.lift) {
      // 空中なのに、さらに上へ
      ph.vy = Math.max(ph.vy, 0) + d.lift;
      if (a.descent) {
        a.descent = false;
        this.time.to(a.slow * a.slowMul, 5);
      }
      this.sfx.whoosh(1.2);
    }
    if (d.slow) {
      a.slowMul *= d.slow;
      if (!a.descent) this.time.to(clamp(a.slow * a.slowMul, 0.035, 0.3), 5);
    }
    void fast;
  }

  // 着地
  land(ev) {
    const a = this.air;
    const ath = this.athlete;
    const t = this.typing;
    t.end();
    this.hud.hideWord();
    const err = ath.landingError();
    const grade = err < 0.1 ? 'PERFECT' : err < 0.24 ? 'GOOD' : err < 0.42 ? 'OK' : 'FAIL';
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
    const sum = this.scoring.attemptSum;
    this.cheer.hype(clamp(sum / 9000, 0.05, 0.6));
    if (!failed) this.fx.confettiBurst({ x: 0, y: 1, z: 0 }, Math.min(260, 40 + sum / 40), 6);
    this.setPhase('landed');
  }

  // 1 回の跳躍の採点（内訳）
  scoreJump(err, grade, a) {
    const s = this.scoring;
    const sum = this.typing.summary();
    s.add('TECHNIQUE', `HEIGHT ${a.maxH.toFixed(1)}m`, a.maxH * 100);
    // 打ち終わった単語（同じ単語はまとめる）
    const counts = {};
    for (const w of sum.words) counts[w] = (counts[w] ?? 0) + 1;
    for (const [w, n] of Object.entries(counts)) s.add('TECHNIQUE', n > 1 ? `${w} ×${n}` : w, WORDS[w].tech * n * (n >= 3 ? 1.25 : 1));
    if (sum.partial) s.add('TECHNIQUE', `${sum.partial}…（途中）`, WORDS[this.typing.word].tech * this.typing.progress * 0.5);
    if (sum.correct) s.add('TYPING', `TYPING ${sum.correct}文字`, sum.correct * 30);
    if (sum.fastWords) s.add('TYPING', 'FAST INPUT', sum.fastWords * 250);
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
    else {
      s.add('ACCIDENT', '着地失敗', 150);
      this.nanoni('着地失敗、なのに。', 'NANONI', '着地失敗、なのに加点', 350);
    }
    if (!sum.correct && !sum.miss) this.nanoni('何もしなかった、なのに。', 'NANONI', 'ただ跳んだだけ、なのに', 150);
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
    const rec = this.scoring.finish(this.execution ?? 8, () => this.rng.next());
    this.setPhase('result');
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
    this.autoAcc = (this.autoAcc ?? 0) + realDt * (this.params.get('cps') ? +this.params.get('cps') : 6.5);
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
    if (this.phase !== 'air') input.takeLetters();
    if (input.pressed('KeyM') && this.phase !== 'air') this.audio.toggleMute();

    switch (this.phase) {
      case 'intro':
        if (input.confirm()) this.startGame();
        break;
      case 'ready':
        if (this.phaseT > 1.4) this.setPhase('bounce');
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
      case 'landed':
        if (this.phaseT > (this.landing === 'FAIL' ? 2.4 : 1.7)) this.finishAttempt();
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
    const boost = 1 + Math.min(2.5, this.typing.fastWords * 0.35);
    const wasContact = ph.contact;
    const events = ath.update(gameDt, { stomp: stompHeld, hurry, boost });
    this.contactT = ph.contact ? (wasContact ? this.contactT + gameDt : 0) : 0;
    for (const ev of events) this.onPhysics(ev);
    this.bed.update(gameDt, ph.d, ath.x, ath.z);
    this.cheer.update(gameDt, { running: false, crowdDensity: 0.7 });
    this.arena.update(gameDt, this.cheer.excitement);
    this.judges.update(realDt);

    // ---- HUD
    if (this.phase === 'air' || this.phase === 'landed' || this.phase === 'bounce') {
      const revs = (Math.abs(ath.flip) + Math.abs(ath.twist) + Math.abs(ath.spin)) / TAU;
      this.hud.setStats({ height: this.phase === 'air' ? ph.height : this.air?.maxH ?? ph.height, rotation: revs, landing: this.landing, score: this.scoring.attemptSum });
    }
    if (this.phase !== 'bounce') this.hud.meter(false);
    this.hud.update(realDt);

    // ---- カメラ（realDt）
    ath.com(this._com ?? (this._com = new THREE.Vector3()));
    this.cam.update(realDt, { com: this._com, head: ath.headPos, headFwd: ath.headFwd, headUp: ath.headUp, faceDir: ath.faceDir, height: ph.height, airborne: ath.airborne });

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
      if (this.phase === 'air') this.land(ev);
    } else if (ev.type === 'bottom') {
      if (this.stompArmed) this.fireStomp();
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
        this.beginAir(ev);
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
    };
  }
}
