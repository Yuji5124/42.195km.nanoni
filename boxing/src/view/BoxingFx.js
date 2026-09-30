import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { DigitalShader } from '../../../src/fx/DigitalShader.js';
import { damp } from '../../../src/core/math.js';

// 画面の見た目（ポストエフェクト）。42.195km の DigitalShader（色ずれ・画素化・減色・監視カメラ・魚眼・縦動画）を
// 1 パスのまま使い、ゲームシステムごとの「映像の種類」を LOOKS で切り替える（数値はなめらかに移る）。
// ブルームは軽く（半分の解像度）。重い時は PerformanceGovernor が切る。

export const LOOKS = {
  clean: { aberr: 0.0012, scan: 0, pixel: 0, noise: 0.016, vignette: 0.42, posterize: 0, mono: 0, tint: 0, fisheye: 0, tall: 0, bloom: 0.5, hue: 0, invert: 0 },
  broadcast: { aberr: 0.002, scan: 0.12, pixel: 0, noise: 0.04, vignette: 0.55, posterize: 0, mono: 0, tint: 0, fisheye: 0, tall: 0, bloom: 0.45, hue: 0, invert: 0 },
  film: { aberr: 0.001, scan: 0, pixel: 0, noise: 0.07, vignette: 0.75, posterize: 0, mono: 0.25, tint: 0, fisheye: 0, tall: 0, bloom: 0.7, hue: 0, invert: 0 },
  bit8: { aberr: 0, scan: 0.1, pixel: 6, noise: 0, vignette: 0.2, posterize: 5, mono: 0, tint: 0, fisheye: 0, tall: 0, bloom: 0.2, hue: 0, invert: 0 },
  cctv: { aberr: 0.002, scan: 0.35, pixel: 0, noise: 0.12, vignette: 0.85, posterize: 0, mono: 1, tint: 1, fisheye: 0.45, tall: 0, bloom: 0.3, hue: 0, invert: 0 },
  phone: { aberr: 0.0016, scan: 0, pixel: 0, noise: 0.05, vignette: 0.3, posterize: 0, mono: 0, tint: 0, fisheye: 0, tall: 1, bloom: 0.55, hue: 0, invert: 0 },
  tele: { aberr: 0.003, scan: 0, pixel: 0, noise: 0.05, vignette: 0.9, posterize: 0, mono: 0, tint: 0, fisheye: 0, tall: 0, bloom: 0.6, hue: 0, invert: 0 },
  neon: { aberr: 0.003, scan: 0, pixel: 0, noise: 0.02, vignette: 0.5, posterize: 0, mono: 0, tint: 0, fisheye: 0, tall: 0, bloom: 0.95, hue: 0, invert: 0 },
  ps1: { aberr: 0.001, scan: 0.05, pixel: 3, noise: 0.02, vignette: 0.3, posterize: 18, mono: 0, tint: 0, fisheye: 0, tall: 0, bloom: 0.3, hue: 0, invert: 0 },
};

const _size = new THREE.Vector2();

export class BoxingFx {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.4, 1.35);
    this.composer.addPass(this.bloom);
    this.digital = new ShaderPass(DigitalShader);
    this.composer.addPass(this.digital);
    this.composer.addPass(new OutputPass());
    this.cur = { ...LOOKS.clean };
    this.target = { ...LOOKS.clean };
    this.time = 0;
    this.glitch = 0;
    this.flashAmt = 0;
    this.extra = null; // ゲームシステムを重ねる時（FINAL）の 2 つ目の見た目
    this.enabled = true;
  }

  setLook(name, extra = null) {
    this.target = { ...(LOOKS[name] ?? LOOKS.clean) };
    if (extra && LOOKS[extra]) {
      // 重ね: 強い方を採る（縦動画・画素化などを同時に）
      const e = LOOKS[extra];
      for (const k of Object.keys(this.target)) this.target[k] = Math.max(this.target[k], e[k]);
      if (this.target.posterize && e.posterize) this.target.posterize = Math.min(LOOKS[name].posterize || 99, e.posterize);
    }
  }

  glitchBurst(a = 1) {
    this.glitch = Math.max(this.glitch, a);
  }

  flash(a = 0.4) {
    this.flashAmt = Math.max(this.flashAmt, a);
  }

  setCamera(camera) {
    this.camera = camera;
    this.renderPass.camera = camera;
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.setSize(w / 2, h / 2);
  }

  update(dt, { hype = 0 } = {}) {
    this.time += dt;
    for (const k of Object.keys(this.cur)) this.cur[k] = k === 'pixel' || k === 'posterize' ? this.target[k] : damp(this.cur[k], this.target[k], 6, dt);
    this.glitch = Math.max(0, this.glitch - dt * 2);
    this.flashAmt = Math.max(0, this.flashAmt - dt * 3);
    const u = this.digital.uniforms;
    const c = this.cur;
    this.renderer.getDrawingBufferSize(_size);
    u.uRes.value = [_size.x, _size.y];
    u.uTime.value = this.time;
    u.uAberr.value = c.aberr + hype * 0.0015;
    u.uScan.value = c.scan;
    u.uPixel.value = c.pixel > 1.5 ? Math.round(c.pixel * this.renderer.getPixelRatio()) : 0;
    u.uNoise.value = c.noise;
    u.uVignette.value = c.vignette;
    u.uPosterize.value = c.posterize > 1 ? c.posterize : 0;
    u.uGlitch.value = this.glitch;
    u.uFlash.value = this.flashAmt;
    u.uMono.value = c.mono;
    u.uTint.value = c.tint;
    u.uFisheye.value = c.fisheye;
    u.uTall.value = c.tall;
    u.uHue.value = c.hue;
    u.uInvert.value = c.invert;
    this.bloom.strength = (c.bloom + hype * 0.3) * 0.7;
  }

  render() {
    if (this.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
