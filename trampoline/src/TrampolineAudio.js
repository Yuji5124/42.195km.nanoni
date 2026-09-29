// トランポリンの音。合成エンジン（BGM のシーケンサー・観客のざわめき・tone / noiseHit）は
// 1500m の AudioManager をそのまま使い、トランポリン固有の効果音だけをここで足す。

const semi = (n, base = 220) => base * Math.pow(2, n / 12);

// バレリーナ: クラシック（3 拍子のワルツ。主旋律 + ベースのズン・チャッ・チャッ）
const WALTZ = {
  bpm: 84,
  melody: [7, null, 12, 11, null, 9, 7, null, 4, 5, null, 7, 9, null, 7, 5, null, 4, 2, null, 4, 5, 7, null],
  bass: [0, 7, 7, -5, 2, 2, -3, 4, 4, -7, 2, 2],
};

export class TrampolineAudio {
  constructor(audio) {
    this.a = audio;
    this.ballet = false;
  }

  get ctx() {
    return this.a.ctx;
  }

  // ベッドの「ボヨン」（強さ 0〜1）
  boing(v = 0.5) {
    const a = this.a;
    a.tone(140 + v * 60, 0.22, { type: 'triangle', slideTo: 70, vol: 0.05 + v * 0.08 });
    a.noiseHit(0.08, { type: 'lowpass', freq: 380, vol: 0.04 + v * 0.06 });
  }

  // 踏み込み: 低い「ドン」+ ばねの軋み
  stomp(q = 1) {
    const a = this.a;
    a.tone(62, 0.5, { type: 'sine', slideTo: 30, vol: 0.32 });
    a.tone(124, 0.18, { type: 'square', slideTo: 55, vol: 0.06, cutoff: 600 });
    a.noiseHit(0.35, { type: 'lowpass', freq: 520, sweepTo: 120, vol: 0.2 });
    if (q > 0.6) a.cheerSwell(1 + q);
  }

  letter() {
    this.a.tone(1650 + Math.random() * 120, 0.035, { type: 'square', vol: 0.025, cutoff: 5000 });
  }

  miss() {
    this.a.tone(150, 0.12, { type: 'square', slideTo: 110, vol: 0.05, cutoff: 900 });
  }

  word(n = 1) {
    const t = this.ctx?.currentTime;
    if (t === undefined) return;
    [0, 4, 7, 12].forEach((s, i) => this.a.tone(semi(s + Math.min(n, 6) * 2, 660), 0.1, { type: 'triangle', vol: 0.05, at: t + i * 0.04 }));
  }

  whoosh(v = 1) {
    this.a.noiseHit(0.3, { freq: 300, sweepTo: 2400, q: 1.1, vol: 0.05 * v });
  }

  land(perfect) {
    const a = this.a;
    a.tone(90, 0.3, { type: 'sine', slideTo: 45, vol: 0.2 });
    a.noiseHit(0.12, { type: 'lowpass', freq: 600, vol: 0.12 });
    if (perfect) a.applause();
  }

  fail() {
    const a = this.a;
    a.tone(110, 0.35, { type: 'sine', slideTo: 50, vol: 0.18 });
    a.noiseHit(0.9, { type: 'lowpass', freq: 500, sweepTo: 240, vol: 0.18, attack: 0.08 }); // 「あぁ…」
  }

  // 審判の札（ピンポン）
  judges() {
    const t = this.ctx?.currentTime;
    if (t === undefined) return;
    this.a.tone(1046, 0.18, { type: 'sine', vol: 0.06, at: t });
    this.a.tone(784, 0.3, { type: 'sine', vol: 0.06, at: t + 0.16 });
  }

  // 「なのに。」の効果音（真面目な中継に似合わない、軽いファンファーレ）
  nanoni() {
    const t = this.ctx?.currentTime;
    if (t === undefined) return;
    [0, 7, 12, 16].forEach((s, i) => this.a.tone(semi(s, 523), 0.16, { type: 'square', vol: 0.035, at: t + i * 0.07, cutoff: 3500 }));
  }

  // 観客の「おおっ」
  ooh(size = 1) {
    this.a.noiseHit(1.1, { freq: 420, sweepTo: 760, q: 1.4, vol: Math.min(0.3, 0.1 * size), attack: 0.2 });
  }

  // ---- クラシック（バレリーナ）: AudioManager のシーケンサーとは別に、ここで 3 拍子を刻む
  setBallet(on) {
    if (on === this.ballet) return;
    this.ballet = on;
    if (on) {
      this.a.duckMusic(0.9, 30);
      this.bStep = 0;
      this.bNext = (this.ctx?.currentTime ?? 0) + 0.05;
    } else this.a.duckMusic(0, 0.1);
  }

  update() {
    if (!this.ballet || !this.ctx) return;
    const now = this.ctx.currentTime;
    const beat = 60 / WALTZ.bpm / 2; // 8 分音符
    if (this.bNext < now - 0.3) this.bNext = now + 0.02;
    while (this.bNext < now + 0.15) {
      const i = this.bStep;
      const m = WALTZ.melody[i % WALTZ.melody.length];
      if (m !== null) {
        this.a.tone(semi(m, 523), beat * 1.9, { type: 'triangle', vol: 0.06, at: this.bNext, attack: 0.03, cutoff: 4000 });
        this.a.tone(semi(m + 12, 523), beat * 1.2, { type: 'sine', vol: 0.018, at: this.bNext, attack: 0.02 });
      }
      if (i % 2 === 0) {
        const b = WALTZ.bass[(i / 2) % WALTZ.bass.length];
        const down = (i / 2) % 3 === 0;
        this.a.tone(semi(b, down ? 110 : 220), beat * (down ? 3.5 : 1.6), { type: down ? 'triangle' : 'sine', vol: down ? 0.07 : 0.03, at: this.bNext, attack: 0.01 });
      }
      this.bNext += beat;
      this.bStep++;
    }
  }
}
