import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ローポリ人型を 1 つのジオメトリに結合し、手足の振りは頂点シェーダーで行う。
// → 255 人の AI ランナーも 1500 人の観客も、それぞれ 1 draw call。
//
// aPart: 0 胴 / 1 頭 / 2 左腕 / 3 右腕 / 4 左脚 / 5 右脚 / 6 帽子
// aSlot: 0 シャツ / 1 パンツ / 2 肌 / 3 靴 / 4 ゼッケン / 5 髪・帽子
// 前方 = -Z（背中側 +Z にゼッケン）

const PART = { torso: 0, head: 1, armL: 2, armR: 3, legL: 4, legR: 5, hat: 6 };
const SLOT = { shirt: 0, pants: 1, skin: 2, shoe: 3, bib: 4, hair: 5 };

function piece(geo, part, slot, pivot, [x, y, z]) {
  geo.translate(x, y, z);
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  const aPart = new Float32Array(n).fill(part);
  const aSlot = new Float32Array(n).fill(slot);
  const aPivot = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    aPivot[i * 3] = pivot[0];
    aPivot[i * 3 + 1] = pivot[1];
    aPivot[i * 3 + 2] = pivot[2];
  }
  geo.setAttribute('aPart', new THREE.BufferAttribute(aPart, 1));
  geo.setAttribute('aSlot', new THREE.BufferAttribute(aSlot, 1));
  geo.setAttribute('aPivot', new THREE.BufferAttribute(aPivot, 3));
  return geo;
}

const cachedGeometry = {};

// detail: 'high'（ランナー、約 230 tris）/ 'low'（観客、約 120 tris）
export function getHumanGeometry(detail = 'high') {
  if (cachedGeometry[detail]) return cachedGeometry[detail];
  const low = detail === 'low';
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const hip = 0.9;
  const shoulder = 1.45;
  const parts = [];

  for (const side of [-1, 1]) {
    const leg = side < 0 ? PART.legL : PART.legR;
    const pv = [0.11 * side, hip, 0];
    const arm = side < 0 ? PART.armL : PART.armR;
    const pa = [0.29 * side, shoulder, 0];
    if (low) {
      parts.push(piece(box(0.17, 0.86, 0.19), leg, SLOT.pants, pv, [0.11 * side, 0.47, 0]));
      parts.push(piece(box(0.13, 0.58, 0.14), arm, SLOT.shirt, pa, [0.29 * side, 1.2, 0]));
      continue;
    }
    parts.push(piece(box(0.17, 0.44, 0.19), leg, SLOT.pants, pv, [0.11 * side, 0.68, 0]));
    parts.push(piece(box(0.14, 0.42, 0.16), leg, SLOT.skin, pv, [0.11 * side, 0.27, 0]));
    parts.push(piece(box(0.17, 0.1, 0.3), leg, SLOT.shoe, pv, [0.11 * side, 0.05, -0.05]));
    parts.push(piece(box(0.13, 0.3, 0.14), arm, SLOT.shirt, pa, [0.29 * side, 1.33, 0]));
    parts.push(piece(box(0.11, 0.28, 0.12), arm, SLOT.skin, pa, [0.3 * side, 1.07, -0.04]));
  }

  const origin = [0, 0, 0];
  parts.push(piece(box(0.46, 0.56, 0.25), PART.torso, SLOT.shirt, origin, [0, 1.2, 0]));
  parts.push(piece(box(0.25, 0.27, 0.26), PART.head, SLOT.skin, origin, [0, 1.64, 0]));
  parts.push(piece(box(0.27, 0.09, 0.28), PART.head, SLOT.hair, origin, [0, 1.79, 0.01]));
  const hatPivot = [0, 1.82, 0];
  if (low) {
    parts.push(piece(box(0.3, 0.3, 0.3), PART.hat, SLOT.hair, hatPivot, [0, 1.98, 0]));
  } else {
    parts.push(piece(box(0.47, 0.2, 0.27), PART.torso, SLOT.pants, origin, [0, 0.96, 0]));
    parts.push(piece(box(0.25, 0.18, 0.02), PART.torso, SLOT.bib, origin, [0, 1.2, 0.135]));
    parts.push(piece(box(0.27, 0.17, 0.06), PART.head, SLOT.hair, origin, [0, 1.7, 0.13]));
    const crown = new THREE.CylinderGeometry(0.15, 0.15, 0.34, 6, 1, true);
    parts.push(piece(crown, PART.hat, SLOT.hair, hatPivot, [0, 2.0, 0]));
    const brim = new THREE.CylinderGeometry(0.25, 0.25, 0.03, 8);
    parts.push(piece(brim, PART.hat, SLOT.hair, hatPivot, [0, 1.84, 0]));
    const top = new THREE.CylinderGeometry(0.15, 0.15, 0.01, 6);
    parts.push(piece(top, PART.hat, SLOT.hair, hatPivot, [0, 2.17, 0]));
  }

  const geo = mergeGeometries(parts, false);
  geo.computeBoundingSphere();
  cachedGeometry[detail] = geo;
  return geo;
}

