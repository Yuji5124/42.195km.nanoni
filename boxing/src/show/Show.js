import * as THREE from 'three';
import { POSE } from '../../../soccer/src/crowd/CrowdDirector.js';
import { Particles } from '../../../src/fx/Particles.js';
import { RING } from '../arena/BoxingArena.js';
import { makeHaloTexture, SPONSORS } from '../arena/arenaTextures.js';
import { Commentary } from './Commentary.js';
import { Panels } from './Panels.js';
import { Replay } from './Replay.js';
import { ROUND_SEC } from '../systems/SystemDirector.js';

// 周り（中継・会場・観客）の担当。試合とゲームシステムには口を出さない。
//   HYPE（会場がおかしくなるゲージ）: よけた・カウンター・紙一重・ダウンから立った・システムが変わった・打ち合い で上がる
//     → 観客が立つ → 総立ち → スマホ → ウェーブ → 跳ぶ / 光の筋 / カメラが増える / 紙吹雪 / 風船
//   実況（熱い → どうでもいい）・情報パネル（増える）・テロップ・CM（L 字）・リプレイ（分割）・小窓の中継
// 笑いは周りから。選手・レフェリー・勝敗は真面目。

const Y = RING.y;

const FLASH_VERT = /* glsl */ `
attribute float aPhase;
uniform float uTime;
uniform float uRate;
uniform float uScale;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float slot = floor(uTime * 7.0 + aPhase * 50.0);
  float r = fract(sin(slot * 12.9898 + aPhase * 78.233) * 43758.5453);
  vA = step(1.0 - uRate * 0.16, r);
  gl_PointSize = vA * 1.1 * uScale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
const FLASH_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vA;
void main() {
  if (vA < 0.5) discard;
  gl_FragColor = texture2D(uMap, gl_PointCoord) * vec4(1.0, 1.0, 1.0, 1.0);
}
`;

const CM = [
  ['なのに銀行', '貯まるのに、なのに。', '#1d3fb5'],
  ['侍エナジー', '飲むと、なぜか正座したくなる。', '#c3182e'],
  ['42.195 WATER', 'マラソンにも、ボクシングにも。', '#0b7bd8'],
  ['GONG 保険', 'カーンと鳴ったら、安心を。', '#101018'],
];

