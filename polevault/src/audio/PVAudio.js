import * as THREE from 'three';
import { SoccerAudio } from '../../../soccer/src/audio/SoccerAudio.js';

// 音（素材ゼロ。src/audio/AudioManager + サッカーの群衆の声 SoccerAudio の上に重ねる）。
//   夜の空気: 風（ゆっくりゆれるノイズ）・遠くの街・虫の声
//   観客: ざわめき（盛り上がりで開く）・手拍子（儀式で求められると、助走に向けて速くなる）・「オォ…」・歓声・ため息・最後の静けさ
//   競技: スパイクの足音・ポールがボックスに刺さる音・しなり・バーの落ちる金属音・マットの「ボフッ」
//   カメラ: パンの流体ヘッドのこすれ・ズームのサーボ・ピントのリング・シャッター・ロックの音・AI のピピッ
//   定位: 音の出どころの方向で左右に振る。カメラが向いている（画角の中の）音は少し大きい（カメラのガンマイク）

const _d = new THREE.Vector3();
const _r = new THREE.Vector3();

export class PVAudio {
  constructor(audio) {
    this.audio = audio;
    this.crowd = new SoccerAudio(audio);
    this.crowd.chantOn = false;
    this.crowd.drumsOn = false;
    this.ready = false;
    this.clap = null;
    this.hush = 0;
    this.excite = 0.25;
    this.birdT = 0;
    this.cricketT = 0;
  }

  get ctx() {
    return this.audio.ctx;
  }

  init() {
    this.audio.init();
    if (this.ready || !this.audio.ctx) return;
    this.crowd.init();
    const ctx = this.ctx;
    this.ready = true;
    const loop = (type, freq, q, vol, dest = this.audio.master) => {
      const src = ctx.createBufferSource();
      src.buffer = this.audio.noise;
      src.loop = true;
      src.playbackRate.value = 0.5 + Math.random() * 0.3;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(f).connect(g).connect(dest);
      src.start(0, Math.random());
      return { f, g, src };
    };
    // 夜の空気
    this.wind = loop('lowpass', 380, 0.5, 0.05);
    this.city = loop('lowpass', 120, 0.7, 0.04);
    // カメラ: パンのこすれ（流体ヘッド）
    this.panNoise = loop('bandpass', 900, 1.4, 0);
    // ズームのサーボ
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 180;
    const of = ctx.createBiquadFilter();
    of.type = 'lowpass';
    of.frequency.value = 900;
    const og = ctx.createGain();
    og.gain.value = 0;
    o.connect(of).connect(og).connect(this.audio.master);
    o.start();
    this.servo = { o, g: og, f: of };
  }

  // ---- 定位: 音の出どころ → { pan, gain }
  spatial(pos, cam) {
    if (!cam) return { pan: 0, gain: 1 };
    _d.copy(pos).sub(cam.camera.position);
    const dist = _d.length();
    _d.divideScalar(Math.max(0.01, dist));
    const fwd = cam.forward(_r).clone();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
    const pan = Math.max(-0.9, Math.min(0.9, _d.dot(right)));
    const ang = Math.acos(Math.max(-1, Math.min(1, _d.dot(fwd))));
    const inView = ang < cam.fovRad * 0.7 ? 1 : ang < 0.6 ? 0.5 : 0;
    const att = 1 / (1 + dist / 25);
    const mic = 0.55 + 0.45 * inView * Math.min(1, 0.4 + cam.zoom / 8);
    return { pan, gain: att * mic * 1.6, dist };
  }

  hit(dur, opts, pos, cam) {
    if (!this.ready) return;
    const sp = pos ? this.spatial(pos, cam) : { pan: 0, gain: 1 };
    this.audio.noiseHit(dur, { ...opts, vol: (opts.vol ?? 0.1) * sp.gain, pan: sp.pan });
  }

  tone(f, dur, opts) {
    if (!this.ready) return;
    this.audio.tone(f, dur, opts);
  }

