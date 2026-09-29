import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// コード生成のキャラクター（外部 3D モデルなし）。
// 23 本の骨（Skeleton）+ 骨ごとに剛体で結びつけたパーツを 1 つの SkinnedMesh に結合 → 1 人 1 draw call。
// 骨: root / pelvis / spine / chest / neck / head / upperArm.L,R / lowerArm.L,R / hand.L,R /
//     upperLeg.L,R / lowerLeg.L,R / foot.L,R / topknot / bandTail1 / bandTail2 / haori / sword
// 基準姿勢（バインドポーズ）は腕を下ろした直立。前方 = -Z。

export const LEG = { thigh: 0.44, shin: 0.42, ankle: 0.075, hipX: 0.1 };
export const ARM = { upper: 0.29, lower: 0.26 };

const BONES = [
  ['root', null, [0, 0, 0]],
  ['pelvis', 'root', [0, 0.95, 0]],
  ['spine', 'pelvis', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.15, 0]],
  ['neck', 'chest', [0, 0.28, 0]],
  ['head', 'neck', [0, 0.08, 0]],
  ['topknot', 'head', [0, 0.215, 0.05]],
  ['bandTail1', 'head', [0, 0.15, 0.14]],
  ['bandTail2', 'bandTail1', [0, -0.17, 0]],
  ['upperArm.L', 'chest', [-0.205, 0.235, 0]],
  ['lowerArm.L', 'upperArm.L', [0, -ARM.upper, 0]],
  ['hand.L', 'lowerArm.L', [0, -ARM.lower, 0]],
  ['upperArm.R', 'chest', [0.205, 0.235, 0]],
  ['lowerArm.R', 'upperArm.R', [0, -ARM.upper, 0]],
  ['hand.R', 'lowerArm.R', [0, -ARM.lower, 0]],
  ['haori', 'chest', [0, 0.24, 0.125]],
  ['upperLeg.L', 'pelvis', [-LEG.hipX, -0.04, 0]],
  ['lowerLeg.L', 'upperLeg.L', [0, -LEG.thigh, 0]],
  ['foot.L', 'lowerLeg.L', [0, -LEG.shin, 0]],
  ['upperLeg.R', 'pelvis', [LEG.hipX, -0.04, 0]],
  ['lowerLeg.R', 'upperLeg.R', [0, -LEG.thigh, 0]],
  ['foot.R', 'lowerLeg.R', [0, -LEG.shin, 0]],
  ['sword', 'pelvis', [-0.2, 0.09, -0.02]],
];

export function createSkeleton() {
  const bones = {};
  const list = [];
  for (const [name, parent, pos] of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...pos);
    bones[name] = b;
    list.push(b);
    if (parent) bones[parent].add(b);
  }
  bones.root.updateMatrixWorld(true);
  // バインド時の各骨のモデル空間での位置
  const bindPos = {};
  for (const b of list) bindPos[b.name] = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  return { bones, list, index: Object.fromEntries(list.map((b, i) => [b.name, i])), bindPos };
}

// ---- パーツ作り（モデル空間で配置して、骨に剛体で結ぶ）
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class PartBuilder {
  constructor(skel) {
    this.skel = skel;
    this.parts = [];
  }

  // bone: 骨の名前 / at: 骨の位置からのずれ / r: 回転 / s: 拡大
  add(geo, bone, color, { at = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    const base = this.skel.bindPos[bone];
    _m.compose(_p.set(base.x + at[0], base.y + at[1], base.z + at[2]), _q.setFromEuler(_e.set(...r)), _s.set(...s));
    g.applyMatrix4(_m);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const bi = this.skel.index[bone];
    for (let i = 0; i < n; i++) {
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this.parts.push(g);
    return this;
  }

  // 骨 a から骨 b へ伸びる手足（テーパー付き円柱）。bone に結ぶ
  limb(bone, len, r0, r1, color, seg = 8, offset = [0, 0, 0]) {
    const geo = new THREE.CylinderGeometry(r0, r1, len, seg, 1).translate(0, -len / 2, 0);
    return this.add(geo, bone, color, { at: offset });
  }

  build() {
    const geo = mergeGeometries(this.parts, false);
    geo.computeBoundingSphere();
    geo.boundingSphere.radius = 2.5;
    return geo;
  }
}

// 共通の形
export const G = {
  cyl: (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open),
  sph: (r, w = 10, h = 8, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest),
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  cap: (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 3, seg),
};
