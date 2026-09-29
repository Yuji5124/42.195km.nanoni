import { EV } from '../core/events.js';
import { clamp, lerp } from '../core/mathx.js';
import { Music } from './music.js';

// 音はすべて WebAudio でその場で作る（音声ファイルなし）。
//   足音 … 接地（RaceCore の FOOTSTEP）ごとに「ドッ」+「ザッ」。速いほど強い
//   呼吸 … 2〜4 歩に 1 回。疲れるほど速く・大きく
//   歓声 … 常に鳴っている観客のざわめき + 出来事ごとの歓声（CROWD_REACT）。逆再生の Modifier は本当に逆回し
//   風   … 走る速さと強風の Modifier
//   号砲・鐘（ラスト 1 周）・ゴール・Modifier が始まった時の短い効果音
//   音楽 … music.js（距離で変わる）
// ラスト 40m（P.audio.focus）: 音楽が消え、足音・呼吸・歓声だけが大きくなる。

export class AudioEngine {
  constructor(bus, { muted = false } = {}) {
    this.bus = bus;
    this.muted = muted;
    this.ctx = null;
    this.lastFoot = 0;
    this.breathT = 0;
    this.breathIn = true;
    this.state = { reverse: 0, focus: 0, silence: 0, footsteps: 1 };
    this.wire();
  }

  // 最初のクリック・キーで作る（ブラウザの自動再生の決まり）
  unlock() {
    if (this.muted) return;
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (!this.muted) this.unlock();
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1.4, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 1.4;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master.connect(this.lp).connect(this.comp).connect(ctx.destination);
    this.sfx = this.bus_(0.9);
    this.crowdBus = this.bus_(0.9);
    this.musicBus = this.bus_(0.7);

    // 共有のノイズ（2 秒）
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 7;
    for (let i = 0; i < len; i++) {
      s = (s * 16807) % 2147483647;
      d[i] = (s / 2147483647) * 2 - 1;
    }
    // 歓声の「わーっ」（前向き / 逆回し）
    this.cheer = this.makeCheer(2.6);
    this.cheerRev = this.reverseBuffer(this.cheer);

    // ざわめき（ずっと鳴る）
    this.bed = this.loopNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.55;
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0;
    this.bed.connect(bp).connect(this.bedGain).connect(this.crowdBus);
    // 風
    this.windSrc = this.loopNoise();
    this.windLp = ctx.createBiquadFilter();
    this.windLp.type = 'lowpass';
    this.windLp.frequency.value = 420;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windLp).connect(this.windGain).connect(this.sfx);

