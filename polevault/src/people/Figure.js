import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getFaceAtlas, EXPR } from './faceAtlas.js';

// 人（特殊 NPC・審判・スタッフ・選手）の関節モデル。1 人 = SkinnedMesh 1 つ = 1 draw call。
//   骨: hips → spine → chest → neck → head / chest → 肩 → 肘 → 手 / hips → 股 → 膝 → 足首
//   部位ごとの形（回転体・球）を 1 つのジオメトリに結合し、頂点ごとに「どの骨か（skinIndex・重み 1）」と
//   「何の色か（aSlot: 肌・髪・上着・下・靴・小物…）」を持たせる。色は 1 人ずつの uniform（パレット）。
//   → 同じ体型・髪型・服の形の人はジオメトリを共有する（数種類だけ作ってキャッシュ）。
//   顔は頭の前の薄い殻（aSlot = 8）に表情アトラスを貼る。表情は uniform 1 つで切り替え（まばたきも）。
//   ふちの光（リムライト）: 夜のスタジアムの逆光でシルエットが立つ。
//
// 座標（モデルの中）: +Z = 前、+X = 本人の左、+Y = 上。原点は足元（座っている人は座席の床）。

export const SLOT = { SKIN: 0, HAIR: 1, TOP: 2, BOTTOM: 3, SHOE: 4, ACC: 5, ACC2: 6, WHITE: 7, FACE: 8 };
export const BONE = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  shoulderL: 5, elbowL: 6, handL: 7, shoulderR: 8, elbowR: 9, handR: 10,
  hipL: 11, kneeL: 12, ankleL: 13, hipR: 14, kneeR: 15, ankleR: 16,
};

// 体型
export const BUILDS = {
  adult: { hipY: 0.86, spine: 0.11, chest: 0.21, neck: 0.2, head: 0.07, shX: 0.175, shY: 0.17, upper: 0.26, fore: 0.24, hipX: 0.09, thigh: 0.41, shin: 0.39, ankle: 0.07, headR: 0.135, torsoR: 0.15, limbR: 0.05, legR: 0.07, depth: 0.78 },
  big: { hipY: 0.86, spine: 0.11, chest: 0.22, neck: 0.2, head: 0.07, shX: 0.205, shY: 0.17, upper: 0.27, fore: 0.25, hipX: 0.105, thigh: 0.41, shin: 0.39, ankle: 0.07, headR: 0.14, torsoR: 0.2, limbR: 0.062, legR: 0.085, depth: 0.85 },
  slim: { hipY: 0.84, spine: 0.11, chest: 0.2, neck: 0.2, head: 0.07, shX: 0.16, shY: 0.165, upper: 0.25, fore: 0.235, hipX: 0.085, thigh: 0.4, shin: 0.38, ankle: 0.07, headR: 0.132, torsoR: 0.13, limbR: 0.043, legR: 0.06, depth: 0.76 },
  athlete: { hipY: 0.95, spine: 0.12, chest: 0.22, neck: 0.21, head: 0.075, shX: 0.19, shY: 0.18, upper: 0.29, fore: 0.27, hipX: 0.095, thigh: 0.46, shin: 0.44, ankle: 0.07, headR: 0.13, torsoR: 0.145, limbR: 0.048, legR: 0.066, depth: 0.74 },
  kid: { hipY: 0.5, spine: 0.07, chest: 0.14, neck: 0.13, head: 0.05, shX: 0.12, shY: 0.11, upper: 0.16, fore: 0.15, hipX: 0.065, thigh: 0.23, shin: 0.22, ankle: 0.05, headR: 0.125, torsoR: 0.105, limbR: 0.036, legR: 0.048, depth: 0.82 },
  elder: { hipY: 0.82, spine: 0.11, chest: 0.2, neck: 0.18, head: 0.07, shX: 0.17, shY: 0.16, upper: 0.25, fore: 0.235, hipX: 0.09, thigh: 0.39, shin: 0.37, ankle: 0.07, headR: 0.132, torsoR: 0.155, limbR: 0.047, legR: 0.066, depth: 0.82 },
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

// 形を作って、骨の位置へ置き、色のスロットと骨の番号を付ける
function part(geo, slot, bone, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}, at) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  _m.compose(_p.set(...p), _q.setFromEuler(_e.set(...r)), _s.set(...s));
  g.applyMatrix4(_m);
  if (at) g.translate(at.x, at.y, at.z);
  const n = g.attributes.position.count;
  const slots = new Float32Array(n).fill(slot);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    si[i * 4] = bone;
    sw[i * 4] = 1;
  }
  g.setAttribute('aSlot', new THREE.BufferAttribute(slots, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

const sph = (r, w = 14, h = 10, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest);

// 骨に沿って -Y 方向の回転体（両端は丸いふた）。prof: [[t, r], ...]
function lathe(len, prof, seg = 10) {
  const pts = [];
  const rAt = (t) => {
    for (let i = 0; i < prof.length - 1; i++) {
      const [t0, r0] = prof[i];
      const [t1, r1] = prof[i + 1];
      if (t >= t0 && t <= t1) {
        const k = (t - t0) / Math.max(1e-6, t1 - t0);
        return r0 + (r1 - r0) * k * k * (3 - 2 * k);
      }
    }
    return prof[prof.length - 1][1];
  };
  const rb = prof[prof.length - 1][1];
  const rt = prof[0][1];
  for (let i = 0; i <= 3; i++) {
    const a = (i / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, Math.sin(a) * rb), -len - Math.cos(a) * rb * 0.8));
  }
  for (let i = 1; i < 6; i++) {
    const t = 1 - i / 6;
    pts.push(new THREE.Vector2(rAt(t), -len * t));
  }
  for (let i = 0; i <= 3; i++) {
    const a = (i / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * rt), Math.sin(a) * rt * 0.8));
  }
  return new THREE.LatheGeometry(pts, seg);
}

