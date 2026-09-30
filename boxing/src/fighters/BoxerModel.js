import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ボクサー（とレフェリー）の関節モデル。人間らしい体型・真剣な顔。変形や変顔で笑いを取らない。
//
//   骨: root（床）→ hips → spine → chest → neck → head / chest → 肩 → 上腕 → 前腕（→ グローブ）/ hips → 太腿 → 脛 → 足
//   骨ごとにパーツ（筋肉の輪郭の回転体・球）を 1 つのジオメトリに結合（頂点カラー）。なめらかな陰影、関節は丸いふたで重なる
//   腕と脚は 2 ボーン IK: グローブの目標点・足の置き場所を与えると肩・肘・膝が決まる（closed-chain-ik の考え方の最小版）
//
// 座標（モデルの中）: +Z = 前、+X = 本人の左、+Y = 上。root は足元。

export const DIM = {
  hipY: 0.97,
  spine: 0.1,
  chest: 0.22,
  neck: 0.25,
  head: 0.08,
  shoulderX: 0.205,
  shoulderY: 0.19,
  upper: 0.29,
  fore: 0.265,
  hipX: 0.1,
  thigh: 0.45,
  shin: 0.435,
  ankle: 0.085,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

function part(geo, color, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  _m.compose(_p.set(...p), _q.setFromEuler(_e.set(...r)), _s.set(...s));
  g.applyMatrix4(_m);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
// なめらかな曲面（分割を多めに・フラットにしない）
const cyl = (rt, rb, h, seg = 20) => new THREE.CylinderGeometry(rt, rb, h, seg, 1);
const sph = (r, w = 22, h = 16, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// 筋肉の形の回転体（骨に沿って -Y 方向・長さ len）。両端は丸いふた = 関節で隣の部位と丸く重なる（折れ目が見えない）
//   prof: [[t, r], ...]（t = 0 が付け根、1 が先端）
function lathe(len, prof, { seg = 20, capTop = true, capBottom = true } = {}) {
  const pts = [];
  const rAt = (t) => {
    for (let i = 0; i < prof.length - 1; i++) {
      const [t0, r0] = prof[i];
      const [t1, r1] = prof[i + 1];
      if (t >= t0 && t <= t1) {
        const k = (t - t0) / Math.max(1e-6, t1 - t0);
        const e = k * k * (3 - 2 * k);
        return r0 + (r1 - r0) * e;
      }
    }
    return prof[prof.length - 1][1];
  };
  const rb = prof[prof.length - 1][1];
  const rt = prof[0][1];
  // 先端のふた（下）
  if (capBottom) for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, Math.sin(a) * rb), -len - Math.cos(a) * rb * 0.85));
  }
  for (let i = 1; i < 14; i++) {
    const t = 1 - i / 14;
    pts.push(new THREE.Vector2(rAt(t), -len * t));
  }
  // 付け根のふた（上）
  if (capTop) for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * rt), Math.sin(a) * rt * 0.85));
  }
  return new THREE.LatheGeometry(pts, seg);
}

// 見た目の種類
export const LOOKS = {
  // 赤コーナー: 侍（シリーズの主人公）。後ろで結んだ黒髪・白い鉢巻・深紅のトランクスに金の帯
  samurai: { skin: 0xe2ad84, hair: 0x17131b, trunks: 0xa8182a, trunks2: 0x7a1020, band: 0xd8a33a, glove: 0xc3182e, boot: 0x18181e, sock: 0xf2f2f2, tape: 0xf4f1e8, style: 'topknot', headband: true },
  // 青コーナー: 王者。短い髪・青と白のトランクス
  champion: { skin: 0x9b6a4a, hair: 0x100c0c, trunks: 0x1d3fb5, trunks2: 0x122a80, band: 0xf2f2f2, glove: 0x1d3fb5, boot: 0xe8e8ee, sock: 0xe8e8ee, tape: 0xf4f1e8, style: 'buzz', headband: false },
  referee: { skin: 0xd9a47c, hair: 0x9a9aa0, shirt: 0xf4f4f6, pants: 0x121218, shoe: 0x0a0a0c, tie: 0x0a0a0c, style: 'short', official: true },
  // 撮影スタッフ（ハプニング用）: 黒い服・肩にカメラ
  staff: { skin: 0xc99672, hair: 0x2a1c14, shirt: 0x17171d, pants: 0x17171d, shoe: 0x0a0a0c, tie: 0x17171d, style: 'short', official: true, camera: true },
};

