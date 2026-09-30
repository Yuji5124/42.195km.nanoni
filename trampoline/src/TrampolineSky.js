import * as THREE from 'three';
import { createRng } from '../../src/core/math.js';

// 夜空（会場の外）。屋根の半透明の膜ごしにうっすら、屋根が開くとはっきり見える。
// 空へ飛んだ時（SKY JUMP）は高度に合わせて色と星が変わる（setAltitude）。

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uGlowAmt;
uniform float uDip; // 地平線がどれだけ下がるか（高度が高いほど地球が丸く、下に見える）
uniform float uEarth; // 空の下半分に地球を描くか（0〜1）
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float h = vDir.y;
  float hz = -sin(uDip);
  vec3 c = mix(uHorizon, uTop, smoothstep(hz - 0.05, 0.6, h));
  // 地平線の光（低い所では街あかり、高い所では大気の青い縁）
  c += uGlow * uGlowAmt * exp(-abs(h - hz + 0.02) * 9.0);
  // 地球（地平線より下）: 夜の地表 + 街あかりの粒
  if (h < hz) {
    vec2 q = vDir.xz / max(0.02, -h) * 26.0;
    float lights = step(0.985, hash(floor(q))) * (0.5 + 0.5 * hash(floor(q * 0.37)));
    vec3 earth = vec3(0.012, 0.018, 0.04) + vec3(1.0, 0.72, 0.42) * lights * 0.9;
    float edge = smoothstep(hz, hz - 0.015, h);
    c = mix(c, earth, uEarth * edge);
    c += uGlow * uGlowAmt * uEarth * exp(-abs(h - hz) * 60.0) * 0.8;
  }
  gl_FragColor = vec4(c, 1.0);
}`;

export class TrampolineSky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color(0x02030b) },
      uHorizon: { value: new THREE.Color(0x141a3a) },
      uGlow: { value: new THREE.Color(0xff9a4a) },
      uGlowAmt: { value: 0.35 },
      uDip: { value: 0 },
      uEarth: { value: 0 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1900, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
    // 星
    const rng = createRng(42);
    const N = 1600;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = rng.next() * 2 - 1;
      const a = rng.next() * Math.PI * 2;
      const y = Math.abs(u) * 0.98 + 0.02;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 1700, y * 1700, Math.sin(a) * r * 1700], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false, depthWrite: false });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.frustumCulled = false;
    scene.add(this.stars);
    // 月
    const [c, g] = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      return [cv, cv.getContext('2d')];
    })();
    const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,250,230,1)');
    grad.addColorStop(0.35, 'rgba(255,245,220,1)');
    grad.addColorStop(0.42, 'rgba(255,240,210,0.35)');
    grad.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false }));
    this.moon.scale.setScalar(150);
    this.moon.position.set(-700, 1100, -900);
    scene.add(this.moon);
    this.group = [this.dome, this.stars, this.moon];
  }

  // カメラと一緒に動かす（空はいつも無限に遠い）
  follow(camera) {
    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.moon.position.set(camera.position.x - 700, camera.position.y + 1100, camera.position.z - 900);
  }

  // 高度（m）で空の色を変える（SKY JUMP）
  setAltitude(alt) {
    const u = this.uniforms;
    const t = Math.min(1, Math.max(0, Math.log10(Math.max(1, alt)) / 4.7)); // 0（地上）〜 1（50km）
    u.uTop.value.setRGB(0.008 * (1 - t), 0.012 * (1 - t), 0.045 * (1 - t * 0.9));
    u.uHorizon.value.setRGB(0.08 * (1 - t) + 0.02 * t, 0.1 * (1 - t) + 0.08 * t, 0.23 * (1 - t) + 0.35 * t);
    u.uGlow.value.setRGB(1 - t * 0.7, 0.6 - t * 0.1, 0.29 + t * 0.7);
    u.uGlowAmt.value = 0.35 + t * 0.5;
    this.starMat.opacity = 0.7 + t * 0.3;
    this.starMat.size = 2.2 + t * 0.8;
    // 地球の丸み: 地平線の下がる角度 = acos(R / (R + h))
    const R = 6371000;
    u.uDip.value = Math.acos(R / (R + Math.max(0, alt)));
    u.uEarth.value = alt > 200 ? 1 : 0;
  }
}
