// AudioManager: 音素材ゼロ。WebAudio で BGM・歓声・効果音をすべて合成する。
// BGM はモードごとに「ジャンル」が変わる（通常 = シンセ / TV = ニュース風 / 横スクロール = チップチューン）。
// 歓声のボリュームと拍手の密度は CHEER の盛り上がり（excitement）に連動。

const A2 = 110;
const semi = (n) => A2 * Math.pow(2, n / 12);

const STYLES = {
  title: {
    bpm: 96, wave: 'triangle', cutoff: 1400, bassVol: 0.1, leadWave: 'sine', leadVol: 0.06,
    bass: [0, null, null, null, 7, null, null, null, 5, null, null, null, 3, null, null, null],
    lead: [24, null, 27, null, 31, null, 29, null, 27, null, 24, null, 22, null, 24, null],
    kick: [], snare: [], hat: [2, 6, 10, 14], hatVol: 0.02,
  },
  normal: {
    bpm: 150, wave: 'sawtooth', cutoff: 700, bassVol: 0.13, leadWave: 'square', leadVol: 0.035,
    bass: [0, null, 0, 12, 0, null, 3, null, 5, null, 5, 12, 3, null, 7, null],
    lead: [null, null, null, null, 24, null, 22, null, null, null, 19, null, 22, null, null, null],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], hatVol: 0.035,
  },
  tv: {
    bpm: 128, wave: 'triangle', cutoff: 1600, bassVol: 0.14, leadWave: 'sine', leadVol: 0.07,
    bass: [0, null, null, 0, 5, null, null, 5, 7, null, null, 7, 3, null, 5, null],
    lead: [24, 28, 31, 36, null, 31, 28, null, 26, 29, 33, 38, null, 33, 29, null],
    kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], hatVol: 0.02,
  },
  chip: {
    bpm: 168, wave: 'triangle', cutoff: 3000, bassVol: 0.16, leadWave: 'square', leadVol: 0.055,
    bass: [0, 12, 0, 12, 5, 17, 5, 17, 3, 15, 3, 15, 7, 19, 7, 19],
    lead: [24, null, 27, null, 29, null, 31, 29, 27, null, 24, null, 27, 29, 27, null],
    kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14], hatVol: 0.04, chipDrums: true,
  },
  race: {
    bpm: 176, wave: 'sawtooth', cutoff: 1000, bassVol: 0.14, leadWave: 'square', leadVol: 0.035,
    bass: [0, 0, 12, 0, 0, 0, 12, 0, 5, 5, 17, 5, 7, 7, 19, 7],
    lead: [24, null, 24, 27, null, 29, null, 31, 29, null, 27, null, 24, null, 22, null],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14, 1, 5, 9, 13], hatVol: 0.022,
  },
  // ---- 1500m
  // スタジアム: 入場曲っぽいファンファーレ
  stadium: {
    bpm: 118, wave: 'triangle', cutoff: 1500, bassVol: 0.13, leadWave: 'square', leadVol: 0.04,
    bass: [0, null, 0, null, 5, null, 5, null, 7, null, 7, null, 5, null, 4, null],
    lead: [24, null, 28, 31, null, 31, 33, 31, 28, null, 26, 28, null, 24, null, null],
    kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14], hatVol: 0.025,
  },
  // 見下ろし回避: 弾幕シューティング風のアルペジオ
  dodge: {
    bpm: 172, wave: 'square', cutoff: 2200, bassVol: 0.1, leadWave: 'square', leadVol: 0.035,
    bass: [0, 12, 0, 12, 3, 15, 3, 15, 5, 17, 5, 17, 7, 19, 7, 19],
    lead: [24, 28, 31, 36, 31, 28, 24, 28, 27, 31, 34, 39, 34, 31, 27, 31],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [1, 3, 5, 7, 9, 11, 13, 15], hatVol: 0.025, chipDrums: true,
  },
  // 重力シフト: 低い鼓動が少しずつ明るくなる（緊張の上昇）
  tension: {
    bpm: 100, wave: 'sawtooth', cutoff: 380, bassVol: 0.14, leadWave: 'sine', leadVol: 0.05, rise: true,
    bass: [0, null, 0, null, 0, null, 0, null, 1, null, 1, null, 1, null, 1, null],
    lead: [null, null, null, null, 36, null, null, null, null, null, null, null, 37, null, null, null],
    kick: [0, 4, 8, 12], snare: [], hat: [], hatVol: 0,
  },
  // 鏡の世界: いつもの曲を逆から
  mirror: {
    bpm: 140, wave: 'sawtooth', cutoff: 800, bassVol: 0.12, leadWave: 'triangle', leadVol: 0.05,
    bass: [null, 7, null, 3, 12, 5, 5, null, null, 3, null, 0, 12, 0, null, 0],
    lead: [null, null, null, 22, null, 19, null, null, null, 22, null, 24, null, null, null, null],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [3, 7, 11, 15], hatVol: 0.03,
  },
  final: {
    bpm: 164, wave: 'sawtooth', cutoff: 1100, bassVol: 0.14, leadWave: 'sawtooth', leadVol: 0.04,
    bass: [0, 0, 12, 0, 3, 3, 15, 3, 5, 5, 17, 5, 7, 7, 19, 7],
    lead: [24, null, 31, null, 29, null, 27, null, 24, null, 31, null, 34, null, 36, null],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [1, 3, 5, 7, 9, 11, 13, 15], hatVol: 0.03,
  },
};

