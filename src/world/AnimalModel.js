import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ローポリの猫と柴犬。ランナーと同じく「箱の結合 + 頂点シェーダーで脚としっぽを動かす」。
// aPart: 0 胴 / 1 頭 / 2 前左脚 / 3 前右脚 / 4 後左脚 / 5 後右脚 / 6 しっぽ
// aSlot: 0 毛色 / 1 差し色（お腹・口元・足先）/ 2 目・鼻 / 3 ピンク（耳の内側・鼻）
// 前方 = -Z

function piece(w, h, d, [x, y, z], part, slot, pivot = [0, 0, 0]) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  geo.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  geo.setAttribute('aSlot', new THREE.BufferAttribute(new Float32Array(n).fill(slot), 1));
  const pv = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pv.set(pivot, i * 3);
  geo.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
  return geo;
}

function legs(parts, { x, z, hip, len, w, pawSlot }) {
  const defs = [
    [2, -x, -z],
    [3, x, -z],
    [4, -x, z],
    [5, x, z],
  ];
  for (const [part, lx, lz] of defs) {
    const pivot = [lx, hip, lz];
    parts.push(piece(w, len, w, [lx, hip - len / 2, lz], part, 0, pivot));
    parts.push(piece(w * 1.08, 0.05, w * 1.15, [lx, 0.025, lz - 0.01], part, pawSlot, pivot));
  }
}

const cache = {};

export function getAnimalGeometry(kind) {
  if (cache[kind]) return cache[kind];
  const parts = [];
  if (kind === 'cat') {
    parts.push(piece(0.26, 0.22, 0.56, [0, 0.34, 0], 0, 0));
    parts.push(piece(0.22, 0.05, 0.44, [0, 0.225, 0], 0, 1));
    parts.push(piece(0.26, 0.22, 0.22, [0, 0.5, -0.36], 1, 0));
    parts.push(piece(0.13, 0.07, 0.04, [0, 0.44, -0.475], 1, 1));
    parts.push(piece(0.045, 0.03, 0.02, [0, 0.48, -0.49], 1, 3));
    for (const sx of [-1, 1]) {
      parts.push(piece(0.05, 0.05, 0.02, [sx * 0.065, 0.54, -0.475], 1, 2));
      parts.push(piece(0.075, 0.11, 0.05, [sx * 0.085, 0.655, -0.34], 1, 0));
      parts.push(piece(0.04, 0.06, 0.02, [sx * 0.085, 0.645, -0.366], 1, 3));
    }
    parts.push(piece(0.05, 0.38, 0.05, [0, 0.57, 0.3], 6, 0, [0, 0.4, 0.28]));
    legs(parts, { x: 0.09, z: 0.2, hip: 0.25, len: 0.24, w: 0.07, pawSlot: 1 });
  } else {
    // 柴犬
    parts.push(piece(0.32, 0.28, 0.66, [0, 0.46, 0], 0, 0));
    parts.push(piece(0.28, 0.08, 0.5, [0, 0.33, 0], 0, 1));
    parts.push(piece(0.26, 0.2, 0.08, [0, 0.44, -0.33], 0, 1));
    parts.push(piece(0.32, 0.28, 0.3, [0, 0.68, -0.44], 1, 0));
    parts.push(piece(0.18, 0.12, 0.14, [0, 0.62, -0.63], 1, 1));
    parts.push(piece(0.07, 0.05, 0.03, [0, 0.67, -0.705], 1, 2));
    for (const sx of [-1, 1]) {
      parts.push(piece(0.05, 0.05, 0.02, [sx * 0.08, 0.74, -0.595], 1, 2));
      parts.push(piece(0.09, 0.13, 0.06, [sx * 0.1, 0.87, -0.42], 1, 0));
      parts.push(piece(0.05, 0.08, 0.02, [sx * 0.1, 0.86, -0.452], 1, 1));
    }
    // 巻きしっぽ
    parts.push(piece(0.08, 0.2, 0.08, [0, 0.7, 0.34], 6, 0, [0, 0.58, 0.33]));
    parts.push(piece(0.08, 0.08, 0.16, [0, 0.8, 0.28], 6, 1, [0, 0.58, 0.33]));
    legs(parts, { x: 0.11, z: 0.24, hip: 0.34, len: 0.32, w: 0.09, pawSlot: 1 });
  }
  const geo = mergeGeometries(parts, false);
  geo.computeBoundingSphere();
  cache[kind] = geo;
  return geo;
}