const COMMON_VERT = /* glsl */ `
attribute float aPart;
attribute float aSlot;
attribute vec3 aPivot;
attribute vec3 iAnim;     // x: phase, y: amplitude, z: hat scale
attribute vec3 iShirt;
attribute vec3 iPants;
attribute vec3 iSkin;
attribute vec3 iHatCol;
uniform float uTime;
uniform float uExcite;
uniform vec2 uPlayerXZ;
varying vec3 vRCol;
varying vec3 vRimView;

vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }

vec3 pickColor() {
  if (aSlot < 0.5) return iShirt;
  if (aSlot < 1.5) return iPants;
  if (aSlot < 2.5) return iSkin;
  if (aSlot < 3.5) return mix(iShirt, vec3(1.0), 0.55);
  if (aSlot < 4.5) return vec3(0.95);
  return iHatCol;
}
`;

const RUNNER_ANIM = /* glsl */ `
float partAngle() {
  float sw = sin(iAnim.x) * iAnim.y;
  if (aPart < 1.5) return 0.0;
  if (aPart < 2.5) return sw * 0.95;
  if (aPart < 3.5) return -sw * 0.95;
  if (aPart < 4.5) return -sw * 0.8;
  if (aPart < 5.5) return sw * 0.8;
  return 0.0;
}
vec3 animNormal(vec3 n) {
  return rotX(rotX(n, partAngle()), -0.12 * iAnim.y);
}
vec3 animPos(vec3 p) {
  vec3 q = rotX(p - aPivot, partAngle());
  if (aPart > 5.5) q *= iAnim.z;
  p = q + aPivot;
  p.y += abs(cos(iAnim.x)) * 0.07 * iAnim.y;
  return rotX(p, -0.12 * iAnim.y);
}
`;

// 観客: 声援（uExcite）とプレイヤーとの近さで腕を上げ、跳ねる
const SPECTATOR_ANIM = /* glsl */ `
float exciteLevel() {
  float nearP = smoothstep(34.0, 0.0, distance(instanceMatrix[3].xz, uPlayerXZ));
  float personal = 0.55 + 0.45 * fract(iAnim.x * 7.13);
  return clamp(uExcite * personal + nearP * 0.55 * (0.4 + uExcite), 0.0, 1.0);
}
float specPhase() { return uTime * (6.0 + fract(iAnim.x * 3.1) * 4.0) + iAnim.x * 6.2831; }
float partAngle() {
  float e = exciteLevel();
  float ph = specPhase();
  if (aPart > 1.5 && aPart < 2.5) return -(0.12 + e * 2.3 + sin(ph) * 0.35 * e);
  if (aPart > 2.5 && aPart < 3.5) return (0.12 + e * 2.3 + sin(ph + 1.3) * 0.35 * e);
  return 0.0;
}
vec3 animNormal(vec3 n) { return rotZ(n, partAngle()); }
vec3 animPos(vec3 p) {
  vec3 q = rotZ(p - aPivot, partAngle());
  if (aPart > 5.5) q *= iAnim.z;
  p = q + aPivot;
  float e = exciteLevel();
  p.y += max(0.0, sin(specPhase() * 0.5)) * 0.3 * e * e;
  return p;
}
`;

export function createHumanMaterial({ mode = 'runner', rim = 0.4, rimColor = 0x39e6ff } = {}) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = {
    uTime: { value: 0 },
    uExcite: { value: 0 },
    uPlayerXZ: { value: new THREE.Vector2() },
    uRim: { value: rim },
    uRimColor: { value: new THREE.Color(rimColor) },
    // カメラとプレイヤーの間にいる AI をディザで消す距離（0 = 無効）
    uNearFade: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const anim = mode === 'spectator' ? SPECTATOR_ANIM : RUNNER_ANIM;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_VERT}\n${anim}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = animNormal(normal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = animPos(position);\nvRCol = pickColor();')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRimView = -mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRCol;\nvarying vec3 vRimView;\nuniform float uRim;\nuniform vec3 uRimColor;\nuniform float uNearFade;'
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (uNearFade > 0.0) {
          float fadeA = smoothstep(uNearFade * 0.5, uNearFade, length(vRimView));
          vec2 bp = mod(floor(gl_FragCoord.xy), 2.0);
          float dither = (mod(bp.x * 2.0 + bp.y * 3.0, 4.0) + 0.5) / 4.0;
          if (fadeA < dither) discard;
        }`
      )
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vRCol;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimF = pow(1.0 - abs(dot(normalize(vRimView), normal)), 2.5);
        totalEmissiveRadiance += uRimColor * rimF * uRim;`
      );
  };
  mat.customProgramCacheKey = () => `human-${mode}`;
  return mat;
}