  // ---- 競技
  step(pos, cam, speed) {
    this.hit(0.045, { type: 'highpass', freq: 1800 + speed * 60, q: 0.8, vol: 0.05 + speed * 0.006 }, pos, cam);
    this.hit(0.06, { type: 'lowpass', freq: 300, vol: 0.05 }, pos, cam);
  }

  plant(pos, cam) {
    if (!this.ready) return;
    this.hit(0.18, { type: 'lowpass', freq: 260, vol: 0.4 }, pos, cam);
    this.hit(0.25, { type: 'bandpass', freq: 2200, sweepTo: 900, q: 3, vol: 0.12 }, pos, cam);
    this.crowd.ooh();
  }

  bend(pos, cam) {
    this.hit(0.7, { type: 'bandpass', freq: 400, sweepTo: 1200, q: 2.2, vol: 0.09, attack: 0.2 }, pos, cam);
  }

  release(pos, cam) {
    this.hit(0.12, { type: 'bandpass', freq: 3000, q: 6, vol: 0.06 }, pos, cam);
  }

  // バーが落ちる（グラスファイバーの棒が金具・マットに当たる）
  barClatter(pos, cam, v = 3) {
    if (!this.ready) return;
    const sp = this.spatial(pos, cam);
    const t = this.ctx.currentTime;
    const vol = Math.min(0.12, 0.03 + v * 0.015) * sp.gain;
    [1960, 2630, 3310].forEach((f, i) => this.audio.tone(f * (0.97 + Math.random() * 0.06), 0.35, { type: 'triangle', vol: vol * (1 - i * 0.25), at: t + i * 0.01 }));
    this.hit(0.08, { type: 'highpass', freq: 2500, vol: 0.12 }, pos, cam);
  }

  mat(pos, cam) {
    this.hit(0.35, { type: 'lowpass', freq: 180, vol: 0.55, attack: 0.01 }, pos, cam);
    this.hit(0.25, { type: 'bandpass', freq: 600, q: 0.6, vol: 0.12 }, pos, cam);
  }

  // ---- 観客
  // 手拍子: start で始まり、until までテンポが速くなる
  startClap(t, until) {
    this.clap = { t0: t, until, next: t };
  }

  stopClap() {
    this.clap = null;
  }

  cheer(size = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.crowd.noise(3.2 * size, { freq: 520, sweepTo: 1300, q: 0.4, vol: 0.9 * size, attack: 0.12, at: t });
    for (let k = 0; k < 4; k++) this.crowd.voice(150 + k * 40, 2.6 * size, { vowel: k % 2 ? 'a' : 'o', vol: 0.06 * size, at: t + 0.04 * k, n: 7, attack: 0.12 });
    for (let k = 0; k < 6; k++) this.crowd.clapBurst(t + 1.4 + k * 0.45, 26, 0.45, 0.035 * size);
  }

  groan() {
    this.crowd.groan();
  }

  roarRecord() {
    if (!this.ready) return;
    this.crowd.goal(true);
  }

