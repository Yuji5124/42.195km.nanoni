// スタジアムの音（素材ゼロ。src/audio/AudioManager の WebAudio の土台の上に重ねる）。
//
//   stadium バス → こもりフィルタ（コンコース・トンネルでは 450Hz まで閉じる）→ master
//   ざわめき（低い帯 + 高い帯のノイズ）/ うねり（盛り上がりで開くノイズ）
//   声（のこぎり波 × 6 をフォルマント 2 本に通す = 「オー」「アー」「ウー」）
//   チャント「ニッ・ポン！（チャ・チャ・チャ）」/ アウェイのサンバの太鼓
//   ゴール: 爆発（ノイズの山 + 声 + 低音）→ 長い拍手 / 決定機: 「オォ…」上がる / 外れ: 「アァ…」下がる
//   笛・場内放送のチャイム（ピンポンパーン）・スマホ・ゲート・双眼鏡のモーター・調べる音
// 音だけでも「何か凄いことが起きた」と分かることを目標にする。

const VOWEL = { a: [800, 1250], o: [480, 880], u: [330, 760], i: [300, 2200], e: [450, 1900] };

export class SoccerAudio {
  constructor(audio) {
    this.audio = audio;
    this.ready = false;
    this.excite = 0.2;
    this.chantOn = true;
    this.drumsOn = true;
    this.chantT = 0;
    this.drumT = 0;
    this.muffle = 0;
    this.murmurT = 0;
  }

  get ctx() {
    return this.audio.ctx;
  }

