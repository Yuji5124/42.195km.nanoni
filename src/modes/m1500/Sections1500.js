import * as THREE from 'three';
import { MODES } from '../../config.js';
import { clamp, damp, smoothstep } from '../../core/math.js';
import { TV_SHOTS_1500 } from '../../director/CameraDirector.js';
import { DodgeField } from './DodgeField.js';

// 「1500m、なのに。」の区間演出。
// EventDirector（segmented）が区間の切り替わりを 'event' で知らせ、ここで各区間の
//   enter()  … 入った瞬間（カメラ以外の特殊演出を開始）
//   update() … 区間中
//   exit()   … 出る瞬間（開始したものを必ず片付ける → 次の区間に漏れない）
// を呼ぶ。カメラ・エフェクト・BGM・観客・障害物などの「状態」は JSON 側（区間ごとに defaults からやり直し）。
// ここでは JSON で書けない動き（重力の傾き・鏡・中継テロップ・写真判定…）だけを扱う。

const DEG = Math.PI / 180;
const WR_1500 = 206.0; // 3:26.00

// ---- 重力シフト中に「新しい下」へ落ちていく紙くず・花びら
class GravityDebris {
  constructor(scene, path) {
    this.path = path;
    this.n = 110;
    const geo = new THREE.PlaneGeometry(0.34, 0.24);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.n);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const palette = [0xffffff, 0xffc0d8, 0xffd23f, 0xff7a3a, 0x9ff2ff].map((c) => new THREE.Color(c));
    for (let i = 0; i < this.n; i++) this.mesh.setColorAt(i, palette[i % palette.length]);
    scene.add(this.mesh);
    this.p = [];
    this.acc = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  reset() {
    this.p.length = 0;
    this.mesh.count = 0;
  }