  // 小さな歓声（視聴率スパイク）
  smallCheer() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.crowd.voice(220, 0.9, { vowel: 'o', vol: 0.03, at: t, n: 5, slideTo: 300 });
    this.crowd.clapBurst(t + 0.1, 12, 0.4, 0.02);
  }

  // 客席の小さな声（ヒント）
  voice(pos, cam) {
    if (!this.ready) return;
    const sp = this.spatial(pos, cam);
    const t = this.ctx.currentTime;
    this.crowd.voice(260 + Math.random() * 120, 0.5, { vowel: Math.random() < 0.5 ? 'a' : 'e', vol: 0.02 * sp.gain, at: t, n: 3 });
  }

  birds(pos, cam) {
    if (!this.ready) return;
    const sp = this.spatial(pos, cam);
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this.audio.tone(3400 + Math.random() * 900, 0.08, { type: 'sine', slideTo: 2600, vol: 0.02 * sp.gain, at: t + i * 0.13 });
  }

  // ---- カメラ
  shutter() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.audio.noiseHit(0.03, { type: 'highpass', freq: 3500, vol: 0.18, at: t });
    this.audio.noiseHit(0.05, { type: 'bandpass', freq: 1500, q: 2, vol: 0.12, at: t + 0.06 });
    this.audio.tone(1760, 0.06, { type: 'square', vol: 0.02, at: t + 0.02, cutoff: 3000 });
  }

  lockBeep(on) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (on) {
      this.audio.tone(1320, 0.05, { type: 'square', vol: 0.025, at: t, cutoff: 3000 });
      this.audio.tone(1760, 0.07, { type: 'square', vol: 0.025, at: t + 0.07, cutoff: 3000 });
    } else this.audio.tone(880, 0.07, { type: 'square', vol: 0.02, at: t, cutoff: 2000 });
  }

  focusTick() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) this.audio.noiseHit(0.012, { type: 'highpass', freq: 5000, vol: 0.05, at: t + i * 0.045 });
  }

  aiBlip(i = 0) {
    if (!this.ready) return;
    this.audio.tone(1200 + i * 140, 0.05, { type: 'square', vol: 0.015, cutoff: 2500 });
  }

  master() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12, 16, 19].forEach((n, i) => this.audio.tone(523 * Math.pow(2, n / 12), 0.6, { type: 'triangle', vol: 0.05, at: t + i * 0.07 }));
  }

  onAirChime() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.audio.tone(1000, 0.12, { type: 'sine', vol: 0.05, at: t });
    this.audio.tone(1000, 0.12, { type: 'sine', vol: 0.05, at: t + 0.5 });
    this.audio.tone(1500, 0.4, { type: 'sine', vol: 0.06, at: t + 1.0 });
  }

  // ---- 毎フレーム
  update(dt, { cam, excite = 0.25, hush = 0, t = 0, birdPos = null, birdsNear = false }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.hush += (hush - this.hush) * Math.min(1, dt * 1.5);
    this.crowd.update(dt, { excite: excite * (1 - this.hush * 0.7), playing: true });
    // 静けさ（最後の試技の前）: ざわめきを下げる
    this.crowd.stadium.gain.setTargetAtTime(0.9 * (1 - this.hush * 0.55), now, 0.3);
    // 風
    this.wind.g.gain.setTargetAtTime(0.035 + 0.025 * Math.sin(t * 0.21) * Math.sin(t * 0.13), now, 0.5);
    this.wind.f.frequency.setTargetAtTime(300 + 150 * Math.sin(t * 0.17), now, 0.5);
    // パンのこすれ・ズームのサーボ
    const pan = cam ? Math.min(1, cam.panSpeed / 1.2) : 0;
    this.panNoise.g.gain.setTargetAtTime(pan * 0.03, now, 0.05);
    this.panNoise.f.frequency.setTargetAtTime(700 + pan * 900, now, 0.05);
    const zv = cam ? Math.min(1, Math.abs(cam.zoomV) / 2.5) : 0;
    this.servo.g.gain.setTargetAtTime(zv * 0.018, now, 0.04);
    this.servo.o.frequency.setTargetAtTime(160 + zv * 220, now, 0.05);
    // 手拍子（だんだん速く）
    const c = this.clap;
    if (c) {
      if (t > c.until + 0.3) this.clap = null;
      else if (t >= c.next) {
        const k = Math.min(1, (t - c.t0) / Math.max(0.5, c.until - c.t0));
        const period = 0.95 - 0.55 * k * k;
        c.next = t + period;
        this.crowd.clapBurst(now + 0.02, 70, 0.05, 0.05 + 0.03 * k);
      }
    }
    // 虫の声
    this.cricketT -= dt;
    if (this.cricketT <= 0) {
      this.cricketT = 0.6 + Math.random() * 2.5;
      if (this.hush > 0.3 || Math.random() < 0.4) for (let i = 0; i < 3; i++) this.audio.tone(4600 + Math.random() * 300, 0.04, { type: 'sine', vol: 0.006 + this.hush * 0.008, at: now + i * 0.07 });
    }
    // 鳥の声（カメラが向いている時に聞こえる）
    if (birdsNear && birdPos) {
      this.birdT -= dt;
      if (this.birdT <= 0) {
        this.birdT = 1.2 + Math.random() * 2.5;
        this.birds(birdPos, cam);
      }
    }
  }
}
