import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { damp } from '../core/mathx.js';

// ポストエフェクト: RenderPass → Bloom → Output（sRGB）→ NanoniPass（表示の壊し方をまとめた 1 パス）
// NanoniPass の各項目は Presentation（P.post）の数値そのまま。Modifier は数値を書くだけ。
// 疑似 Low FPS は「描かないフレーム」を作るだけ（ゲームの更新は 60fps のまま）。前の絵がそのまま残る。
// 小窓（PIP）: 違うカメラを映している間も、自分の走りを右下に出す（操作できなくならないように）。

const NanoniShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uFisheye: { value: 0 },
    uPixel: { value: 0 },
    uPosterize: { value: 0 },
    uPalette: { value: 0 },
    uMono: { value: 0 },
    uSepia: { value: 0 },
    uCrt: { value: 0 },
    uScan: { value: 0 },
    uVignette: { value: 0.35 },
    uChroma: { value: 0.001 },
    uGlitch: { value: 0 },
    uFlip: { value: new THREE.Vector2(0, 0) },
    uTall: { value: 0 },
    uWide: { value: 0 },
    uNoise: { value: 0.015 },
    uDither: { value: 0 },
    uHue: { value: 0 },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uExposure: { value: 1 },
    uInvert: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uCctv: { value: 0 },
    uFlash: { value: 0 },
    uFade: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes, uFlip;
    uniform vec3 uTint;
    uniform float uTime, uFisheye, uPixel, uPosterize, uPalette, uMono, uSepia, uCrt, uScan, uVignette, uChroma, uGlitch;
    uniform float uTall, uWide, uNoise, uDither, uHue, uSat, uContrast, uExposure, uInvert, uCctv, uFlash, uFade;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 hueShift(vec3 c, float a) {
      const vec3 k = vec3(0.57735);
      float ca = cos(a);
      return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
    }
    float bayer(vec2 p) {
      ivec2 i = ivec2(mod(p, 4.0));
      int idx = i.x + i.y * 4;
      float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
      return m[idx] / 16.0 - 0.5;
    }
    vec3 palette16(vec3 c) {
      // CGA / PC-98 っぽい 16 色へ
      vec3 pal[16] = vec3[16](
        vec3(0.0), vec3(0.0, 0.0, 0.67), vec3(0.0, 0.67, 0.0), vec3(0.0, 0.67, 0.67), vec3(0.67, 0.0, 0.0), vec3(0.67, 0.0, 0.67), vec3(0.67, 0.33, 0.0), vec3(0.67),
        vec3(0.33), vec3(0.33, 0.33, 1.0), vec3(0.33, 1.0, 0.33), vec3(0.33, 1.0, 1.0), vec3(1.0, 0.33, 0.33), vec3(1.0, 0.33, 1.0), vec3(1.0, 1.0, 0.33), vec3(1.0));
      vec3 best = pal[0]; float bd = 9.0;
      for (int i = 0; i < 16; i++) { float d = distance(c, pal[i]); if (d < bd) { bd = d; best = pal[i]; } }
      return best;
    }
    vec3 paletteGB(vec3 c) {
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      if (l < 0.25) return vec3(0.06, 0.22, 0.06);
      if (l < 0.5) return vec3(0.19, 0.38, 0.19);
      if (l < 0.75) return vec3(0.55, 0.67, 0.06);
      return vec3(0.61, 0.74, 0.06);
    }
    void main() {
      vec2 uv = vUv;
      // 黒帯（縦画面 / 横長すぎ）
      float aspect = uRes.x / uRes.y;
      if (uTall > 0.0) {
        float w = mix(1.0, (9.0 / 16.0) / aspect, uTall);
        if (abs(uv.x - 0.5) > w * 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        uv.x = 0.5 + (uv.x - 0.5);
      }
      if (uWide > 0.0) {
        float h = mix(1.0, aspect / 4.2, uWide);
        if (abs(uv.y - 0.5) > h * 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      }
      if (uFlip.x > 0.5) uv.x = 1.0 - uv.x;
      if (uFlip.y > 0.5) uv.y = 1.0 - uv.y;
      // CRT の丸み / 魚眼
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      if (uFisheye > 0.0) c *= 1.0 + uFisheye * r2 * 2.4 - uFisheye * 0.35;
      if (uCrt > 0.0) c *= 1.0 + uCrt * r2 * 0.35;
      uv = c + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      // グリッチ（横ずれの帯）
      if (uGlitch > 0.0) {
        float band = floor(uv.y * 24.0 + floor(uTime * 12.0) * 3.7);
        float g = step(1.0 - uGlitch * 0.35, hash(vec2(band, floor(uTime * 20.0))));
        uv.x += g * (hash(vec2(band, 1.7)) - 0.5) * 0.12 * uGlitch;
      }
      // 低解像度
      vec2 px = uRes;
      if (uPixel > 0.0) {
        px = vec2(uPixel, uPixel / aspect);
        uv = (floor(uv * px) + 0.5) / px;
      }
      float ca = uChroma + uGlitch * 0.006;
      vec3 col;
      if (ca > 0.0) {
        vec2 dir = (uv - 0.5) * ca * 2.0;
        col = vec3(texture2D(tDiffuse, uv + dir).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - dir).b);
      } else col = texture2D(tDiffuse, uv).rgb;
      // 色調
      col *= uExposure;
      col = (col - 0.5) * uContrast + 0.5;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      if (uHue != 0.0) col = hueShift(col, uHue);
      col *= uTint;
      if (uMono > 0.0) col = mix(col, vec3(l), uMono);
      if (uSepia > 0.0) col = mix(col, vec3(l * 1.08, l * 0.9, l * 0.66), uSepia);
      if (uCctv > 0.0) col = mix(col, vec3(0.2, 1.0, 0.35) * (l * 1.2 + 0.05), uCctv);
      // ディザ + 減色（PS1 / 8bit）
      vec2 fragPx = uPixel > 0.0 ? floor(vUv * px) : gl_FragCoord.xy;
      if (uDither > 0.0) col += bayer(fragPx) * uDither * 0.12;
      if (uPosterize > 1.0) col = floor(col * uPosterize + 0.5) / uPosterize;
      if (uPalette > 0.5 && uPalette < 1.5) col = palette16(clamp(col, 0.0, 1.0));
      else if (uPalette > 1.5) col = paletteGB(col);
      if (uInvert > 0.0) col = mix(col, 1.0 - col, uInvert);
      // 走査線・シャドウマスク・ノイズ・周辺減光
      if (uScan > 0.0) col *= 1.0 - uScan * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159));
      if (uCrt > 0.0) {
        float m = mod(gl_FragCoord.x, 3.0);
        vec3 mask = vec3(m < 1.0 ? 1.0 : 0.75, m >= 1.0 && m < 2.0 ? 1.0 : 0.75, m >= 2.0 ? 1.0 : 0.75);
        col *= mix(vec3(1.0), mask, uCrt * 0.6);
      }
      col += (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * uNoise;
      float v = smoothstep(0.85, 0.2, length(vUv - 0.5) * (1.0 + uVignette));
      col *= mix(1.0, v, clamp(uVignette, 0.0, 1.0));
      col += uFlash;
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// 1 つのカメラ、または 4 分割（「画面が 4 つに分割され 4 種類のカメラを同時表示」）で描く
class MultiRenderPass extends RenderPass {
  constructor(scene, camera) {
    super(scene, camera);
    this.cameras = null;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    if (!this.cameras) return super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    const target = this.renderToScreen ? null : readBuffer;
    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    renderer.clear();
    const w = target ? target.width : renderer.domElement.width;
    const h = target ? target.height : renderer.domElement.height;
    const q = [
      [0, h / 2],
      [w / 2, h / 2],
      [0, 0],
      [w / 2, 0],
    ];
    renderer.setScissorTest(true);
    this.cameras.forEach((cam, i) => {
      const [x, y] = q[i];
      if (target) {
        // レンダーターゲットのビューポートは setRenderTarget の時に読まれる → 毎回設定し直す
        target.viewport.set(x, y, w / 2, h / 2);
        target.scissor.set(x, y, w / 2, h / 2);
        target.scissorTest = true;
        renderer.setRenderTarget(target);
      } else {
        renderer.setViewport(x, y, w / 2, h / 2);
        renderer.setScissor(x, y, w / 2, h / 2);
      }
      renderer.render(this.scene, cam);
    });
    if (target) {
      target.viewport.set(0, 0, w, h);
      target.scissor.set(0, 0, w, h);
      target.scissorTest = false;
      renderer.setRenderTarget(target);
    }
    renderer.setScissorTest(false);
    renderer.autoClear = true;
  }
}

export class PostProcessing {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new MultiRenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.88);
    this.bloom.enabled = quality.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.pass = new ShaderPass(NanoniShader);
    this.composer.addPass(this.pass);
    this.cur = {};
    this.frame = 0;
    this.time = 0;
    this.flash = 0;
    this.fade = 0;
    this.baseBloom = 0.5;
  }

  resize(w, h, pixelRatio) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.setSize(Math.floor(w / 2), Math.floor(h / 2));
    this.pass.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
  }

  flashOnce(v = 0.6) {
    this.flash = Math.max(this.flash, v);
  }

  // P.post をなめらかに反映（反転・パレット・フレーム間引きは即時）
  update(dt, post) {
    this.time += dt;
    const u = this.pass.uniforms;
    const smooth = (k, target, rate = 6) => {
      const v = this.cur[k] ?? target;
      this.cur[k] = damp(v, target, rate, dt);
      return this.cur[k];
    };
    u.uTime.value = this.time;
    u.uFisheye.value = smooth('fisheye', post.fisheye);
    u.uPixel.value = post.pixel;
    u.uPosterize.value = post.posterize;
    u.uPalette.value = post.palette;
    u.uMono.value = smooth('mono', post.mono);
    u.uSepia.value = smooth('sepia', post.sepia);
    u.uCrt.value = smooth('crt', post.crt);
    u.uScan.value = smooth('scan', post.scan);
    u.uVignette.value = smooth('vignette', post.vignette);
    u.uChroma.value = smooth('chroma', post.chroma);
    u.uGlitch.value = smooth('glitch', post.glitch, 10);
    u.uFlip.value.set(post.flipX, post.flipY);
    u.uTall.value = smooth('tall', post.tall, 5);
    u.uWide.value = smooth('wide', post.wide, 5);
    u.uNoise.value = smooth('noise', post.noise);
    u.uDither.value = post.dither;
    u.uHue.value = smooth('hue', post.hue, 3);
    u.uSat.value = smooth('sat', post.saturation);
    u.uContrast.value = smooth('contrast', post.contrast);
    u.uExposure.value = smooth('exposure', post.exposure);
    u.uInvert.value = smooth('invert', post.invert, 8);
    u.uTint.value.set(...post.tint);
    u.uCctv.value = smooth('cctv', post.cctv, 8);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    u.uFlash.value = this.flash;
    u.uFade.value = this.fade;
    this.bloom.strength = this.baseBloom * post.bloom;
    this.lowFps = post.lowFps;
    this.holdT = (this.holdT ?? 0) + dt;
  }

  // 疑似 Low FPS: 1/lowFps 秒に 1 回だけ描く（時間で数えるので、端末が遅くても同じ見え方）
  render(cameras4 = null, pip = null) {
    this.frame++;
    if (this.lowFps > 0) {
      if (this.holdT < 1 / this.lowFps) return false;
      this.holdT %= 1 / this.lowFps;
    } else this.holdT = 0;
    this.renderPass.cameras = cameras4;
    this.composer.render();
    if (pip) this.renderPip(pip);
    return true;
  }

  // 右下の小窓（ポストエフェクトなし・枠は HUD の CSS）
  renderPip({ scene, camera, rect }) {
    const r = this.renderer;
    const [x, y, w, h] = rect;
    r.setRenderTarget(null);
    r.setScissorTest(true);
    r.setViewport(x, y, w, h);
    r.setScissor(x, y, w, h);
    r.autoClear = false;
    r.clear();
    r.render(scene, camera);
    r.autoClear = true;
    r.setScissorTest(false);
    const size = r.getSize(this._size ?? (this._size = new THREE.Vector2()));
    r.setViewport(0, 0, size.x, size.y);
  }
}
