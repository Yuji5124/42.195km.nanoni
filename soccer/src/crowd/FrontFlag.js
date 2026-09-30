import * as THREE from 'three';
import { makeCanvas, toTexture, FONT_JP } from '../../../src/world/textures.js';
import { damp } from '../../../src/core/math.js';

// 目の前の大きな旗（ゴール・決定機の「肝心なところ」で、視線とボールの間に入る）。
// 旗は布のように揺れる（頂点シェーダー）。ふだんは下ろしていて見えない。
// block(dir): カメラ → ボールの線上、少し手前に旗を振り込む（嫌がらせではなく、ゴール裏の日常として）

const VERT = /* glsl */ `
uniform float uTime;
uniform float uWave;
varying vec2 vUv;
varying float vShade;
void main() {
  vUv = uv;
  vec3 p = position;
  float k = uv.x;
  float w = sin(p.x * 2.4 - uTime * 7.0) * 0.18 + sin(p.x * 5.1 + p.y * 2.0 - uTime * 11.0) * 0.06;
  p.z += w * k * uWave;
  p.y -= k * k * 0.12 * (1.0 - uWave);
  vShade = 0.8 + 0.4 * (w * k);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vShade;
void main() {
  vec4 c = texture2D(uMap, vUv);
  gl_FragColor = vec4(c.rgb * vShade, 1.0);
  #include <colorspace_fragment>
}
`;

function flagTexture() {
  const [c, g] = makeCanvas(512, 320);
  g.fillStyle = '#f6f4ef';
  g.fillRect(0, 0, 512, 320);
  g.fillStyle = '#d0102c';
  g.beginPath();
  g.arc(256, 150, 88, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0b1a4a';
  g.font = `44px ${FONT_JP}`;
  g.textAlign = 'center';
  g.fillText('がんばれ日本', 256, 292);
  return toTexture(c);
}

export class FrontFlag {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(2.3, 1.45, 20, 8);
    geo.translate(1.15, 0, 0); // 竿側（左端）が原点
    this.uniforms = { uTime: { value: 0 }, uWave: { value: 1 }, uMap: { value: flagTexture() } };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.DoubleSide });
    this.group = new THREE.Group();
    this.cloth = new THREE.Mesh(geo, mat);
    this.cloth.position.y = 0.95;
    this.group.add(this.cloth);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
    pole.position.y = 0.4;
    this.group.add(pole);
    this.group.visible = false;
    this.group.traverse((o) => o.layers.set(1));
    scene.add(this.group);
    this.time = 0;
    this.active = 0;
    this.anchor = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.cur = new THREE.Vector3();
    this.camera = null;
  }

  // 旗を振る（seconds 秒）。aim: 旗が隠す方向の点（ボール）
  wave(seconds, aim = null) {
    this.active = seconds;
    this.aim = aim;
    this.group.visible = true;
  }

  // anchor: 旗を持つ人の足元（通路）/ camera: 主人公の目
  update(dt, camera, anchor, aimPoint) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (this.active <= 0) {
      this.group.visible = false;
      return;
    }
    this.active -= dt;
    // 視線（カメラ → ボール）の 2.4m 先。竿は視線の左、布（幅 2.3m）が視線をまたぐ。少し左右に揺れる
    const cam = camera.position;
    const dir = new THREE.Vector3().subVectors(aimPoint ?? anchor, cam).normalize();
    const left = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
    const sway = Math.sin(this.time * 2.6);
    this.goal.copy(cam).addScaledVector(dir, 2.4).addScaledVector(left, 1.15 + sway * 0.3);
    this.goal.y -= 0.95;
    if (!this.started) this.cur.copy(anchor).add(new THREE.Vector3(0, 1.5, 0));
    this.started = true;
    this.cur.x = damp(this.cur.x, this.goal.x, 7, dt);
    this.cur.y = damp(this.cur.y, this.goal.y, 7, dt);
    this.cur.z = damp(this.cur.z, this.goal.z, 7, dt);
    this.group.position.copy(this.cur);
    // 布の面をカメラへ向ける（+X が画面の右 = 視線をまたぐ）
    this.group.lookAt(cam.x, this.cur.y, cam.z);
    this.group.rotateY(sway * 0.15);
    this.group.rotateZ(Math.sin(this.time * 5.2) * 0.1);
    if (this.active <= 0) this.started = false;
  }
}
