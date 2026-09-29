import * as THREE from 'three';
import { EventBus, EV } from './events.js';
import { Clock, STEP } from './clock.js';
import { Input } from './input.js';
import { SeedBank, randomSeed } from './seed.js';
import { readParams } from './debug.js';
import { QUALITY, pickQuality } from './quality.js';
import { clamp, formatTime } from './mathx.js';
import { RUNNERS } from '../data/runners.js';
import { PERSONALITIES } from '../data/personalities.js';
import { RaceCore, RACE_STATE } from '../race/raceCore.js';
import { TRACK } from '../race/trackLogic.js';
import { PHYS } from '../race/physiology.js';
import { Bot } from '../runners/bot.js';
import { RunnerManager } from '../runners/runnerManager.js';
import { buildTrack } from '../stadium/track.js';
import { buildStands, CROWD_UNIFORMS } from '../stadium/stands.js';
import { Crowd, SPECTATOR_UNIFORMS } from '../stadium/crowd.js';
import { CrowdEnergy } from '../stadium/cheer.js';
import { buildProps } from '../stadium/props.js';
import { Lighting } from '../stadium/lighting.js';
import { WorldDeform } from '../stadium/worldDeform.js';
import { CameraRig } from '../camera/cameraRig.js';
import { PostProcessing } from '../fx/postProcessing.js';
import { GLOBAL_UNIFORMS } from '../fx/materialPatch.js';
import { createPresentation, resetPresentation } from '../modifiers/presentation.js';
import { Hud } from '../ui/hud.js';

// Game: 組み立てと配線だけの薄い層。
//   RaceCore（壊れない） ← 意図（入力 / Bot） … 1/60 秒固定
//   Presentation（壊してよい） ← Modifier … 毎フレーム作り直し
//   Renderer / Camera / HUD / Audio ← Presentation と RaceCore を読むだけ