// 骨の休みの位置（立った姿勢・腕は下）
function restPositions(B) {
  const P = {};
  P.hips = new THREE.Vector3(0, B.hipY, 0);
  P.spine = P.hips.clone().add(new THREE.Vector3(0, B.spine, 0));
  P.chest = P.spine.clone().add(new THREE.Vector3(0, B.chest * 0.45, 0));
  P.neck = P.chest.clone().add(new THREE.Vector3(0, B.neck, 0));
  P.head = P.neck.clone().add(new THREE.Vector3(0, B.head, 0));
  for (const [n, s] of [['L', 1], ['R', -1]]) {
    P[`shoulder${n}`] = P.chest.clone().add(new THREE.Vector3(s * B.shX, B.shY, -0.01));
    P[`elbow${n}`] = P[`shoulder${n}`].clone().add(new THREE.Vector3(0, -B.upper, 0));
    P[`hand${n}`] = P[`elbow${n}`].clone().add(new THREE.Vector3(0, -B.fore, 0));
    P[`hip${n}`] = P.hips.clone().add(new THREE.Vector3(s * B.hipX, -0.05, 0));
    P[`knee${n}`] = P[`hip${n}`].clone().add(new THREE.Vector3(0, -B.thigh, 0));
    P[`ankle${n}`] = P[`knee${n}`].clone().add(new THREE.Vector3(0, -B.shin, 0));
  }
  return P;
}

const geoCache = new Map();

