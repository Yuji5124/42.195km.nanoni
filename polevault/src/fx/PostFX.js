import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// 画面の仕上げ（自前の最小パイプライン）。
//   1) シーン → HDR の描画先（MSAA 4・深度テクスチャ付き。群衆の alpha-to-coverage は MSAA が要る）
//   2) ブルーム: 明るい所だけ 1/4 の解像度でぼかす（月・照明・スマホのライト）
//   3) 仕上げ 1 パス: 被写界深度（深度 → ピントの距離との差で円形にぼかす。望遠ほど浅い）
//      + 急パンの流れ（横方向のにじみ）+ 周辺減光 + 粒子ノイズ + 色収差（わずか）+ トーンマップ + sRGB
// three.js の BokehShader（MIT）の考え方（深度から CoC を出して円形にサンプル）を 1 パスに縮めた。

const BRIGHT = /* glsl */ `
uniform sampler2D tColor;
uniform float uThresh;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThresh, uThresh * 2.2, l);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

const BLUR = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tColor, vUv).rgb * 0.2270270270;
  s += texture2D(tColor, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tColor, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tColor, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  s += texture2D(tColor, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}
`;

const FINAL = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uAperture;
uniform float uMaxCoc;
uniform float uBloom;
uniform float uTime;
uniform float uVignette;
uniform float uGrain;
uniform vec2 uSmear;
uniform float uFlash;
uniform float uFade;
uniform float uDesat;
varying vec2 vUv;

float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return -perspectiveDepthToViewZ(d, uNear, uFar);
}
float coc(float z) {
  float c = uAperture * abs(1.0 / uFocus - 1.0 / max(z, 0.1)) * uRes.y;
  return min(c, uMaxCoc);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 px = 1.0 / uRes;
  float z0 = viewZ(vUv);
  float c0 = coc(z0);
  vec3 col = texture2D(tColor, vUv).rgb;
  // 被写界深度: 黄金角のらせん 20 点。周りの点は「その点の CoC が自分まで届く」時だけ足す（にじみ出しを抑える）
  if (c0 > 0.6) {
    vec3 acc = col;
    float wsum = 1.0;
    const float GA = 2.39996323;
    for (int i = 1; i < 21; i++) {
      float fi = float(i);
      float r = sqrt(fi / 20.0) * c0;
      float a = fi * GA;
      vec2 o = vec2(cos(a), sin(a)) * r * px;
      vec2 uv = vUv + o;
      float zi = viewZ(uv);
      float ci = coc(zi);
      float w = smoothstep(r - 1.0, r + 1.0, max(ci, zi > z0 ? c0 : 0.0));
      acc += texture2D(tColor, uv).rgb * w;
      wsum += w;
    }
    col = acc / wsum;
  }
  // 急パンの流れ（パンの向きに 6 点）
  float sm = length(uSmear);
  if (sm > 0.5) {
    vec3 acc = col;
    for (int i = 1; i < 7; i++) {
      float k = (float(i) / 6.0 - 0.5);
      acc += texture2D(tColor, vUv + uSmear * px * k).rgb;
    }
    col = mix(col, acc / 7.0, min(1.0, sm / 6.0));
  }
  // ブルーム
  col += texture2D(tBloom, vUv).rgb * uBloom;
  // 白い光（シャッター）
  col += vec3(uFlash);
  // 周辺減光
  vec2 q = vUv - 0.5;
  col *= 1.0 - uVignette * dot(q, q) * 1.6;
  // トーンマップ → sRGB
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // 彩度を落とす（放送が終わった後）
  float l = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(l), uDesat);
  // 粒子ノイズ（放送カメラの感度ノイズ。暗い所ほど）
  float n = hash(vUv * uRes + fract(uTime * 7.13) * 100.0) - 0.5;
  gl_FragColor.rgb += n * uGrain * (1.2 - l);
  gl_FragColor.rgb *= uFade;
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;
    const caps = renderer.capabilities;
    this.samples = caps.isWebGL2 ? 4 : 0;
    this.makeTargets(2, 2);
    this.brightQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BRIGHT, uniforms: { tColor: { value: null }, uThresh: { value: 1.05 } }, depthTest: false, depthWrite: false }));
    this.blurQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR, uniforms: { tColor: { value: null }, uDir: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false }));
    this.u = {
      tColor: { value: null },
      tDepth: { value: null },
      tBloom: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uFocus: { value: 30 },
      uAperture: { value: 0.01 },
      uMaxCoc: { value: 12 },
      uBloom: { value: 0.9 },
      uTime: { value: 0 },
      uVignette: { value: 0.55 },
      uGrain: { value: 0.035 },
      uSmear: { value: new THREE.Vector2() },
      uFlash: { value: 0 },
      uFade: { value: 1 },
      uDesat: { value: 0 },
    };
    this.finalQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FINAL, uniforms: this.u, depthTest: false, depthWrite: false, toneMapped: true }));
    this.flash = 0;
    this.bloomOn = true;
  }

  makeTargets(w, h) {
    this.rt?.dispose();
    this.rtA?.dispose();
    this.rtB?.dispose();
    const depth = new THREE.DepthTexture(w, h);
    depth.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples, depthTexture: depth, depthBuffer: true });
    const bw = Math.max(1, Math.floor(w / 4));
    const bh = Math.max(1, Math.floor(h / 4));
    this.rtA = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType });
    this.rtB = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType });
    this.w = w;
    this.h = h;
  }

  setSize(w, h, pr) {
    const W = Math.max(2, Math.floor(w * pr));
    const H = Math.max(2, Math.floor(h * pr));
    this.makeTargets(W, H);
    this.u.uRes.value.set(W, H);
    this.u.uMaxCoc.value = 7 + H / 90;
  }

  // focus: ピントの距離（m）/ aperture: 望遠ほど大きい
  set({ focus, zoom, smearX = 0, smearY = 0, time = 0 }) {
    const u = this.u;
    u.uFocus.value = focus;
    // 広角は深い（ほぼ全部ピントが合う）・望遠は浅い
    u.uAperture.value = 0.0016 * Math.pow(zoom, 1.25);
    u.uSmear.value.set(smearX, smearY);
    u.uTime.value = time;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
  }

  render(dt = 0.016) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
      return;
    }
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, this.camera);
    if (this.bloomOn) {
      this.brightQ.material.uniforms.tColor.value = this.rt.texture;
      r.setRenderTarget(this.rtA);
      this.brightQ.render(r);
      const bu = this.blurQ.material.uniforms;
      for (let i = 0; i < 2; i++) {
        bu.tColor.value = this.rtA.texture;
        bu.uDir.value.set((1.5 + i) / this.rtA.width, 0);
        r.setRenderTarget(this.rtB);
        this.blurQ.render(r);
        bu.tColor.value = this.rtB.texture;
        bu.uDir.value.set(0, (1.5 + i) / this.rtA.height);
        r.setRenderTarget(this.rtA);
        this.blurQ.render(r);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 4);
    const u = this.u;
    u.tColor.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.tBloom.value = this.rtA.texture;
    u.uBloom.value = this.bloomOn ? 0.85 : 0;
    u.uFlash.value = this.flash;
    r.setRenderTarget(null);
    this.finalQ.render(r);
  }
}