// 部位の形（筋肉の輪郭）
const PROF = {
  upper: [[0, 0.064], [0.22, 0.068], [0.5, 0.061], [0.82, 0.05], [1, 0.047]],
  fore: [[0, 0.05], [0.2, 0.055], [0.55, 0.046], [1, 0.037]],
  thigh: [[0, 0.098], [0.3, 0.092], [0.7, 0.074], [1, 0.062]],
  shin: [[0, 0.06], [0.22, 0.064], [0.55, 0.05], [1, 0.04]],
  sleeve: [[0, 0.075], [1, 0.07]],
  pantsT: [[0, 0.1], [1, 0.078]],
  pantsS: [[0, 0.078], [1, 0.064]],
};

export class BoxerModel {
  constructor(lookName = 'samurai') {
    this.look = LOOKS[lookName];
    this.official = !!this.look.official;
    this.root = new THREE.Group();
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.02 });
    this.bones = {};
    this.build();
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
  }

  bone(name, parent, pos) {
    const b = new THREE.Group();
    b.name = name;
    b.position.set(...pos);
    parent.add(b);
    this.bones[name] = b;
    return b;
  }

  mesh(bone, parts) {
    const m = new THREE.Mesh(mergeGeometries(parts, false), this.mat);
    bone.add(m);
    return m;
  }

  build() {
    const L = this.look;
    const D = DIM;
    const off = this.official;
    const skin = L.skin;
    const hips = this.bone('hips', this.root, [0, D.hipY, 0]);
    const spine = this.bone('spine', hips, [0, D.spine, 0]);
    const chest = this.bone('chest', spine, [0, D.chest, 0]);
    const neck = this.bone('neck', chest, [0, D.neck, 0]);
    const head = this.bone('head', neck, [0, D.head, 0.01]);

    // 腰（トランクス / ズボン）: 丸みのある回転体
    const lower = off ? L.pants : L.trunks;
    const trunks = new THREE.LatheGeometry(
      [[0.0001, -0.2], [0.14, -0.2], [0.178, -0.14], [0.186, -0.04], [0.176, 0.06], [0.168, 0.12], [0.0001, 0.13]].map(([x, y]) => new THREE.Vector2(x, y)),
      24
    );
    this.mesh(hips, [
      part(trunks, lower, { s: [1, 1, 0.76] }),
      part(cyl(0.171, 0.171, off ? 0.035 : 0.07, 24), off ? 0x050507 : L.band, { p: [0, 0.1, 0], s: [1, 1, 0.78] }),
      ...(off ? [] : [part(box(0.012, 0.2, 0.01), L.band, { p: [0.125, -0.05, 0.128] }), part(box(0.012, 0.2, 0.01), L.band, { p: [-0.125, -0.05, 0.128] })]),
    ]);
    // 腹（腰から胸へ細く → 太く）
    const torso = off ? L.shirt : skin;
    const abd = new THREE.LatheGeometry([[0.158, -0.02], [0.15, 0.08], [0.152, 0.16], [0.162, 0.24]].map(([x, y]) => new THREE.Vector2(x, y)), 24);
    this.mesh(spine, [part(abd, torso, { s: [1, 1, 0.7] })]);
    // 胸（逆三角形）+ 肩（三角筋）+ 僧帽筋
    const chestG = new THREE.LatheGeometry(
      [[0.158, -0.03], [0.18, 0.06], [0.205, 0.16], [0.198, 0.24], [0.15, 0.3], [0.07, 0.33], [0.0001, 0.335]].map(([x, y]) => new THREE.Vector2(x, y)),
      24
    );
    const chestParts = [part(chestG, torso, { s: [1, 1, 0.64] })];
    for (const side of [1, -1]) chestParts.push(part(sph(0.078), torso, { p: [side * 0.2, 0.19, -0.005], s: [1.05, 0.95, 1.05] }));
    chestParts.push(part(sph(0.1, 20, 12), torso, { p: [0, 0.27, -0.03], s: [1.5, 0.45, 0.8] }));
    if (!off) {
      const pec = new THREE.Color(skin).multiplyScalar(0.95).getHex();
      chestParts.push(part(sph(0.085), pec, { p: [0.072, 0.17, 0.08], s: [1.15, 0.78, 0.5] }));
      chestParts.push(part(sph(0.085), pec, { p: [-0.072, 0.17, 0.08], s: [1.15, 0.78, 0.5] }));
    } else {
      chestParts.push(part(box(0.05, 0.035, 0.02), L.tie, { p: [0, 0.28, 0.12] }));
    }
    this.mesh(chest, chestParts);
    this.mesh(neck, [part(lathe(0.12, [[0, 0.064], [1, 0.07]], { seg: 18 }), skin, { p: [0, 0.1, 0] })]);

    // 頭: 真剣な顔（眉はまっすぐ・口は結ぶ）
    const hp = [
      part(sph(0.104, 28, 20), skin, { p: [0, 0.1, 0], s: [0.95, 1.13, 1.06] }),
      part(sph(0.07, 20, 14), skin, { p: [0, 0.05, 0.03], s: [1.05, 0.8, 0.95] }),
      part(sph(0.025, 10, 8), skin, { p: [0.1, 0.1, -0.005], s: [0.5, 1, 0.8] }),
      part(sph(0.025, 10, 8), skin, { p: [-0.1, 0.1, -0.005], s: [0.5, 1, 0.8] }),
      part(sph(0.011, 8, 6), 0x120d10, { p: [0.037, 0.118, 0.1], s: [1.4, 0.8, 0.6] }),
      part(sph(0.011, 8, 6), 0x120d10, { p: [-0.037, 0.118, 0.1], s: [1.4, 0.8, 0.6] }),
      part(box(0.042, 0.011, 0.012), L.hair, { p: [0.04, 0.142, 0.099], r: [0, 0, -0.06] }),
      part(box(0.042, 0.011, 0.012), L.hair, { p: [-0.04, 0.142, 0.099], r: [0, 0, 0.06] }),
      part(sph(0.018, 10, 8), new THREE.Color(skin).multiplyScalar(0.92).getHex(), { p: [0, 0.088, 0.11], s: [0.9, 1.4, 1] }),
      part(box(0.038, 0.007, 0.01), 0x6a2a2a, { p: [0, 0.05, 0.098] }),
    ];
    if (L.style === 'topknot') {
      hp.push(part(sph(0.109, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), L.hair, { p: [0, 0.112, -0.004], s: [1, 1.12, 1.08] }));
      hp.push(part(sph(0.036, 14, 10), L.hair, { p: [0, 0.2, -0.085] }));
      hp.push(part(cyl(0.015, 0.02, 0.07, 10), L.hair, { p: [0, 0.2, -0.13], r: [1.2, 0, 0] }));
    } else if (L.style === 'buzz') {
      hp.push(part(sph(0.107, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.48), L.hair, { p: [0, 0.11, -0.002], s: [1, 1.1, 1.07] }));
    } else {
      hp.push(part(sph(0.108, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), L.hair, { p: [0, 0.112, -0.012], s: [1, 1.1, 1.06] }));
    }
    if (L.headband) {
      hp.push(part(cyl(0.113, 0.113, 0.03, 28), 0xf6f4ee, { p: [0, 0.155, 0.002], s: [0.97, 1, 1.08] }));
      hp.push(part(box(0.025, 0.12, 0.012), 0xf6f4ee, { p: [0.02, 0.1, -0.12], r: [0.3, 0, 0.25] }));
      hp.push(part(box(0.025, 0.1, 0.012), 0xf6f4ee, { p: [-0.02, 0.1, -0.12], r: [0.35, 0, -0.2] }));
      hp.push(part(sph(0.015, 10, 8), 0xc3182e, { p: [0, 0.16, 0.112] }));
    }
    this.mesh(head, hp);

    // 腕（上腕・前腕とも両端が丸い = 肘で丸く重なる）
    for (const side of [1, -1]) {
      const n = side > 0 ? 'L' : 'R';
      const sh = this.bone(`shoulder${n}`, chest, [side * D.shoulderX, D.shoulderY, -0.01]);
      const up = this.bone(`upper${n}`, sh, [0, 0, 0]);
      const fore = this.bone(`fore${n}`, up, [0, -D.upper, 0]);
      const hand = this.bone(`hand${n}`, fore, [0, -D.fore, 0]);
      if (off) {
        this.mesh(up, [part(lathe(0.13, PROF.sleeve), L.shirt, {}), part(lathe(D.upper, PROF.upper), skin, { s: [0.92, 1, 0.92] })]);
        this.mesh(fore, [part(lathe(D.fore, PROF.fore), skin, {})]);
        this.mesh(hand, [part(sph(0.045, 14, 10), skin, { p: [0, -0.04, 0], s: [0.8, 1.2, 0.6] })]);
      } else {
        this.mesh(up, [part(lathe(D.upper, PROF.upper), skin, {})]);
        this.mesh(fore, [part(lathe(D.fore, PROF.fore), skin, {}), part(cyl(0.044, 0.044, 0.05, 18), L.tape, { p: [0, -D.fore + 0.03, 0] })]);
        // グローブ: 拳（丸み）+ 親指 + 袖口 + 白いライン
        this.mesh(hand, [
          part(sph(0.1, 26, 18), L.glove, { p: [0, -0.07, 0.012], s: [0.96, 1.18, 1.06] }),
          part(sph(0.042, 14, 10), L.glove, { p: [side * -0.07, -0.05, 0.05], s: [0.9, 1.3, 0.9] }),
          part(cyl(0.06, 0.068, 0.11, 22), L.glove, { p: [0, 0.04, 0] }),
          part(cyl(0.069, 0.069, 0.02, 22), 0xf2f2f2, { p: [0, 0.07, 0] }),
        ]);
      }
    }
    // 撮影スタッフ: 右肩にカメラ
    if (L.camera) {
      this.mesh(chest, [
        part(box(0.2, 0.22, 0.46), 0x6a6e7a, { p: [-0.22, 0.38, 0.06] }),
        part(cyl(0.075, 0.08, 0.16, 18), 0x14141a, { p: [-0.22, 0.38, 0.36], r: [Math.PI / 2, 0, 0] }),
        part(cyl(0.082, 0.082, 0.02, 18), 0xd8dbe2, { p: [-0.22, 0.38, 0.44], r: [Math.PI / 2, 0, 0] }),
        part(box(0.05, 0.05, 0.3), 0x2a2c34, { p: [-0.22, 0.52, 0.04] }),
        part(sph(0.022, 10, 8), 0xff2030, { p: [-0.12, 0.47, 0.25] }),
      ]);
    }
    // 脚（太腿・脛とも両端が丸い = 膝で丸く重なる）
    for (const side of [1, -1]) {
      const n = side > 0 ? 'L' : 'R';
      const th = this.bone(`thigh${n}`, hips, [side * D.hipX, -0.05, 0]);
      const sh = this.bone(`shin${n}`, th, [0, -D.thigh, 0]);
      const ft = this.bone(`foot${n}`, sh, [0, -D.shin, 0]);
      const foot = new THREE.CapsuleGeometry(0.048, 0.16, 6, 14);
      foot.rotateX(Math.PI / 2);
      if (off) {
        this.mesh(th, [part(lathe(D.thigh, PROF.pantsT), L.pants, {})]);
        this.mesh(sh, [part(lathe(D.shin, PROF.pantsS), L.pants, {})]);
        this.mesh(ft, [part(foot, L.shoe, { p: [0, -D.ankle + 0.045, 0.05], s: [1.05, 0.85, 1] })]);
      } else {
        this.mesh(th, [part(lathe(0.2, [[0, 0.104], [1, 0.096]], { capBottom: false }), L.trunks, {}), part(lathe(D.thigh, PROF.thigh), L.skin, {}), part(box(0.012, 0.18, 0.01), L.band, { p: [side * 0.1, -0.1, 0] })]);
        this.mesh(sh, [part(lathe(D.shin, PROF.shin), L.skin, {}), part(cyl(0.052, 0.052, 0.07, 20), L.sock, { p: [0, -D.shin + 0.2, 0] }), part(cyl(0.06, 0.054, 0.17, 20), L.boot, { p: [0, -D.shin + 0.08, 0] })]);
        this.mesh(ft, [part(foot, L.boot, { p: [0, -D.ankle + 0.048, 0.05], s: [1.05, 0.9, 1] }), part(box(0.1, 0.014, 0.25), 0xf2f2f2, { p: [0, -D.ankle + 0.007, 0.05] })]);
      }
    }
  }

  // ------------------------------------------------------------------
  // 2 ボーン IK（ワールド座標）: 肩（股関節）の位置 S、目標 T、曲げる向きの手がかり pole
  // 上腕（太腿）の -Y を S→E、前腕（脛）の -Y を E→T に向け、曲げは +Z 側
  solve(upper, lower, L1, L2, T, pole) {
    upper.parent.updateWorldMatrix(true, false);
    upper.getWorldPosition(_a);
    const S = _a;
    _b.subVectors(T, S);
    let d = _b.length();
    const maxR = (L1 + L2) * 0.999;
    const minR = Math.abs(L1 - L2) + 0.02;
    d = Math.min(maxR, Math.max(minR, d));
    const dir = _b.normalize();
    // 肘（膝）の位置
    _c.subVectors(pole, S);
    _c.addScaledVector(dir, -_c.dot(dir));
    if (_c.lengthSq() < 1e-8) _c.set(0, 0, 1);
    _c.normalize();
    const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const E = _d.copy(S).addScaledVector(dir, L1 * Math.cos(A)).addScaledVector(_c, L1 * Math.sin(A));
    const Tc = _p.copy(S).addScaledVector(dir, d);
    // 上腕の向き
    const u = _y.subVectors(E, S).normalize(); // 骨の -Y
    const f = _z.subVectors(Tc, E).normalize();
    // 曲げる向き w = f の u に垂直な成分
    const w = _x.copy(f).addScaledVector(u, -f.dot(u));
    if (w.lengthSq() < 1e-8) w.copy(_c);
    w.normalize();
    // ワールド回転: Y = -u, Z = w, X = Y × Z
    const Y = _s.copy(u).negate();
    const X = new THREE.Vector3().crossVectors(Y, w);
    _m.makeBasis(X, Y, w);
    _q.setFromRotationMatrix(_m);
    upper.parent.getWorldQuaternion(_q2);
    upper.quaternion.copy(_q2.invert().multiply(_q));
    // 前腕: +Z 側へ θ 曲げる（rotX(-θ)）
    const theta = Math.acos(Math.max(-1, Math.min(1, u.dot(f))));
    lower.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -theta);
  }

  // ------------------------------------------------------------------
  // ポーズを当てる。pose はモデルの中の座標（root 基準）:
  //   { x, z, yaw, hipY, hipX, hipZ, hipRot:[x,y,z], spine:[x,y,z], chest:[x,y,z], head:[x,y,z],
  //     gloveL:[x,y,z], gloveR:[x,y,z], elbowL:[x,y,z], elbowR:[x,y,z], footL:[x,y,z], footR:[x,y,z], heelR, heelL }
  apply(pose) {
    const B = this.bones;
    const r = this.root;
    r.position.set(pose.x, pose.y ?? 0, pose.z);
    r.rotation.set(0, pose.yaw, 0);
    B.hips.position.set(pose.hipX ?? 0, pose.hipY ?? DIM.hipY, pose.hipZ ?? 0);
    B.hips.rotation.set(...(pose.hipRot ?? [0, 0, 0]));
    B.spine.rotation.set(...(pose.spine ?? [0, 0, 0]));
    B.chest.rotation.set(...(pose.chest ?? [0, 0, 0]));
    B.neck.rotation.set(0, 0, 0);
    B.head.rotation.set(...(pose.head ?? [0, 0, 0]));
    r.updateMatrixWorld(true);
    const toW = (v, out) => out.set(v[0], v[1], v[2]).applyMatrix4(r.matrixWorld);
    const T = new THREE.Vector3();
    const P = new THREE.Vector3();
    // 脚（足首の位置 = 足の置き場所 + 足首の高さ）
    for (const n of ['L', 'R']) {
      const f = pose[`foot${n}`];
      const kneePole = pose[`knee${n}`] ?? [f[0] * 1.2, 0.6, f[2] + 0.6];
      toW([f[0], f[1] + DIM.ankle, f[2]], T);
      toW(kneePole, P);
      this.solve(B[`thigh${n}`], B[`shin${n}`], DIM.thigh, DIM.shin, T, P);
      // 足: 体の向きにそろえて水平（かかとを上げる時は少し前へ傾く）
      B[`shin${n}`].updateWorldMatrix(true, false);
      _q.setFromEuler(_e.set(pose[`heel${n}`] ?? 0, pose.yaw + (pose[`toe${n}`] ?? 0), 0, 'YXZ'));
      B[`shin${n}`].getWorldQuaternion(_q2);
      B[`foot${n}`].quaternion.copy(_q2.invert().multiply(_q));
    }
    // 腕
    for (const n of ['L', 'R']) {
      const g = pose[`glove${n}`];
      const side = n === 'L' ? 1 : -1;
      const pole = pose[`elbow${n}`] ?? [side * 0.5, 0.9, -0.3];
      toW(g, T);
      toW(pole, P);
      this.solve(B[`upper${n}`], B[`fore${n}`], DIM.upper, DIM.fore + 0.05, T, P);
      // 拳（グローブ）は前腕の向き + 少しひねり
      B[`hand${n}`].rotation.set(0, 0, 0);
    }
  }

  // 目標点（モデルの中の座標）→ ワールド
  headWorld(out = new THREE.Vector3()) {
    return this.bones.head.getWorldPosition(out).add(_p.set(0, 0.1, 0));
  }

  gloveWorld(n, out = new THREE.Vector3()) {
    return this.bones[`hand${n}`].localToWorld(out.set(0, -0.07, 0.01));
  }
}
