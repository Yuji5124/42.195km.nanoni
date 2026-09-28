import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { DigitalShader, FX_PRESETS } from './DigitalShader.js';
import { Particles } from './Particles.js';
import { Trail } from './Trail.js';
import { CONFIG } from '../config.js';
import { damp } from '../core/math.js';

// EffectManager: ポストエフェクト + パーティクル + 残像。
// 常時エフェクト過多にしない: 基本は控えめ、イベント・ダッシュ・声援の段階で一時的に派手にする。
// フレームレートが落ちたら自動で品質を下げる（派手さより安定したプレイ）。

const TIER_COLORS = [0x39e6ff, 0x39e6ff, 0x7af0ff, 0xc77dff, 0xff3d7f, 0xffd23f];
const CONFETTI = [
  [1, 0.24, 0.5],
  [0.22, 0.9, 1],
  [1, 0.82, 0.25],
  [0.24, 1, 0.55],
  [1, 1, 1],
  [0.78, 0.49, 1],
];

const _v = new THREE.Vector3();
const _size = new THREE.Vector2();

export class EffectManager {
  constructor(renderer, scene, camera, path) {
    this.renderer = renderer;
    this.path = path;
    this.scene = scene;
    this.camera = camera;
    this.quality = 2;
    this.pixelRatio = Math.min(window.devicePixelRatio, CONFIG.quality.maxPixelRatio);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.55, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.digital = new ShaderPass(DigitalShader);
    this.composer.addPass(this.digital);
    this.composer.addPass(new OutputPass());

    this.current = { ...FX_PRESETS.none };
    this.target = { ...FX_PRESETS.none };
    this.glitch = 0;
    this.flashAmt = 0;
    this.time = 0;

    this.sparks = new Particles(scene, { capacity: 900, additive: true });
    this.confetti = new Particles(scene, { capacity: 1400, additive: false, confetti: true });
    this.trail = new Trail(scene);

    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.lowTime = 0;
  }

  setPreset(name) {
    const next = { ...(FX_PRESETS[name] ?? FX_PRESETS.none) };
    if (next.mirror !== this.target.mirror) this.glitchBurst(1);
    this.target = next;
  }

  glitchBurst(amount = 1) {
    this.glitch = Math.max(this.glitch, amount);
  }

  flash(amount = 0.4) {
    this.flashAmt = Math.max(this.flashAmt, amount);
  }

  resize(w, h) {
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.setSize(w / 2, h / 2);
  }

  setQuality(level) {
    if (level === this.quality) return;
    this.quality = level;
    this.pixelRatio = level >= 2 ? Math.min(window.devicePixelRatio, CONFIG.quality.maxPixelRatio) : level === 1 ? 1 : 0.75;
    this.bloom.enabled = level >= 1;
    this.resize(window.innerWidth, window.innerHeight);
    console.info(`[fx] quality -> ${level}`);
  }

  // ---- エミッター
  dashSparks(p) {
    this.path.toWorld(p.s - 0.3, p.x, 0.15, _v);
    const f = this.path.sample(p.s);
    this.sparks.emit({ x: _v.x, y: _v.y, z: _v.z, vx: f.sin * 4, vz: f.cos * 4, vy: 1.5, spread: 1.2, color: [0.3, 0.95, 1.4], size: 0.18, life: 0.35, gravity: 6, count: 2 });
  }

  dust(p) {
    this.path.toWorld(p.s, p.x, 0.1, _v);
    this.sparks.emit({ x: _v.x, y: _v.y, z: _v.z, vy: 1, spread: 1.8, color: [0.5, 0.5, 0.6], size: 0.35, life: 0.45, gravity: 1, count: 12 });
  }

  burst(x, y, z, color = [1.4, 1.2, 0.4], count = 24) {
    this.sparks.emit({ x, y, z, spread: 4, color, size: 0.25, life: 0.6, gravity: 2, count });
  }

  confettiBurst(center, count = 200, spread = 9) {
    this.confetti.emit({
      x: center.x,
      y: center.y + 7,
      z: center.z,
      vy: 2,
      spread,
      color: CONFETTI,
      size: 0.32,
      life: 4,
      gravity: 2.2,
      drag: 1.2,
      count,
    });
  }

  // ctx: { player, tier, excitement, playing }
  update(dt, ctx) {
    this.time += dt;
    const p = ctx.player;

    for (const k of Object.keys(this.current)) {
      this.current[k] = k === 'mirror' ? this.target[k] : damp(this.current[k], this.target[k], k === 'pixel' ? 6 : 3, dt);
    }
    this.glitch = Math.max(0, this.glitch - dt * 1.8);
    this.flashAmt = Math.max(0, this.flashAmt - dt * 2.5);

    const u = this.digital.uniforms;
    this.renderer.getDrawingBufferSize(_size);
    u.uRes.value = [_size.x, _size.y];
    u.uTime.value = this.time;
    u.uAberr.value = this.current.aberr;
    u.uScan.value = this.current.scan;
    u.uPixel.value = this.current.pixel < 1.5 ? 0 : Math.round(this.current.pixel * (this.pixelRatio / 1.0));
    u.uNoise.value = this.current.noise;
    u.uVignette.value = this.current.vignette;
    u.uPosterize.value = this.current.posterize < 2 ? 0 : this.current.posterize;
    u.uGlitch.value = this.glitch;
    u.uFlash.value = this.flashAmt;
    u.uMirror.value = this.current.mirror;
    const speedTarget = p.dashing || p.boostTimer > 0 ? 1 : 0;
    this.speedFx = damp(this.speedFx ?? 0, speedTarget, 5, dt);
    u.uSpeed.value = Math.max(this.speedFx, this.current.speed) * (this.current.pixel > 1.5 ? 0 : 1);
    this.bloom.strength = this.current.bloom + (ctx.excitement ?? 0) * 0.25;

    // パーティクルの見かけサイズ（望遠でも正しく）
    const pointScale = (_size.y * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    this.sparks.setPointScale(pointScale);
    this.confetti.setPointScale(pointScale);
    this.pointScale = pointScale;

    if (ctx.playing && (p.dashing || p.boostTimer > 0) && p.grounded) this.dashSparks(p);
    this.sparks.update(dt, this.time);
    this.confetti.update(dt, this.time);

    const tier = ctx.tier ?? 0;
    this.path.toWorld(p.s - 0.25, p.x, p.y + 1.05, _v);
    const intensity = ctx.playing ? 0.18 + tier * 0.05 + this.speedFx * 0.55 : 0;
    this.trail.update(dt, _v, this.camera, 0.16 + this.speedFx * 0.12, intensity, TIER_COLORS[tier]);

    this.trackFps(dt);
  }

  trackFps(dt) {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 1) {
      const fps = this.fpsFrames / this.fpsAcc;
      this.fps = fps;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      if (fps < 42) this.lowTime++;
      else this.lowTime = Math.max(0, this.lowTime - 1);
      if (this.lowTime >= 3 && this.quality > 0) {
        this.setQuality(this.quality - 1);
        this.lowTime = 0;
      }
    }
  }

  render() {
    this.composer.render();
  }

  reset() {
    this.sparks.clear();
    this.confetti.clear();
    this.trail.reset();
    this.glitch = 0;
    this.flashAmt = 0;
    this.setPreset('none');
  }
}