// 形（体型・髪型・上着・下・小物）→ 結合したジオメトリ（キャッシュ）
export function figureGeometry(spec) {
  const key = JSON.stringify([spec.build, spec.hair, spec.top, spec.bottom, spec.extras ?? []]);
  if (geoCache.has(key)) return geoCache.get(key);
  const B = BUILDS[spec.build] ?? BUILDS.adult;
  const P = restPositions(B);
  const parts = [];
  const add = (geo, slot, bone, tr = {}) => parts.push(part(geo, slot, BONE[bone], tr, P[bone]));
  const ex = new Set(spec.extras ?? []);
  const top = spec.top ?? 'tshirt';
  const bottom = spec.bottom ?? 'pants';
  const longSleeve = ['long', 'blazer', 'hoodie', 'jacket', 'suit', 'coat', 'cardigan'].includes(top);
  const tr = B.torsoR;
  const dz = B.depth;

  // 腰
  add(sph(tr * 1.02, 14, 10), bottom === 'skirt' ? SLOT.BOTTOM : SLOT.BOTTOM, 'hips', { p: [0, -0.02, 0], s: [1, 0.85, dz] });
  // 胴（お腹 → 胸）
  const V2 = (arr) => arr.map(([x, y]) => new THREE.Vector2(x, y));
  const torso = new THREE.LatheGeometry(V2([[0.0001, -0.02], [tr * 0.92, 0.0], [tr * 0.94, B.spine * 0.6], [tr * 1.0, B.spine + B.chest * 0.45], [tr * 1.05, B.spine + B.chest * 0.9], [tr * 0.85, B.spine + B.chest * 1.25], [0.0001, B.spine + B.chest * 1.32]]), 14);
  add(torso, top === 'singlet' ? SLOT.TOP : SLOT.TOP, 'spine', { p: [0, -B.spine * 0.15, 0], s: [1, 1, dz] });
  if (top === 'singlet') {
    // ゼッケン（胸）
    add(new THREE.PlaneGeometry(tr * 1.1, tr * 0.8), SLOT.WHITE, 'chest', { p: [0, 0.03, tr * dz * 1.02 + 0.006] });
  }
  if (top === 'blazer' || top === 'suit') {
    // 胸元の V（シャツ）+ ネクタイ
    add(new THREE.PlaneGeometry(tr * 0.5, tr * 0.9), SLOT.ACC, 'chest', { p: [0, 0.09, tr * dz * 1.02 + 0.004] });
    if (top === 'suit') add(new THREE.BoxGeometry(0.03, tr * 0.8, 0.01), SLOT.ACC2, 'chest', { p: [0, 0.06, tr * dz * 1.04 + 0.006] });
  }
  if (top === 'jacket' || top === 'hoodie' || top === 'cardigan') {
    add(new THREE.BoxGeometry(0.014, B.chest + B.spine * 0.8, 0.01), SLOT.ACC, 'spine', { p: [0, B.spine * 0.7, tr * dz * 1.01] });
  }
  if (top === 'hoodie') add(sph(tr * 0.8, 12, 8), SLOT.TOP, 'chest', { p: [0, B.chest * 0.6, -tr * 0.75], s: [1, 0.7, 0.7] });
  if (ex.has('lanyard')) {
    add(new THREE.TorusGeometry(tr * 0.55, 0.006, 4, 16, Math.PI), SLOT.ACC2, 'chest', { p: [0, 0.2, tr * dz * 0.95], r: [0, 0, Math.PI] });
    add(new THREE.BoxGeometry(0.06, 0.08, 0.006), SLOT.WHITE, 'chest', { p: [0, -0.02, tr * dz * 1.08] });
  }
  if (ex.has('scarf')) add(new THREE.TorusGeometry(B.limbR * 1.6, 0.03, 6, 14), SLOT.ACC2, 'neck', { p: [0, 0.02, 0], r: [Math.PI / 2, 0, 0] });
  if (ex.has('bag')) add(new THREE.BoxGeometry(0.18, 0.2, 0.08), SLOT.ACC2, 'hips', { p: [tr * 1.1, 0.05, 0.02] });
  if (ex.has('flagCape')) add(new THREE.PlaneGeometry(0.5, 0.42), SLOT.ACC, 'chest', { p: [0, 0.0, -tr * dz - 0.02], r: [0, Math.PI, 0] });

  // 首・頭
  add(lathe(B.neck * 0.8, [[0, B.limbR * 0.95], [1, B.limbR * 1.0]], 10), SLOT.SKIN, 'neck', { p: [0, B.neck * 0.8, 0] });
  const hr = B.headR;
  const hc = hr * 0.92;
  add(sph(hr, 18, 14), SLOT.SKIN, 'head', { p: [0, hc, 0], s: [1, 0.98, 0.97] });
  // 耳
  for (const s of [1, -1]) add(sph(hr * 0.2, 6, 5), SLOT.SKIN, 'head', { p: [s * hr * 0.97, hc - 0.005, -0.005], s: [0.5, 1, 0.8] });
  // 顔の殻（表情アトラス）
  const face = sph(hr * 1.012, 16, 12, Math.PI / 2 - 0.95, 1.9, Math.PI / 2 - 0.85, 1.55);
  add(face, SLOT.FACE, 'head', { p: [0, hc, 0], s: [1, 0.98, 0.97] });
  // 髪
  const hair = spec.hair ?? 'short';
  const capFront = (len, tilt = -0.3) => add(sph(hr * 1.05, 18, 10, 0, Math.PI * 2, 0, len), SLOT.HAIR, 'head', { p: [0, hc + 0.004, -0.008], r: [tilt, 0, 0] });
  if (hair === 'short') capFront(Math.PI * 0.42);
  else if (hair === 'buzz') capFront(Math.PI * 0.36, -0.15);
  else if (hair === 'long' || hair === 'bob') {
    capFront(Math.PI * 0.45, -0.35);
    const l = hair === 'long' ? 0.24 : 0.12;
    add(new THREE.CylinderGeometry(hr * 1.02, hr * 1.08, l, 16, 1, true, Math.PI * 0.55, Math.PI * 0.9), SLOT.HAIR, 'head', { p: [0, hc - l * 0.45, -0.01], r: [0, Math.PI, 0] });
    add(new THREE.CircleGeometry(hr * 0.9, 12), SLOT.HAIR, 'head', { p: [0, hc - l * 0.35, -hr * 0.95], r: [0, Math.PI, 0] });
  } else if (hair === 'bun') {
    capFront(Math.PI * 0.44, -0.3);
    add(sph(hr * 0.42, 10, 8), SLOT.HAIR, 'head', { p: [0, hc + hr * 0.75, -hr * 0.55] });
  } else if (hair === 'pony') {
    capFront(Math.PI * 0.44, -0.3);
    add(new THREE.CapsuleGeometry(hr * 0.2, hr * 1.1, 4, 8), SLOT.HAIR, 'head', { p: [0, hc - hr * 0.2, -hr * 1.1], r: [0.35, 0, 0] });
  } else if (hair === 'bald') {
    add(sph(hr * 1.03, 18, 6, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.2), SLOT.HAIR, 'head', { p: [0, hc, 0] });
  } else if (hair === 'gray') capFront(Math.PI * 0.4);
  if (ex.has('cap')) {
    add(sph(hr * 1.08, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.36), SLOT.ACC, 'head', { p: [0, hc + 0.01, -0.005] });
    add(new THREE.CylinderGeometry(hr * 0.75, hr * 0.75, 0.012, 14, 1, false, -Math.PI / 2, Math.PI), SLOT.ACC, 'head', { p: [0, hc + hr * 0.42, hr * 0.62], r: [0.18, 0, 0], s: [1, 1, 1.1] });
  }
  if (ex.has('beanie')) add(sph(hr * 1.09, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), SLOT.ACC2, 'head', { p: [0, hc + 0.012, -0.004] });
  if (ex.has('glasses')) {
    for (const s of [1, -1]) add(new THREE.TorusGeometry(hr * 0.2, 0.006, 4, 12), SLOT.ACC2, 'head', { p: [s * hr * 0.33, hc + 0.004, hr * 0.97] });
  }
  if (ex.has('headset')) {
    add(new THREE.TorusGeometry(hr * 1.06, 0.01, 4, 16, Math.PI), SLOT.ACC2, 'head', { p: [0, hc, 0], r: [0, Math.PI / 2, 0] });
    add(sph(hr * 0.3, 8, 6), SLOT.ACC2, 'head', { p: [hr * 1.02, hc, 0], s: [0.5, 1, 1] });
  }

  // 腕（上腕・前腕・手）
  const sleeveSlot = longSleeve ? SLOT.TOP : SLOT.SKIN;
  for (const n of ['L', 'R']) {
    if (top === 'tshirt' || top === 'polo') add(lathe(B.upper * 0.45, [[0, B.limbR * 1.35], [1, B.limbR * 1.25]], 10), SLOT.TOP, `shoulder${n}`);
    add(lathe(B.upper, [[0, B.limbR * 1.1], [1, B.limbR * 0.95]], 10), longSleeve ? SLOT.TOP : SLOT.SKIN, `shoulder${n}`);
    add(lathe(B.fore, [[0, B.limbR * 0.98], [1, B.limbR * 0.82]], 10), sleeveSlot === SLOT.TOP && top !== 'tshirt' ? SLOT.TOP : SLOT.SKIN, `elbow${n}`);
    add(sph(B.limbR * 1.15, 10, 8), SLOT.SKIN, `hand${n}`, { p: [0, -B.limbR * 0.9, 0.005], s: [0.85, 1.25, 0.7] });
  }
  // 脚
  const pants = bottom === 'pants' || bottom === 'tights';
  for (const n of ['L', 'R']) {
    add(lathe(B.thigh, [[0, B.legR * 1.15], [1, B.legR * 0.92]], 10), bottom === 'shorts' ? SLOT.SKIN : SLOT.BOTTOM, `hip${n}`);
    if (bottom === 'shorts') add(lathe(B.thigh * 0.4, [[0, B.legR * 1.3], [1, B.legR * 1.2]], 10), SLOT.BOTTOM, `hip${n}`);
    add(lathe(B.shin, [[0, B.legR * 0.9], [1, B.legR * 0.72]], 10), pants ? SLOT.BOTTOM : SLOT.SKIN, `knee${n}`);
    const shoe = new THREE.CapsuleGeometry(B.legR * 0.78, B.legR * 1.6, 4, 8);
    shoe.rotateX(Math.PI / 2);
    add(shoe, SLOT.SHOE, `ankle${n}`, { p: [0, -B.ankle + B.legR * 0.7, B.legR * 0.9], s: [1, 0.85, 1] });
  }
  if (bottom === 'skirt') add(new THREE.CylinderGeometry(B.torsoR * 0.95, B.torsoR * 1.6, B.thigh * 0.75, 14, 1, true), SLOT.BOTTOM, 'hips', { p: [0, -B.thigh * 0.38, 0] });

  const geo = mergeGeometries(parts, false);
  geo.computeBoundingSphere();
  const out = { geo, B, P };
  geoCache.set(key, out);
  return out;
}

