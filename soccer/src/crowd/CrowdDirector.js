import * as THREE from 'three';
import { ZONE } from './SeatPlan.js';

// Crowd Event Director: 観客を 1 人ずつ AI 制御しない。ブロック（96 個）単位の「姿勢」だけを持つ。
//
//   ブロックの状態 = 前の姿勢 → 次の姿勢（stand / arms / jump / phone）と、切り替えた時刻・ばらつき（spread）
//   それを DataTexture（96 × 3 texel）に書き、GPU が 10 万人ぶん「その人の遅れ（delay）・速さ・身長」を足して姿勢にする。
//   ウェーブは uniform 1 つ（ループ位置 s の上を動くガウスの山）。
//   → 毎フレームの JS は 96 ブロック + ウェーブだけ。10 万人ぶんの処理はしない。
//
// 「大きな集団として動き、その中に個体差がある」: ブロックごとに切り替えの時刻が少しずれ、1 人 1 人は
// r1（遅れ）・r2（動きの速さ・どこまで立つか）で少しずつ違う。完全同期でも完全ランダムでもない。
//
// 同じ式を CPU にも持つ（poseAt）: 「前の人が立っていて見えない」の判定と近くの 3D 観客に使う。

export const POSE = {
  SIT: { stand: 0, arms: 0, jump: 0, phone: 0 },
  LEAN: { stand: 0.3, arms: 0, jump: 0, phone: 0, lean: 1 },
  HALF: { stand: 0.6, arms: 0.15, jump: 0, phone: 0 },
  STAND: { stand: 1, arms: 0, jump: 0, phone: 0 },
  CHEER: { stand: 1, arms: 1, jump: 0, phone: 0 },
  JUMP: { stand: 1, arms: 1, jump: 1, phone: 0 },
  PHONE: { stand: 0.2, arms: 0.2, jump: 0, phone: 1 },
  CLAP: { stand: 0, arms: 0.35, jump: 0, phone: 0, clap: 1 },
  HEAD: { stand: 0.5, arms: 0.55, jump: 0, phone: 0 }, // 頭を抱える
};

// 姿勢（ブロックの状態 + 人ごとの r1 r2 + ウェーブ）: CrowdField / NearCrowd の頂点シェーダーで共有
export const POSE_GLSL = /* glsl */ `
uniform sampler2D uState;
uniform vec4 uWave;
uniform float uTime;
vec4 crowdPose(float block, float r1, float r2, float s, out float lean, out float clap) {
  int bx = int(block + 0.5);
  vec4 a = texelFetch(uState, ivec2(bx, 0), 0);
  vec4 b = texelFetch(uState, ivec2(bx, 1), 0);
  vec4 m = texelFetch(uState, ivec2(bx, 2), 0);
  float k = clamp((uTime - m.x - r1 * m.y) / (0.22 + r2 * 0.4), 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  vec4 p = mix(a, b, k);
  p.x = clamp(p.x * (0.8 + 0.4 * r2), 0.0, 1.0);
  // 何もない時も少しだけ動く（数秒ごとに 2% ほどの人が手を上げる・立ち上がる）: 静止画に見せない
  float slot = floor(uTime * 0.4 + r1 * 17.0);
  float pick = fract(sin(slot * 12.9898 + r2 * 78.233) * 43758.5453);
  float fid = smoothstep(0.978, 0.99, pick) * (0.5 + 0.5 * sin(fract(uTime * 0.4 + r1 * 17.0) * 3.14159));
  p.y = max(p.y, fid * (r2 > 0.5 ? 1.0 : 0.45));
  p.x = max(p.x, fid * step(0.8, r1));
  float ds = fract(s - uWave.x + 0.5 + (r1 - 0.5) * 0.004) - 0.5;
  float w = uWave.z * exp(-(ds * ds) / (uWave.y * uWave.y));
  p.x = max(p.x, w);
  p.y = max(p.y, w * 0.95);
  lean = m.z;
  clap = m.w;
  return p;
}
float crowdJump(vec4 p, float r1, float r2) {
  return p.z * 0.24 * max(0.0, sin(uTime * (7.0 + r2 * 3.0) + r1 * 6.2831));
}
`;

const W = 128;
const smooth = (k) => k * k * (3 - 2 * k);