export class AudioManager {
  constructor(bus) {
    this.bus = bus;
    this.ctx = null;
    this.muted = false;
    this.style = null;
    this.step = 0;
    this.nextTime = 0;
    this.clapAcc = 0;
    this.excitement = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.8;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicBus.connect(this.musicFilter).connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);

    // ノイズバッファ
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 群衆のざわめき（常時ループ）
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 850;
    bp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    src.connect(bp).connect(lp).connect(this.crowdGain).connect(this.master);
    src.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMusic(style) {
    if (style === this.style) return;
    this.style = style;
    this.step = 0;
    this.styleStart = this.ctx?.currentTime ?? 0;
    if (this.ctx) this.nextTime = this.ctx.currentTime + 0.05;
  }

  // ---- 基本ボイス
  tone(freq, dur, { type = 'sine', vol = 0.1, at = null, slideTo = null, attack = 0.005, bus = null, cutoff = null } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = at ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o.connect(g);
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      node = g.connect(f);
    }
    node.connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noiseHit(dur, { type = 'bandpass', freq = 1000, q = 1, vol = 0.1, at = null, sweepTo = null, attack = 0.002, bus = null, pan = 0 } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = src.connect(f).connect(g);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(bus ?? this.sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  // ---- 効果音
  footstep(speed) {
    // ラスト 50m は足音がよく聞こえる
    this.noiseHit(0.05, { type: 'lowpass', freq: 500 + speed * 20, vol: this.breath ? 0.14 : 0.05 });
  }
  jump() {
    this.tone(300, 0.14, { type: 'triangle', slideTo: 720, vol: 0.09 });
  }
  land() {
    this.tone(110, 0.09, { type: 'sine', slideTo: 60, vol: 0.12 });
  }
  pickup() {
    [1318, 1568, 1976].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', vol: 0.08, at: this.ctx?.currentTime + i * 0.05 }));
  }
  coin() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1320, 0.06, { type: 'square', vol: 0.05, at: t });
    this.tone(1760, 0.18, { type: 'square', vol: 0.05, at: t + 0.06 });
  }
  overtake(big = false) {
    this.noiseHit(0.22, { freq: 600, sweepTo: 2600, q: 2, vol: big ? 0.09 : 0.05 });
  }
  bump() {
    this.tone(140, 0.12, { type: 'square', slideTo: 90, vol: 0.07, cutoff: 900 });
  }
  fall() {
    this.tone(900, 0.7, { type: 'sine', slideTo: 180, vol: 0.08 });
    this.noiseHit(1.2, { freq: 900, sweepTo: 380, q: 0.8, vol: 0.22, attack: 0.08 });
  }
  cheerSwell(size = 1) {
    this.noiseHit(1.6, { freq: 520, sweepTo: 1150, q: 0.7, vol: Math.min(0.35, 0.12 * size), attack: 0.25 });
  }
  whoosh() {
    this.noiseHit(0.45, { freq: 200, sweepTo: 3200, q: 1.2, vol: 0.1 });
  }
  glitch() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) this.tone(200 + Math.random() * 1600, 0.04, { type: 'square', vol: 0.035, at: t + i * 0.035 });
  }
  // ---- 動物・ギャグ
  meow() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(620, 0.12, { type: 'triangle', slideTo: 980, vol: 0.07, at: t });
    this.tone(980, 0.22, { type: 'triangle', slideTo: 540, vol: 0.07, at: t + 0.12 });
  }
  bark(pitch = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      this.tone(420 * pitch, 0.09, { type: 'square', slideTo: 260 * pitch, vol: 0.05, at: t + i * 0.16, cutoff: 1800 });
      this.noiseHit(0.07, { freq: 900 * pitch, q: 2, vol: 0.05, at: t + i * 0.16 });
    }
  }
  bigBark() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(160, 0.45, { type: 'sawtooth', slideTo: 70, vol: 0.18, at: t, cutoff: 700 });
    this.noiseHit(0.5, { type: 'lowpass', freq: 500, vol: 0.2, at: t });
  }
  thump() {
    this.tone(70, 0.25, { type: 'sine', slideTo: 35, vol: 0.25 });
  }
  whistle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) this.tone(i % 2 ? 2700 : 3000, 0.07, { type: 'sine', vol: 0.06, at: t + i * 0.07 });
  }
  boo() {
    this.noiseHit(1.3, { type: 'lowpass', freq: 420, sweepTo: 260, vol: 0.28, attack: 0.15 });
  }
  applause() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 40; i++) {
      this.noiseHit(0.03, { type: 'highpass', freq: 1500 + Math.random() * 900, vol: 0.03 + Math.random() * 0.04, at: t + Math.random() * 1.4, pan: Math.random() * 1.6 - 0.8 });
    }
    this.cheerSwell(1.5);
  }
  horn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [440, 554].forEach((f) => this.tone(f, 0.9, { type: 'sawtooth', vol: 0.05, at: t, attack: 0.05, cutoff: 1600 }));
  }
  carHorn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [350, 440].forEach((f) => this.tone(f, 0.4, { type: 'square', vol: 0.05, at: t, cutoff: 1400 }));
  }
  shoot() {
    this.tone(1100, 0.06, { type: 'square', slideTo: 520, vol: 0.025, cutoff: 3000 });
  }
  explode() {
    this.noiseHit(0.35, { type: 'lowpass', freq: 1400, sweepTo: 180, vol: 0.16 });
    this.tone(95, 0.3, { type: 'sine', slideTo: 40, vol: 0.14 });
  }
  signalChime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1200, 0.12, { type: 'sine', vol: 0.06, at: t });
    this.tone(900, 0.2, { type: 'sine', vol: 0.06, at: t + 0.14 });
  }

  countdown(n) {
    this.tone(n > 0 ? 880 : 1760, n > 0 ? 0.15 : 0.5, { type: 'square', vol: 0.07, cutoff: 3000 });
  }
  startGun() {
    this.noiseHit(0.5, { type: 'lowpass', freq: 3000, sweepTo: 200, vol: 0.4 });
    this.cheerSwell(2.5);
  }
  goal() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [0, 4, 7, 12, 16, 19, 24];
    notes.forEach((n, i) => this.tone(semi(n + 24), 0.25, { type: 'square', vol: 0.06, at: t + i * 0.08, cutoff: 4000 }));
    [0, 4, 7, 12].forEach((n) => this.tone(semi(n + 24), 1.8, { type: 'sawtooth', vol: 0.04, at: t + 0.6, attack: 0.05, cutoff: 3000 }));
    this.cheerSwell(3);
  }

  // ---- シーケンサー
  scheduleStep(style, step, t) {
    const S = STYLES[style];
    const bar16 = step % 16;
    const spb = 60 / S.bpm / 4;
    const bn = S.bass[bar16];
    // rise: 区間が進むほどフィルターが開いていく
    const cutoff = S.rise ? S.cutoff * (1 + Math.min(4, (t - (this.styleStart ?? t)) / 7)) : S.cutoff;
    if (bn !== null && bn !== undefined) {
      this.tone(semi(bn), spb * 1.8, { type: S.wave, vol: S.bassVol, at: t, cutoff, bus: this.musicBus });
    }
    const phrase = Math.floor(step / 16) % 4;
    const ln = S.lead[bar16];
    if (ln !== null && ln !== undefined && phrase !== 3) {
      this.tone(semi(ln + (phrase === 2 ? 2 : 0)), spb * 1.6, { type: S.leadWave, vol: S.leadVol, at: t, cutoff: 5000, bus: this.musicBus });
    }
    if (S.kick.includes(bar16)) {
      if (S.chipDrums) this.tone(180, 0.08, { type: 'square', slideTo: 50, vol: 0.12, at: t, bus: this.musicBus });
      else this.tone(140, 0.16, { type: 'sine', slideTo: 42, vol: 0.32, at: t, bus: this.musicBus });
    }
    if (S.snare.includes(bar16)) {
      this.noiseHit(0.13, { freq: 1800, q: 0.9, vol: 0.09, at: t, bus: this.musicBus });
    }
    if (S.hat.includes(bar16)) {
      this.noiseHit(0.035, { type: 'highpass', freq: 7000, vol: S.hatVol, at: t, bus: this.musicBus });
    }
  }

  // ctx: { excitement, playing, dt }
  update(dt, ctx) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.style && STYLES[this.style]) {
      if (this.nextTime < now - 0.2) this.nextTime = now + 0.02;
      const spb = 60 / STYLES[this.style].bpm / 4;
      while (this.nextTime < now + 0.12) {
        this.scheduleStep(this.style, this.step, this.nextTime);
        this.nextTime += spb;
        this.step++;
      }
    }
    const e = ctx.excitement ?? 0;
    let target = ctx.playing ? 0.025 + e * 0.22 : 0.02;
    if (now < (this.hushUntil ?? 0)) target = 0.0;
    this.crowdGain.gain.setTargetAtTime(target, now, now < (this.hushUntil ?? 0) ? 0.05 : 0.3);

    // 1500m ラスト 50m: 息づかいと鼓動
    if (this.breath) {
      this.breathT = (this.breathT ?? 0) - dt;
      if (this.breathT <= 0) {
        this.breathT = 0.42;
        this.breathIn = !this.breathIn;
        this.noiseHit(0.3, { freq: this.breathIn ? 1300 : 800, sweepTo: this.breathIn ? 1700 : 500, q: 1.4, vol: 0.05, attack: 0.08 });
      }
      this.heartT = (this.heartT ?? 0) - dt;
      if (this.heartT <= 0) {
        this.heartT = 0.5;
        this.tone(58, 0.14, { type: 'sine', vol: 0.2 });
        this.tone(52, 0.12, { type: 'sine', vol: 0.14, at: now + 0.16 });
      }
    }

    // 拍手（盛り上がりに比例した確率で散発的に）
    if (ctx.playing) {
      this.clapAcc += dt * e * e * 30;
      while (this.clapAcc > 1) {
        this.clapAcc -= 1;
        this.noiseHit(0.03, { type: 'highpass', freq: 1400 + Math.random() * 800, vol: 0.02 + Math.random() * 0.03, pan: Math.random() * 1.6 - 0.8 });
      }
    }
  }

  // ---- 1500m の効果音
  // レースゲーム区間: 走る速さでうなるエンジン音（人間です）
  setEngine(on) {
    if (!this.ctx) return;
    if (on && !this.engineNodes) {
      const ctx = this.ctx;
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 600;
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = o2.type = 'sawtooth';
      o1.connect(f);
      o2.connect(f);
      f.connect(g).connect(this.sfxBus);
      o1.start();
      o2.start();
      g.gain.setTargetAtTime(0.045, ctx.currentTime, 0.2);
      this.engineNodes = { g, f, o1, o2 };
    } else if (!on && this.engineNodes) {
      const { g, o1, o2 } = this.engineNodes;
      const t = this.ctx.currentTime;
      g.gain.setTargetAtTime(0, t, 0.1);
      o1.stop(t + 0.5);
      o2.stop(t + 0.5);
      this.engineNodes = null;
    }
  }
  engine(speed) {
    if (!this.engineNodes) return;
    const t = this.ctx.currentTime;
    const f = 38 + speed * 3.4;
    this.engineNodes.o1.frequency.setTargetAtTime(f, t, 0.08);
    this.engineNodes.o2.frequency.setTargetAtTime(f * 1.505, t, 0.08);
    this.engineNodes.f.frequency.setTargetAtTime(300 + speed * 45, t, 0.1);
  }
  // 750m: 観客も一瞬静まる
  hush(seconds) {
    if (!this.ctx) return;
    this.hushUntil = this.ctx.currentTime + seconds;
    // 世界が止まっている間は update が呼ばれないので、ここで直接静かにする
    this.crowdGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    this.duckMusic(1, seconds);
  }
  // 重力が傾く「ぐぐっ」
  creak(deg = 30) {
    this.tone(70 + deg * 0.3, 0.6, { type: 'sawtooth', slideTo: 42, vol: 0.09, cutoff: 500 });
    this.noiseHit(0.7, { type: 'lowpass', freq: 300, sweepTo: 120, vol: 0.12, attack: 0.05 });
  }
  // 最終周回の鐘（カンカンカン）
  bell() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      this.tone(1480, 0.5, { type: 'triangle', vol: 0.08, at: t + i * 0.26 });
      this.tone(3710, 0.25, { type: 'sine', vol: 0.03, at: t + i * 0.26 });
    }
  }
  // 金ダライ（ゴーン）/ ドラム缶
  tarai(kind) {
    if (!this.ctx) return;
    if (kind === 'drop') {
      [420, 873, 1290, 1720].forEach((f, i) => this.tone(f, 1.1 - i * 0.2, { type: 'sine', vol: 0.05 - i * 0.008 }));
    } else this.tone(90, 0.2, { type: 'square', slideTo: 60, vol: 0.06, cutoff: 700 });
  }
  setBreath(on) {
    this.breath = on;
    this.breathT = 0;
    this.heartT = 0.2;
  }
  // 写真判定のシャッター
  shutter() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseHit(0.03, { type: 'highpass', freq: 3000, vol: 0.2, at: t });
    this.noiseHit(0.05, { type: 'highpass', freq: 2200, vol: 0.14, at: t + 0.07 });
  }

  duckMusic(amount, seconds) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(0.8 * (1 - amount), t, 0.05);
    this.musicBus.gain.setTargetAtTime(0.8, t + seconds, 0.3);
  }
}