// 材質: パレット（9 色）+ 表情アトラス + リムライト。1 人ずつ別のインスタンス（プログラムは共有）
const PAL_N = 9;
function figureMaterial(colors) {
  const atlas = getFaceAtlas();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const u = {
    uPal: { value: colors.map((c) => new THREE.Color(c)) },
    uAtlas: { value: atlas },
    uExpr: { value: 0 },
    uRim: { value: 0.32 },
    uRimColor: { value: new THREE.Color(0xbfd2ff) },
    uGlow: { value: 0 },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSlot;\nvarying float vSlot;\nvarying vec2 vFUv;\nvarying vec3 vFView;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSlot = aSlot;\nvFUv = uv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFView = -mvPosition.xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uPal[${PAL_N}];
uniform sampler2D uAtlas;
uniform float uExpr;
uniform float uRim;
uniform vec3 uRimColor;
uniform float uGlow;
varying float vSlot;
varying vec2 vFUv;
varying vec3 vFView;`
      )
      .replace(
        '#include <color_fragment>',
        `{
          int si = int(vSlot + 0.5);
          vec3 c = uPal[0];
          for (int i = 0; i < ${PAL_N}; i++) if (i == si) c = uPal[i];
          if (si == 8) {
            float e = uExpr;
            vec2 cell = vec2(mod(e, 4.0), 3.0 - floor(e / 4.0));
            vec4 f = texture2D(uAtlas, (cell + clamp(vFUv, 0.01, 0.99)) / 4.0);
            c = mix(uPal[0], f.rgb, f.a);
          }
          diffuseColor.rgb *= c;
        }`
      )
      .replace(
        '#include <opaque_fragment>',
        `{ vec3 nv = normalize(vNormal);
           float fr = 1.0 - clamp(dot(nv, normalize(vFView)), 0.0, 1.0);
           outgoingLight += uRimColor * pow(fr, 2.4) * uRim + diffuseColor.rgb * uGlow; }
         #include <opaque_fragment>`
      );
    // vNormal は Lambert でも定義されている（flat でない時）
  };
  mat.customProgramCacheKey = () => 'pv-figure-v1';
  return mat;
}

