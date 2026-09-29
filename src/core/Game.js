import * as THREE from 'three';
import { CONFIG, MODES } from '../config.js';
import { EventBus } from './EventBus.js';
import { Input } from './Input.js';
import { clamp } from './math.js';
import { getMode, MODE_ORDER } from '../modes/modes.js';
import { DistanceManager } from '../race/DistanceManager.js';
import { RaceManager, RACE } from '../race/RaceManager.js';
import { RunnerController } from '../race/RunnerController.js';
import { AIRunnerManager } from '../race/AIRunnerManager.js';
import { CheerSystem } from '../race/CheerSystem.js';
import { TokyoChunkManager } from '../world/TokyoChunkManager.js';
import { CoursePath } from '../world/CoursePath.js';
import { CrowdManager } from '../world/CrowdManager.js';
import { CourseManager } from '../world/CourseManager.js';
import { EventDirector } from '../director/EventDirector.js';
import { CameraDirector } from '../director/CameraDirector.js';
import { GagDirector } from '../director/GagDirector.js';
import { EffectManager } from '../fx/EffectManager.js';
import { AudioManager } from '../audio/AudioManager.js';
import { UIManager } from '../ui/UIManager.js';

// Game: 各システムを組み立て、イベントでつなぐだけの薄い層。
//   RaceManager     … 普通のマラソン（順位・時計・ゴール）
//   CameraDirector  … 見え方を壊す
//   EventDirector   … 世界とゲームルールを壊す（距離ベース・データ駆動）
//
// レースモード（42.195km / 1500m）はタイトルで選ぶ。モードが変わったら「ワールド」（シーンと
// 距離に依存するシステム一式）だけを作り直す。レンダラー・入力・UI・音・ポストエフェクトは共有。