export const LOOKS = {
  samurai: { shirt: 0xa01818, pants: 0x16161e, skin: 0xe8b894, hat: 0x0c0c10, hatScale: 0.42 },
  ninja: { shirt: 0x191923, pants: 0x121218, skin: 0x23232e, hat: 0x0c0c10, hatScale: 0 },
  gentleman: { shirt: 0x6b4a2f, pants: 0x2b2b33, skin: 0xe0b08c, hat: 0x121212, hatScale: 1 },
  grandma: { shirt: 0x7a3f9a, pants: 0xe8e2d0, skin: 0xe6b89a, hat: 0xd0d0d0, hatScale: 0 },
  salaryman: { shirt: 0x262a33, pants: 0x1c1e24, skin: 0xe0b08c, hat: 0x151515, hatScale: 0 },
  panda: { shirt: 0xf2f2f2, pants: 0x111111, skin: 0xf6f6f6, hat: 0x111111, hatScale: 0 },
  bunny: { shirt: 0xff8fc8, pants: 0xff8fc8, skin: 0xffd4ea, hat: 0xff8fc8, hatScale: 0 },
  hero: { shirt: 0x1d4fff, pants: 0xe02020, skin: 0xe8b894, hat: 0x1d4fff, hatScale: 0 },
};

const VIVID = [0x19c3ff, 0xff3d7f, 0xffd23f, 0x3dff8b, 0xff7a1a, 0xa56bff, 0xffffff, 0x00e0c6, 0xff4040, 0x4d7cff];
const PANTS = [0x15151c, 0x1f2a44, 0x222222, 0x3a3a46, 0x0f2d3a];
const SKIN = [0xf1c7a3, 0xe0ac86, 0xc98e6a, 0x9b6a4a, 0xf6d5b8];
const HAIR = [0x111111, 0x2b1a10, 0x4a3020, 0x777777, 0xc9a26a];

export function randomLook(rng, costumeChance = 0.2) {
  if (rng.chance(costumeChance)) {
    const key = rng.pick(['ninja', 'gentleman', 'grandma', 'salaryman', 'panda', 'bunny', 'hero']);
    return { ...LOOKS[key], costume: key };
  }
  return {
    shirt: rng.pick(VIVID),
    pants: rng.pick(PANTS),
    skin: rng.pick(SKIN),
    hat: rng.pick(HAIR),
    hatScale: 0,
    costume: null,
  };
}

const CASUAL = [0x2d3b55, 0x5a2d3b, 0x3b5a2d, 0x6b6b6b, 0xd8d8d8, 0x1d1d25, 0x8a5a2b, 0x2b6b8a, 0xb03a48, 0xe0c060];

export function randomSpectatorLook(rng) {
  return {
    shirt: rng.pick(CASUAL),
    pants: rng.pick(PANTS),
    skin: rng.pick(SKIN),
    hat: rng.pick(HAIR),
    hatScale: rng.chance(0.08) ? 0.7 : 0,
  };
}

// iAnim / 色のインスタンス属性つき InstancedMesh
export function createHumanInstances(count, material, detail = 'high') {
  const geo = getHumanGeometry(detail).clone();
  const mk = (size, usage) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
    if (usage) a.setUsage(usage);
    return a;
  };
  geo.setAttribute('iAnim', mk(3, THREE.DynamicDrawUsage));
  geo.setAttribute('iShirt', mk(3));
  geo.setAttribute('iPants', mk(3));
  geo.setAttribute('iSkin', mk(3));
  geo.setAttribute('iHatCol', mk(3));
  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  return mesh;
}

const tmpColor = new THREE.Color();
export function applyLook(mesh, i, look) {
  const g = mesh.geometry.attributes;
  const set = (attr, hex) => {
    tmpColor.setHex(hex);
    attr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
  };
  set(g.iShirt, look.shirt);
  set(g.iPants, look.pants);
  set(g.iSkin, look.skin);
  set(g.iHatCol, look.hat);
  g.iAnim.setZ(i, look.hatScale ?? 0);
  g.iShirt.needsUpdate = g.iPants.needsUpdate = g.iSkin.needsUpdate = g.iHatCol.needsUpdate = true;
  g.iAnim.needsUpdate = true;
}

// 高速な行列書き込み（Y 回転 + 均一スケール + 移動）
export function writeYawMatrix(array, i, x, y, z, yaw, scale = 1) {
  const c = Math.cos(yaw) * scale;
  const s = Math.sin(yaw) * scale;
  const o = i * 16;
  array[o] = c; array[o + 1] = 0; array[o + 2] = -s; array[o + 3] = 0;
  array[o + 4] = 0; array[o + 5] = scale; array[o + 6] = 0; array[o + 7] = 0;
  array[o + 8] = s; array[o + 9] = 0; array[o + 10] = c; array[o + 11] = 0;
  array[o + 12] = x; array[o + 13] = y; array[o + 14] = z; array[o + 15] = 1;
}
