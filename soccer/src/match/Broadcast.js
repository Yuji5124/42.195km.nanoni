import * as THREE from 'three';
import { JUMBO } from '../stadium/StadiumBuilder.js';
import { PITCH } from './MatchSim.js';
import { FONT_JP } from '../../../src/world/textures.js';
import { SPONSORS, FONT_NUM } from '../stadium/stadiumTextures.js';
import { clamp, damp } from '../../../src/core/math.js';

// 巨大ビジョン: 中継カメラ（BroadcastCamera）の映像を RenderTarget に描いて、北と南の画面に貼る。
// その上に Canvas の重ね（スコア・時計・実況字幕・GOAL・REPLAY・VAR・広告・CROWD CAM）。
//
// 「見やすくしすぎない」: ゴールの瞬間は巨大な GOOOAL!! が映像を隠す。リプレイは始まった直後に広告へ切り替わる。
// 画面の見た目: LED の格子 + 少し明るめ（トーンマップしない）。

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FRAG = /* glsl */ `
uniform sampler2D uVideo;
uniform sampler2D uOver;
uniform float uBright;
uniform float uVideoOn;
varying vec2 vUv;
void main() {
  vec3 v = texture2D(uVideo, vUv).rgb * uVideoOn;
  vec4 o = texture2D(uOver, vUv);
  vec3 c = mix(v, o.rgb, o.a);
  vec2 g = fract(vUv * vec2(320.0, 164.0));
  float grid = 0.82 + 0.18 * step(0.18, g.x) * step(0.18, g.y);
  gl_FragColor = vec4(c * uBright * grid, 1.0);
  #include <colorspace_fragment>
}
`;

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();