const LINES = {
  fall: ['あーっと！ 転倒！', 'これは痛い！ …いや、立ち上がるか!?'],
  banana: ['マラソンで…バナナ!? 誰が置いたんですか！', 'バナナで転んだー！ 古典的！'],
  recover: ['立ち上がった！ 沿道から大歓声！', '転んでもただでは起きない！ 会場が沸いています！'],
  leapfrog: ['ランナーを…飛び越えた!?', 'それ、ルール的に大丈夫なんですか!?'],
  rivalPass: ['忍者ランナーを抜いた！', 'ここで忍者をかわした！'],
  rivalBack: ['忍者ランナー、抜き返す！', '忍者、ぴったりついてくる！'],
  duel: ['忍者ランナーと激しい競り合い！', '侍と忍者、一歩も譲りません！'],
  fever: ['沿道は大フィーバー！', '新宿が…揺れています！'],
  lead: ['侍ランナー、ついに先頭に立ちました！'],
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 夜の東京 ↔ 雲の上（夕方の空）
const SKY_NIGHT = { top: new THREE.Color(0x07051a), mid: new THREE.Color(0x2a1846), horizon: new THREE.Color(0xc0406e), fog: new THREE.Color(0x2a1846) };
const SKY_DAY = { top: new THREE.Color(0x2e6fd8), mid: new THREE.Color(0x8fc4ff), horizon: new THREE.Color(0xffd9a8), fog: new THREE.Color(0xcfe4ff) };

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.params = new URLSearchParams(location.search);
    this.timeScale = 1;
    this.slowMo = 0;
    this.time = 0;
    this.paused = false;
    this.sayCooldown = 0;
    this.nearMissCooldown = 0;
    this.fastSteps = clamp(parseInt(this.params.get('fast'), 10) || 1, 1, 8);
    this.duelTimer = 0;
    this.highFiveTimer = 0;
    this.sprintTimer = 0;
    this.resultTimer = 0;
    this.freeze = 0;
    let saved = null;
    try {
      saved = localStorage.getItem('nanoni.mode');
    } catch {
      saved = null;
    }
    this.modeId = getMode(this.params.get('mode') ?? saved ?? 'marathon').id;
  }

  async init() {
    await this.loadFonts();

    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.info.autoReset = false; // コンポーザーの複数パスをまとめて計測する
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);

    this.input = new Input(document.getElementById('ui'));
    this.ui = new UIManager();
    this.audio = new AudioManager();
    if (this.params.has('mute')) this.audio.setMuted(true);

    this.buildWorld(this.modeId);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    document.getElementById('title').addEventListener('pointerdown', () => this.startRace());
    document.querySelectorAll('[data-mode]').forEach((card) => {
      card.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.selectMode(card.dataset.mode);
        this.startRace();
      });
    });
    document.getElementById('result').addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-action="title"]')) this.backToTitle();
      else this.startRace();
    });
    document.getElementById('pause').addEventListener('pointerdown', () => this.setPaused(false));
    // Safari 等はユーザー操作のハンドラ内でないと音が鳴らないため、ここでも起こす
    const wakeAudio = () => this.audio.init();
    window.addEventListener('keydown', wakeAudio);
    window.addEventListener('pointerdown', wakeAudio);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.race.running) this.setPaused(true);
    });

    if (this.params.has('debug') || this.params.has('auto')) window.__game = this;
    if (this.params.has('auto')) setTimeout(() => this.startRace(), 300);

    this.last = performance.now();
    renderer.setAnimationLoop((now) => this.frame(now));
  }

  // ------------------------------------------------------------------
  // ワールド（モードごとのシーンとシステム）
  // ------------------------------------------------------------------
  buildWorld(modeId) {
    const oldScene = this.scene;
    // 前のワールドの区間演出が鳴らしていた音を止める
    this.audio.setEngine?.(false);
    this.audio.setBreath?.(false);
    const mode = getMode(modeId);
    this.mode = mode;
    this.modeId = mode.id;
    const data = mode.data;
    this.data = data;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x2a1846, 70, 460);
    this.scene = scene;
    this.buildSky();

    this.hemi = new THREE.HemisphereLight(0x9fb4ff, 0x2a1c3a, 1.0);
    scene.add(this.hemi);
    const moon = new THREE.DirectionalLight(0xffd6f0, 1.1);
    moon.position.set(-40, 80, 30);
    scene.add(moon);
    // 真横・中継カメラ側から見た面が真っ黒にならないよう、+X 側からの補助光
    const fill = new THREE.DirectionalLight(0x9aa8ff, 0.7);
    fill.position.set(80, 30, 0);
    scene.add(fill);
    this.playerLight = new THREE.PointLight(0x39e6ff, 18, 14, 1.6);
    scene.add(this.playerLight);

    this.bus = new EventBus();
    this.distance = new DistanceManager(data.goalKm, mode);
    this.events = new EventDirector(data, this.bus);
    this.path = new CoursePath(data.curves, this.distance, { endS: this.distance.goalUnits + 1600 });
    this.chunks = new TokyoChunkManager(scene, this.distance, data, this.path);
    this.crowd = new CrowdManager(scene, this.distance, this.events, this.path);
    this.chunks.landmarkCtx.crowdMaterial = this.crowd.material;
    this.chunks.landmarkCtx.raceTime = () => this.distance.raceTime;
    this.chunks.landmarkCtx.quality = () => this.fx?.quality ?? 2;
    this.course = new CourseManager(scene, this.bus, this.distance, this.events, this.path);
    this.player = new RunnerController(scene, this.bus, this.path);
    this.marker = this.buildMarker();
    scene.add(this.marker);
    this.ai = new AIRunnerManager(scene, this.bus, this.distance, this.path, mode.ai);
    this.race = new RaceManager(this.bus, this.distance, this.ai, this.player);
    this.cheer = new CheerSystem(this.bus);
    this.cameraDirector = new CameraDirector(this.camera, scene, this.bus, this.path);
    if (!this.fx) this.fx = new EffectManager(this.renderer, scene, this.camera, this.path);
    else this.fx.setScene(scene, this.path);
    const sfxMap = { signal: 'signalChime' };
    this.gags = new GagDirector(scene, this.path, this.distance, this.chunks, {
      say: (t, force) => this.say(t, force),
      fever: (t) => this.ui.fever(t),
      hint: (t, touchText) => this.ui.hint(this.input.isTouch ? touchText ?? t : t, 5000),
      cheer: (kind, opts) => this.cheer.add(kind, opts),
      sfx: (name, arg) => this.audio[sfxMap[name] ?? name]?.(arg),
      shake: (v) => this.cameraDirector.shake(v),
      hype: (v) => this.cheer.hype(v),
      burst: (s, x, y, color) => this.burstAt({ s, x, y }, color, 26),
    });

    this.sections = mode.createSections?.(this) ?? null;

    this.ui.setRaceMode(mode, this.ai.n + 1);
    this.lastSkyAmt = undefined;
    this.wire();
    this.resetWorld();
    this.toTitle();
    if (oldScene) this.disposeScene(oldScene);
  }

  disposeScene(scene) {
    const seen = new Set();
    scene.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        for (const v of Object.values(m)) if (v?.isTexture && !seen.has(v)) (seen.add(v), v.dispose());
        m.dispose();
      }
    });
    scene.clear();
  }

  // タイトルでモードを切り替える（ワールドを作り直す）
  selectMode(id) {
    const mode = getMode(id);
    if (mode.id === this.modeId || (this.race.state !== RACE.TITLE && this.race.state !== RACE.RESULT)) return;
    try {
      localStorage.setItem('nanoni.mode', mode.id);
    } catch {
      /* 保存できなくても遊べる */
    }
    this.ui.hideResult();
    this.buildWorld(mode.id);
    this.fx.glitchBurst(0.8);
  }

  async loadFonts() {
    if (!document.fonts?.load) return;
    const fonts = ['40px "Dela Gothic One"', '40px "DotGothic16"', 'bold 40px "Chakra Petch"'];
    await Promise.race([
      Promise.all(fonts.map((f) => document.fonts.load(f, 'あ新宿42km').catch(() => null))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(1200, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x07051a) },
        uMid: { value: new THREE.Color(0x2a1846) },
        uHorizon: { value: new THREE.Color(0xc0406e) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uTop, uMid, uHorizon; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 c = mix(uMid, uTop, smoothstep(0.05, 0.6, h));
          c = mix(uHorizon, c, smoothstep(-0.02, 0.16, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  // 中継・真横視点で「自分はどれか」を見失わないための頭上マーカー
  buildMarker() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#39e6ff';
    g.font = 'bold 30px "Chakra Petch", Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('YOU', 64, 28);
    g.beginPath();
    g.moveTo(50, 36);
    g.lineTo(78, 36);
    g.lineTo(64, 58);
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false });
    mat.color.setScalar(1.4);
    const s = new THREE.Sprite(mat);
    s.scale.set(1.6, 0.8, 1);
    s.renderOrder = 10;
    s.visible = false;
    return s;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.resize(w, h);
  }

  // ------------------------------------------------------------------
  // 各システムのイベント配線
  // ------------------------------------------------------------------
  wire() {
    const { bus, ui, audio, fx, cheer, player, cameraDirector: cam } = this;

    bus.on('event', ({ event, state, before, silent }) => {
      const camChanged = state.camera !== before.camera || silent;
      if (camChanged && this.race.running) {
        const cut = state.camera === MODES.TV_BROADCAST || state.transition === 'cut';
        const transition = state.camera === MODES.SIDE_2D ? 1.7 : before.camera === MODES.SIDE_2D ? 1.5 : 1.2;
        cam.setMode(state.camera, { transition, cut });
        fx.glitchBurst(cut ? 1 : 0.75);
        audio.glitch();
        audio.whoosh();
      }
      fx.setPreset(state.fx);
      const wire = state.world === 'wireframe';
      if (wire !== this.chunks.buildingMaterial.wireframe) {
        this.chunks.setWireframe(wire);
        fx.glitchBurst(0.9);
        audio.glitch();
      }
      ui.setTV(state.camera === MODES.TV_BROADCAST);
      if (this.race.running) audio.setMusic(state.music);
      if (silent) return;
      if (event.gag) this.gags.trigger(event.gag, player);
      if (event.caption) ui.caption(event.caption.main, event.caption.sub);
      if (event.commentary) this.say(event.commentary, true);
      const hint = this.input.isTouch ? event.hintTouch ?? event.hint : event.hint;
      if (hint) ui.hint(hint, 5000);
      if (event.id === 'final_straight') {
        this.course.clearAhead(player.s + 4);
        ui.fever('LAST 140m');
      }
    });

    bus.on('cameraMode', ({ mode }) => {
      ui.setModeClass(mode);
      ui.setCCTV(mode === MODES.CCTV);
    });
    bus.on('cameraCut', ({ label, cctv }) => {
      if (cctv) ui.cctvCam(label);
      else ui.camTag(`CAM: ${label}`);
      fx.glitchBurst(cctv ? 0.35 : 0.2);
    });

    bus.on('countdown', ({ n }) => {
      const labels = this.mode.countdown;
      ui.countdown(labels ? labels[n] ?? '' : String(n));
      if (!labels || labels[n]) audio.countdown(n);
    });
    bus.on('raceStart', () => {
      ui.countdown(this.mode.countdown?.go ?? 'GO!');
      audio.countdown(0);
      audio.startGun();
      audio.setMusic(this.events.current.music);
      cam.setMode(MODES.NORMAL, { transition: 1.6 });
      fx.flash(0.25);
      ui.hint(this.input.isTouch ? '◀▶ 移動　JUMP ジャンプ　DASH ダッシュ' : '←→ 移動　SPACE ジャンプ　SHIFT ダッシュ　W ペースアップ', 5000);
      this.say(this.mode.lines?.start ?? 'スタートしました！ 42.195km、なのに…の旅が始まります！', true);
      const warp = parseFloat(this.params.get('warp'));
      if (warp > 0) this.warpTo(warp);
    });

    bus.on('overtakeScored', (e) => {
      if (e.airborne) {
        cheer.add('leapfrog');
        this.say(pick(LINES.leapfrog));
      } else if (e.dx < 0.9 && player.speed > 15 && this.nearMissCooldown <= 0) {
        cheer.add('nearMiss');
        this.nearMissCooldown = 0.8;
      } else cheer.add('overtake');
      // 連続追い抜きの節目は、同じ波の中で一度ずつ
      if (e.burst <= 2) this.lastBurstShown = 0;
      if ([3, 5, 8, 12].includes(e.burst) && e.burst > (this.lastBurstShown ?? 0)) {
        this.lastBurstShown = e.burst;
        cheer.add('multiOvertake', { label: `${e.burst} OVERTAKE!`, scale: Math.min(2, e.burst / 5) });
      }
      if (e.rival) this.say(pick(LINES.rivalPass));
      audio.overtake(e.rival || e.burst >= 3);
    });
    bus.on('overtake', (e) => {
      if (e.rival && !e.first && this.race.running) this.say(pick(LINES.rivalPass));
    });
    bus.on('overtaken', (e) => {
      if (e.rival && this.race.running) this.say(pick(LINES.rivalBack));
    });
    bus.on('takeLead', () => {
      cheer.add('takeLead');
      ui.fever('TOP RUNNER!');
      this.say(pick(LINES.lead), true);
      audio.cheerSwell(2);
      fx.confettiBurst(player.position, 120, 6);
    });

    bus.on('playerJump', () => audio.jump());
    bus.on('playerLand', ({ length }) => {
      audio.land();
      fx.dust(player);
      if (length > 15 && this.race.running) cheer.add('bigJump');
    });
    bus.on('playerFall', ({ reason }) => {
      audio.fall();
      cam.shake(0.7);
      fx.glitchBurst(0.25);
      if (reason !== 'car') this.say(pick(reason === 'banana' ? LINES.banana : LINES.fall), true);
      ui.fever(reason === 'banana' ? 'つるっ' : 'ドテッ');
    });
    bus.on('playerRecover', () => {
      cheer.add('recovery');
      audio.cheerSwell(1.6);
      this.say(pick(LINES.recover));
    });
    bus.on('playerBump', () => {
      audio.bump();
      cam.shake(0.25);
    });
    bus.on('footstep', ({ speed }) => audio.footstep(speed));

    bus.on('pickup', ({ type, item }) => {
      if (type === 'onigiri') {
        player.addStamina(45);
        cheer.add('pickup', { label: 'おにぎり STAMINA+' });
        audio.pickup();
        this.burstAt(item, [1.4, 1.4, 1.4]);
      } else if (type === 'shoe') {
        player.boost(3.2);
        cheer.add('pickup', { label: 'SPEED SHOES' });
        audio.pickup();
        this.burstAt(item, [0.3, 1, 1.6]);
      } else if (type === 'token') {
        cheer.add('token');
        audio.coin();
        this.burstAt(item, [0.4, 1.6, 1.8], 14);
      }
    });
    bus.on('hazardHit', ({ effect }) => {
      if (effect === 'carCrash') {
        player.fall('car');
        audio.carHorn();
        this.say('車にぶつかった！ …マラソンです！ 大丈夫、立ち上がります！', true);
      } else if (effect === 'cat') {
        player.hitStagger(0.3);
        audio.meow();
        cam.shake(0.2);
        this.say('猫にぶつかった！ …猫は無事です！ 見事に着地しました！');
      } else if (effect === 'stagger') {
        player.hitStagger(0.45);
        cam.shake(0.3);
      } else if (effect === 'fall') player.fall('crash');
      else if (effect === 'slip') player.fall('banana');
    });
    bus.on('carPass', ({ dx }) => {
      if (dx < 0.9) cheer.add('carPass', { scale: 1.6, label: 'CLOSE OVERTAKE' });
      else cheer.add('carPass');
      audio.overtake(dx < 0.9);
    });
    bus.on('hazardClear', ({ type, perfect }) => {
      if (type === 'cat') {
        cheer.add('nyanJump');
        audio.meow();
      } else cheer.add(perfect ? 'perfectClear' : 'clear');
    });
    bus.on('hazardNearMiss', ({ type }) => {
      if (type === 'barrier' || type === 'banana') cheer.add('nearMiss', { scale: 0.6, label: 'CLOSE!' });
      else if (type === 'cat') cheer.add('nearMiss', { scale: 0.6, label: 'CAT DODGE' });
    });

    bus.on('cheer', ({ kind, label, amount, combo }) => {
      if (kind === 'nearMiss' || kind === 'dodge') this.race.stats.nearMiss++;
      // ただの追い抜きは連続するとポップが埋まるので間引く（スコアは全部入る）
      const now = performance.now();
      if (kind !== 'overtake' || now - (this.lastOvertakePop ?? 0) > 700) {
        ui.popup(label, amount, { big: amount >= 100 });
        if (kind === 'overtake') this.lastOvertakePop = now;
      }
      if ([5, 10, 15, 20, 30].includes(combo)) {
        ui.fever(`COMBO ×${combo}`);
        audio.cheerSwell(1 + combo / 10);
      }
    });
    bus.on('cheerTier', ({ tier, up }) => {
      if (!up || !this.race.running) return;
      if (tier >= 3) audio.cheerSwell(tier / 2);
      if (tier === 5) {
        fx.confettiBurst(player.position, 220);
        ui.fever('FEVER!!');
        this.say(pick(LINES.fever));
      }
    });

    bus.on('finish', ({ position }) => {
      this.slowMo = 1.5;
      cam.goalS = this.race.goalS;
      // 1500m は写真判定の演出を区間側が持つ
      if (!this.sections?.onFinish(position)) {
        cam.setMode(MODES.GOAL, { transition: 0.8 });
        fx.setPreset('goal');
      }
      this.chunks.getLandmark('goalArch')?.breakTape?.();
      fx.flash(0.5);
      fx.confettiBurst(player.position, 380, 11);
      audio.goal();
      audio.setMusic('title');
      ui.setTV(false);
      ui.fever(this.mode.goalText ?? 'GOAL!!', 2400);
      this.say(this.mode.lines?.finish?.(position, this) ?? `侍ランナー、ゴール！ ${position}位でフィニッシュ！ …結局、ちゃんとマラソンでした！`, true);
      this.resultTimer = 4.2;
    });

    this.sections?.wire(bus);
  }

  // コース座標 (s, x, y) のアイテム位置でパーティクルを弾けさせる
  burstAt(item, color, count) {
    const v = this.path.toWorld(item.s, item.x, item.y, new THREE.Vector3());
    this.fx.burst(v.x, v.y, v.z, color, count);
  }

  say(text, force = false) {
    if (!force && this.sayCooldown > 0) return;
    this.ui.say(text);
    this.sayCooldown = 2.8;
  }

  // ------------------------------------------------------------------
  resetWorld() {
    // 1500m は AI 側がスタートラインの枠を決める（プレイヤーの位置も合わせて調整される）
    const start = { ...this.mode.startLine };
    this.ai.reset(start);
    this.player.reset(start.s, start.x);
    this.course.reset(0);
    this.gags.reset();
    this.chunks.reset();
    this.crowd.reset();
    this.cheer.reset();
    this.events.reset();
    this.fx.reset();
    this.cameraDirector.reset();
    this.distance.reset();
    this.sections?.reset();
    this.timeScale = 1;
    this.slowMo = 0;
    this.resultTimer = 0;
    this.duelTimer = 0;
    this.freeze = 0;
  }

  // リザルト → タイトル（モードを選び直す）
  backToTitle() {
    if (this.race.state !== RACE.RESULT) return;
    this.ui.hideResult();
    this.audio.setMusic(null);
    this.resetWorld();
    this.ui.setTV(false);
    this.toTitle();
  }

  toTitle() {
    this.race.toTitle();
    this.ui.showTitle(true);
    this.ui.showHUD(false);
    this.cameraDirector.setMode(MODES.TITLE, { cut: true });
    this.ui.setModeClass('TITLE');
  }

  startRace() {
    if (this.race.state !== RACE.TITLE && this.race.state !== RACE.RESULT) return;
    this.audio.init();
    this.audio.setMusic(null);
    this.resetWorld();
    this.ui.showTitle(false);
    this.ui.hideResult();
    this.ui.showHUD(true);
    this.ui.setTV(false);
    this.ui.showTouch(this.input.isTouch);
    this.race.startCountdown();
    this.cameraDirector.setMode(MODES.START, { cut: true });
    this.cameraDirector.changes = 0;
    this.autopilot = this.params.has('auto');
  }

  warpTo(km) {
    const target = this.distance.kmToUnits(km);
    const delta = target - this.player.s;
    this.player.s = target;
    for (let i = 0; i < this.ai.n; i++) this.ai.s[i] += delta;
    this.course.reset(target);
    this.events.skipTo(km);
    this.distance.raceTime = (km * 1000) / (this.distance.displayCruiseKmh / 3.6);
    this.cameraDirector.setMode(this.events.current.camera, { cut: true });
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause').classList.toggle('hidden', !p);
  }

  showResult() {
    this.race.showResult();
    const st = this.race.stats;
    this.ui.showResult({
      mode: this.mode,
      km: this.data.goalKm,
      nearMiss: st.nearMiss,
      time: st.finishTime,
      position: st.finishPosition,
      total: this.race.total,
      cheer: this.cheer.cheer,
      maxKmh: this.distance.displayKmh(this.player.maxSpeed),
      overtakes: st.overtakes,
      falls: st.falls,
      maxCombo: this.cheer.maxCombo,
      cameraChanges: this.cameraDirector.changes,
    });
    this.ui.showTouch(false);
  }

  // テスト・デモ用の自動操縦（?auto=1）
  autopilotInput() {
    const p = this.player;
    const rules = this.events.current.rules ?? {};
    const out = { axisX: 0, axisY: p.stamina > 30 ? 1 : 0, dash: p.stamina > 60, jump: false };
    // ?auto=push: ずっと W（ペースアップ）、1500m はラスト 60m でダッシュ（検証用のもう一つの走り方）
    if (this.params.get('auto') === 'push') {
      out.axisY = 1;
      out.dash = this.mode.id === '1500m' ? this.distance.unitsToKm(p.s) > this.data.goalKm - 0.06 : p.stamina > 60;
    }
    if (rules.screenControls) {
      out.axisX = 1;
      out.axisY = 0;
    }
    // シューティング: 一番近いドローンの正面に回り込む
    if (rules.shooter) {
      const d = this.gags.nearestDrone(p);
      if (d && Math.abs(d.x - p.x) > 0.35) out.axisX = d.x > p.x ? 1 : -1;
      return out;
    }
    // 赤信号では止まる（行儀のいい自動操縦）
    const stop = this.gags.stopLine;
    if (stop.active && p.s < stop.s && stop.s - p.s < 24) {
      out.axisY = -1;
      out.dash = false;
    }
    const hz = this.course.hazardAhead(p.s, p.x, 14);
    if (hz) {
      const t = (hz.s - p.s) / Math.max(1, p.speed);
      if (hz.jumpable && t < 0.3 && t > 0.08) out.jump = true;
      else if (!rules.screenControls && typeof rules.lane !== 'number' && (t > 0.3 || !hz.jumpable)) out.axisX = hz.x > p.x ? -1 : 1;
    }
    if (!rules.screenControls && !out.axisX) {
      const ai = this.ai;
      for (let i = 0; i < ai.n; i++) {
        const d = ai.s[i] - p.s;
        if (d > 0 && d < 5 && Math.abs(ai.x[i] - p.x) < 0.9) {
          out.axisX = ai.x[i] > p.x ? -1 : 1;
          if (Math.abs(p.x) > 5.5) out.axisX = p.x > 0 ? -1 : 1;
          break;
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  frame(now) {
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.handleGlobalInput();
    if (this.freeze > 0) {
      // 世界が止まる（750m の「まだ半分です。」/ 写真判定）。カメラも止まり、画面のエフェクトだけ動く
      this.freeze -= realDt;
      this.fx.update(realDt, { player: this.player, tier: this.cheer.tier, excitement: this.cheer.excitement, playing: false });
    } else if (!this.paused) {
      if (this.slowMo > 0) {
        this.slowMo -= realDt;
        this.timeScale = this.slowMo > 0 ? 0.35 : 1;
      }
      // ?fast=N: 検証用。1 フレームにシミュレーションを N 回進める（描画は 1 回）
      for (let i = 0; i < this.fastSteps; i++) this.update(realDt * this.timeScale, realDt);
    }
    this.renderer.info.reset();
    this.fx.render();
    this.input.endFrame();
  }

  handleGlobalInput() {
    const { input, race } = this;
    if (input.pressed('mute')) this.audio.toggleMute();
    if (race.state === RACE.TITLE && (input.pressed('left') || input.pressed('right'))) {
      const i = MODE_ORDER.indexOf(this.modeId);
      const next = MODE_ORDER[(i + (input.pressed('right') ? 1 : MODE_ORDER.length - 1)) % MODE_ORDER.length];
      this.selectMode(next);
    }
    if (race.state === RACE.RESULT && input.pressed('title')) this.backToTitle();
    if ((race.state === RACE.TITLE || race.state === RACE.RESULT) && (input.pressed('confirm') || input.pressed('retry'))) {
      this.startRace();
    }
    if (input.pressed('pause') && race.running) this.setPaused(!this.paused);
  }

  update(dt, realDt) {
    this.time += dt;
    const { race, player, events, cheer } = this;
    const running = race.state === RACE.RUNNING;
    const playing = running || race.state === RACE.FINISHING;
    const km = this.distance.unitsToKm(player.s);
    this.sayCooldown = Math.max(0, this.sayCooldown - realDt);
    this.nearMissCooldown = Math.max(0, this.nearMissCooldown - dt);

    if (running) events.update(km);
    const state = events.current;
    const patch = running ? this.gags.rulesPatch(player) : null;
    const secPatch = running ? this.sections?.rulesPatch(player) : null;
    let rules = patch ? { ...(state.rules ?? {}), ...patch } : state.rules ?? {};
    if (secPatch) rules = { ...rules, ...secPatch };

    player.update(dt, this.input, {
      canControl: running,
      rules,
      cheerBonus: cheer.powerBonus,
      autopilot: this.autopilot && running ? this.autopilotInput() : null,
      finishedJog: race.state === RACE.FINISHING || race.state === RACE.RESULT,
      // 「よーい」でスタートの構え
      ready: race.state === RACE.COUNTDOWN && race.countdown <= 2.05,
    });
    this.course.update(dt, player, running);
    this.ai.update(dt, {
      running: playing || race.state === RACE.RESULT,
      player,
      rules,
      course: this.course,
      finalStretch: !!state.calm,
      goalS: race.goalS,
      excitement: cheer.excitement,
      stopLine: this.gags.stopLine,
      avoid: this.sections?.avoidFn,
    });
    // シューティング中の射撃（SPACE / JUMP 長押しで連射）
    const fire = running && !!rules.shooter && (this.autopilot ? true : this.input.held('jump'));
    if (playing) this.gags.update(dt, player, { fire });
    this.sections?.update(dt, { running, playing, km, state, rules });
    race.update(dt);

    // 声援の条件
    const nearCrowd = Math.abs(player.x) > 4.9 && state.crowd > 0.3;
    if (running) this.updateCheerMoments(dt, state);
    cheer.update(dt, {
      running,
      position: race.position,
      total: race.total,
      cheerMul: state.cheerMul,
      crowdDensity: state.crowd,
      nearCrowd,
      finalStretch: !!state.calm || race.state === RACE.FINISHING,
    });

    this.crowd.update(player.s, dt, cheer.excitement);
    const roll = running ? this.sections?.cameraRoll?.() ?? state.roll ?? 0 : 0;
    this.cameraDirector.update(dt, { player, time: this.time, roll });
    this.ui.cctvTime(this.distance.raceTime);
    const camMode = this.cameraDirector.mode;
    // 自分を見失いやすい視点では頭上に YOU マーカー（中継・真横・真上・写真判定・重力が傾いた区間）
    const tilted = Math.abs(this.sections?.tilt ?? 0) > 5;
    this.marker.visible =
      playing && (camMode === MODES.TV_BROADCAST || camMode === MODES.SIDE_2D || camMode === MODES.TOP_DOWN || camMode === MODES.PHOTO || tilted);
    this.path.toWorld(player.s, player.x, player.y + 2.7 + Math.sin(this.time * 6) * 0.1, this.marker.position);
    // カメラとプレイヤーの間にいる AI ランナーは透かす（主役が群衆に埋もれないように）
    const cp = this.camera.position;
    const pw = player.position;
    const camDist = Math.hypot(cp.x - pw.x, cp.y - (pw.y + 1), cp.z - pw.z);
    this.ai.material.userData.uniforms.uNearFade.value = camDist < 14 ? camDist - 1.2 : 0;
    this.chunks.update(player.s, dt, this.cameraDirector.sideBlend);
    const skyAmt = this.chunks.skyAmount(player.s);
    const stadAmt = this.chunks.stadiumAmount(player.s);
    if (skyAmt + stadAmt * 7 !== this.lastSkyAmt) {
      this.lastSkyAmt = skyAmt + stadAmt * 7;
      const su = this.sky.material.uniforms;
      su.uTop.value.copy(SKY_NIGHT.top).lerp(SKY_DAY.top, skyAmt);
      su.uMid.value.copy(SKY_NIGHT.mid).lerp(SKY_DAY.mid, skyAmt);
      su.uHorizon.value.copy(SKY_NIGHT.horizon).lerp(SKY_DAY.horizon, skyAmt);
      this.scene.fog.color.copy(SKY_NIGHT.fog).lerp(SKY_DAY.fog, skyAmt);
      // スタジアムは照明で明るい
      this.hemi.intensity = 1.0 + skyAmt * 0.9 + stadAmt * 0.55;
    }
    this.fx.update(dt, { player, tier: cheer.tier, excitement: cheer.excitement, playing });
    this.crowd.setPointScale(this.fx.pointScale);
    this.audio.update(realDt, { excitement: cheer.excitement, playing });

    // プレイヤー周りのネオンライト / 空は常にカメラ中心
    this.path.toWorld(player.s - 1.5, player.x, 2.6, this.playerLight.position);
    this.playerLight.color.setHSL(0.52 - cheer.tier * 0.09, 1, 0.6);
    this.sky.position.copy(this.camera.position);

    if (playing || race.state === RACE.RESULT) {
      const area = this.chunks.areaAt(Math.max(0, km));
      this.ui.update({
        position: race.state === RACE.RUNNING ? race.position : race.stats.finishPosition || race.position,
        total: race.total,
        cheer: cheer.cheer,
        combo: cheer.combo,
        km: clamp(km, 0, race.state === RACE.RUNNING ? 99 : this.data.goalKm),
        fullKm: this.mode.fullKm,
        time: this.distance.raceTime,
        stamina: player.stamina,
        exhausted: player.exhausted,
        kmh: this.distance.displayKmh(player.speed),
        area: `${area.name}  ${area.en}`,
        tier: cheer.tier,
      });
    }

    if (this.resultTimer > 0) {
      this.resultTimer -= realDt;
      if (this.resultTimer <= 0) this.showResult();
    }

    if (this.params.has('debug')) {
      const info = this.renderer.info.render;
      this.ui.debug(
        `fps ${this.fx.fps?.toFixed(0) ?? '-'}  q${this.fx.quality}  calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k\n` +
          `km ${km.toFixed(3)}  mode ${this.cameraDirector.mode}  state ${race.state}  speed ${player.speed.toFixed(1)}`
      );
    }
  }

  updateCheerMoments(dt, state) {
    const { player, cheer, ai } = this;
    // 観客とハイタッチ（柵ぎりぎりを走る）
    this.highFiveTimer -= dt;
    if (Math.abs(player.x) > 5.9 && player.grounded && player.speed > 8 && state.crowd > 0.4 && this.highFiveTimer <= 0) {
      cheer.add('highFive', { scale: 0.6 });
      this.highFiveTimer = 0.9;
    }
    // ライバルとの競り合い
    const gap = Math.abs(ai.rivalS - player.s);
    if (gap < 2.4 && Math.abs(ai.rivalX - player.x) < 3) {
      this.duelTimer += dt;
      if (this.duelTimer > 2.5) {
        this.duelTimer = 0;
        cheer.add('duel');
        this.say(pick(LINES.duel));
      }
    } else {
      this.duelTimer = Math.max(0, this.duelTimer - dt);
    }
    // ゴール前スプリント
    if (state.calm && player.dashing) {
      this.sprintTimer -= dt;
      if (this.sprintTimer <= 0) {
        cheer.add('finalSprint');
        this.sprintTimer = 1;
      }
    }
  }
}
