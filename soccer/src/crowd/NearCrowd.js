import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getHumanGeometry } from '../../../src/world/RunnerModel.js';
import { POSE_GLSL } from './CrowdDirector.js';
import { SHIRTS, HAIR, SKIN, SEAT_COLOR, KIND } from './SeatPlan.js';
import { CORE } from '../stadium/StadiumLayout.js';

// 近くの観客（NEAR / VERY NEAR）: 主人公のまわり数十 m だけ 3D の人形（1500m / 沿道と同じローポリ人型）にする。
//   その席のビルボードは CrowdField 側で消す（iMeta.x += 128）。
//   姿勢は遠くの観客と同じ DataTexture（CrowdDirector）→ 遠くと近くで立ち上がるタイミングがそろう。
//   座っている時は脚を前へ曲げ、腰を座面の高さまで下げる。腕は横から上へ（ウェーブ・歓喜）。
//   iOver（上書き）: 目の前でゴールの時に跳ぶ人など、CPU から直接姿勢を決める人（VERY NEAR）。
//   座席（背もたれ + 座面）も 3D で置く（空席・荷物が近くで見えるように）。

const NEAR_GLSL = /* glsl */ `
attribute float aPart;
attribute float aSlot;
attribute vec3 aPivot;
attribute vec4 iSeat;   // x y z s
attribute vec4 iLook;
attribute vec4 iMeta;   // kind, block, row, yaw(0-255)
attribute vec4 iOver;   // stand, arms, jump, weight
uniform vec3 uShirts[16];
uniform vec3 uHair[4];
uniform vec3 uSkin[4];
uniform vec3 uSeatC;
uniform vec2 uCore;
${POSE_GLSL}
varying vec3 vNCol;
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
float nKind;
vec4 nPose;
float nSit;
float nArmA(float side) {
  float ph = uTime * (5.0 + fract(iLook.z * 0.013) * 3.0) + iLook.w * 0.0246;
  float a = 0.12 + nPose.y * 2.45 + sin(ph + side) * 0.3 * nPose.y;
  return a;
}
vec3 nAnim(vec3 p, bool isNormal) {
  vec3 pv = isNormal ? vec3(0.0) : aPivot;
  vec3 q = p - pv;
  if (aPart > 3.5 && aPart < 5.5) q = rotX(q, 1.45 * nSit);
  else if (aPart > 1.5 && aPart < 2.5) q = rotZ(q, -nArmA(0.0));
  else if (aPart > 2.5 && aPart < 3.5) q = rotZ(q, nArmA(1.3));
  return q + pv;
}
`;

const _v = new THREE.Vector3();

function seatGeometry() {
  const back = new THREE.BoxGeometry(0.42, 0.44, 0.05);
  back.translate(0, 0.68, 0.18);
  const pan = new THREE.BoxGeometry(0.44, 0.05, 0.36);
  pan.translate(0, 0.44, 0);
  const g = mergeGeometries([back, pan]);
  return g;
}

export class NearCrowd {
  // center: 主人公の位置。radius m 以内・max 人まで
  constructor(scene, layout, plan, director, field) {
    this.scene = scene;
    this.layout = layout;
    this.plan = plan;
    this.director = director;
    this.field = field;
    this.ids = [];
    this.extras = []; // VERY NEAR（通路の人など）: { index, pose }
    this.max = 0;
  }