export class Broadcast {
  constructor(renderer, scene, stadium, director, { width = 512, height = 256, crowdField = null } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.director = director;
    this.sim = director.sim;
    this.crowdField = crowdField;
    this.camera = new THREE.PerspectiveCamera(22, JUMBO.w / JUMBO.h, 1, 1600);
    this.camera.position.set(0, 24, -95);
    this.look = new THREE.Vector3();
    // 8bit + sRGB（半精度の描画先は iOS で使えない環境があるので避ける）
    this.rt = new THREE.WebGLRenderTarget(width, height);
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.rt.texture.generateMipmaps = false;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 328;
    this.g = this.canvas.getContext('2d');
    this.overTex = new THREE.CanvasTexture(this.canvas);
    this.overTex.colorSpace = THREE.SRGBColorSpace;
    this.uniforms = {
      uVideo: { value: this.rt.texture },
      uOver: { value: this.overTex },
      uBright: { value: 1.25 },
      uVideoOn: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, toneMapped: false });
    this.screens = [];
    for (const j of stadium.jumbos) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(JUMBO.w, JUMBO.h), mat);
      m.position.z = 0.02;
      j.group.add(m);
      this.screens.push(m);
    }
    this.mode = 'live';
    this.modeT = 0;
    this.caption = '';
    this.captionT = 0;
    this.interval = 1;
    this.frameCount = 0;
    this.time = 0;
    this.big = null; // { text, sub, color, t }
    this.adIndex = 0;
    this.renderMs = 0;
    this.dirty = true;
    this.crowdCamTarget = null;
  }

  setQuality(level) {
    // 0: 毎フレーム / 1: 2 フレームに 1 回 / 2: 3 回に 1 回
    this.interval = [1, 2, 3, 4][level] ?? 2;
    const sizes = [
      [640, 328],
      [512, 256],
      [384, 196],
      [320, 164],
    ];
    const [w, h] = sizes[level] ?? sizes[1];
    this.rt.setSize(w, h);
  }

  // ---- 表示の切り替え
  setMode(mode, seconds = 0) {
    this.mode = mode;
    this.modeT = 0;
    this.modeDur = seconds;
    this.dirty = true;
  }

  say(text, seconds = 4) {
    this.caption = text;
    this.captionT = seconds;
    this.dirty = true;
  }

  bigText(text, sub = '', seconds = 5, color = '#ffd23f') {
    this.big = { text, sub, color, t: seconds, max: seconds };
    this.dirty = true;
  }

  // ゴール: GOOOAL!!（映像は字幕の裏）→ 選手のアップ → リプレイ → すぐ広告
  onGoal(ev) {
    const home = ev.team === 'home';
    this.goalTeam = ev.team;
    this.scorerName = ev.scorer;
    this.setMode('goal', 7);
    this.bigText(home ? 'GOOOOOAL!!' : 'GOAL', `${ev.scorer}  ${ev.goal.minute}'`, 7, home ? '#ffd23f' : '#ffffff');
    this.say(home ? '決めたーーっ！！ 日本、ゴール！！' : 'ブラジル、決めました……', 6);
    this.pending = [
      { at: 7.2, fn: () => this.setMode('replay', 1.0) },
      { at: 8.2, fn: () => this.setMode('ad', 4.5) },
      { at: 12.7, fn: () => this.setMode('live') },
    ];
    this.pendingT = 0;
  }

  crowdCam(target, seconds = 6) {
    this.crowdCamTarget = target.clone();
    this.setMode('crowdcam', seconds);
    this.pending = [{ at: seconds, fn: () => this.setMode('live') }];
    this.pendingT = 0;
  }

  update(dt) {
    this.time += dt;
    this.modeT += dt;
    if (this.pending) {
      this.pendingT += dt;
      for (const p of this.pending) {
        if (!p.done && this.pendingT >= p.at) {
          p.done = true;
          p.fn();
        }
      }
      if (this.pending.every((p) => p.done)) this.pending = null;
    }
    if (this.modeDur && this.modeT > this.modeDur && (this.mode === 'ad' || this.mode === 'replay')) {
      if (!this.pending) this.setMode('live');
    }
    if (this.captionT > 0) {
      this.captionT -= dt;
      if (this.captionT <= 0) {
        this.caption = '';
        this.dirty = true;
      }
    }
    if (this.big) {
      this.big.t -= dt;
      if (this.big.t <= 0) this.big = null;
      this.dirty = true;
    }
    this.moveCamera(dt);
    // 重ねの描き直し（アニメーションする時は 12Hz）
    this.overAcc = (this.overAcc ?? 0) + dt;
    const animated = this.big || this.mode === 'ad' || this.mode === 'crowdcam' || this.mode === 'replay';
    if (this.dirty || (animated && this.overAcc > 1 / 12) || this.overAcc > 0.5) {
      this.overAcc = 0;
      this.drawOverlay();
      this.dirty = false;
    }
  }

  moveCamera(dt) {
    const cam = this.camera;
    const b = this.sim.ball.pos;
    let px;
    let py;
    let pz;
    let fov;
    if (this.mode === 'goal' || this.mode === 'replay') {
      // 得点者のアップ（リプレイは逆側から）
      const scorer = this.sim.players.find((p) => p.name === this.scorerName) ?? this.sim.players[10];
      const dir = this.sim.dir[scorer.team];
      const rev = this.mode === 'replay' ? -1 : 1;
      px = scorer.pos.x - dir * 10 * rev;
      py = 3.2;
      pz = scorer.pos.y - 9 * rev;
      _look.set(scorer.pos.x, 1.3, scorer.pos.y);
      fov = 28;
    } else if (this.mode === 'crowdcam' && this.crowdCamTarget) {
      px = 0;
      py = 12;
      pz = 0;
      _look.copy(this.crowdCamTarget);
      fov = 9;
    } else {
      // メインカメラ: 西スタンドの上からボールを追う
      px = clamp(b.x * 0.82, -40, 40);
      py = 26;
      pz = -98;
      _look.set(clamp(b.x, -PITCH.hx, PITCH.hx), 0, clamp(b.z * 0.6, -20, 20));
      fov = 20 + Math.abs(b.z) * 0.08;
    }
    const k = this.mode === 'live' ? 3 : 20;
    cam.position.x = damp(cam.position.x, px, k, dt);
    cam.position.y = damp(cam.position.y, py, k, dt);
    cam.position.z = damp(cam.position.z, pz, k, dt);
    this.look.x = damp(this.look.x, _look.x, k * 1.4, dt);
    this.look.y = damp(this.look.y, _look.y, k * 1.4, dt);
    this.look.z = damp(this.look.z, _look.z, k * 1.4, dt);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = damp(cam.fov, fov, 4, dt);
      cam.updateProjectionMatrix();
    }
  }

  // 主画面の前に呼ぶ（間引き）
  render() {
    this.frameCount++;
    if (this.mode === 'ad') {
      this.uniforms.uVideoOn.value = 0;
      return;
    }
    this.uniforms.uVideoOn.value = 1;
    if (this.frameCount % this.interval) return;
    const t0 = performance.now();
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const cf = this.crowdField;
    let pxPrev;
    if (cf) {
      pxPrev = cf.uniforms.uPxScale.value;
      cf.uniforms.uPxScale.value = this.rt.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    }
    for (const s of this.screens) s.visible = false;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    for (const s of this.screens) s.visible = true;
    if (cf) cf.uniforms.uPxScale.value = pxPrev;
    this.renderMs = performance.now() - t0;
  }

  // ---- 重ね（Canvas）
  drawOverlay() {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const d = this.director;
    g.clearRect(0, 0, W, H);
    const t = this.time;

    if (this.mode === 'ad') {
      const [text, bg, fg] = SPONSORS[this.adIndex % SPONSORS.length];
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = fg;
      const jp = /[ぁ-んァ-ン一-龥]/.test(text);
      g.font = `${jp ? 72 : 64}px ${jp ? FONT_JP : FONT_NUM}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, W / 2, H / 2 - 10 + Math.sin(t * 3) * 4, W - 40);
      g.font = `700 22px ${FONT_NUM}`;
      g.fillText('OFFICIAL PARTNER', W / 2, H - 40);
      if (this.modeT > 4) this.adIndex++;
      this.overTex.needsUpdate = true;
      return;
    }

    // スコアの帯（左上）
    g.fillStyle = 'rgba(6,9,28,0.86)';
    g.fillRect(18, 16, 270, 44);
    g.fillStyle = '#1d3fb5';
    g.fillRect(18, 16, 8, 44);
    g.fillStyle = '#f2d02a';
    g.fillRect(280, 16, 8, 44);
    g.fillStyle = '#fff';
    g.font = `700 26px ${FONT_NUM}`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(`JPN ${d.score.home} - ${d.score.away} BRA`, 36, 39);
    g.fillStyle = '#ffd23f';
    g.fillText(d.clockText().slice(0, 5), 200, 39);
    // LIVE / REPLAY / CROWD CAM
    g.textAlign = 'right';
    g.font = `700 22px ${FONT_NUM}`;
    if (this.mode === 'replay') {
      g.fillStyle = '#ff3d7f';
      g.fillRect(W - 150, 16, 132, 34);
      g.fillStyle = '#fff';
      g.fillText('REPLAY', W - 30, 34);
    } else if (this.mode === 'crowdcam') {
      g.fillStyle = '#39e6ff';
      g.fillRect(W - 210, 16, 192, 34);
      g.fillStyle = '#05060f';
      g.fillText('CROWD CAM ♪', W - 30, 34);
      // 盛り上げの文字が画面を半分隠す
      g.textAlign = 'center';
      g.font = `64px ${FONT_JP}`;
      g.fillStyle = `hsla(${(t * 90) % 360},90%,62%,0.92)`;
      g.fillText('もっと声を！', W / 2, H - 70 + Math.sin(t * 5) * 6);
    } else {
      g.fillStyle = '#e0142c';
      g.fillRect(W - 110, 16, 92, 34);
      g.fillStyle = '#fff';
      g.fillText('● LIVE', W - 26, 34);
    }

    // 巨大な文字（GOAL / VAR / HALF TIME …）: 映像を隠す
    if (this.big) {
      const b = this.big;
      const age = b.max - b.t;
      const pulse = 1 + Math.sin(age * 12) * 0.04;
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, 70, W, H - 110);
      g.translate(W / 2, H / 2 + 6);
      g.scale(pulse, pulse);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `italic 700 ${b.text.length > 7 ? 112 : 128}px ${FONT_NUM}`;
      g.lineWidth = 12;
      g.strokeStyle = '#0b1a4a';
      g.strokeText(b.text, 0, 0, W - 20);
      g.fillStyle = Math.floor(age * 6) % 2 ? b.color : '#ffffff';
      g.fillText(b.text, 0, 0, W - 20);
      if (b.sub) {
        g.font = `700 30px ${FONT_NUM}`;
        g.fillStyle = '#ffffff';
        g.fillText(b.sub, 0, 82);
      }
      g.restore();
    }

    // 実況字幕（下の帯）
    if (this.caption) {
      g.fillStyle = 'rgba(6,9,28,0.9)';
      g.fillRect(0, H - 54, W, 54);
      g.fillStyle = '#39e6ff';
      g.fillRect(0, H - 54, W, 4);
      g.fillStyle = '#fff';
      g.font = `30px ${FONT_JP}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(this.caption, W / 2, H - 26, W - 30);
    }
    this.overTex.needsUpdate = true;
  }
}
