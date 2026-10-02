// 音（素材ゼロ。src/audio/AudioManager の合成の上に重ねる）。
//   配信 BGM（小さめ。ラスト 1 周で速い曲）・スタジアムのざわめき（盛り上がりで開く）・足音・息（疲れで荒く）・
//   コメントの「ピコッ」・スパチャ（金額で音が増える）・同接の爆発・審判のパドル・赤カード・鐘・フィニッシュ。

export class RWAudio {
  constructor(audio) {
    this.audio = audio;
    this.breathT = 0;
    this.breathIn = false;
    this.pingT = 0;
    this.excite = 0.2;
  }

  get ctx() {
    return this.audio.ctx;
  }

  init() {
    this.audio.init();
    if (this.ready || !this.ctx) return;
    this.ready = true;
    this.audio.musicBus.gain.value = 0.32;
    this.audio.setMusic('title');
  }

  update(dt, { excitement = 0.2, fatigue = 0, moving = true, final = false, playing = true } = {}) {
    if (!this.ctx) return;
    this.excite += (excitement - this.excite) * Math.min(1, dt * 0.8);
    this.audio.update(dt, { excitement: this.excite, playing });
    // 息（疲れるほど速く・大きく）
    if (moving && playing) {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        this.breathT = 0.62 - 0.26 * fatigue;
        this.breathIn = !this.breathIn;
        const v = 0.012 + 0.05 * fatigue * fatigue;
        this.audio.noiseHit(0.24, { freq: this.breathIn ? 1250 : 760, sweepTo: this.breathIn ? 1650 : 480, q: 1.3, vol: v, attack: 0.07 });
      }
    }
    if (final && this.audio.style !== 'final') this.audio.setMusic('final');
    this.pingT -= dt;
  }

  step(speed, fatigue) {
    if (!this.ctx) return;
    this.audio.noiseHit(0.045, { type: 'lowpass', freq: 520 + speed * 30, vol: 0.035 + 0.02 * fatigue });
  }

  ping(kind) {
    if (!this.ctx || this.pingT > 0) return;
    this.pingT = 0.09;
    if (kind === 'hl') this.audio.tone(1568, 0.08, { type: 'sine', vol: 0.025 });
    else this.audio.tone(2093, 0.04, { type: 'sine', vol: 0.012 });
  }

  superchat(amount) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = amount >= 50000 ? 6 : amount >= 10000 ? 5 : amount >= 2000 ? 3 : 2;
    const notes = [1047, 1319, 1568, 2093, 2637, 3136];
    for (let i = 0; i < n; i++) this.audio.tone(notes[i], 0.16, { type: 'triangle', vol: 0.05, at: t + i * 0.06 });
    if (amount >= 50000) this.audio.noiseHit(0.8, { freq: 2000, sweepTo: 6000, q: 0.8, vol: 0.05, attack: 0.05 });
  }

  spike() {
    if (!this.ctx) return;
    this.audio.noiseHit(0.7, { freq: 200, sweepTo: 4200, q: 1.1, vol: 0.12, attack: 0.1 });
    this.audio.tone(220, 0.6, { type: 'sawtooth', slideTo: 880, vol: 0.04, cutoff: 2000 });
  }

  flame() {
    if (!this.ctx) return;
    this.audio.noiseHit(1.2, { type: 'lowpass', freq: 400, sweepTo: 1600, vol: 0.12, attack: 0.2 });
  }

  paddle() {
    if (!this.ctx) return;
    this.audio.tone(880, 0.12, { type: 'square', vol: 0.04, cutoff: 2400 });
    this.audio.tone(660, 0.16, { type: 'square', vol: 0.04, cutoff: 2400, at: this.ctx.currentTime + 0.13 });
  }

  red() {
    if (!this.ctx) return;
    this.audio.tone(180, 0.45, { type: 'sawtooth', vol: 0.09, cutoff: 900 });
    this.audio.tone(140, 0.5, { type: 'sawtooth', vol: 0.07, cutoff: 900, at: this.ctx.currentTime + 0.18 });
  }

  qte() {
    if (!this.ctx) return;
    this.audio.tone(1200, 0.08, { type: 'square', vol: 0.06 });
    this.audio.tone(1500, 0.1, { type: 'square', vol: 0.06, at: this.ctx.currentTime + 0.08 });
  }

  trip() {
    this.audio.bump();
  }

  fall() {
    this.audio.fall();
  }

  bell() {
    this.audio.bell();
  }

  overtake(big) {
    this.audio.overtake(big);
  }

  cheer(size = 1) {
    this.audio.cheerSwell(size);
  }

  finish(win) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.audio.horn?.();
    this.audio.cheerSwell(win ? 3 : 1.6);
    if (win) [523, 659, 784, 1047].forEach((f, i) => this.audio.tone(f, 0.5, { type: 'triangle', vol: 0.07, at: t + 0.2 + i * 0.12 }));
  }

  click() {
    if (!this.ctx) return;
    this.audio.tone(1760, 0.04, { type: 'square', vol: 0.03 });
  }

  sleep() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // 「すやぁ」（下がる音）+ 会場のどよめき
    this.audio.tone(660, 0.9, { type: 'sine', slideTo: 220, vol: 0.06 });
    this.audio.noiseHit(1.8, { freq: 380, sweepTo: 900, q: 0.6, vol: 0.2, attack: 0.3, at: t + 0.2 });
  }
}