const $ = (s) => document.querySelector(s);

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.params = readParams();
    this.qualityName = pickQuality(this.params.quality);
    this.quality = QUALITY[this.qualityName];
    this.bus = new EventBus();
    this.P = createPresentation();
    this.phase = 'title';
    this.devOpen = this.params.debug;
    this.fps = 60;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.fpsHistory = [];
  }

  get cheer() {
    return this.cheerSys?.value ?? 20;
  }

  async init() {
    await this.loadFonts();
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);

    this.deform = new WorldDeform();
    this.lighting = new Lighting(this.scene);
    this.stadium = new THREE.Group();
    this.scene.add(this.stadium);
    this.track = buildTrack(this.deform);
    this.stadium.add(this.track);
    this.stands = buildStands(this.deform, this.quality.standRows);
    this.stadium.add(this.stands);
    this.props = buildProps(this.deform, this.stands.userData.top);
    this.stadium.add(this.props.group);
    this.crowd = new Crowd(this.stadium, this.deform, this.quality.crowd, new SeedBank(800).stream('crowd'));
    this.cheerSys = new CrowdEnergy(this.bus);

    this.core = new RaceCore(RUNNERS, this.bus);
    this.runners = new RunnerManager(this.scene, RUNNERS, this.deform);
    this.rig = new CameraRig(this.camera);
    this.post = new PostProcessing(renderer, this.scene, this.camera, this.quality);
    this.hud = new Hud();
    this.input = new Input($('#ui'));
    this.clock = new Clock({ fast: this.params.fast });

    this.wire();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.setupScreens();
    this.exposeDebug();

    this.seed = this.params.seed ?? randomSeed();
    $('#seedInput').value = this.seed;
    this.prepareRace(this.seed);
    if (this.params.autopilot || this.params.start) setTimeout(() => this.startRace(), 250);
    renderer.setAnimationLoop((now) => this.frame(now));
  }

  async loadFonts() {
    if (!document.fonts?.load) return;
    const fonts = ['40px "Dela Gothic One"', '40px "DotGothic16"', 'bold 40px "Chakra Petch"'];
    await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f, 'あ800m').catch(() => null))), new Promise((r) => setTimeout(r, 2000))]);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.resize(w, h, Math.min(devicePixelRatio, this.quality.pixelRatio));
  }

  // ------------------------------------------------------------------
  wire() {
    const { bus, hud } = this;
    bus.on(EV.ON_YOUR_MARKS, () => hud.call('On your marks', 1600));
    bus.on(EV.SET, () => hud.call('Set', 1200));
    bus.on(EV.RACE_START, () => {
      hud.call('', 10);
      this.post.flashOnce(0.35);
      this.shake = 0.3;
    });
    bus.on(EV.RHYTHM, ({ grade }) => hud.step(grade));
    bus.on(EV.FINISH, () => {
      this.finishRealTime = this.clock.realTime;
      this.post.flashOnce(0.5);
    });
    bus.on(EV.RACE_END, () => (this.raceEndTime = this.clock.realTime));
  }

  setupScreens() {
    $('#title').addEventListener('pointerdown', (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'reroll') {
        this.seed = randomSeed();
        $('#seedInput').value = this.seed;
        this.prepareRace(this.seed);
        return;
      }
      if (e.target.closest('input')) return;
      this.startRace();
    });
    $('#seedInput').addEventListener('change', (e) => {
      const v = parseInt(e.target.value, 10);
      if (Number.isFinite(v) && v >= 0) {
        this.seed = v;
        this.prepareRace(v);
      }
    });
    $('#result').addEventListener('pointerdown', (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'same') this.restart(this.seed);
      else if (a === 'new') this.restart(randomSeed());
    });
    $('#devpanel').addEventListener('pointerdown', (e) => {
      const a = e.target.closest('[data-dev-action]')?.dataset.devAction;
      if (a) this.devAction(a);
    });
  }

  // seed からレースを用意（CPU の性格・スタートの間）。まだ走らない
  prepareRace(seed) {
    this.seed = seed;
    this.bank = new SeedBank(seed);
    const botRng = this.bank.stream('bots');
    this.bots = RUNNERS.map((def) => (def.isPlayer ? null : new Bot(def, botRng)));
    this.autoBot = Bot.autopilot(this.params.autopilotStyle, this.bank.stream('autopilot'));
    this.autopilot = this.params.autopilot;
    this.core.reset(this.params.distance);
    // 同じ性格でも、その日の調子は seed で少し違う
    this.core.runners.forEach((r, i) => (r.talent = this.bots[i]?.talent ?? 1));
    this.runners.reset();
    this.cheerSys.reset();
    this.finishRealTime = null;
    this.raceEndTime = null;
    this.phase = 'title';
    document.body.dataset.phase = 'title';
    this.hud.show(false);
    this.bus.log = [];
    this.bus.emit(EV.RACE_READY, { seed });
  }

  startRace() {
    if (this.phase !== 'title') return;
    this.phase = 'race';
    document.body.dataset.phase = 'race';
    $('#title').classList.add('hidden');
    $('#result').classList.add('hidden');
    this.hud.show(true);
    $('#touch').classList.toggle('hidden', !this.input.isTouch);
    const rng = this.bank.stream('start');
    if (this.params.distance > 0) {
      // 途中開始: 号砲なしで走っている状態から
      this.core.state = RACE_STATE.RUNNING;
      this.bus.emit(EV.RACE_START, { startDistance: this.params.distance });
    } else this.core.begin(rng.range(0.9, 1.5));
    this.raceStartReal = this.clock.realTime;
  }

  restart(seed) {
    this.prepareRace(seed);
    $('#seedInput').value = seed;
    this.startRace();
  }

  // ------------------------------------------------------------------
  intents() {
    const core = this.core;
    const env = this.env();
    return core.runners.map((r, i) => {
      if (r.isPlayer) {
        if (this.autopilot) return this.autoBot.intent(core, r, env);
        const inp = this.input;
        const ax = inp.effortAxis;
        const effort = PHYS.effort.normal + (ax > 0 ? ax * (PHYS.effort.push - PHYS.effort.normal) : ax * (PHYS.effort.normal - PHYS.effort.conserve));
        return { effort, burst: inp.held('burst'), lateral: inp.lateralAxis, step: inp.pressed('step') };
      }
      return this.bots[i].intent(core, r, env);
    });
  }

  env() {
    return {
      crowd: this.cheer / 100,
      cheer: this.cheer,
      chaos: this.chaosLevel ?? 0,
      cameraSubject: this.cameraSubject ?? -1,
    };
  }

  frame(now) {
    const { core } = this;
    this.handleGlobalInput();
    const steps = this.paused ? 0 : this.clock.tick(now, this.P.time.sim);
    for (let i = 0; i < steps; i++) {
      core.step(STEP, this.intents(), { cheer: this.cheer });
      this.bus.time = core.time;
      this.input.endFrameStep?.();
    }
    const dt = this.clock.realDt;
    this.updatePresentation(dt);
    this.updateView(dt);
    this.renderer.info.reset();
    this.post.render(this.P.camera.split4 ? this.split4Cameras() : null);
    this.trackFps(dt);
    this.input.endFrame();
    this.checkEnd();
  }

  handleGlobalInput() {
    const inp = this.input;
    if (inp.pressed('debug')) this.toggleDev();
    if (this.phase === 'title' && inp.pressed('confirm') && document.activeElement?.id !== 'seedInput') this.startRace();
    if (this.phase === 'result') {
      if (inp.pressed('retry')) this.restart(this.seed);
      else if (inp.pressed('newSeed') || inp.pressed('confirm')) this.restart(randomSeed());
    }
    if (this.phase === 'race' && inp.pressed('pause')) {
      this.paused = !this.paused;
      $('#pause').classList.toggle('hidden', !this.paused);
    }
  }

  // Presentation を作り直す（Phase 3 で ModifierManager / ChaosDirector がここに入る）
  updatePresentation(dt) {
    const P = resetPresentation(this.P);
    const core = this.core;
    const p = core.player;
    // フィニッシュ前後: 写真判定カメラ + スロー
    if (p.finished && this.finishRealTime !== null) {
      const since = this.clock.realTime - this.finishRealTime;
      P.camera.mode = since < 2.2 ? 'FINISH_PHOTO' : 'FINISH_LINE';
      P.time.sim = since < 1.2 ? 0.3 : 1;
    } else if (core.state === RACE_STATE.MARKS || core.state === RACE_STATE.SET || this.phase === 'title') {
      P.camera.mode = 'START';
    } else if (this.params.camera) {
      P.camera.mode = this.params.camera; // ?camera=tv など
    }
    this.modifierHook?.(P, dt);
  }

  updateView(dt) {
    const { P, core } = this;
    const p = core.player;
    // 世界の変形・空・観客
    this.deform.set({ wave: P.world.wave, tilt: P.world.tilt, twist: P.world.twist, fold: P.world.fold, foldX: 20 }, this.clock.realTime);
    this.lighting.mix(P.world.sky, { skyFlip: P.world.skyFlip, light: P.world.light });
    this.lighting.update(dt, this.camera);
    GLOBAL_UNIFORMS.uSnap.value = P.post.snap;
    CROWD_UNIFORMS.uTime.value += dt;
    CROWD_UNIFORMS.uEnergy.value = clamp((this.cheer / 100) * P.crowd.energyMul, 0, 1.5);
    CROWD_UNIFORMS.uWave.value = P.crowd.wave;
    CROWD_UNIFORMS.uWaveP.value = (this.clock.realTime * 40) % 400;
    CROWD_UNIFORMS.uFreeze.value = P.crowd.freeze;
    CROWD_UNIFORMS.uVanish.value = P.crowd.vanish;
    CROWD_UNIFORMS.uSync.value = P.crowd.sync;
    SPECTATOR_UNIFORMS.uTime.value = CROWD_UNIFORMS.uTime.value;
    SPECTATOR_UNIFORMS.uEnergy.value = CROWD_UNIFORMS.uEnergy.value;
    SPECTATOR_UNIFORMS.uFreeze.value = P.crowd.freeze;
    SPECTATOR_UNIFORMS.uSync.value = P.crowd.sync;
    SPECTATOR_UNIFORMS.uWave.value = P.crowd.wave;
    SPECTATOR_UNIFORMS.uWaveP.value = CROWD_UNIFORMS.uWaveP.value;
    this.crowd.update(dt, P.crowd, p.d);
    this.cheerSys.update(dt, core);
    this.stadium.visible = P.world.stadium > 0.5;

    const raceState = core.state === RACE_STATE.MARKS ? 'marks' : core.state === RACE_STATE.SET ? 'set' : 'run';
    this.runners.update(dt, core, P, raceState, this.camera, this.resolveTarget(P.camera.target));

    // カメラ
    const subjectIndex = this.resolveTarget(P.camera.target);
    this.cameraSubject = P.camera.mode === 'TV' ? subjectIndex : -1;
    this.rig.update(
      dt,
      {
        mode: P.camera.mode,
        subject: { view: this.runners.views[subjectIndex], r: core.runners[subjectIndex] },
        cut: P.camera.cut,
        roll: P.camera.roll,
        shake: Math.max(P.camera.shake, this.shake ?? 0),
        fovMul: P.camera.fovMul,
      },
      { onCut: (label) => this.hud.camLabel(label) }
    );
    this.shake = Math.max(0, (this.shake ?? 0) - dt);
    this.post.update(dt, P.post);

    // HUD
    if (this.phase === 'race') {
      const leader = core.ranked[0];
      const leaderDef = RUNNERS[leader.index];
      this.hud.setSkin(P.ui.skin);
      this.hud.update(
        {
          rank: p.rank,
          d: p.d,
          time: core.time,
          stamina: p.stamina,
          cheer: this.cheer,
          kmh: p.v * 3.6,
          leaderName: leaderDef.en,
          leaderStamina: leader.stamina,
          board: core.ranked
            .slice(0, 4)
            .map((r, i) => `${i + 1}  ${RUNNERS[r.index].en.padEnd(9)} ${(r.d - core.ranked[0].d).toFixed(1)}m`)
            .join('\n'),
          rpgLine: `侍 は ${Math.floor(p.d)}m はしった！`,
          runners: core.runners,
          playerIndex: core.playerIndex,
          phase: p.phase,
          stepFreq: p.stepFreq,
        },
        P.ui
      );
      this.hud.fakeBug(P.ui.fake > 0.5, core.time);
      this.props.mirrored = P.ui.boardMirror;
      this.props.draw({ time: core.time, lap: `LAP ${p.d >= 400 ? 2 : 1} / 2`, leader: `1. ${leaderDef.en}` });
    }
  }

  resolveTarget(t) {
    const core = this.core;
    if (typeof t === 'number') return clamp(t, 0, core.n - 1);
    if (t === 'leader') return core.ranked[0].index;
    if (t === 'last') return core.ranked[core.n - 1].index;
    if (t === 'director') return this.directorPick ?? core.playerIndex;
    return core.playerIndex;
  }

  split4Cameras() {
    return null;
  }

  checkEnd() {
    if (this.phase !== 'race') return;
    const core = this.core;
    // 全員ゴール、またはプレイヤーのゴールから 9 秒で結果へ
    const t = this.clock.realTime;
    const done = this.raceEndTime !== null || (this.finishRealTime !== null && t - this.finishRealTime > 9);
    if (done && t - (this.finishRealTime ?? t) > 3.5) this.showResult();
    void core;
  }

  showResult() {
    this.phase = 'result';
    document.body.dataset.phase = 'result';
    this.hud.show(false);
    $('#touch').classList.add('hidden');
    const res = this.core.results();
    this.lastResult = { seed: this.seed, results: res, had: this.raceHistory?.() ?? [] };
    const rows = res
      .map((r) => {
        const def = RUNNERS[r.index];
        const pers = r.isPlayer ? 'YOU' : PERSONALITIES[this.bots[r.index]?.personality]?.label ?? '';
        return `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.place}</td><td>${def.name} <span class="pers">${def.en} ─ ${pers}</span></td><td>${r.finished ? formatTime(r.time) : 'DNF'}</td></tr>`;
      })
      .join('');
    $('[data-results]').innerHTML = rows;
    $('[data-had]').innerHTML = (this.lastResult.had.length ? this.lastResult.had : [{ label: '（何も起きなかった…なのに。）' }])
      .map((h) => `<li class="${h.legendary ? 'legend' : ''}">${h.label}</li>`)
      .join('');
    $('[data-v="seed"]').textContent = this.seed;
    $('#result').classList.remove('hidden');
    this.bus.emit('RESULT_SHOWN', { seed: this.seed });
  }

  // ------------------------------------------------------------------
  toggleDev() {
    this.devOpen = !this.devOpen;
  }

  devAction(a) {
    const core = this.core;
    if (a === 'plus100' || a === 'minus100') {
      const delta = a === 'plus100' ? 100 : -100;
      // 全員を同じだけ動かす（距離は RaceCore の API 経由のみ）
      core.shiftAll(delta);
    } else if (a === 'freeze') this.clock.frozen = !this.clock.frozen;
    else if (a === 'step') this.clock.stepOnce = true;
    else if (a === 'autopilot') this.autopilot = !this.autopilot;
    else if (a === 'restart') this.restart(this.seed);
    else this.devHook?.(a);
  }

  trackFps(dt) {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      if (this.phase === 'race') this.fpsHistory.push(this.fps);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    const dev = $('#devpanel');
    dev.classList.toggle('hidden', !this.devOpen);
    if (this.devOpen) {
      const p = this.core.player;
      const info = this.renderer.info.render;
      $('[data-dev]').textContent =
        `FPS ${this.fps.toFixed(0)}  q:${this.quality.name}  calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k\n` +
        `seed ${this.seed}  state ${this.core.state}  t ${this.core.time.toFixed(2)}\n` +
        `d ${p.d.toFixed(1)}m  rank ${p.rank}  v ${p.v.toFixed(2)}  sta ${p.stamina.toFixed(0)}  cheer ${this.cheer.toFixed(0)}\n` +
        `chaos ${(this.chaosLevel ?? 0).toFixed(2)}  autopilot ${this.autopilot ? 'ON' : 'off'}\n` +
        `mods: ${(this.activeModifierIds?.() ?? []).join(', ') || '-'}`;
    }
  }

  // 自動テスト・AI 観察用の窓口（window.__nanoni）
  exposeDebug() {
    const g = this;
    window.__nanoni = {
      game: g,
      get events() {
        return g.bus.log;
      },
      state() {
        const p = g.core.player;
        return {
          phase: g.phase,
          raceState: g.core.state,
          seed: g.seed,
          d: +p.d.toFixed(2),
          rank: p.rank,
          v: +p.v.toFixed(2),
          stamina: +p.stamina.toFixed(1),
          time: +g.core.time.toFixed(2),
          finished: p.finished,
          fps: +g.fps.toFixed(1),
          chaos: +(g.chaosLevel ?? 0).toFixed(2),
          modifiers: g.activeModifierIds?.() ?? [],
          camera: g.P.camera.mode,
          skin: g.P.ui.skin,
          calls: g.renderer.info.render.calls,
          tris: g.renderer.info.render.triangles,
        };
      },
      result() {
        return g.lastResult ?? null;
      },
      fpsAverage() {
        const h = g.fpsHistory;
        return h.length ? h.reduce((a, b) => a + b, 0) / h.length : 0;
      },
      start: () => g.startRace(),
      restart: (seed) => g.restart(seed ?? g.seed),
    };
  }
}

export { TRACK };
