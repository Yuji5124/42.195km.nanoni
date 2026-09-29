import * as THREE from 'three';

// 空と光。プリセットを Modifier が混ぜる（夜 / 朝焼け / 夕焼け / 宇宙 / 雲の上 / 海の上）。
// 空は球のシェーダー（星・地平線・下半分の色）。「空が下なのに。」は上下の色を入れ替えるだけ。

export const SKY_PRESETS = {
  night: { top: 0x060a1c, horizon: 0x2c2f6a, bottom: 0x0b0d16, sun: 0x000000, stars: 0.8, hemi: 1.05, dir: 0.9, fog: 0x151a33, ground: 0x14161e },
  dawn: { top: 0x3d4f9a, horizon: 0xffa27a, bottom: 0x2a2233, sun: 0xffd2a0, stars: 0.15, hemi: 1.35, dir: 1.2, fog: 0x8a6f86, ground: 0x2a2630 },
  sunset: { top: 0x2a1c58, horizon: 0xff6a3a, bottom: 0x2a1418, sun: 0xffb060, stars: 0.05, hemi: 1.3, dir: 1.3, fog: 0x6a3a4a, ground: 0x2a1c1c },
  space: { top: 0x000000, horizon: 0x0a0620, bottom: 0x000000, sun: 0x000000, stars: 1.6, hemi: 0.95, dir: 1.1, fog: 0x000000, ground: 0x000000 },
  clouds: { top: 0x3f86e8, horizon: 0xcfe6ff, bottom: 0xffffff, sun: 0xfff2d0, stars: 0, hemi: 1.8, dir: 1.5, fog: 0xd8ecff, ground: 0xf2f6ff },
  sea: { top: 0x3a78d0, horizon: 0xbfe0ff, bottom: 0x0e3f78, sun: 0xfff2d0, stars: 0, hemi: 1.7, dir: 1.4, fog: 0x9cc8ee, ground: 0x0e3f78 },
};

const COLOR_KEYS = ['top', 'horizon', 'bottom', 'sun', 'fog'];
const PRESET_COLORS = Object.fromEntries(
  Object.entries(SKY_PRESETS).map(([k, p]) => [k, Object.fromEntries(COLOR_KEYS.map((c) => [c, new THREE.Color(p[c])]))])
);
const ACC = Object.fromEntries(COLOR_KEYS.map((c) => [c, new THREE.Color()]));
const _c = new THREE.Color();

export class Lighting {
  constructor(scene) {
    this.scene = scene;
    this.hemi = new THREE.HemisphereLight(0xaab8ff, 0x2a2436, 1.05);
    scene.add(this.hemi);
    this.dir = new THREE.DirectionalLight(0xfff0dc, 0.9);
    this.dir.position.set(40, 90, 60);
    scene.add(this.dir);
    this.fill = new THREE.DirectionalLight(0x8fa8ff, 0.45);
    this.fill.position.set(-60, 40, -50);
    scene.add(this.fill);

    this.skyUniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() },
      uStars: { value: 0 },
      uFlip: { value: 0 },
      uTime: { value: 0 },
    };
    const geo = new THREE.SphereGeometry(1400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.skyUniforms,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uTop, uHorizon, uBottom, uSun; uniform float uStars, uFlip, uTime; varying vec3 vDir;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        void main(){
          vec3 d = vDir;
          if (uFlip > 0.5) d.y = -d.y;
          float h = d.y;
          vec3 c = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
          c = mix(uBottom, c, smoothstep(-0.25, 0.02, h));
          // 太陽のにじみ
          c += uSun * pow(max(0.0, dot(d, normalize(vec3(-0.6, 0.12, -0.8)))), 18.0) * 0.8;
          // 星
          vec2 g = floor(vec2(atan(d.z, d.x) * 180.0, h * 180.0));
          float s = step(0.996, h21(g)) * smoothstep(0.02, 0.3, h) * uStars;
          c += vec3(s) * (0.6 + 0.4 * sin(uTime * 3.0 + h21(g + 1.0) * 30.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.fog = new THREE.Fog(0x151a33, 120, 900);
    scene.fog = this.fog;
    this.current = null;
    this.apply(SKY_PRESETS.night);
  }

  // weights: { night: 1, sunset: 0.4, ... } → 混ぜ合わせ（同じ重みなら計算しない）
  mix(weights, extra = {}) {
    let key = extra.skyFlip ? 'F' : 'N';
    key += (extra.light ?? 1).toFixed(2);
    for (const [name, w] of Object.entries(weights)) if (w > 0.001) key += name + w.toFixed(3);
    if (key === this.mixKey) return;
    this.mixKey = key;
    for (const k of COLOR_KEYS) ACC[k].setRGB(0, 0, 0);
    let stars = 0;
    let hemi = 0;
    let dir = 0;
    let total = 0;
    for (const [name, w] of Object.entries(weights)) {
      if (w <= 0.001) continue;
      const p = SKY_PRESETS[name];
      const pc = PRESET_COLORS[name];
      total += w;
      for (const k of COLOR_KEYS) ACC[k].add(_c.copy(pc[k]).multiplyScalar(w));
      stars += p.stars * w;
      hemi += p.hemi * w;
      dir += p.dir * w;
    }
    if (total <= 0) return;
    const u = this.skyUniforms;
    u.uTop.value.copy(ACC.top).multiplyScalar(1 / total);
    u.uHorizon.value.copy(ACC.horizon).multiplyScalar(1 / total);
    u.uBottom.value.copy(ACC.bottom).multiplyScalar(1 / total);
    u.uSun.value.copy(ACC.sun).multiplyScalar(1 / total);
    u.uStars.value = stars / total;
    u.uFlip.value = extra.skyFlip ? 1 : 0;
    this.fog.color.copy(ACC.fog).multiplyScalar(1 / total);
    this.hemi.intensity = (hemi / total) * (extra.light ?? 1);
    this.dir.intensity = (dir / total) * (extra.light ?? 1);
  }

  apply(p) {
    const u = this.skyUniforms;
    u.uTop.value.set(p.top);
    u.uHorizon.value.set(p.horizon);
    u.uBottom.value.set(p.bottom);
    u.uSun.value.set(p.sun);
    u.uStars.value = p.stars;
    this.fog.color.set(p.fog);
    this.hemi.intensity = p.hemi;
    this.dir.intensity = p.dir;
  }

  update(dt, camera) {
    this.skyUniforms.uTime.value += dt;
    this.sky.position.copy(camera.position);
  }
}