// ---------------------------------------------------------------------------
// 2 ボーン IK（親の骨の座標系）: 肩 S から目標 T へ、肘を pole の側へ曲げる
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _w = new THREE.Vector3();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _rm = new THREE.Matrix4();
const _xAxis = new THREE.Vector3(1, 0, 0);

export function solveTwoBone(S, T, pole, L1, L2, qUpper, qLower) {
  _b.subVectors(T, S);
  let d = _b.length();
  d = Math.min((L1 + L2) * 0.999, Math.max(Math.abs(L1 - L2) + 0.01, d));
  const dir = _b.normalize();
  _c.subVectors(pole, S);
  _c.addScaledVector(dir, -_c.dot(dir));
  if (_c.lengthSq() < 1e-8) _c.set(0, 0, 1);
  _c.normalize();
  const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const E = _d.copy(S).addScaledVector(dir, L1 * Math.cos(A)).addScaledVector(_c, L1 * Math.sin(A));
  const Tc = _a.copy(S).addScaledVector(dir, d);
  _u.subVectors(E, S).normalize();
  _f.subVectors(Tc, E).normalize();
  _w.copy(_f).addScaledVector(_u, -_f.dot(_u));
  if (_w.lengthSq() < 1e-8) _w.copy(_c);
  _w.normalize();
  _Y.copy(_u).negate();
  _X.crossVectors(_Y, _w);
  _rm.makeBasis(_X, _Y, _w);
  qUpper.setFromRotationMatrix(_rm);
  const theta = Math.acos(Math.max(-1, Math.min(1, _u.dot(_f))));
  qLower.setFromAxisAngle(_xAxis, -theta);
}

