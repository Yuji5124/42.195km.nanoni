// ボクシングの音（素材ゼロ）。src/audio/AudioManager（WebAudio の土台）+ soccer/src/audio/SoccerAudio（群衆のざわめき・声）の上に重ねる。
//   ゴング（金属の倍音 4 本の減衰）/ パンチ（低いノイズ + 沈む正弦波）/ ガード（高い乾いた音）/ 空振り（風切り）
//   レフェリーのカウント（声の合成）/ リズムゲームの拍（キック・ハイハット・ベース）/ 8BIT の時は全部 矩形波
//   群衆: 「オォ」（よけた）・歓声（当たった）・大歓声（ダウン）

export class BoxingAudio {
  constructor(audio, crowd) {
    this.audio = audio;
    this.crowd = crowd;
    this.chip = false;
    this.beatOn = false;
    this.slow = false;
  }

  get ctx() {
    return this.audio.ctx;
  }

  init() {
    this.audio.init();
    this.crowd.init();
    this.crowd.chantOn = false;
    this.crowd.drumsOn = false;
  }

  t() {
    return this.ctx?.currentTime ?? 0;
  }

  // ---- ゴング: カーン（n 回）
  gong(n = 1) {
    if (!this.ctx) return;
    const t0 = this.t();
    for (let k = 0; k < n; k++) {
      const t = t0 + k * 0.42;
      [1, 2.76, 5.4, 8.93].forEach((m, i) => this.audio.tone(560 * m, 2.6 / (1 + i * 0.7), { type: 'sine', vol: 0.22 / (1 + i), at: t, attack: 0.002 }));
      this.audio.noiseHit(0.05, { type: 'highpass', freq: 3000, vol: 0.2, at: t });
    }
  }

  // ---- パンチ
  punch(kind = 'land', power = 1) {
    if (!this.ctx) return;
    const a = this.audio;
    if (this.chip) {
      const f = kind === 'land' ? 180 : kind === 'block' ? 520 : 900;
      a.tone(f * (1 + power * 0.3), 0.09, { type: 'square', vol: 0.09, slideTo: f * 0.5 });
      return;
    }
    if (kind === 'land') {
      a.noiseHit(0.12, { type: 'lowpass', freq: 900 + power * 400, vol: 0.5 * Math.min(1.4, 0.6 + power * 0.5) });
      a.tone(110, 0.16, { type: 'sine', vol: 0.35 * Math.min(1.4, power), slideTo: 48 });
      a.noiseHit(0.04, { type: 'bandpass', freq: 2400, q: 0.8, vol: 0.12 });
    } else if (kind === 'block') {
      a.noiseHit(0.06, { type: 'bandpass', freq: 1800, q: 1.2, vol: 0.26 });
      a.tone(220, 0.07, { type: 'triangle', vol: 0.1, slideTo: 150 });
    } else if (kind === 'hurt') {
      // 自分が打たれた（低く重く）
      a.noiseHit(0.16, { type: 'lowpass', freq: 600, vol: 0.55 });
      a.tone(80, 0.22, { type: 'sine', vol: 0.4, slideTo: 40 });
    } else {
      a.noiseHit(0.18, { type: 'bandpass', freq: 700, q: 0.7, vol: 0.12, sweepTo: 2600 });
    }
  }

  whoosh() {
    if (!this.ctx) return;
    if (this.chip) return this.audio.tone(1200, 0.08, { type: 'square', vol: 0.05, slideTo: 600 });
    this.audio.noiseHit(0.22, { type: 'bandpass', freq: 500, q: 0.8, vol: 0.14, sweepTo: 2200 });
  }

  perfect() {
    if (!this.ctx) return;
    const t = this.t();
    [880, 1320, 1760].forEach((f, i) => this.audio.tone(f, 0.35, { type: this.chip ? 'square' : 'triangle', vol: 0.07, at: t + i * 0.05 }));
  }

  // ---- 群衆
  ooh() {
    this.crowd.ooh?.();
  }

  cheer(size = 1) {
    const c = this.crowd;
    if (!c.ready) return;
    const t = this.t();
    c.noise(1.4 + size, { freq: 520, sweepTo: 1300, q: 0.45, vol: 0.5 * size, attack: 0.08, at: t });
    c.voice(170, 1.2 + size * 0.5, { vowel: 'a', vol: 0.05 * size, at: t, n: 6, attack: 0.08 });
    c.clapBurst(t + 0.4, Math.round(12 * size), 0.8, 0.03);
  }

  roar() {
    this.crowd.goal?.(true);
  }

  groan() {
    this.crowd.groan?.();
  }

  // レフェリーのカウント: 「ワン」「ツー」…（声の合成で短く）
  count(n) {
    const c = this.crowd;
    if (!c.ready) return;
    const t = this.t();
    c.voice(150 - n * 2, 0.34, { vowel: n % 2 ? 'a' : 'o', vol: 0.12, at: t, n: 3, attack: 0.02, spread: 0.01, oct: false });
    this.audio.noiseHit(0.05, { type: 'lowpass', freq: 500, vol: 0.3, at: t + 0.02 });
  }

  // ---- リズムゲームの拍（120 BPM）
  setBeat(on) {
    this.beatOn = on;
  }

  beat(i) {
    if (!this.ctx || !this.beatOn) return;
    const a = this.audio;
    const t = this.t();
    a.tone(120, 0.18, { type: 'sine', vol: 0.5, slideTo: 42, at: t });
    a.noiseHit(0.03, { type: 'highpass', freq: 7000, vol: 0.08, at: t + 0.25 });
    const bass = [55, 55, 65.4, 49][Math.floor(i / 2) % 4];
    if (i % 2 === 0) a.tone(bass, 0.4, { type: 'sawtooth', vol: 0.08, at: t, cutoff: 500 });
    if (i % 4 === 0) a.tone(bass * 8, 0.12, { type: 'square', vol: 0.03, at: t + 0.125 });
  }

  setSlow(on) {
    this.slow = on;
    this.crowd.setMuffle?.(on ? 1 : 0, 0.5);
  }

  qte(ok) {
    if (!this.ctx) return;
    if (ok) this.perfect();
    else this.audio.tone(140, 0.25, { type: 'square', vol: 0.08 });
  }

  // ゲームシステムが変わる音（テレビのチャンネルを変えるような）
  systemChange() {
    if (!this.ctx) return;
    const t = this.t();
    this.audio.noiseHit(0.18, { type: 'bandpass', freq: 3000, q: 0.5, vol: 0.14, at: t });
    this.audio.tone(1500, 0.08, { type: 'square', vol: 0.05, at: t + 0.05, slideTo: 300 });
    this.audio.tone(660, 0.12, { type: 'triangle', vol: 0.06, at: t + 0.16 });
    this.audio.tone(990, 0.16, { type: 'triangle', vol: 0.06, at: t + 0.24 });
  }

  update(dt, excite) {
    this.crowd.update(dt, { excite, playing: true });
  }
}