export class CrowdDirector {
  constructor(layout, plan, rng) {
    this.layout = layout;
    this.plan = plan;
    this.rng = rng;
    this.nb = layout.blocks.length;
    this.data = new Float32Array(W * 3 * 4);
    this.tex = new THREE.DataTexture(this.data, W, 3, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.time = 0;
    this.uniforms = {
      uState: { value: this.tex },
      uWave: { value: new THREE.Vector4(0, 0.02, 0, 0) },
      uTime: { value: 0 },
    };
    this.wave = null;
    this.mood = 'calm';
    this.ultras = layout.blocks.filter((b) => plan.zoneOfBlock[b.index] === ZONE.ULTRAS).map((b) => b.index);
    this.away = layout.blocks.filter((b) => plan.zoneOfBlock[b.index] === ZONE.AWAY).map((b) => b.index);
    this.home = layout.blocks.filter((b) => plan.zoneOfBlock[b.index] === ZONE.HOME).map((b) => b.index);
    this.all = layout.blocks.map((b) => b.index);
    this.timers = [];
    this.set(this.all, POSE.SIT, { spread: 0 });
    this.set(this.ultras, POSE.CHEER, { spread: 0 });
    this.dirty = true;
  }

  // ブロックの今の姿勢（人の遅れを無視した中央値）
  current(bi) {
    const d = this.data;
    const o0 = bi * 4;
    const o1 = (W + bi) * 4;
    const o2 = (2 * W + bi) * 4;
    const k = smooth(Math.min(1, Math.max(0, (this.time - d[o2] - 0.5 * d[o2 + 1]) / 0.42)));
    return [0, 1, 2, 3].map((c) => d[o0 + c] + (d[o1 + c] - d[o0 + c]) * k);
  }

  // ブロック群を姿勢 pose へ。spread = 人ごとの遅れの最大（秒）、stagger = ブロックごとのずれ（秒）
  set(blocks, pose, { spread = 0.35, stagger = 0.12, delay = 0 } = {}) {
    const d = this.data;
    for (const bi of blocks) {
      const cur = this.current(bi);
      const o0 = bi * 4;
      const o1 = (W + bi) * 4;
      const o2 = (2 * W + bi) * 4;
      for (let c = 0; c < 4; c++) d[o0 + c] = cur[c];
      d[o1] = pose.stand;
      d[o1 + 1] = pose.arms;
      d[o1 + 2] = pose.jump;
      d[o1 + 3] = pose.phone;
      d[o2] = this.time + delay + this.rng.next() * stagger;
      d[o2 + 1] = spread;
      d[o2 + 2] = pose.lean ?? 0;
      d[o2 + 3] = pose.clap ?? 0;
    }
    this.dirty = true;
  }

  // t 秒後に set（反応の連鎖: 立つ → 座る）
  later(t, fn) {
    this.timers.push({ at: this.time + t, fn });
  }

  clearTimers() {
    this.timers.length = 0;
  }

  // ---- 試合への反応（MatchDirector から）
  react(type, info = {}) {
    const homeSide = info.team === 'home';
    const fans = homeSide ? this.home : this.away;
    const rivals = homeSide ? this.away : this.home;
    this.clearTimers();
    switch (type) {
      case 'chance': // 決定機: 前のめり → 半分立つ
        this.set(fans, POSE.LEAN, { spread: 0.5 });
        this.later(0.9, () => this.set(fans, POSE.HALF, { spread: 0.6 }));
        break;
      case 'shot':
        this.set(fans, POSE.STAND, { spread: 0.25, stagger: 0.05 });
        this.set(rivals, POSE.LEAN, { spread: 0.4 });
        break;
      case 'miss':
      case 'save':
        this.set(fans, POSE.HEAD, { spread: 0.3 });
        this.set(rivals, POSE.CLAP, { spread: 0.5 });
        this.later(2.2, () => this.set([...fans, ...rivals], POSE.SIT, { spread: 2.5, stagger: 0.6 }));
        break;
      case 'goal': // スタジアム爆発: 総立ち → ジャンプ → しばらくして座る（ばらばらに）
        this.set(fans, POSE.JUMP, { spread: 0.22, stagger: 0.08 });
        this.set(rivals, POSE.SIT, { spread: 1.2 });
        this.later(6.5, () => this.set(fans, POSE.CHEER, { spread: 1.5 }));
        this.later(11, () => this.set(fans, POSE.CLAP, { spread: 2.5, stagger: 0.8 }));
        this.later(15, () => this.set(fans, POSE.SIT, { spread: 4, stagger: 1 }));
        break;
      case 'var':
        this.set(this.all, POSE.PHONE, { spread: 1.5, stagger: 0.4 });
        break;
      case 'calm':
        this.set([...this.home, ...this.away], POSE.SIT, { spread: 2.5, stagger: 0.8 });
        break;
      case 'standAll': // 終盤・大詰め
        this.set([...this.home, ...this.away], POSE.STAND, { spread: 0.8 });
        break;
      case 'kickoff':
        this.set(this.all, POSE.CHEER, { spread: 0.5 });
        this.later(4.5, () => this.set([...this.home, ...this.away], POSE.SIT, { spread: 3, stagger: 0.8 }));
        break;
      case 'whistle':
        this.set(this.all, POSE.STAND, { spread: 0.8 });
        break;
      default:
        break;
    }
    // ゴール裏はずっと立って跳ねている（ゴールの時はもっと）
    this.set(this.ultras, type === 'goal' && homeSide ? POSE.JUMP : POSE.CHEER, { spread: 0.3, stagger: 0 });
    if (type === 'goal' && homeSide) this.later(16, () => this.set(this.ultras, POSE.CHEER, { spread: 0.8 }));
  }

  // ウェーブ: 一周 lapSeconds 秒。laps 周で止まる
  startWave({ from = 0.5, lapSeconds = 24, laps = 1.15, width = 0.022 } = {}) {
    this.wave = { s: from, speed: 1 / lapSeconds, left: laps, width, amp: 0 };
  }

  get waveActive() {
    return !!this.wave;
  }

  update(dt) {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].at <= this.time) {
        const t = this.timers[i];
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    const u = this.uniforms;
    u.uTime.value = this.time;
    const w = this.wave;
    if (w) {
      w.s = (w.s + w.speed * dt) % 1;
      w.left -= w.speed * dt;
      w.amp = Math.min(1, w.amp + dt * 0.8);
      if (w.left < 0.1) w.amp = Math.max(0, w.left / 0.1);
      u.uWave.value.set(w.s, w.width, w.amp, 0);
      if (w.left <= 0) {
        this.wave = null;
        u.uWave.value.z = 0;
      }
    }
    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }

  // ---- CPU の鏡（シェーダーと同じ式）
  // 返り値: [stand, arms, jump, phone]
  poseAt(id, out = [0, 0, 0, 0]) {
    const L = this.layout;
    const bi = L.block[id];
    const look = this.plan.look;
    const r1 = look[id * 4 + 2] / 255;
    const r2 = look[id * 4 + 3] / 255;
    const d = this.data;
    const o0 = bi * 4;
    const o1 = (W + bi) * 4;
    const o2 = (2 * W + bi) * 4;
    const k = smooth(Math.min(1, Math.max(0, (this.time - d[o2] - r1 * d[o2 + 1]) / (0.22 + r2 * 0.4))));
    for (let c = 0; c < 4; c++) out[c] = d[o0 + c] + (d[o1 + c] - d[o0 + c]) * k;
    out[0] = Math.min(1, Math.max(0, out[0] * (0.8 + 0.4 * r2)));
    const wv = this.uniforms.uWave.value;
    if (wv.z > 0) {
      let ds = L.s[id] - wv.x + 0.5 + (r1 - 0.5) * 0.004;
      ds = ds - Math.floor(ds) - 0.5;
      const w = wv.z * Math.exp(-(ds * ds) / (wv.y * wv.y));
      out[0] = Math.max(out[0], w);
      out[1] = Math.max(out[1], w * 0.95);
    }
    return out;
  }

  // ウェーブが座席 id を覆っている強さ（0〜1）
  waveAt(id) {
    const wv = this.uniforms.uWave.value;
    if (wv.z <= 0) return 0;
    let ds = this.layout.s[id] - wv.x + 0.5;
    ds = ds - Math.floor(ds) - 0.5;
    return wv.z * Math.exp(-(ds * ds) / (wv.y * wv.y));
  }
}