const VERT = /* glsl */ `
attribute float aPart;
attribute float aSlot;
attribute vec3 aPivot;
attribute vec3 iAnim;   // x: 位相, y: 脚の振り幅
attribute vec3 iColA;
attribute vec3 iColB;
varying vec3 vACol;
varying vec3 vARim;
vec3 aRotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
vec3 aRotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
float legAngle() {
  float sw = sin(iAnim.x) * 0.75 * iAnim.y;
  if (aPart > 1.5 && aPart < 2.5) return sw;
  if (aPart > 2.5 && aPart < 3.5) return -sw;
  if (aPart > 3.5 && aPart < 4.5) return -sw;
  if (aPart > 4.5 && aPart < 5.5) return sw;
  return 0.0;
}
vec3 animA(vec3 p, bool isNormal) {
  vec3 q = isNormal ? p : p - aPivot;
  if (aPart > 1.5 && aPart < 5.5) q = aRotX(q, legAngle());
  else if (aPart > 5.5) q = aRotZ(q, sin(iAnim.x * 2.0 + 1.0) * 0.55);
  if (isNormal) return q;
  p = q + aPivot;
  p.y += abs(sin(iAnim.x)) * 0.035 * iAnim.y;
  return p;
}
vec3 pickA() {
  if (aSlot < 0.5) return iColA;
  if (aSlot < 1.5) return iColB;
  if (aSlot < 2.5) return vec3(0.04);
  return vec3(1.0, 0.55, 0.65);
}
`;

export function createAnimalMaterial(rim = 0.25) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = { uRim: { value: rim } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = animA(normal, true);')
      .replace('#include <begin_vertex>', 'vec3 transformed = animA(position, false);\nvACol = pickA();')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvARim = -mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vACol;\nvarying vec3 vARim;\nuniform float uRim;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vACol;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimA = pow(1.0 - abs(dot(normalize(vARim), normal)), 2.5);
        totalEmissiveRadiance += vec3(1.0, 0.85, 0.6) * rimA * uRim + vACol * 0.12;`
      );
  };
  mat.customProgramCacheKey = () => 'animal-v1';
  return mat;
}

export function createAnimalInstances(kind, count, material = createAnimalMaterial()) {
  const geo = getAnimalGeometry(kind).clone();
  const attr = (size, dynamic) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
    if (dynamic) a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  geo.setAttribute('iAnim', attr(3, true));
  geo.setAttribute('iColA', attr(3));
  geo.setAttribute('iColB', attr(3));
  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

export const CAT_LOOKS = [
  { a: 0xe0893b, b: 0xfff0dc }, // 茶トラ
  { a: 0x1b1b22, b: 0x2a2a33 }, // 黒猫
  { a: 0xf2f2f2, b: 0xffffff }, // 白猫
  { a: 0x7a7a88, b: 0xdcdcdc }, // サバ白
  { a: 0xf5ecd9, b: 0xd9893b }, // 三毛っぽい
];

export const DOG_LOOKS = [
  { a: 0xd9893b, b: 0xfff3e0 }, // 赤柴
  { a: 0x2a2224, b: 0xe8c9a0 }, // 黒柴
  { a: 0xf0e2c4, b: 0xffffff }, // 白柴
];

const tmp = new THREE.Color();
export function setAnimalLook(mesh, i, look) {
  const g = mesh.geometry.attributes;
  tmp.setHex(look.a);
  g.iColA.setXYZ(i, tmp.r, tmp.g, tmp.b);
  tmp.setHex(look.b);
  g.iColB.setXYZ(i, tmp.r, tmp.g, tmp.b);
  g.iColA.needsUpdate = g.iColB.needsUpdate = true;
}