  // tilt: 画面の傾き（ラジアン）。下 = (x: +sin, y: -cos)
  update(dt, player, tilt, emit) {
    if (emit > 0) {
      this.acc += dt * 40 * emit;
      while (this.acc > 1 && this.p.length < this.n) {
        this.acc -= 1;
        this.p.push({
          s: player.s + 3 + Math.random() * 34,
          x: -9 + Math.random() * 18,
          y: 1.5 + Math.random() * 9,
          vx: 0,
          vy: 0,
          rx: Math.random() * 6,
          ry: Math.random() * 6,
          life: 0,
        });
      }
    }
    const gx = Math.sin(tilt) * 7;
    const gy = -Math.cos(tilt) * 7;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const q = this.p[i];
      q.life += dt;
      q.vx = damp(q.vx, gx, 1.5, dt);
      q.vy = damp(q.vy, gy, 1.5, dt);
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.rx += dt * 5;
      q.ry += dt * 3.3;
      if (q.life > 4 || q.s < player.s - 6 || Math.abs(q.x) > 16 || q.y < -0.5 || q.y > 22) this.p.splice(i, 1);
    }
    for (let i = 0; i < this.p.length; i++) {
      const q = this.p[i];
      this.path.toWorld(q.s, q.x, q.y, this._v);
      this._e.set(q.rx, q.ry, q.rx * 0.5);
      this._m.compose(this._v, this._q.setFromEuler(this._e), this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.count = this.p.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---- 各区間
const zap = (S, label) => {
  S.g.fx.glitchBurst(1);
  S.g.audio.glitch();
  S.g.ui.camTag(label, 2600);
};

const TICKER = {
  enter(S) {
    S.g.ui.setTicker(true);
    S.tickerAcc = 1;
  },
  update(S, dt) {
    S.tickerAcc += dt;
    if (S.tickerAcc > 0.25) {
      S.tickerAcc = 0;
      S.updateTicker();
    }
  },
  exit(S) {
    S.g.ui.setTicker(false);
  },
};

const MIRROR_WORLD = {
  enter(S, { silent, fixControls }) {
    S.ghost.show(true);
    S.g.ui.setMirrorHUD(true);
    S.invertT = fixControls ? 0 : 3.2;
    if (!silent && !fixControls) {
      S.g.ui.hint(S.g.input.isTouch ? '◀▶ が左右反対に…！（すぐ慣れます）' : '← → が左右反対に…！（すぐ慣れます）', 3200);
      S.g.cheer.add('mirrorPass');
      S.g.fx.flash(0.6);
      S.g.burstAt({ s: S.g.player.s + 2, x: S.g.player.x, y: 1.5 }, [1.6, 1.8, 2.0], 60);
    }
  },
  update(S, dt) {
    if (S.invertT > 0) {
      S.invertT -= dt;
      if (S.invertT <= 0) S.g.ui.hint('…慣れました。操作は画面どおり', 2400);
    }
    const p = S.g.player;
    // 反対側で、もう一人の侍がこちらを向いて後ろ向きに走る
    const side = p.x >= 0 ? -1 : 1;
    S.ghost.place(p.s + 4.5, side * Math.max(2.4, Math.abs(p.x)), p.y, Math.PI, p.speed, dt);
  },
  // 最初の数秒だけ「見た目どおりに反転」、そのあとは画面の左右に合わせる
  rules(S) {
    return S.invertT > 0 ? null : { invertX: true };
  },
  exit(S) {
    S.ghost.show(false);
    S.g.ui.setMirrorHUD(false);
    S.invertT = 0;
  },
};

const HANDLERS = {
  stadium_start: {},

  tokyo_road: {},

  racing: {
    enter(S) {
      S.g.audio.setEngine?.(true);
    },
    update(S) {
      S.g.audio.engine?.(S.g.player.speed);
    },
    exit(S) {
      S.g.audio.setEngine?.(false);
    },
  },

  side_scroll: {},

  top_dodge: {
    enter(S) {
      S.dodge.start();
    },
    update(S) {
      if (S.f > 0.9) S.dodge.stop();
    },
    exit(S) {
      S.dodge.stop();
    },
  },

  // 750m: 世界が止まる。BGM も止まる。「まだ半分です。」
  halfway: {
    enter(S, { silent }) {
      if (silent) return;
      S.g.freeze = 1.6;
      S.g.ui.bigDist('750m', 'まだ半分です。');
      S.g.audio.setMusic(null);
      S.g.audio.hush?.(2.2);
    },
  },

  // 750〜900m: 0 → 10 → 30 → 60 → 90° と世界が傾き、重力が横へずれる
  gravity: {
    enter(S) {
      S.tilt = 0;
      S.tiltTarget = 0;
      S.wallT = 0;
    },
    update(S, dt) {
      const steps = [
        [0.04, 10],
        [0.2, 30],
        [0.38, 60],
        [0.56, 90],
        [0.9, 0],
      ];
      let target = 0;
      for (const [at, deg] of steps) if (S.f >= at) target = deg;
      if (target !== S.tiltTarget) {
        const up = target > S.tiltTarget;
        S.tiltTarget = target;
        S.g.cameraDirector.shake(up ? 0.45 : 0.25);
        S.g.audio.creak?.(target);
        if (target > 0) S.g.ui.camTag(`GRAVITY ${target}°`, 1800);
        if (target === 30) S.g.say('傾いています！ 確実に傾いています！', true);
        if (target === 90) S.g.say('ランナーたちが…壁を走っています！', true);
        if (target === 0) S.g.say('重力、戻りました！ …あれ、この先に鏡が？', true);
      }
      // 段ごとに「ぐぐっ」と傾く
      S.tilt = damp(S.tilt, S.tiltTarget, 2.6, dt);
      S.roll = S.tilt;
      const rad = S.tilt * DEG;
      S.debris.update(dt, S.g.player, rad, S.tiltTarget > 0 ? 1 : 0);
      S.g.player.gravityTilt = rad;
      // 壁走り（90° 近くで走り続ける）
      if (S.tilt > 80 && S.g.player.grounded) {
        S.wallT += dt;
        if (S.wallT > 2.5) {
          S.wallT = 0;
          S.g.cheer.add('wallRun');
        }
      }
    },
    rules(S) {
      const rad = S.tilt * DEG;
      return { pullX: Math.sin(rad) * 2.3 };
    },
    exit(S) {
      S.roll = undefined;
      S.tilt = 0;
      S.debris.reset();
      S.g.player.gravityTilt = 0;
    },
  },

  mirror: MIRROR_WORLD,

  tv: {
    enter(S) {
      TICKER.enter(S);
      S.bellRung = false;
    },
    update(S, dt) {
      TICKER.update(S, dt);
      // 1100m = 残り 400m: 最終周回の鐘（公道ですが）
      if (!S.bellRung && S.km >= 1.1) {
        S.bellRung = true;
        S.g.audio.bell?.();
        S.g.ui.fever('LAST LAP', 2000);
        S.g.cheer.add('lastLap');
        S.g.say('ラスト 1 周の鐘です！ …ここ、公道ですけど！', true);
      }
    },
    exit(S) {
      TICKER.exit(S);
    },
  },

  // 1200〜1350m: 観客が多すぎる（歩道・歩道橋・ビルの窓・屋上）
  mega_crowd: {
    enter(S) {
      S.g.chunks.setCrowdWindows?.(1);
      S.g.ui.setCheerFocus(true);
      S.burstT = 1;
    },
    update(S, dt) {
      S.burstT -= dt;
      if (S.burstT <= 0) {
        S.burstT = 1.1 + Math.random() * 0.8;
        const v = S.g.path.toWorld(S.g.player.s + 18 + Math.random() * 10, (Math.random() - 0.5) * 12, 0, new THREE.Vector3());
        S.g.fx.confettiBurst(v, 70, 7);
      }
    },
    exit(S) {
      S.g.chunks.setCrowdWindows?.(0);
      S.g.ui.setCheerFocus(false);
    },
  },

  // 1350〜1450m: 全部のジャンルが短く切り替わる（どれも 20m ≒ 4 秒）
  mix_race: {
    enter(S) {
      zap(S, 'CH 1 ─ RACING');
      S.g.audio.setEngine?.(true);
    },
    update(S) {
      S.g.audio.engine?.(S.g.player.speed);
    },
    exit(S) {
      S.g.audio.setEngine?.(false);
    },
  },
  mix_top: {
    enter(S) {
      zap(S, 'CH 2 ─ TOP VIEW');
      S.dodge.start({ gentle: true });
    },
    exit(S) {
      S.dodge.stop();
    },
  },
  mix_side: {
    enter(S) {
      zap(S, 'CH 3 ─ SIDE VIEW');
    },
  },
  mix_tv: {
    enter(S) {
      zap(S, 'CH 4 ─ LIVE');
      TICKER.enter(S);
    },
    update(S, dt) {
      TICKER.update(S, dt);
    },
    exit(S) {
      TICKER.exit(S);
    },
  },
  mix_mirror: {
    enter(S, opts) {
      zap(S, 'CH 5 ─ MIRROR');
      MIRROR_WORLD.enter(S, { ...opts, fixControls: true });
    },
    update(S, dt) {
      MIRROR_WORLD.update(S, dt);
    },
    rules() {
      return { invertX: true };
    },
    exit(S) {
      MIRROR_WORLD.exit(S);
    },
  },

  // 1450〜1500m: 全部止まって、普通のスタジアム。足音と息づかいと観客だけ
  stadium_finish: {
    enter(S, { silent }) {
      S.g.course.clearAhead(S.g.player.s + 4);
      S.g.audio.setBreath?.(true);
      S.g.cameraDirector.goalS = S.g.race.goalS;
      if (!silent) S.g.ui.fever('LAST 50m', 1600);
      S.photo = false;
    },
    update(S) {
      const p = S.g.player;
      const goalS = S.g.race.goalS;
      // 写真判定カメラ: ゴール直前で真横に切り替え、スローモーション
      if (!S.photo && S.g.race.running && p.s > goalS - 14) {
        S.photo = true;
        S.g.cameraDirector.setMode(MODES.PHOTO, { cut: true });
        S.g.slowMo = 2.2;
        S.g.ui.camTag('PHOTO FINISH CAM', 2400);
        S.g.fx.glitchBurst(0.3);
      }
    },
    exit(S) {
      S.g.audio.setBreath?.(false);
    },
  },
};

export class Sections1500 {
  constructor(game) {
    this.g = game;
    this.dodge = new DodgeField(game.scene, game.path, {
      onHit: (kind) => this.onDodgeHit(kind),
      onNearMiss: (kind, d) => this.onDodgeNearMiss(kind, d),
      onLand: (kind, s, x) => {
        game.audio.tarai?.(kind);
        game.burstAt({ s, x, y: 0.4 }, [1.6, 1.3, 0.5], 10);
      },
    });
    this.debris = new GravityDebris(game.scene, game.path);
    this.ghost = game.player.createGhost(game.scene);
    this.avoidFn = (s, x) => this.dodge.avoid(s, x);
    // 1500m の中継はカメラ名を CAM 01 / TRACKING / HELICOPTER / GOAL CAM に
    game.cameraDirector.tvShots = TV_SHOTS_1500;
    game.cameraDirector.startStyle = 'line';
    this.reset();
  }

  wire(bus) {
    bus.on('event', ({ event, silent }) => {
      const id = event.id === 'warp' ? this.g.events.segmentAt(event.km)?.id : event.id;
      this.enter(id, !!silent);
    });
  }

  reset() {
    if (this.cur) this.cur.exit?.(this);
    this.cur = null;
    this.id = null;
    this.t = 0;
    this.f = 0;
    this.km = 0;
    this.roll = undefined;
    this.tilt = 0;
    this.invertT = 0;
    this.photo = false;
    this.finishT = 0;
    this.finishCam = false;
    this.lapNo = 0;
    this.comebackFrom = null;
    this.closeT = 0;
    this.fastT = 0;
    this.dodge.reset();
    this.debris.reset();
    this.ghost.show(false);
    this.g.player.gravityTilt = 0;
    this.g.ui.setTicker(false);
    this.g.ui.setMirrorHUD(false);
    this.g.ui.setCheerFocus(false);
    this.g.chunks.setCrowdWindows?.(0);
  }

  enter(id, silent = false) {
    if (id === this.id) return;
    this.cur?.exit?.(this);
    this.id = id;
    this.cur = HANDLERS[id] ?? {};
    this.t = 0;
    const events = this.g.events.events;
    const k = events.findIndex((e) => e.id === id);
    this.fromKm = k >= 0 ? Math.max(0, events[k].km) : 0;
    this.toKm = k >= 0 && k + 1 < events.length ? events[k + 1].km : this.g.data.goalKm;
    this.cur.enter?.(this, { silent });
  }

  update(dt, ctx) {
    if (!ctx.playing) return;
    const p = this.g.player;
    this.km = ctx.km;
    this.t += dt;
    this.f = clamp((ctx.km - this.fromKm) / Math.max(1e-6, this.toKm - this.fromKm), 0, 1);
    if (ctx.running) this.cur?.update?.(this, dt, ctx);
    this.dodge.update(dt, p, ctx.running);
    if (ctx.running) this.updateCheerMoments(dt, ctx);
    this.updateFinish(dt);
  }

  rulesPatch(player) {
    return this.cur?.rules?.(this, player) ?? null;
  }

  cameraRoll() {
    return this.roll;
  }

  // ---- 中継テロップ
  updateTicker() {
    const g = this.g;
    const m = g.distance.unitsToKm(g.player.s) * 1000;
    const remain = Math.max(0, Math.ceil((1500 - m) / 10) * 10);
    // 1500m = 最初の 300m + 400m × 3 周
    const lap = m < 300 ? 1 : Math.min(4, 2 + Math.floor((m - 300) / 400));
    const lapStart = lap === 1 ? 0 : 300 + (lap - 2) * 400;
    if (this.lapNo !== lap) {
      this.lapNo = lap;
      this.lapStartT = g.distance.raceTime - ((m - lapStart) / 1000) * (3600 / g.distance.displayCruiseKmh);
    }
    const lapT = Math.max(0, g.distance.raceTime - this.lapStartT);
    // 順位表（上位 4 人）
    const board = [];
    const ai = g.ai;
    const entries = [{ name: '侍ランナー', s: g.player.s, you: true }];
    for (let i = 0; i < ai.n; i++) entries.push({ name: ai.nameOf(i), s: ai.s[i] });
    entries.sort((a, b) => b.s - a.s);
    entries.slice(0, 4).forEach((e, k) => board.push(`${k + 1}位 ${e.name}${e.you ? ' ◀' : ''}`));
    const pos = g.race.position;
    const scroll = `侍ランナー ${pos}位 ─ 残り ${remain}m ─ CHEER ${g.cheer.cheer.toLocaleString('en-US')} ─ ${board.join('　')} ─ LAP ${lap} / 4`;
    g.ui.ticker({
      lap: lap === 4 ? 'LAST LAP' : `LAP ${lap} / 4`,
      lapTime: `${Math.floor(lapT / 60)}:${(lapT % 60).toFixed(1).padStart(4, '0')}`,
      scroll,
      lastLap: lap === 4,
    });
  }

  // ---- 見下ろし回避
  onDodgeHit(kind) {
    const g = this.g;
    g.player.hitStagger(0.5, 0.5);
    g.cameraDirector.shake(0.5);
    g.cheer.add('dodgeHit', { label: kind === 'drop' ? 'ゴーン…' : 'ドラム缶…' });
    g.say(kind === 'drop' ? '金ダライが直撃！ …1500m 決勝です！' : 'ドラム缶に当たった！ …陸上競技です！');
    g.audio.bump();
  }

  onDodgeNearMiss(kind, d) {
    this.g.cheer.add('dodge', { scale: d < 1.8 ? 1.5 : 1 });
    this.g.audio.whoosh();
  }

  // ---- 1500m の見せ場（追い抜き・先頭は既存の仕組み）
  updateCheerMoments(dt, ctx) {
    const g = this.g;
    const p = g.player;
    const m = ctx.km * 1000;
    // 高速走行
    if (p.speed > 21.5) {
      this.fastT += dt;
      if (this.fastT > 1.6) {
        this.fastT = 0;
        g.cheer.add('highSpeed');
      }
    } else this.fastT = 0;
    // 終盤の追い上げ（1200m で 6 位以下 → 3 つ以上順位を上げる）
    if (m > 1200 && this.comebackFrom === null) this.comebackFrom = g.race.position;
    if (this.comebackFrom !== null && this.comebackFrom >= 6 && g.race.position <= this.comebackFrom - 3) {
      this.comebackFrom = -99;
      g.cheer.add('comeback');
      g.say('ここで追い上げてきた！ 侍ランナー、ごぼう抜き！', true);
    }
    // 接戦（ラスト 300m で誰かとほぼ並んでいる）
    if (m > 1200) {
      let close = false;
      for (let i = 0; i < g.ai.n; i++) if (Math.abs(g.ai.s[i] - p.s) < 1.6 && Math.abs(g.ai.x[i] - p.x) < 3) close = true;
      this.closeT = close ? this.closeT + dt : Math.max(0, this.closeT - dt);
      if (this.closeT > 2.2) {
        this.closeT = 0;
        g.cheer.add('closeRace');
      }
    }
  }

  // ---- フィニッシュ（Game の 'finish' から）。写真判定の演出を担当したら true
  onFinish(position) {
    const g = this.g;
    this.finishT = 0.001;
    this.finishPos = position;
    g.freeze = 1.1;
    g.fx.setPreset('photo');
    g.fx.flash(0.3);
    g.audio.shutter?.();
    g.ui.photoFinish(g.ui.formatTime(g.race.stats.finishTime), position);
    const close = g.ai.n > 0 && [...g.ai.s].some((s) => Math.abs(s - g.player.s) < 2.5);
    if (close) g.cheer.add('photoFinish');
    return true;
  }

  updateFinish(dt) {
    if (!this.finishT) return;
    this.finishT += dt;
    const g = this.g;
    // 写真判定の静止画 → いつものゴール映像へ
    if (this.finishT > 0.9 && !this.finishCam) {
      this.finishCam = true;
      g.fx.setPreset('goal');
      g.cameraDirector.setMode(MODES.GOAL, { transition: 1.2 });
      const t = g.race.stats.finishTime;
      if (t < WR_1500) g.say('世界記録…!? いや、1500m しか走っていません！', true);
    }
  }
}
