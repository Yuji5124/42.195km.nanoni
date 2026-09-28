import * as THREE from 'three';

// 軽量パーティクル（CPU 更新 + 1 draw call の Points）。
// 火花・着地の砂ぼこり・アイテム取得・紙吹雪に使う。three.quarks / three-nebula の
// 「エミッター → リングバッファ → 一括アップロード」という構造だけを最小実装。

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aSpin;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vAlpha = aAlpha;
  vSpin = aSpin;
}
`;

const FRAG_SOFT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

// 紙吹雪: 回転する長方形
const FRAG_CONFETTI = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vSpin), s = sin(vSpin);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float w = 0.18 + 0.3 * abs(sin(vSpin * 1.7));
  if (abs(p.x) > w || abs(p.y) > 0.4) discard;
  gl_FragColor = vec4(vColor * (0.75 + 0.25 * sign(sin(vSpin * 2.3))), vAlpha);
}
`;

export class Particles {
  constructor(scene, { capacity = 1500, additive = true, confetti = false } = {}) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.spinV = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.cursor = 0;
    this.confetti = confetti;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage));
    // uScale = 画面高さ(px) / 2 / tan(fov/2)。EffectManager が毎フレーム更新（望遠でも大きさが正しい）
    this.uniforms = { uScale: { value: 800 } };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: confetti ? FRAG_CONFETTI : FRAG_SOFT,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setPointScale(scale) {
    this.uniforms.uScale.value = scale;
  }

  emit({ x, y, z, vx = 0, vy = 0, vz = 0, spread = 1, color = [1, 1, 1], size = 0.3, life = 0.6, gravity = 0, drag = 1.5, count = 10 }) {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = vx + (Math.random() - 0.5) * 2 * spread;
      this.vel[i * 3 + 1] = vy + (Math.random() - 0.5) * 2 * spread;
      this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * 2 * spread;
      const c = Array.isArray(color[0]) ? color[Math.floor(Math.random() * color.length)] : color;
      this.col[i * 3] = c[0];
      this.col[i * 3 + 1] = c[1];
      this.col[i * 3 + 2] = c[2];
      this.baseSize[i] = size * (0.6 + Math.random() * 0.8);
      this.life[i] = life * (0.7 + Math.random() * 0.6);
      this.maxLife[i] = this.life[i];
      this.gravity[i] = gravity;
      this.drag[i] = drag;
      this.spin[i] = Math.random() * 6.28;
      this.spinV[i] = (Math.random() - 0.5) * 12;
    }
  }

  update(dt, time) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= k;
      if (this.confetti) {
        this.vel[i * 3] += Math.sin(time * 3 + i) * dt * 2;
      }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.confetti ? Math.min(1, t * 3) : t;
      this.size[i] = this.baseSize[i] * (this.confetti ? 1 : 0.5 + t * 0.5);
      this.spin[i] += this.spinV[i] * dt;
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = g.aColor.needsUpdate = g.aSize.needsUpdate = g.aAlpha.needsUpdate = g.aSpin.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }
}