// ---------------------------------------------------------------------------
const BONE_NAMES = Object.keys(BONE);
const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', elbowL: 'shoulderL', handL: 'elbowL', shoulderR: 'chest', elbowR: 'shoulderR', handR: 'elbowR',
  hipL: 'hips', kneeL: 'hipL', ankleL: 'kneeL', hipR: 'hips', kneeR: 'hipR', ankleR: 'kneeR',
};

// 見た目（色）: skin hair top bottom shoe acc acc2 white
export const SKINS = [0xf2c9a6, 0xe5b08a, 0xcf9670, 0x9a6444, 0x6e4430];
export const HAIRS = [0x1a1414, 0x3a2618, 0x6a4428, 0xb08850, 0x9a9a9e, 0xd8d8dc];

export class Figure {
  // spec: { build, hair, top, bottom, extras, colors: { skin, hair, top, bottom, shoe, acc, acc2 }, scale }
  constructor(spec) {
    this.spec = spec;
    const { geo, B, P } = figureGeometry(spec);
    this.B = B;
    const c = spec.colors ?? {};
    const colors = [c.skin ?? SKINS[0], c.hair ?? HAIRS[0], c.top ?? 0x3a5aa0, c.bottom ?? 0x2a2a34, c.shoe ?? 0x202024, c.acc ?? 0xffffff, c.acc2 ?? 0x303038, c.white ?? 0xf4f4f4, c.skin ?? SKINS[0]];
    this.material = figureMaterial(colors);
    this.u = this.material.userData.u;
    // 骨
    const bones = [];
    const byName = {};
    for (const n of BONE_NAMES) {
      const b = new THREE.Bone();
      b.name = n;
      const par = PARENT[n];
      if (par) b.position.copy(P[n]).sub(P[par]);
      else b.position.copy(P[n]);
      byName[n] = b;
      bones.push(b);
    }
    for (const n of BONE_NAMES) if (PARENT[n]) byName[PARENT[n]].add(byName[n]);
    this.bones = byName;
    const mesh = new THREE.SkinnedMesh(geo, this.material);
    mesh.add(byName.hips);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.frustumCulled = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, B.hipY, 0), 1.6);
    mesh.castShadow = false;
    this.mesh = mesh;
    this.root = new THREE.Group();
    this.root.add(mesh);
    const sc = spec.scale ?? 1;
    this.root.scale.setScalar(sc);
    this.rest = P;
    this.hipRest = B.hipY;
    // 腕の長さ（手の中心まで）
    this.L1 = B.upper;
    this.L2 = B.fore + B.limbR * 0.9;
    this.expr = 0;
    this.blinkT = 1 + Math.random() * 4;
    this.baseExpr = 0;
    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
  }

  setExpr(name) {
    this.baseExpr = typeof name === 'number' ? name : EXPR[name] ?? 0;
  }

  // まばたき（目を開けている表情の時だけ）
  updateFace(dt) {
    this.blinkT -= dt;
    let e = this.baseExpr;
    const canBlink = [0, 3, 6, 8, 9, 10, 11, 13, 14].includes(e);
    if (canBlink && this.blinkT < 0.13) e = EXPR.blink;
    if (this.blinkT <= 0) this.blinkT = 2 + Math.random() * 4;
    if (e !== this.expr) {
      this.expr = e;
      this.u.uExpr.value = e;
    }
  }

  // 腕の IK（胸の座標系の目標・肘の向きの手がかり）
  armIK(side, target, pole) {
    const B = this.bones;
    const sh = B[`shoulder${side}`];
    const S = sh.position;
    solveTwoBone(S, target, pole, this.L1, this.L2, this._qa, this._qb);
    sh.quaternion.copy(this._qa);
    B[`elbow${side}`].quaternion.copy(this._qb);
  }

  // 胸の座標系での肩の位置
  shoulderPos(side) {
    return this.bones[`shoulder${side}`].position;
  }

  headWorld(out = new THREE.Vector3()) {
    return this.bones.head.localToWorld(out.set(0, this.B.headR * 0.9, 0));
  }

  hipsWorld(out = new THREE.Vector3()) {
    return this.bones.hips.localToWorld(out.set(0, 0, 0));
  }
}