  init() {
    if (this.ready || !this.audio.ctx) return;
    const ctx = this.ctx;
    this.ready = true;
    this.stadium = ctx.createGain();
    this.stadium.gain.value = 0.9;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 18000;
    this.stadium.connect(this.lp).connect(this.audio.master);
    // 既存のざわめき（AudioManager）は使わない
    this.audio.crowdGain.gain.value = 0;
    const loop = (freq, q, type = 'bandpass') => {
      const src = ctx.createBufferSource();
      src.buffer = this.audio.noise;
      src.loop = true;
      src.playbackRate.value = 0.6 + Math.random() * 0.2;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.stadium);
      src.start(0, Math.random());
      return { g, f };
    };
    this.bed = loop(420, 0.7);
    this.hiss = loop(1500, 0.9);
    this.roar = loop(700, 0.6);
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = 1;
    this.voiceBus.connect(this.stadium);
  }

  // 0 = 試合中の外 / 1 = コンコース（こもる）
  setMuffle(m, seconds = 0.4) {
    this.muffle = m;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.lp.frequency.setTargetAtTime(m > 0.5 ? 420 : 18000, t, seconds / 3);
    this.stadium.gain.setTargetAtTime(m > 0.5 ? 0.55 : 0.9, t, seconds / 3);
  }

  // ---- 声の部品
  voice(f0, dur, { vowel = 'o', vol = 0.05, slideTo = null, at = null, n = 6, attack = 0.08, spread = 0.035, oct = true } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = at ?? ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.7, dur * 0.18);
    const [f1, f2] = VOWEL[vowel];
    const b1 = ctx.createBiquadFilter();
    b1.type = 'bandpass';
    b1.frequency.value = f1;
    b1.Q.value = 5;
    const b2 = ctx.createBiquadFilter();
    b2.type = 'bandpass';
    b2.frequency.value = f2;
    b2.Q.value = 7;
    g.connect(b1).connect(this.voiceBus);
    g.connect(b2).connect(this.voiceBus);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const k = (1 + (Math.random() - 0.5) * spread) * (oct && i % 3 === 2 ? 2 : 1);
      o.frequency.setValueAtTime(f0 * k, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo * k, t + dur);
      o.connect(g);
      o.start(t + Math.random() * 0.04);
      o.stop(t + dur + 0.6);
    }
  }

  noise(dur, opts) {
    this.audio.noiseHit(dur, { ...opts, bus: this.stadium });
  }

  clapBurst(t, count = 26, spread = 0.25, vol = 0.035) {
    for (let i = 0; i < count; i++) {
      this.audio.noiseHit(0.03, { type: 'highpass', freq: 1400 + Math.random() * 1200, vol: vol * (0.5 + Math.random()), at: t + Math.random() * spread, pan: Math.random() * 1.6 - 0.8, bus: this.stadium });
    }
  }

  // ---- チャント: ニッ・ポン！（チャ・チャ・チャ）
  chant(t) {
    const v = 0.022 + this.excite * 0.03;
    this.voice(233, 0.2, { vowel: 'i', vol: v, at: t, n: 7 });
    this.voice(196, 0.42, { vowel: 'o', vol: v * 1.1, at: t + 0.26, n: 7 });
    for (let k = 0; k < 3; k++) this.clapBurst(t + 0.9 + k * 0.27, 16, 0.06, 0.03 + this.excite * 0.02);
  }

  // サンバの太鼓（アウェイ席・右寄り）
  drums(t) {
    const pat = [0, 0.375, 0.5, 0.75, 1.125, 1.25, 1.5, 1.875];
    pat.forEach((p, i) => this.audio.tone(i % 4 === 0 ? 70 : 110, 0.16, { type: 'sine', slideTo: 45, vol: 0.05, at: t + p * 0.55, bus: this.stadium }));
    for (let i = 0; i < 8; i++) this.audio.noiseHit(0.03, { type: 'highpass', freq: 5000, vol: 0.012, at: t + i * 0.1375, pan: 0.6, bus: this.stadium });
  }

  // ---- 試合の音
  goal(home = true) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (home) {
      this.noise(6.5, { freq: 420, sweepTo: 1300, q: 0.5, vol: 0.9, attack: 0.25, at: t });
      this.noise(4.5, { type: 'lowpass', freq: 380, vol: 0.5, attack: 0.1, at: t });
      for (let k = 0; k < 4; k++) this.voice(160 + k * 45, 3.6, { vowel: 'a', vol: 0.05, at: t + 0.05 * k, n: 8, attack: 0.2 });
      this.audio.tone(55, 1.4, { type: 'sine', slideTo: 38, vol: 0.4, at: t });
      this.audio.horn();
      for (let k = 0; k < 10; k++) this.clapBurst(t + 3 + k * 0.5, 30, 0.5, 0.04);
      this.roarHold = 6;
    } else {
      // アウェイのゴール: 右奥だけが沸き、ホームは静まる
      this.noise(3.5, { freq: 600, sweepTo: 1000, q: 0.7, vol: 0.28, attack: 0.2, pan: 0.6, at: t });
      this.voice(220, 2.2, { vowel: 'a', vol: 0.03, at: t, n: 6 });
      this.boo(t + 1.2);
      this.roarHold = -3;
    }
  }

  // 決定機: 「オォ…」上がる
  ooh() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.voice(150, 1.6, { vowel: 'o', vol: 0.05, slideTo: 250, at: t, n: 8, attack: 0.3 });
    this.noise(1.8, { freq: 500, sweepTo: 1100, q: 0.6, vol: 0.3, attack: 0.5, at: t });
  }

  // 外れ: 「アァ…」下がる
  groan() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.voice(270, 1.4, { vowel: 'a', vol: 0.06, slideTo: 140, at: t, n: 8, attack: 0.05 });
    this.noise(1.5, { freq: 1000, sweepTo: 350, q: 0.6, vol: 0.35, attack: 0.05, at: t });
    this.clapBurst(t + 1.3, 20, 0.8, 0.025);
  }

  save() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.groan();
    this.clapBurst(t + 0.4, 40, 1.4, 0.035);
  }

  boo(at) {
    this.voice(110, 2.2, { vowel: 'u', vol: 0.05, at, n: 7, attack: 0.3, oct: false });
  }

  shot() {
    this.audio.noiseHit(0.08, { type: 'lowpass', freq: 900, vol: 0.12, bus: this.stadium });
    this.noise(0.9, { freq: 600, sweepTo: 1400, q: 0.6, vol: 0.4, attack: 0.08 });
  }

  // 笛: short / long / end（ピッ ピッ ピーーー）
  whistle(kind = 'short') {
    if (!this.ready) return;
    const ctx = this.ctx;
    const blow = (t, dur) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2950;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 38;
      const lg = ctx.createGain();
      lg.gain.value = 120;
      lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
      g.gain.setValueAtTime(0.09, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.audio.master);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.05);
      lfo.stop(t + dur + 0.05);
    };
    const t = ctx.currentTime;
    if (kind === 'end') {
      blow(t, 0.22);
      blow(t + 0.38, 0.22);
      blow(t + 0.76, 1.9);
    } else blow(t, kind === 'long' ? 0.8 : 0.28);
  }

  // 場内放送: ピンポンパーン
  chime() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [698, 880, 1047, 1397].forEach((f, i) => {
      this.audio.tone(f, 0.9, { type: 'sine', vol: 0.07, at: t + i * 0.28 });
      this.audio.tone(f * 3, 0.4, { type: 'sine', vol: 0.012, at: t + i * 0.28 });
    });
    this.duck(3.5);
  }

  duck(seconds) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.voiceBus.gain.cancelScheduledValues(t);
    this.voiceBus.gain.setTargetAtTime(0.35, t, 0.1);
    this.voiceBus.gain.setTargetAtTime(1, t + seconds, 0.5);
  }

  // ---- UI・物の音
  phone() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) this.audio.tone(170, 0.18, { type: 'square', vol: 0.03, at: t + i * 0.28, cutoff: 600 });
    this.audio.tone(1568, 0.25, { type: 'sine', vol: 0.05, at: t + 0.65 });
  }

  gate(ok) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (ok) this.audio.tone(1800, 0.18, { type: 'sine', vol: 0.07, at: t });
    else for (let i = 0; i < 2; i++) this.audio.tone(210, 0.2, { type: 'square', vol: 0.05, at: t + i * 0.25, cutoff: 1200 });
  }

  zoom(up) {
    if (!this.ready) return;
    this.audio.noiseHit(0.12, { freq: up ? 2600 : 2000, sweepTo: up ? 3400 : 1500, q: 9, vol: 0.05 });
  }

  focus() {
    this.audio.tone(2400, 0.03, { type: 'square', vol: 0.02 });
  }

  scan() {
    if (!this.ready) return;
    this.audio.tone(900, 0.12, { type: 'triangle', slideTo: 1600, vol: 0.04 });
  }

  resultNo() {
    if (!this.ready) return;
    this.audio.tone(330, 0.16, { type: 'triangle', slideTo: 220, vol: 0.05 });
  }

  resultFar() {
    if (!this.ready) return;
    this.audio.tone(260, 0.1, { type: 'sine', vol: 0.035 });
  }

  pin() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.audio.tone(1175, 0.08, { type: 'triangle', vol: 0.05, at: t });
    this.audio.tone(1568, 0.14, { type: 'triangle', vol: 0.05, at: t + 0.08 });
  }

  found() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12, 16].forEach((n, i) => this.audio.tone(523 * Math.pow(2, n / 12), 0.5, { type: 'triangle', vol: 0.06, at: t + i * 0.09 }));
    this.audio.tone(1047, 1.4, { type: 'sine', vol: 0.05, at: t + 0.5 });
  }

  footstep(fast) {
    this.audio.noiseHit(0.05, { type: 'lowpass', freq: fast ? 700 : 450, vol: 0.09 });
  }

  // 双眼鏡を受け取る・構える
  gear() {
    this.audio.noiseHit(0.08, { freq: 1200, q: 2, vol: 0.05 });
  }

  // ---- 毎フレーム: excitement（0〜1、立っている人の割合など）でざわめきを動かす
  update(dt, { excite = 0.2, playing = true } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.excite += (excite - this.excite) * Math.min(1, dt * 2);
    this.roarHold = (this.roarHold ?? 0) * Math.exp(-dt * 0.5);
    const e = Math.max(0, Math.min(1, this.excite + Math.max(0, this.roarHold) * 0.1));
    const quiet = this.roarHold < -0.5 ? 0.55 : 1;
    this.bed.g.gain.setTargetAtTime((0.16 + e * 0.16) * quiet, t, 0.3);
    this.hiss.g.gain.setTargetAtTime((0.05 + e * 0.12) * quiet, t, 0.3);
    this.roar.g.gain.setTargetAtTime(e * e * 0.35, t, 0.2);
    this.roar.f.frequency.setTargetAtTime(600 + e * 700, t, 0.3);
    if (!playing) return;
    // チャント（盛り上がっていない時 = 応援で盛り上げる）
    this.chantT -= dt;
    if (this.chantOn && this.chantT <= 0) {
      this.chantT = 2.5;
      if (e < 0.75 && this.roarHold > -0.5) this.chant(t + 0.05);
    }
    this.drumT -= dt;
    if (this.drumsOn && this.drumT <= 0) {
      this.drumT = 1.1;
      this.drums(t + 0.05);
    }
    // ときどきの小さな歓声・拍手
    this.murmurT -= dt;
    if (this.murmurT <= 0) {
      this.murmurT = 1.5 + Math.random() * 3;
      if (Math.random() < 0.5) this.clapBurst(t, 10, 0.8, 0.02);
      else this.voice(180 + Math.random() * 80, 0.8, { vowel: Math.random() < 0.5 ? 'o' : 'a', vol: 0.012, n: 4 });
    }
  }
}
