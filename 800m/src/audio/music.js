// 距離で変わる音楽（その場で合成するステップシーケンサー）。
//     0〜300m  静か（遅いキック・和音だけ）
//   300〜600m  速くなる（4 つ打ち・スネア・ベース）
//   600〜750m  混沌（さらに速く、アルペジオが暴れる）
//   750〜800m  シンプルなビートだけ（心臓の音のようなキック）→ 790m で消える（P.audio.music）
// chip = 1 で全部ピコピコ（矩形波）。bpmMul でテンポ、detune で音程のずれ（Modifier）。
// 音の予約は少し先（lookahead）まで。フレームが遅くてもリズムが崩れない。

const SCALE = [0, 2, 3, 5, 7, 8, 10]; // A マイナー
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function section(d) {
  if (d < 300) return 0;
  if (d < 600) return 1;
  if (d < 750) return 2;
  return 3;
}
const BPM = [104, 132, 156, 156];

export class Music {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(out);
    this.noise = noise;
    this.next = 0; // 次の 16 分音符の時刻
    this.step = 0;
    this.sec = 0;
    this.rand = 12345;
  }

  rnd() {
    this.rand = (this.rand * 16807) % 2147483647;
    return this.rand / 2147483647;
  }

  // p: { d, running, bpmMul, chip, detune, level, finished }
  update(p) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const on = p.running && p.level > 0.001;
    this.out.gain.setTargetAtTime(on ? p.level * 0.8 : 0, t, on ? 0.2 : 0.6);
    if (!on) {
      this.next = 0;
      return;
    }
    if (this.next < t) this.next = t + 0.05;
    this.p = p;
    // 小節の頭でだけセクションを切り替える
    while (this.next < t + 0.12) {
      if (this.step % 16 === 0) this.sec = section(p.d);
      this.play(this.step, this.next);
      const bpm = BPM[this.sec] * (p.bpmMul || 1);
      this.next += 60 / bpm / 4;
      this.step++;
    }
  }

  play(step, at) {
    const s = this.sec;
    const chip = this.p.chip > 0.5;
    const beat = step % 16;
    const bar = Math.floor(step / 16);
    const chord = CHORDS[bar % 4];
    // キック
    const kick = s === 0 ? beat % 8 === 0 : s === 3 ? beat % 4 === 0 || beat === 3 : beat % 4 === 0;
    if (kick) this.kick(at, s === 3 ? 0.9 : 0.7);
    // スネア / クラップ
    if (s >= 1 && s < 3 && (beat === 4 || beat === 12)) this.snare(at, chip);
    if (s === 2 && beat === 14 && this.rnd() < 0.5) this.snare(at, chip);
    // ハイハット
    if (s === 0 && beat % 4 === 2) this.hat(at, 0.03);
    if (s === 1 && beat % 2 === 0) this.hat(at, beat % 4 === 2 ? 0.06 : 0.035);
    if (s === 2) this.hat(at, beat % 2 ? 0.03 : 0.06);
    // 和音（小節の頭で長く）
    if (s < 3 && beat === 0) for (const n of chord) this.note(at, midi(n), (60 / BPM[s]) * 4, s === 0 ? 0.05 : 0.035, chip ? 'square' : 'triangle');
    // ベース
    if (s === 1 || s === 2) {
      if (beat % 2 === 0) this.note(at, midi(chord[0] - 24 + (beat === 6 || beat === 14 ? 7 : 0)), 0.14, 0.14, chip ? 'square' : 'sawtooth', 700);
    }
    // 混沌のアルペジオ（600〜750m）
    if (s === 2) {
      const deg = SCALE[Math.floor(this.rnd() * SCALE.length)];
      const oct = this.rnd() < 0.3 ? 24 : 12;
      if (this.rnd() < 0.85) this.note(at, midi(57 + deg + oct), 0.09, 0.05, chip ? 'square' : 'sawtooth', 2400, this.rnd() < 0.15 ? 60 : 0);
    }
  }

  env(at, dur, vol, attack = 0.005) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0006, at + dur);
    g.connect(this.out);
    return g;
  }

  note(at, freq, dur, vol, type, cutoff = 0, bend = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (bend) o.frequency.linearRampToValueAtTime(freq * Math.pow(2, bend / 1200), at + dur);
    o.detune.value = this.p.detune || 0;
    const g = this.env(at, dur, vol, 0.01);
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      o.connect(f).connect(g);
    } else o.connect(g);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  kick(at, vol) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140, at);
    o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    o.connect(this.env(at, 0.22, vol, 0.002));
    o.start(at);
    o.stop(at + 0.26);
  }

  noiseHit(at, dur, vol, freq, type) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.env(at, dur, vol, 0.002));
    src.start(at, this.rnd() * 1.5, dur + 0.05);
  }

  snare(at, chip) {
    this.noiseHit(at, chip ? 0.08 : 0.14, 0.18, chip ? 3000 : 1800, chip ? 'highpass' : 'bandpass');
  }

  hat(at, vol) {
    this.noiseHit(at, 0.035, vol, 7000, 'highpass');
  }
}