    this.music = new Music(ctx, this.musicBus, this.noise);
  }

  bus_(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    g.connect(this.master);
    return g;
  }

  loopNoise() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  makeCheer(sec) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const out = buf.getChannelData(0);
    // たくさんの「声」: 帯域を絞ったノイズの束 + うねり。立ち上がり速く、ゆっくり減る
    let s = 99;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const voices = Array.from({ length: 14 }, () => ({ f: 300 + rnd() * 900, ph: rnd() * 6, a: 0.5 + rnd() * 0.5, lfo: 3 + rnd() * 5 }));
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      const env = Math.min(1, t / 0.12) * Math.exp(-t * 1.1);
      const w = rnd() * 2 - 1;
      // 2 段のローパス（ざらつきを取る）
      y1 += (w - y1) * 0.25;
      y2 += (y1 - y2) * 0.35;
      let v = y2 * 0.9;
      for (const vo of voices) v += Math.sin(t * vo.f * 6.283 + vo.ph + Math.sin(t * vo.lfo) * 2) * 0.012 * vo.a * (0.6 + 0.4 * Math.sin(t * vo.lfo + vo.ph));
      out[i] = v * env;
    }
    return buf;
  }

  reverseBuffer(buf) {
    const r = this.ctx.createBuffer(1, buf.length, buf.sampleRate);
    const a = buf.getChannelData(0);
    const b = r.getChannelData(0);
    for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i];
    return r;
  }

  // ---- 一回きりの音
  burst({ at = 0, dur = 0.08, freq = 800, q = 1, type = 'bandpass', vol = 0.3, out = this.sfx, offset = null }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, offset ?? Math.random() * 1.5, dur + 0.05);
  }

  tone({ at = 0, freq = 440, dur = 0.2, vol = 0.2, type = 'sine', out = this.sfx, slide = 0, attack = 0.004 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  footstep(v, near = 1) {
    const st = this.state;
    const k = clamp(v / 9, 0.2, 1.2) * near * st.footsteps * (1 + st.focus * 0.9);
    this.tone({ freq: 95 + Math.random() * 20, dur: 0.09, vol: 0.28 * k, slide: 0.5 });
    this.burst({ dur: 0.05, freq: 1800 + Math.random() * 900, q: 0.8, vol: 0.12 * k });
  }

  breath(strength, inhale) {
    const st = this.state;
    const vol = (0.03 + 0.2 * strength) * (1 + st.focus * 1.2);
    this.burst({ dur: inhale ? 0.28 : 0.2, freq: inhale ? 1400 : 900, q: 0.9, vol, type: 'bandpass' });
  }

  cheerSwell(amount) {
    const ctx = this.ctx;
    const st = this.state;
    const src = ctx.createBufferSource();
    src.buffer = st.reverse > 0.5 ? this.cheerRev : this.cheer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const g = ctx.createGain();
    g.gain.value = clamp(amount / 20, 0.1, 1.2) * (1 - st.silence);
    src.connect(g).connect(this.crowdBus);
    src.start();
  }

  gun() {
    this.burst({ dur: 0.35, freq: 2500, q: 0.4, type: 'lowpass', vol: 1.0 });
    this.tone({ freq: 70, dur: 0.5, vol: 0.6, slide: 0.4 });
  }

  bell() {
    for (let i = 0; i < 3; i++) {
      for (const [m, a] of [[1, 0.25], [2.76, 0.12], [5.4, 0.06]]) this.tone({ at: i * 0.42, freq: 880 * m, dur: 1.2, vol: a });
    }
  }

  stinger(legendary) {
    // 世界が変わる合図: 上がって下がる「ヒュン」+ 小さなノイズ
    this.tone({ freq: legendary ? 220 : 520, dur: legendary ? 0.9 : 0.35, vol: legendary ? 0.2 : 0.09, type: 'sawtooth', slide: legendary ? 4 : 0.35 });
    this.burst({ dur: 0.18, freq: 3000, q: 2, vol: 0.06 });
  }

  finishSound(place) {
    this.cheerSwell(40);
    const notes = place === 1 ? [523, 659, 784, 1047] : [440, 554, 659];
    notes.forEach((f, i) => this.tone({ at: 0.15 + i * 0.12, freq: f, dur: 0.7, vol: 0.16, type: 'triangle' }));
  }

  wire() {
    const on = (t, fn) => this.bus.on(t, (e) => this.ctx && !this.muted && fn(e));
    on(EV.RACE_START, () => this.gun());
    on(EV.LAP_2, () => this.bell());
    on(EV.CROWD_REACT, (e) => e.amount >= 6 && this.cheerSwell(e.amount));
    on(EV.FINISH, (e) => this.finishSound(e.place));
    on(EV.MODIFIER_START, (e) => e.source !== 'url' && this.stinger(e.legendary));
    on(EV.RHYTHM, (e) => e.grade === 'PERFECT' && this.tone({ freq: 1760, dur: 0.04, vol: 0.035, type: 'square' }));
    on(EV.FOOTSTEP, (e) => {
      if (e.player) this.footstep(e.v, 1);
      else if (this.near?.has(e.runner) && this.ctx.currentTime - this.lastFoot > 0.07) {
        this.lastFoot = this.ctx.currentTime;
        this.footstep(e.v, 0.3);
      }
    });
  }

  // 毎フレーム。s: { phase, running, d, v, stamina, effort, stepFreq, cheer, finished, audio(P.audio), wind, near }
  update(dt, s) {
    if (!this.ctx || this.muted) return;
    const A = s.audio;
    const st = this.state;
    st.reverse = A.reverseCrowd;
    st.focus = A.focus;
    st.silence = A.silence;
    st.footsteps = A.footsteps;
    this.near = s.near;
    const t = this.ctx.currentTime;
    // こもった音（水中・スロー・古い映画）
    this.lp.frequency.setTargetAtTime(lerp(20000, 520, clamp(A.lowpass, 0, 1)), t, 0.08);
    // ざわめき: 盛り上がりで大きく。ラスト 40m も観客は残る
    const bed = s.running || s.finished ? lerp(0.05, 0.32, s.cheer / 100) : 0.05;
    this.bedGain.gain.setTargetAtTime(bed * (1 - A.silence), t, 0.3);
    // 風
    this.windGain.gain.setTargetAtTime(clamp(s.v / 9, 0, 1) * 0.05 + (s.wind ?? 0) * 0.25, t, 0.2);
    this.windLp.frequency.setTargetAtTime(300 + s.v * 40 + (s.wind ?? 0) * 500, t, 0.2);
    // 呼吸: 疲れ（スタミナ）と力み（effort）で回数と強さが変わる
    if (s.running && !s.finished) {
      const fatigue = 1 - s.stamina / 100;
      const strength = clamp(fatigue * 0.8 + (s.effort - 0.7) * 1.2, 0.05, 1);
      const stepsPerBreath = strength > 0.6 ? 2 : strength > 0.3 ? 3 : 4;
      this.breathT += dt * (s.stepFreq / stepsPerBreath) * 2;
      if (this.breathT >= 1) {
        this.breathT -= 1;
        this.breath(strength, this.breathIn);
        this.breathIn = !this.breathIn;
      }
    }
    this.music.update({ d: s.d, running: s.running && !s.finished, bpmMul: A.bpmMul, chip: A.chip, detune: A.detune, level: A.music * (1 - A.silence), finished: s.finished });
  }
}
