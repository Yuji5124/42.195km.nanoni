import * as THREE from 'three';
import { POSE_GLSL } from './CrowdDirector.js';
import { SHIRTS, HAIR, SKIN, SEAT_COLOR, BAGS } from './SeatPlan.js';
import { CORE } from '../stadium/StadiumLayout.js';

// 10 万人を 1 draw call で描く。
//   1 人 = 頂点 4 つのビルボード（Y 軸だけカメラへ向く）。人の形はフラグメントシェーダーで描く（頭・胴・腕・マフラー・旗・スマホ）。
//   姿勢は CrowdDirector の DataTexture + 人ごとの乱数（GPU）。CPU は毎フレーム何もしない。
//   LOD（画面上の大きさで切り替え）:
//     座席が 2.5px 未満 … 2 色のかたまり（ちらつかない。最低 1.4px の幅を保証して抜けを防ぐ）
//     それ以上         … 形を描く。MSAA + alpha-to-coverage で縁を滑らかに（半透明のソートは不要）
//   近くの座席（NearCrowd の 3D 人形が担当）は iMeta.x に 128 を足して消す。
//
// 属性: iPos = (x, y, z, s) / iLook = (服 | 髪<<4, 肌 | 小物<<2, r1, r2) / iMeta = (kind, block, row, 0)