  build(center, { radius = 26, max = 1400, tier = 0, extras = [] } = {}) {
    this.dispose();
    const L = this.layout;
    const cand = [];
    for (let i = 0; i < L.count; i++) {
      if (L.tier[i] !== tier) continue;
      const dx = L.x[i] - center.x;
      const dz = L.z[i] - center.z;
      const dy = L.y[i] - center.y;
      const d2 = dx * dx + dz * dz + dy * dy;
      if (d2 < radius * radius) cand.push([d2, i]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    this.ids = cand.slice(0, max).map((c) => c[1]);
    for (const id of this.ids) this.field.setHidden(id, true);
    const n = this.ids.length + extras.length;
    this.count = n;

    // 人形
    const base = getHumanGeometry('low');
    const geo = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'normal', 'aPart', 'aSlot', 'aPivot']) geo.setAttribute(k, base.attributes[k]);
    geo.setIndex(base.index);
    const seat = new Float32Array(n * 4);
    const look = new Uint8Array(n * 4);
    const meta = new Uint8Array(n * 4);
    this.over = new Float32Array(n * 4);
    const toYaw = (x, z) => {
      const qx = Math.max(-CORE.sx, Math.min(CORE.sx, x));
      const qz = Math.max(-CORE.sz, Math.min(CORE.sz, z));
      // ピッチ側（内側）を向く。人形の前は -Z
      const ix = qx - x;
      const iz = qz - z;
      return Math.atan2(-ix, -iz);
    };
    this.ids.forEach((id, j) => {
      seat[j * 4] = L.x[id];
      seat[j * 4 + 1] = L.y[id];
      seat[j * 4 + 2] = L.z[id];
      seat[j * 4 + 3] = L.s[id];
      for (let c = 0; c < 4; c++) look[j * 4 + c] = this.plan.look[id * 4 + c];
      meta[j * 4] = this.plan.kind[id];
      meta[j * 4 + 1] = L.block[id];
      meta[j * 4 + 2] = L.row[id];
      const yaw = toYaw(L.x[id], L.z[id]);
      meta[j * 4 + 3] = Math.round(((yaw / (Math.PI * 2)) % 1 + 1) % 1 * 255);
    });
    this.extras = extras.map((e, k) => {
      const j = this.ids.length + k;
      seat[j * 4] = e.x;
      seat[j * 4 + 1] = e.y;
      seat[j * 4 + 2] = e.z;
      seat[j * 4 + 3] = e.s ?? 0;
      look[j * 4] = e.shirt | ((e.hair ?? 0) << 4);
      look[j * 4 + 1] = (e.skin ?? 1) | ((e.acc ?? 0) << 2);
      look[j * 4 + 2] = 77 + k * 50;
      look[j * 4 + 3] = 140 + k * 30;
      meta[j * 4] = 0;
      meta[j * 4 + 1] = e.block ?? 0;
      meta[j * 4 + 3] = Math.round(((e.yaw / (Math.PI * 2)) % 1 + 1) % 1 * 255);
      this.over[j * 4 + 3] = 1;
      return { index: j, scale: e.scale ?? 1.05 };
    });
    geo.setAttribute('iSeat', new THREE.InstancedBufferAttribute(seat, 4));
    geo.setAttribute('iLook', new THREE.InstancedBufferAttribute(look, 4));
    this.metaAttr = new THREE.InstancedBufferAttribute(meta, 4);
    geo.setAttribute('iMeta', this.metaAttr);
    this.overAttr = new THREE.InstancedBufferAttribute(this.over, 4);
    this.overAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iOver', this.overAttr);
    geo.instanceCount = n;
    this.meta = meta;

    const col = (h) => new THREE.Color(h);
    const uniforms = {
      ...this.director.uniforms,
      uShirts: { value: SHIRTS.map(col) },
      uHair: { value: HAIR.map(col) },
      uSkin: { value: SKIN.map(col) },
      uSeatC: { value: col(SEAT_COLOR) },
      uCore: { value: new THREE.Vector2(CORE.sx, CORE.sz) },
    };
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${NEAR_GLSL}`)
        .replace(
          '#include <beginnormal_vertex>',
          `
          nKind = iMeta.x;
          float r1 = iLook.z / 255.0;
          float r2 = iLook.w / 255.0;
          float lean; float clap;
          nPose = crowdPose(iMeta.y, r1, r2, iSeat.w, lean, clap);
          nPose = mix(nPose, vec4(iOver.xyz, 0.0), iOver.w);
          float hood = nKind > 4.5 ? 1.0 : 0.0;
          nPose.xy *= 1.0 - hood * 0.85;
          nSit = 1.0 - nPose.x;
          float yawN = iMeta.w / 255.0 * 6.2831853;
          vec3 objectNormal = rotY(nAnim(normal, true), yawN);`
        )
        .replace(
          '#include <begin_vertex>',
          `
          float sc = (nKind > 3.5 && nKind < 4.5) ? 0.66 : (0.93 + 0.14 * r2);
          if (iOver.w > 0.5) sc = 1.06;
          bool hidden = nKind > 0.5 && nKind < 3.5;
          vec3 lp = nAnim(position, false);
          if (hood > 0.5) lp = rotX(lp - vec3(0.0, 0.9, 0.0), 0.5) + vec3(0.0, 0.9, 0.0);
          lp.y -= 0.47 * nSit;
          lp.z += 0.08 * nSit;
          lp.y += crowdJump(nPose, r1, r2) / max(sc, 0.5);
          vec3 transformed = rotY(lp * sc, yawN) + iSeat.xyz;
          if (hidden) transformed = vec3(0.0, -100.0, 0.0);
          int si = int(mod(iLook.x, 16.0));
          int hi = int(floor(iLook.x / 16.0));
          int ki = int(mod(iLook.y, 4.0));
          vec3 shirt = uShirts[si];
          vec3 hair = uHair[hi];
          vec3 skin = uSkin[ki];
          if (hood > 0.5) { shirt = uSeatC * 0.92; hair = uSeatC * 0.8; }
          if (aSlot < 0.5) vNCol = shirt;
          else if (aSlot < 1.5) vNCol = vec3(0.12, 0.13, 0.17);
          else if (aSlot < 2.5) vNCol = (hood > 0.5 && aPart > 0.5 && aPart < 1.5) ? hair : skin;
          else if (aSlot < 3.5) vNCol = vec3(0.1);
          else if (aSlot < 4.5) vNCol = vec3(0.95);
          else vNCol = hair;
          if (aPart > 5.5) transformed = vec3(0.0, -100.0, 0.0);`
        );
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvNDist = -mvPosition.z;');
      shader.vertexShader = shader.vertexShader.replace('varying vec3 vNCol;', 'varying vec3 vNCol;\nvarying float vNDist;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vNCol;\nvarying float vNDist;')
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          // カメラのすぐ前（60cm 以内）の人はディザで消す（画面いっぱいの箱にしない）
          float fadeA = smoothstep(0.28, 0.62, vNDist);
          vec2 bp = mod(floor(gl_FragCoord.xy), 2.0);
          if (fadeA < (mod(bp.x * 2.0 + bp.y * 3.0, 4.0) + 0.5) / 4.0) discard;`
        )
        .replace('#include <color_fragment>', 'diffuseColor.rgb *= vNCol;');
    };
    mat.customProgramCacheKey = () => 'near-crowd-v1';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'nearCrowd';
    this.mesh.layers.set(1); // 主カメラだけ（大型ビジョンの中継には映さない）
    this.scene.add(this.mesh);

    // 3D の座席
    const sg = seatGeometry();
    const seats = new THREE.InstancedMesh(sg, new THREE.MeshLambertMaterial({ color: SEAT_COLOR }), this.ids.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    this.ids.forEach((id, j) => {
      const yaw = toYaw(L.x[id], L.z[id]);
      q.setFromAxisAngle(up, yaw);
      m.compose(_v.set(L.x[id], L.y[id], L.z[id]), q, new THREE.Vector3(1, 1, 1));
      seats.setMatrixAt(j, m);
    });
    seats.frustumCulled = false;
    seats.layers.set(1);
    this.seats = seats;
    this.scene.add(seats);
  }

  // VERY NEAR の人の姿勢を CPU から決める
  setExtraPose(k, stand, arms, jump) {
    const e = this.extras[k];
    if (!e) return;
    const o = e.index * 4;
    this.over[o] = stand;
    this.over[o + 1] = arms;
    this.over[o + 2] = jump;
    this.overAttr.needsUpdate = true;
  }

  // 近くの席の見た目が変わった（トイレから戻る 等）
  setKind(id, kind) {
    const j = this.ids.indexOf(id);
    if (j < 0) return;
    this.meta[j * 4] = kind;
    this.metaAttr.needsUpdate = true;
  }

  has(id) {
    return this.ids.includes(id);
  }

  dispose() {
    for (const id of this.ids) this.field.setHidden(id, false);
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.scene.remove(this.seats);
      this.seats.geometry.dispose();
      this.seats.material.dispose();
      this.seats.dispose();
    }
    this.mesh = null;
    this.ids = [];
    this.extras = [];
  }
}
