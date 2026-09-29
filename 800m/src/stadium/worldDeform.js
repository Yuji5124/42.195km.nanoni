import * as THREE from 'three';

// 見た目だけの世界の変形（Visual track）。論理トラック（RaceCore）はまったく変わらない。
//   wave  … トラックが波打つ（振幅, 波数, 速さ）
//   tilt  … 競技場ごと傾く（X 軸まわり, rad）
//   twist … トラックがねじれる（X に沿って回転角が変わる, rad / 100m）
//   fold  … 折れ目（x の位置で折れ曲がる, 角度）
// シェーダー（attach）と JS（apply）で同じ式を使い、選手・カメラも変形後の世界に立たせる。

const DEFORM_GLSL = /* glsl */ `
uniform vec4 uDWave;   // amp, k, speed, time
uniform float uDTilt;
uniform float uDTwist;
uniform vec2 uDFold;   // angle, x
vec3 nnDeform(vec3 p) {
  if (uDWave.x != 0.0) p.y += uDWave.x * sin(p.x * uDWave.y + uDWave.w * uDWave.z) * cos(p.z * uDWave.y * 0.7 + uDWave.w * uDWave.z * 0.6);
  if (uDFold.x != 0.0) { float dx = max(0.0, p.x - uDFold.y); p.y += dx * tan(uDFold.x); }
  if (uDTwist != 0.0) { float a = uDTwist * p.x / 100.0; float c = cos(a), s = sin(a); p = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
  if (uDTilt != 0.0) { float c = cos(uDTilt), s = sin(uDTilt); p = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
  return p;
}
`;

export class WorldDeform {
  constructor() {
    this.uniforms = {
      uDWave: { value: new THREE.Vector4(0, 0.1, 1, 0) },
      uDTilt: { value: 0 },
      uDTwist: { value: 0 },
      uDFold: { value: new THREE.Vector2(0, 0) },
    };
  }

  get active() {
    const u = this.uniforms;
    return u.uDWave.value.x !== 0 || u.uDTilt.value !== 0 || u.uDTwist.value !== 0 || u.uDFold.value.x !== 0;
  }

  set({ wave = 0, waveK = 0.12, waveSpeed = 2.2, tilt = 0, twist = 0, fold = 0, foldX = 0 } = {}, time = 0) {
    const u = this.uniforms;
    u.uDWave.value.set(wave, waveK, waveSpeed, time);
    u.uDTilt.value = tilt;
    u.uDTwist.value = twist;
    u.uDFold.value.set(fold, foldX);
  }

  // シェーダーへ差し込む（instancing 対応）
  attach(shader) {
    Object.assign(shader.uniforms, this.uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${DEFORM_GLSL}`).replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      vec4 nnW = modelMatrix * mvPosition;
      nnW.xyz = nnDeform(nnW.xyz);
      mvPosition = viewMatrix * nnW;
      gl_Position = projectionMatrix * mvPosition;`
    );
  }

  // JS 側: ワールド座標を同じ式で変形（out に書く）
  apply(v, out = v) {
    const u = this.uniforms;
    let { x, y, z } = v;
    const w = u.uDWave.value;
    if (w.x !== 0) y += w.x * Math.sin(x * w.y + w.w * w.z) * Math.cos(z * w.y * 0.7 + w.w * w.z * 0.6);
    const f = u.uDFold.value;
    if (f.x !== 0) y += Math.max(0, x - f.y) * Math.tan(f.x);
    if (u.uDTwist.value !== 0) {
      const a = (u.uDTwist.value * x) / 100;
      const c = Math.cos(a);
      const s = Math.sin(a);
      [y, z] = [y * c - z * s, y * s + z * c];
    }
    if (u.uDTilt.value !== 0) {
      const c = Math.cos(u.uDTilt.value);
      const s = Math.sin(u.uDTilt.value);
      [y, z] = [y * c - z * s, y * s + z * c];
    }
    out.x = x;
    out.y = y;
    out.z = z;
    return out;
  }
}