const VERT = /* glsl */ `
precision highp float;
precision highp int;
attribute vec4 iPos;
attribute vec4 iLook;
attribute vec4 iMeta;
uniform vec2 uCore;
uniform float uPxScale;
uniform vec3 uShirts[16];
uniform vec3 uHair[4];
uniform vec3 uSkin[4];
uniform float uFogNear;
uniform float uFogFar;
uniform float uLight;
uniform vec3 uSeatV;
uniform ivec4 uMark;
${POSE_GLSL}
varying vec2 vLocal;
flat varying vec3 vShirt;
flat varying vec3 vHair;
flat varying vec3 vSkin;
flat varying vec3 vScarf;
flat varying vec4 vFig;    // hip, scale, arms, phone
flat varying vec4 vInfo;   // kind, acc, back, px
flat varying vec4 vMisc;   // phase, clap, light, fog
flat varying float vW;
flat varying float vMark;

void main() {
  vMark = (gl_InstanceID == uMark.x || gl_InstanceID == uMark.y || gl_InstanceID == uMark.z || gl_InstanceID == uMark.w) ? 1.0 : 0.0;
  float kind = iMeta.x;
  if (kind > 127.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec3 seat = iPos.xyz;
  float r1 = iLook.z / 255.0;
  float r2 = iLook.w / 255.0;
  float lean;
  float clap;
  vec4 p = crowdPose(iMeta.y, r1, r2, iPos.w, lean, clap);
  float person = (kind < 0.5 || kind > 3.5) ? 1.0 : 0.0;
  float kid = (kind > 3.5 && kind < 4.5) ? 1.0 : 0.0;
  float hood = kind > 4.5 ? 1.0 : 0.0;
  p.x *= 1.0 - hood * 0.75;
  p.y *= 1.0 - hood * 0.85;
  float scale = kid > 0.5 ? 0.66 : (0.93 + 0.14 * r2);
  float jumpH = crowdJump(p, r1, r2);
  float hip = 0.4 + (p.x * 0.52 + jumpH) * scale - lean * 0.05 - hood * 0.16;
  float top = person > 0.5 ? max(hip + (0.8 + p.y * 0.62 + p.w * 0.12) * scale + 0.05, 1.02) : 1.02;
  float bottom = 0.36;
  if (vMark > 0.5) { top = max(top, 1.12); bottom = 0.26; }

  vec2 toCam = cameraPosition.xz - seat.xz;
  float dist = length(toCam);
  toCam /= max(dist, 1e-3);
  vec3 right = vec3(toCam.y, 0.0, -toCam.x);
  vec4 mvSeat = modelViewMatrix * vec4(seat, 1.0);
  float pxPerM = uPxScale / max(0.5, -mvSeat.z);
  float w = max(vMark > 0.5 ? 0.78 : 0.62, 1.4 / pxPerM);
  float ly = mix(bottom, top, position.y);
  vec3 wpos = seat + right * (position.x * w) + vec3(0.0, ly, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wpos, 1.0);
  vLocal = vec2(position.x * w, ly);
  vW = w;

  vec2 q = clamp(seat.xz, -uCore, uCore);
  vec2 n = normalize(seat.xz - q + vec2(1e-4));
  float back = dot(toCam, n) > 0.0 ? 1.0 : 0.0;

  int si = int(mod(iLook.x, 16.0));
  int hi = int(floor(iLook.x / 16.0));
  int ki = int(mod(iLook.y, 4.0));
  float acc = floor(iLook.y / 4.0);
  vShirt = uShirts[si];
  vHair = uHair[hi];
  vSkin = uSkin[ki];
  vScarf = (si == 9 || si == 10) ? vec3(0.1, 0.55, 0.28) : vec3(0.13, 0.28, 0.85);
  if (hood > 0.5) {
    // 座席と同じ色の上着 + フード（うつむいて寝ている）
    vShirt = uSeatV * 0.92;
    vHair = uSeatV * 0.8;
    vSkin = uSeatV * 0.8;
    acc = 0.0;
  }
  vFig = vec4(hip, scale, p.y, p.w);
  vInfo = vec4(kind, acc, back, pxPerM * 0.5);
  float light = uLight * (seat.y > 17.0 ? 0.9 : 1.0) * (0.9 + 0.2 * fract(r1 * 7.31));
  vMisc = vec4(uTime * (5.0 + r1 * 3.0) + r2 * 6.2831, clap, light, smoothstep(uFogNear, uFogFar, dist));
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSeat;
uniform vec3 uBags[4];
uniform vec3 uFogColor;
uniform float uAlphaCut;
varying vec2 vLocal;
flat varying vec3 vShirt;
flat varying vec3 vHair;
flat varying vec3 vSkin;
flat varying vec3 vScarf;
flat varying vec4 vFig;
flat varying vec4 vInfo;
flat varying vec4 vMisc;
flat varying float vW;
flat varying float vMark;
uniform vec3 uMarkColor;
uniform float uMarkPulse;

float sdBox(vec2 p, vec2 c, vec2 h, float r) {
  vec2 d = abs(p - c) - h + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
float sdCap(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

void main() {
  vec2 L = vLocal;
  float kind = vInfo.x;
  float acc = vInfo.y;
  float back = vInfo.z;
  float px = vInfo.w;
  float hip = vFig.x;
  float s = vFig.y;
  float arms = vFig.z;
  float phone = vFig.w;
  bool person = kind < 0.5 || kind > 3.5;
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  if (px < 2.5) {
    // 遠景: 2 色のかたまり（座席の幅いっぱい）
    float top = person ? hip + (0.8 + arms * 0.45) * s : 0.93;
    if (L.y < 0.46 || L.y > top) discard;
    if (person) {
      float headY = hip + 0.52 * s;
      vec3 head = back > 0.5 ? vHair : mix(vSkin, vHair, 0.72);
      col = L.y > headY ? head : vShirt;
      if (arms > 0.5 && L.y > hip + 0.8 * s) col = mix(vShirt, vSkin, 0.4);
      if (phone > 0.5 && L.y > top - 0.12) col = vec3(2.6);
    } else {
      col = uSeat;
      if (kind > 2.5 && kind < 3.5 && L.y < 0.66) col = uBags[int(mod(acc, 4.0))];
    }
    col *= vMisc.z;
    col = mix(col, uFogColor, vMisc.w);
    if (vMark > 0.5) col = mix(col, uMarkColor, uMarkPulse);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }

  float aa = max(fwidth(L.x), 0.003) * 0.8;
  #define PAINT(sd, c) { float a_ = clamp(0.5 - (sd) / aa, 0.0, 1.0); col = mix(col, (c), a_); alpha = max(alpha, a_); }

  // 座席（背もたれ + 座面の縁）
  PAINT(sdBox(L, vec2(0.0, 0.69), vec2(0.18, 0.24), 0.05), uSeat * (0.8 + 0.45 * smoothstep(0.82, 0.93, L.y)));
  PAINT(sdBox(L, vec2(0.0, 0.43), vec2(0.23, 0.035), 0.01), uSeat * 0.7);
  if (kind > 2.5 && kind < 3.5) {
    vec3 bag = uBags[int(mod(acc, 4.0))];
    PAINT(sdBox(L, vec2(0.03, 0.58), vec2(0.13, 0.12), 0.05), bag);
    PAINT(sdBox(L, vec2(0.03, 0.71), vec2(0.06, 0.02), 0.01), bag * 0.6);
  }

  if (person) {
    float ph = vMisc.x;
    float clap = vMisc.y;
    vec2 sh = vec2(0.18 * s, hip + 0.46 * s);
    // 手の位置: 下ろす → 上げる（揺れる）/ 拍手（胸の前）
    float upX = (0.27 + 0.07 * sin(ph)) * s;
    float upY = hip + (0.46 + 0.6) * s + 0.05 * sin(ph * 1.3) * s;
    vec2 handR = mix(vec2(0.24 * s, hip + 0.08 * s), vec2(upX, upY), arms);
    vec2 handL = mix(vec2(-0.24 * s, hip + 0.08 * s), vec2(-upX, upY + 0.04 * sin(ph + 1.1) * s), arms);
    if (clap > 0.5) {
      float c = 0.03 + 0.05 * abs(sin(ph * 2.2));
      handR = vec2(c * s, hip + 0.62 * s);
      handL = vec2(-c * s, hip + 0.62 * s);
    }
    if (phone > 0.5) handR = vec2(0.12 * s, hip + 0.86 * s);
    vec3 sleeve = vShirt * 0.85;
    PAINT(sdCap(L, vec2(sh.x, sh.y), handR, 0.052 * s), sleeve);
    PAINT(sdCap(L, vec2(-sh.x, sh.y), handL, 0.052 * s), sleeve);
    // 胴
    vec3 shirt = vShirt;
    if (back > 0.5 && px > 6.0) {
      // 背番号
      float num = step(abs(L.x), 0.07 * s) * step(abs(L.y - (hip + 0.3 * s)), 0.09 * s);
      shirt = mix(shirt, vec3(1.0) - shirt * 0.6, num * 0.8);
    }
    PAINT(sdBox(L, vec2(0.0, hip + 0.25 * s), vec2(0.19 * s, 0.25 * s), 0.07 * s), shirt);
    // 首のマフラー
    if (mod(acc, 4.0) > 1.5 && arms < 0.5) {
      PAINT(sdBox(L, vec2(0.0, hip + 0.47 * s), vec2(0.13 * s, 0.03 * s), 0.02 * s), vScarf);
      PAINT(sdBox(L, vec2(-0.075 * s, hip + 0.33 * s), vec2(0.028 * s, 0.13 * s), 0.01 * s), vScarf);
      PAINT(sdBox(L, vec2(0.075 * s, hip + 0.33 * s), vec2(0.028 * s, 0.13 * s), 0.01 * s), vScarf);
    }
    // 頭
    vec2 hc = vec2(0.0, hip + 0.64 * s);
    float hr = 0.115 * s * (kind > 3.5 && kind < 4.5 ? 1.2 : 1.0);
    PAINT(length(L - hc) - hr, back > 0.5 ? vHair : vSkin);
    PAINT(max(length(L - hc) - hr - 0.012, hc.y + 0.035 * s - L.y), vHair);
    if (mod(acc, 2.0) > 0.5) {
      PAINT(max(length(L - hc) - hr - 0.02, hc.y + 0.01 - L.y), vScarf);
      PAINT(sdBox(L, hc + vec2(0.05 * s, 0.015), vec2(0.1 * s, 0.012), 0.005), vScarf * 0.7);
    }
    // 両手で掲げるマフラー
    if (mod(acc, 4.0) > 1.5 && arms > 0.5) {
      float y = (handR.y + handL.y) * 0.5;
      float stripes = step(0.5, fract(L.x * 9.0));
      PAINT(sdBox(L, vec2((handR.x + handL.x) * 0.5, y - 0.05), vec2(abs(handR.x - handL.x) * 0.5, 0.055 * s), 0.01), mix(vScarf, vec3(0.95), stripes));
    }
    // 小旗（日の丸 / 黄緑）
    if (mod(acc, 8.0) > 3.5 && arms > 0.3) {
      vec2 fc = handR + vec2(0.16 * s, 0.14 * s + 0.03 * sin(ph * 2.0));
      bool away = vScarf.g > 0.5;
      PAINT(sdBox(L, fc, vec2(0.16 * s, 0.1 * s), 0.005), away ? vec3(0.98, 0.83, 0.15) : vec3(0.97));
      PAINT(length(L - fc) - 0.055 * s, away ? vec3(0.1, 0.55, 0.28) : vec3(0.85, 0.08, 0.15));
    }
    // スマホ（ライト）
    if (phone > 0.5) {
      PAINT(sdBox(L, handR + vec2(0.0, 0.05 * s), vec2(0.03 * s, 0.05 * s), 0.01), vec3(2.8));
    }
  }

  if (vMark > 0.5) {
    // 調べた席・候補の枠
    float ring = abs(sdBox(L, vec2(0.0, 0.7), vec2(0.3, 0.36), 0.08)) - 0.025;
    float ra = clamp(0.5 - ring / aa, 0.0, 1.0) * uMarkPulse;
    col = mix(col, uMarkColor, ra);
    alpha = max(alpha, ra);
  }
  if (alpha < uAlphaCut) discard;
  col *= vMisc.z;
  col = mix(col, uFogColor, vMisc.w);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class CrowdField {
  constructor(scene, layout, plan, director, { a2c = true, fog } = {}) {
    this.layout = layout;
    this.plan = plan;
    const N = layout.count;
    const base = new THREE.InstancedBufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    base.setIndex([0, 1, 2, 0, 2, 3]);
    const pos = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      pos[i * 4] = layout.x[i];
      pos[i * 4 + 1] = layout.y[i];
      pos[i * 4 + 2] = layout.z[i];
      pos[i * 4 + 3] = layout.s[i];
    }
    this.meta = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      this.meta[i * 4] = plan.kind[i];
      this.meta[i * 4 + 1] = layout.block[i];
      this.meta[i * 4 + 2] = layout.row[i];
    }
    base.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 4));
    base.setAttribute('iLook', new THREE.InstancedBufferAttribute(plan.look, 4));
    this.metaAttr = new THREE.InstancedBufferAttribute(this.meta, 4);
    this.metaAttr.setUsage(THREE.DynamicDrawUsage);
    base.setAttribute('iMeta', this.metaAttr);
    base.instanceCount = N;
    const col = (h) => new THREE.Color(h);
    this.uniforms = {
      ...director.uniforms,
      uCore: { value: new THREE.Vector2(CORE.sx, CORE.sz) },
      uPxScale: { value: 600 },
      uShirts: { value: SHIRTS.map(col) },
      uHair: { value: HAIR.map(col) },
      uSkin: { value: SKIN.map(col) },
      uBags: { value: BAGS.map(col) },
      uSeat: { value: col(SEAT_COLOR) },
      uSeatV: { value: col(SEAT_COLOR) },
      uFogColor: { value: fog ? fog.color : new THREE.Color(0x0b0f22) },
      uFogNear: { value: fog ? fog.near : 200 },
      uFogFar: { value: fog ? fog.far * 1.6 : 1200 },
      uLight: { value: 1.0 },
      uAlphaCut: { value: a2c ? 0.02 : 0.5 },
      uMark: { value: [-1, -1, -1, -1] },
      uMarkColor: { value: new THREE.Color(0xffd23f).multiplyScalar(1.6) },
      uMarkPulse: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      alphaToCoverage: a2c,
    });
    this.material = mat;
    this.mesh = new THREE.Mesh(base, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'crowd100k';
    scene.add(this.mesh);
    this.pendingRanges = [];
  }

  setA2C(on) {
    this.material.alphaToCoverage = on;
    this.uniforms.uAlphaCut.value = on ? 0.02 : 0.5;
    this.material.needsUpdate = true;
  }

  // 見た目の種類を変える（ハーフタイムの空席・トイレから戻る 等）
  setKind(id, kind) {
    const hidden = this.meta[id * 4] & 128;
    this.meta[id * 4] = (kind & 127) | hidden;
    this.markDirty(id);
  }

  setHidden(id, hidden) {
    const k = this.meta[id * 4] & 127;
    this.meta[id * 4] = k | (hidden ? 128 : 0);
    this.markDirty(id);
  }

  markDirty(id) {
    this.pendingRanges.push(id);
  }

  // 画面の高さ（描画バッファの px）と縦の画角から「1m が何 px か × 距離」
  update(camera, bufferHeight) {
    this.uniforms.uPxScale.value = bufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    if (this.pendingRanges.length) {
      const a = this.metaAttr;
      a.clearUpdateRanges();
      if (this.pendingRanges.length > 64) a.addUpdateRange(0, this.meta.length);
      else for (const id of this.pendingRanges) a.addUpdateRange(id * 4, 4);
      a.needsUpdate = true;
      this.pendingRanges.length = 0;
    }
  }
}