export class Show {
  constructor(m) {
    this.m = m;
    this.hype = 0;
    this.level = 0;
    this.maxLevel = 0;
    this.commentary = new Commentary(m.hud);
    this.panels = new Panels(m);
    this.replay = new Replay(m);
    this.telopT = 0;
    this.infoT = 8;
    this.confettiCount = 0;
    this.lastSpeed = 0;
    this.cm = null;
    this.cmDone = {};
    this.pipOn = false;
    this.lastReplay = -99;
    this.fanJump = 0;
    this.buildCrowdGroups();
    this.buildFlashes();
    this.confetti = new Particles(m.scene, { capacity: 1500, additive: false, confetti: true });
    this.balloons = new Particles(m.scene, { capacity: 160, additive: false });
    this.pipCam = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 400);
    this.pipCam.layers.enable(1);
    this.pipEl = document.createElement('div');
    this.pipEl.className = 'pip hidden';
    this.pipEl.innerHTML = '<em>NNN 中継 · LIVE</em>';
    document.getElementById('ui').insertBefore(this.pipEl, document.getElementById('telop'));
  }

  get blocking() {
    return this.replay.active;
  }

  buildCrowdGroups() {
    const L = this.m.layout;
    const z = this.m.plan.zoneOfBlock;
    this.red = L.blocks.filter((b) => z[b.index] === 0).map((b) => b.index);
    this.blue = L.blocks.filter((b) => z[b.index] === 1).map((b) => b.index);
    this.cheer = L.blocks.filter((b) => z[b.index] === 2).map((b) => b.index);
    this.all = L.blocks.map((b) => b.index);
  }

  // 観客のスマホのフラッシュ（1 draw call の点。盛り上がるほど多い）
  buildFlashes() {
    const L = this.m.layout;
    const N = 900;
    const pos = new Float32Array(N * 3);
    const ph = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const id = Math.floor(Math.random() * L.count);
      pos[i * 3] = L.x[id];
      pos[i * 3 + 1] = L.y[id] + 1.2;
      pos[i * 3 + 2] = L.z[id];
      ph[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.flashU = { uTime: { value: 0 }, uRate: { value: 0 }, uScale: { value: 600 }, uMap: { value: makeHaloTexture() } };
    const mat = new THREE.ShaderMaterial({ vertexShader: FLASH_VERT, fragmentShader: FLASH_FRAG, uniforms: this.flashU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flashes = new THREE.Points(g, mat);
    this.flashes.frustumCulled = false;
    this.m.scene.add(this.flashes);
  }

  // ------------------------------------------------------------------
  // HYPE
  addHype(a) {
    this.hype = Math.min(1, this.hype + a);
  }

  drift() {
    // 実況がどうでもよくなる度合い（ラウンドと HYPE）
    const r = this.m.round;
    return Math.min(3, (r - 1) * 0.8 + this.hype * 1.4);
  }

  vars() {
    const m = this.m;
    return {
      punch: this.lastPunch ?? 'ジャブ',
      attack: this.lastAttack ?? 'ストレート',
      sys: m.systems.name || '3D',
      thrown: m.core.player.stats.thrown,
      cams: m.arena.cameraRigs.filter((x) => x.visible).length + 32,
    };
  }

  // ------------------------------------------------------------------
  // 観客
  pose(blocks, p, opt) {
    this.m.crowd.set(blocks, p, opt);
  }

  baseline() {
    const lv = this.level;
    const cr = this.m.crowd;
    cr.clearTimers();
    if (lv <= 0) {
      this.pose([...this.red, ...this.blue], POSE.SIT, { spread: 2 });
    } else if (lv === 1) {
      this.pose(this.red, POSE.CLAP, { spread: 1.5 });
      this.pose(this.blue, POSE.SIT, { spread: 2 });
    } else if (lv === 2) {
      this.pose(this.red, POSE.STAND, { spread: 1 });
      this.pose(this.blue, POSE.CLAP, { spread: 1.5 });
    } else if (lv === 3) {
      this.pose(this.all, POSE.STAND, { spread: 1 });
      this.pose(this.blue.filter((_, i) => i % 2 === 0), POSE.PHONE, { spread: 1 });
    } else if (lv === 4) {
      this.pose(this.all, POSE.CHEER, { spread: 0.8 });
    } else {
      this.pose(this.all, POSE.JUMP, { spread: 0.6 });
    }
    this.pose(this.cheer, lv >= 4 ? POSE.JUMP : POSE.CHEER, { spread: 0.3, stagger: 0 });
  }

  react(kind) {
    const cr = this.m.crowd;
    const back = (t) => cr.later(t, () => this.baseline());
    cr.clearTimers();
    if (kind === 'big') {
      this.pose(this.red, POSE.JUMP, { spread: 0.25, stagger: 0.05 });
      this.pose(this.blue, POSE.HEAD, { spread: 0.4 });
      back(1.8);
    } else if (kind === 'ooh') {
      this.pose(this.all, POSE.LEAN, { spread: 0.3 });
      back(1.3);
    } else if (kind === 'phones') {
      this.pose(this.all.filter((_, i) => i % 3 !== 0), POSE.PHONE, { spread: 0.8, stagger: 0.3 });
      back(2.2);
    } else if (kind === 'downE') {
      this.pose(this.red, POSE.JUMP, { spread: 0.2 });
      this.pose(this.blue, POSE.HEAD, { spread: 0.3 });
      this.pose(this.cheer, POSE.JUMP, { spread: 0.2 });
    } else if (kind === 'downP') {
      this.pose(this.blue, POSE.JUMP, { spread: 0.2 });
      this.pose(this.red, POSE.HEAD, { spread: 0.3 });
    } else if (kind === 'getup') {
      this.pose(this.all, POSE.STAND, { spread: 0.3 });
      cr.later(1.2, () => this.pose(this.all, POSE.CLAP, { spread: 0.8 }));
      back(4);
    } else if (kind === 'ko') {
      this.pose(this.all, POSE.JUMP, { spread: 0.2, stagger: 0.05 });
    }
    this.fanJump = 1.2;
  }

  confettiBurst(n = 300) {
    for (let k = 0; k < 6; k++) {
      this.confetti.emit({ x: (Math.random() - 0.5) * 8, y: 10 + Math.random() * 3, z: (Math.random() - 0.5) * 8, vx: 0, vy: -1, vz: 0, spread: 2.5, color: [[1, 0.25, 0.4], [0.2, 0.9, 1], [1, 0.82, 0.25], [1, 1, 1]][k % 4], size: 0.16, life: 6, gravity: -1.2, drag: 0.9, count: Math.round(n / 6) });
    }
    this.confettiCount += n;
  }

  balloonBurst(n = 30) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 16;
      this.balloons.emit({ x: Math.cos(a) * r, y: 4 + Math.random() * 6, z: Math.sin(a) * r * 0.8, vx: 0, vy: 1.2, vz: 0, spread: 0.3, color: [[1, 0.2, 0.3], [1, 0.85, 0.2], [0.3, 0.6, 1], [1, 1, 1]][i % 4], size: 0.9, life: 9, gravity: 0.15, drag: 0.2, count: 1 });
    }
  }

  telop(text, cls = '', dur = 2.4, force = false) {
    if (!force && this.telopT > 0) return;
    this.m.hud.telop(text, { cls, dur });
    this.telopT = 1.1;
  }

  // ------------------------------------------------------------------
  // 流れのフック
  onWalkin() {
    this.m.hud.show(false);
    this.telop('赤コーナー　<b>侍</b>　SAMURAI · 初挑戦', '', 5, true);
    this.commentary.say('idle', 0, this.vars(), true);
    this.m.hud.talk('実況', 'さあ、世界タイトルマッチ。赤コーナーから挑戦者の入場です！', { dur: 4.5 });
    this.react('big');
  }

  onWalkinRing() {
    this.telop('青コーナー　<b>王者</b>　CHAMPION · 防衛 11 回', 'info', 4.5, true);
    this.m.hud.talk('解説', '両者、真剣な表情です。3 分 4 ラウンド。', { dur: 4, b: true });
  }

  onRoundStart(round) {
    const t = ['', '試合開始', 'ROUND 2 — 慣れたら、変わる。', 'ROUND 3 — 周りがうるさくなる。', 'FINAL — 全部まざる。'][round];
    this.telop(t, round === 4 ? 'gold' : 'info', 3, true);
    this.baseline();
  }

  onRoundEnd(round) {
    this.stopCM();
    this.pipOn = false;
    this.telop(`${round === 4 ? 'FINAL ROUND' : `ROUND ${round}`} 終了`, 'info', 2.2, true);
    this.pose(this.all, POSE.CLAP, { spread: 1 });
  }

  onInterval(round) {
    const s = this.m.roundStats[round];
    const P = this.m.core.player.stats;
    this.m.hud.big('INTERVAL', { dur: 1.6, small: `ROUND ${round} → ${round + 1 === 4 ? 'FINAL' : `ROUND ${round + 1}`}` });
    setTimeout(() => this.telop(`ROUND ${round}　命中 ${s.landed} · よけた ${s.dodges} · ダウン ${s.eKD}`, 'info', 4, true), 1800);
    setTimeout(() => this.telop(`ここまでのパンチ ${P.thrown} · ゲームシステム ${this.m.systems.seen.size} 種`, 'info', 4, true), 6500);
    const lines = [
      ['実況', '1 ラウンド目から、もう 3 回ゲームが変わりました'],
      ['解説', '次のラウンドは、慣れた頃に変わるそうです'],
      ['実況', 'ここから、会場の様子がもっとにぎやかになります'],
    ];
    const [who, text] = lines[Math.min(round - 1, 2)];
    this.m.hud.talk(who, text, { dur: 5, b: who === '解説' });
    this.pose(this.all, POSE.SIT, { spread: 2 });
  }

  onSystemChange(dir) {
    this.addHype(0.04);
    const name = dir.mystery ? '???' : dir.name;
    this.telop(`SYSTEM CHANGE ▸ ${name}`, 'gold', 1.8, true);
    this.commentary.say('system', this.drift(), this.vars(), true);
    if (this.m.round >= 2) this.react('phones');
  }

  onUsedTo() {
    this.telop('慣れてきたので、変えます', 'info small', 1.6, true);
    this.commentary.say('used', this.drift(), this.vars(), true);
  }

  onFight(ev) {
    const v = this.vars();
    const d = this.drift();
    switch (ev.type) {
      case 'land': {
        this.lastPunch = { jab: 'ジャブ', straight: 'ストレート', upper: 'アッパー', hook: 'フック' }[ev.punch];
        this.lastSpeed = Math.round(28 + ev.dmg * 2.2 + Math.random() * 6);
        this.addHype(ev.counter ? 0.07 : 0.012);
        if (ev.counter) {
          this.telop(`COUNTER!　${this.lastPunch}`, 'gold', 1.6, true);
          this.commentary.say('counter', d, { ...v, punch: this.lastPunch }, true);
          this.react('big');
          if (ev.dmg >= 12 && this.m.time - this.lastReplay > 22 && this.canReplay()) this.queueReplay('COUNTER');
        } else {
          this.commentary.say('land', d, { ...v, punch: this.lastPunch });
          if (ev.punch === 'upper') this.react('big');
        }
        if (ev.beat === 'perfect') this.telop('ON BEAT ×2', 'small', 1);
        break;
      }
      case 'combo':
        if (ev.n === 3 || ev.n === 5) {
          this.addHype(0.04);
          this.telop(`${ev.n} HIT COMBO`, 'small', 1.2);
        }
        break;
      case 'exchange':
        this.addHype(0.03);
        break;
      case 'perfect':
        this.addHype(0.06);
        this.telop('PERFECT DODGE', 'small', 1.2);
        this.commentary.say('perfect', d, v);
        this.react('ooh');
        this.m.bAudio.ooh();
        if (this.m.round >= 3 && Math.random() < 0.35 && this.m.time - this.lastReplay > 25 && this.canReplay()) this.queueReplay('PERFECT DODGE');
        break;
      case 'dodge':
        this.addHype(0.02);
        break;
      case 'guardBreak':
        this.addHype(0.03);
        this.telop('GUARD BREAK', 'small', 1.2);
        break;
      case 'hit':
        this.lastAttack = { jab: 'ジャブ', straight: 'ストレート', upper: 'アッパー', hook: 'フック' }[ev.attack];
        this.commentary.say('hit', d, { ...v, attack: this.lastAttack });
        break;
      default:
        break;
    }
  }

  canReplay() {
    return !this.cm && !this.replay.active && !this.replay.queued;
  }

  queueReplay(kind, opt = {}) {
    this.lastReplay = this.m.time;
    this.replay.queue(kind, opt);
  }

  onDown(who, final) {
    this.addHype(0.12);
    this.commentary.say('down', this.drift(), this.vars(), true);
    this.react(who === 'enemy' ? 'downE' : 'downP');
    this.confettiBurst(who === 'enemy' ? 260 : 80);
    if (who === 'enemy' && !final && this.canReplay()) this.queueReplay('DOWN', { delay: 0.6 });
  }

  onGetUp(who) {
    this.addHype(0.15);
    this.commentary.say('getup', this.drift(), this.vars(), true);
    this.telop(who === 'player' ? '侍、立ち上がった！' : '王者、立ち上がった！', 'info', 2, true);
    this.react('getup');
  }

  onFinish(r) {
    this.stopCM();
    this.pipOn = false;
    this.react('ko');
    this.confettiBurst(900);
    this.balloonBurst(60);
    this.addHype(0.3);
    const name = r.winner === 'player' ? '侍' : r.winner === 'enemy' ? '王者' : '';
    if (r.cards) {
      const J = ['A', 'B', 'C'];
      r.cards.forEach((c, i) => setTimeout(() => this.telop(`ジャッジ ${J[i]}　${c.p} - ${c.e}　${c.p > c.e ? '侍' : c.e > c.p ? '王者' : 'ドロー'}`, 'info', 3, true), 2400 + i * 1500));
      setTimeout(() => {
        this.m.hud.big(r.winner === 'draw' ? '引き分け' : `勝者 ${name}`, { cls: 'y', dur: 3, small: r.how });
        this.m.bAudio.roar();
      }, 7000);
    } else {
      setTimeout(() => this.telop(`${r.how}　勝者 <b>${name}</b>　${r.round === 4 ? 'FINAL' : `R${r.round}`} ${r.time}`, 'gold', 4, true), 1500);
      if (this.canReplay()) this.queueReplay(r.how, { delay: 1.8, cells: 16 });
    }
    this.m.hud.talk('実況', r.winner === 'draw' ? '判定は… 引き分け！' : `決まった！ 勝者、${name}！`, { dur: 5 });
  }

  // ------------------------------------------------------------------
  // CM（L 字）: 試合は小さくなって、そのまま続く
  startCM(sec) {
    const c = CM[Object.keys(this.cmDone).length % CM.length];
    this.cm = { t: sec };
    const el = document.getElementById('cm');
    el.innerHTML = `<div class="cm-r" style="background:linear-gradient(160deg, ${c[2]}, #05060f)"><span class="cm-tag">CM</span><div><div class="cm-brand">${c[0]}</div><div class="cm-copy">${c[1]}</div></div></div><div class="cm-b"><span>この試合は ${SPONSORS.map((s) => s[0]).join(' · ')} の提供でお送りしています。　試合は左上で続いています。</span></div>`;
    el.classList.remove('hidden');
    document.body.classList.add('lshape');
    this.telop('CM のあいだも 試合は続きます', 'info small', 2, true);
  }

  stopCM() {
    if (!this.cm) return;
    this.cm = null;
    document.getElementById('cm').classList.add('hidden');
    document.body.classList.remove('lshape');
  }

  // ------------------------------------------------------------------
  update(dt) {
    const m = this.m;
    this.telopT -= dt;
    this.replay.update(dt);
    const fighting = m.phase === 'fight' && !m.downState && !this.replay.active;
    // 記録（リプレイ用）
    if (!this.replay.active) this.replay.record(dt * (m.phase === 'fight' ? m.systems.timeScale : 1), [m.animP.pose, m.animE.pose, m.animR.pose]);

    // HYPE: ゆっくり下がる。ラウンドが進むほど下がりにくい（床が上がる）
    const floor = [0, 0, 0.05, 0.18, 0.35][m.round] ?? 0;
    if (fighting) this.hype = Math.max(floor, this.hype - dt * 0.011);
    m.hype = this.hype;
    const lv = this.hype >= 0.97 ? 5 : Math.min(4, Math.floor(this.hype * 5));
    if (lv !== this.level) {
      this.level = lv;
      this.maxLevel = Math.max(this.maxLevel, lv);
      if (fighting) {
        this.baseline();
        if (lv >= 2) this.telop(['', '', '会場、総立ち', '会場がおかしくなってきた', 'もう何が何だか', 'HYPE MAX'][lv], 'small', 1.6);
      }
      if (lv >= 4 && !m.crowd.waveActive) m.crowd.startWave({ lapSeconds: 14, laps: 2 });
      if (lv >= 5) this.balloonBurst(40);
    }
    m.hud.setHype(this.hype, lv);
    m.arena.setHype(this.hype, m.time);

    // 妙に盛り上がっている人（いつも一番）
    this.fanJump = Math.max(0, this.fanJump - dt);
    const fan = Math.min(1, 0.35 + this.hype + (this.fanJump > 0 ? 0.6 : 0));
    m.near.setExtraPose(0, 1, fan > 0.5 ? 1 : fan, this.fanJump > 0 || this.hype > 0.6 ? 1 : 0.3);

    // フラッシュ・紙吹雪・風船
    this.flashU.uTime.value = m.time;
    this.flashU.uRate.value = Math.min(1, this.hype * 0.9 + (m.systems.primary?.id === 'phone' ? 0.3 : 0));
    const size = m.renderer.getDrawingBufferSize(this._sz ?? (this._sz = new THREE.Vector2()));
    const cam = m.rig.camera;
    const scale = cam.isPerspectiveCamera ? size.y / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) : size.y / 4;
    this.flashU.uScale.value = scale;
    this.confetti.setPointScale(scale);
    this.balloons.setPointScale(scale);
    this.confetti.update(dt, m.time);
    this.balloons.update(dt, m.time);
    if (this.hype > 0.85 && Math.random() < dt * 0.5) this.confettiBurst(60);

    // 実況・パネル
    this.commentary.update(dt, this.drift(), this.vars(), fighting);
    if (m.round >= 1 && ['fight', 'ready', 'interval'].includes(m.phase)) this.panels.update(dt, m.round, m.roundT);

    if (fighting) {
      const t = m.roundT;
      // ROUND 3 から: 関係ない情報のテロップ
      if (m.round >= 3) {
        this.infoT -= dt;
        if (this.infoT <= 0) {
          this.infoT = m.round >= 4 ? 4 : 7;
          const hr = Math.round(92 + this.hype * 55);
          const info = [`今のパンチ　時速 ${this.lastSpeed || 38} km`, `会場の湿度　${Math.round(58 + this.hype * 9)}%`, `この試合を見ている人　${(1200 + Math.floor(m.time * 3)).toLocaleString('en-US')} 万人`, `侍の心拍数　${hr}`, `会場のカメラ　${m.arena.cameraRigs.filter((x) => x.visible).length + 32} 台`, '売店の焼きそば　残りわずか', `会場の照明　1,024 灯`, `ロープ　4 本`];
          this.telop(info[Math.floor(Math.random() * info.length)], 'info small', 2.2);
        }
      }
      // CM
      if (m.round === 3 && t > 46 && !this.cmDone[3]) {
        this.cmDone[3] = true;
        if (!this.replay.active) this.startCM(14);
      }
      if (m.round === 4 && t > 22 && !this.cmDone[4]) {
        this.cmDone[4] = true;
        if (!this.replay.active) this.startCM(9);
      }
      // 小窓の中継（ROUND 3 は時々・FINAL はずっと）
      const sys = m.systems.primary?.id;
      this.pipOn = !this.cm && sys !== 'tv' && sys !== 'phone' && (m.round >= 4 || (m.round === 3 && Math.floor(t / 15) % 2 === 1));
    }
    if (this.cm) {
      this.cm.t -= dt;
      if (this.cm.t <= 0 || m.phase !== 'fight') this.stopCM();
    }
    this.pipEl.classList.toggle('hidden', !this.pipOn || m.phase !== 'fight');
    void ROUND_SEC;
  }

  skipReplay() {
    this.replay.stop();
  }

  // リプレイ中は分割画面だけ描く
  renderOverride() {
    if (!this.replay.active) return false;
    this.replay.render(this.m.renderer, this.m.scene, this.m.field);
    return true;
  }

  // 小窓の中継（ポストエフェクトの後に上から描く）
  renderExtras(size) {
    if (!this.pipOn || this.m.phase !== 'fight' || this.m.noRender) return;
    const m = this.m;
    const r = m.renderer;
    const W = innerWidth;
    const w = Math.round(Math.min(W * 0.24, 300));
    const h = Math.round((w * 9) / 16);
    const x = W - w - 14;
    const y = 150;
    const P = m.core.player;
    const E = m.core.enemy;
    const mx = (P.x + E.x) / 2;
    const mz = (P.z + E.z) / 2;
    const ax = E.x - P.x;
    const az = E.z - P.z;
    const al = Math.hypot(ax, az) || 1;
    this.pipCam.position.set(mx + (az / al) * 6.5, Y + 2.3, mz - (ax / al) * 6.5);
    this.pipCam.lookAt(mx, Y + 1.2, mz);
    this.pipCam.aspect = w / h;
    this.pipCam.updateProjectionMatrix();
    m.field.uniforms.uPxScale.value = (h * r.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.pipCam.fov) / 2));
    r.setScissorTest(true);
    r.setViewport(x, y, w, h);
    r.setScissor(x, y, w, h);
    r.render(m.scene, this.pipCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, W, innerHeight);
    const st = this.pipEl.style;
    st.left = `${x}px`;
    st.top = `${innerHeight - y - h}px`;
    st.width = `${w}px`;
    st.height = `${h}px`;
    void size;
  }

  // ------------------------------------------------------------------
  showResult(r) {
    const m = this.m;
    const P = m.core.player.stats;
    const name = r.winner === 'player' ? '侍' : r.winner === 'enemy' ? '王者' : '引き分け';
    const acc = P.thrown ? Math.round((P.landed / P.thrown) * 100) : 0;
    const rows = [
      ['パンチ（命中 / 打った）', `${P.landed} / ${P.thrown}（${acc}%）`],
      ['よけた（うち PERFECT）', `${P.dodges}（${P.perfect}）`],
      ['カウンター', P.counters, true],
      ['ダウンを奪った / 奪われた', `${m.core.enemy.downs} / ${m.core.player.downs}`],
      ['体験したボクシングシステム', `${m.systems.seen.size} 種`, true],
      ['ゲームシステムが変わった回数', `${m.systems.changes} 回`],
      ['最高 HYPE', `LV ${this.maxLevel >= 5 ? 'MAX' : this.maxLevel}`],
      ['増えた情報パネル', `${this.panels.count} 枚`],
      ['リプレイの最大分割', `${[0, 1, 2, 4, 8, 16][Math.min(5, this.replay.count)]} 画面`],
      ['紙吹雪', `${this.confettiCount.toLocaleString('en-US')} 枚`],
    ];
    const cards = r.cards ? `<div class="r-cards">${r.cards.map((c, i) => `<div>JUDGE ${'ABC'[i]}<b>${c.p} - ${c.e}</b></div>`).join('')}</div>` : '';
    const el = document.getElementById('result');
    el.innerHTML = `<div class="result-wrap">
      <div class="r-head">WORLD CHAMPIONSHIP · RESULT</div>
      <div class="r-win ${r.winner === 'player' ? 'red' : r.winner === 'enemy' ? 'blue' : ''}">${r.winner === 'draw' ? '引き分け' : `勝者　${name}`}</div>
      <div class="r-how">${r.how} · ${r.round === 4 ? 'FINAL ROUND' : `ROUND ${r.round}`} ${r.time}</div>
      ${cards}
      <div class="r-rows">${rows.map(([k, v, hot], i) => `<div class="r-row${hot ? ' hot' : ''}" style="animation-delay:${0.1 + i * 0.08}s"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="r-title" style="animation-delay:1.1s">試合は、<span class="b">ちゃんとしてた。</span></div>
      <div class="r-actions"><button type="button" data-action="retry">もう一度（SPACE）</button>${location.hash === '#from-main' ? '<button type="button" data-action="back">← タイトルへ</button>' : ''}</div>
      <div class="r-note">ゲームは、ちゃんとしてなかった。</div>
    </div>`;
    el.classList.remove('hidden');
    m.hud.show(false);
    m.hud.clearText();
    try {
      localStorage.setItem('nanoni.boxing.played', '1');
    } catch {
      /* 保存できなくても遊べる */
    }
  }
}
