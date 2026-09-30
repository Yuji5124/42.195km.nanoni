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

// 見た目の種類（ソフビ人形のような、丸くてかわいい体つき。表情は真剣）
export const LOOKS = {
  // 赤コーナー: 侍（シリーズの主人公）。後ろで結んだ黒髪・白い鉢巻・深紅のトランクスに金の帯
  samurai: { skin: 0xf0c09a, cheek: 0xf28a86, hair: 0x1e1822, trunks: 0xd0283c, band: 0xf2c14e, glove: 0xe8323f, glove2: 0xffffff, boot: 0x26222e, sole: 0xf2f2f2, lace: 0xf2c14e, tape: 0xfaf6ee, iris: 0x2a1c18, style: 'topknot', headband: true },
  // 青コーナー: 王者。短い髪・青と白のトランクス
  champion: { skin: 0xa8734f, cheek: 0xd9776a, hair: 0x15100f, trunks: 0x2f5ee8, band: 0xf4f4f8, glove: 0x2f5ee8, glove2: 0xffffff, boot: 0xf2f2f6, sole: 0x2f5ee8, lace: 0x2f5ee8, tape: 0xfaf6ee, iris: 0x1a1210, style: 'buzz', headband: false },
  referee: { skin: 0xe8b894, cheek: 0xef9a8e, hair: 0x7c7c86, shirt: 0xf6f6f8, pants: 0x1c1c24, shoe: 0x121218, sole: 0x2a2a30, tie: 0x121218, iris: 0x2a2020, style: 'short', official: true },
  // 撮影スタッフ（ハプニング用）: 黒い服・肩にカメラ
  staff: { skin: 0xd8a47e, cheek: 0xe58f82, hair: 0x2e2018, shirt: 0x22222a, pants: 0x22222a, shoe: 0x121218, sole: 0x3a3a42, tie: 0x22222a, iris: 0x2a1c14, style: 'short', official: true, camera: true },
};

// 部位の形（やわらかい円すい。筋肉のでこぼこは付けない = おもちゃのようになめらか）
const PROF = {
  upper: [[0, 0.066], [0.5, 0.062], [1, 0.054]],
  fore: [[0, 0.056], [1, 0.049]],
  thigh: [[0, 0.104], [0.5, 0.092], [1, 0.076]],
  shin: [[0, 0.074], [0.4, 0.07], [1, 0.058]],
  sleeve: [[0, 0.08], [1, 0.076]],
  pantsT: [[0, 0.108], [1, 0.084]],
  pantsS: [[0, 0.084], [1, 0.07]],
};

const HEAD_R = 0.148; // 頭は大きめ（約 5.5 頭身）
const HEAD_Y = 0.12; // 頭の中心（head 骨から上へ）

// 輪郭線（背面を法線方向へ少しふくらませた黒い殻）と、ふちの光（リムライト）
function outlineMaterial(color = 0x1b1428, width = 0.0075) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize(normal) * ${width.toFixed(4)};`);
  };
  return m;
}
function softMaterial(rim = 0.28) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `{ float fr = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
         outgoingLight += vec3(0.85, 0.9, 1.0) * pow(fr, 2.6) * ${rim.toFixed(3)}; }
       #include <opaque_fragment>`
    );
  };
  return m;
}

export class BoxerModel {
  constructor(lookName = 'samurai') {
    this.look = LOOKS[lookName];
    this.official = !!this.look.official;
    this.root = new THREE.Group();
    this.mat = softMaterial();
    this.outlineMat = outlineMaterial();
    this.bones = {};
    this.outlines = [];
    this.build();
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !o.userData.outline && !o.userData.noShadow;
        o.receiveShadow = false;
      }
    });
    this.blinkT = 2 + Math.random() * 3;
  }

  bone(name, parent, pos) {
    const b = new THREE.Group();
    b.name = name;
    b.position.set(...pos);
    parent.add(b);
    this.bones[name] = b;
    return b;
  }

  mesh(bone, parts, { outline = true } = {}) {
    const geo = mergeGeometries(parts, false);
    const m = new THREE.Mesh(geo, this.mat);
    bone.add(m);
    if (outline) {
      const o = new THREE.Mesh(geo, this.outlineMat);
      o.userData.outline = true;
      bone.add(o);
      this.outlines.push(o);
    }
    return m;
  }

  // 半透明（正面固定カウンターの自分）: 輪郭線は消す
  setGhost(on) {
    const m = this.mat;
    m.transparent = on;
    m.opacity = on ? 0.22 : 1;
    m.depthWrite = !on;
    m.needsUpdate = true;
    for (const o of this.outlines) o.visible = !on;
  }

  // まばたき（数秒に 1 回）
  updateBlink(dt) {
    if (!this.eyes) return;
    this.blinkT -= dt;
    let k = 1;
    if (this.blinkT < 0.12) k = Math.abs(this.blinkT - 0.06) / 0.06;
    if (this.blinkT <= 0) this.blinkT = 2.2 + Math.random() * 3.5;
    this.eyes.scale.y = Math.max(0.08, Math.min(1, k));
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
    const V2 = (arr) => arr.map(([x, y]) => new THREE.Vector2(x, y));

    // 腰（トランクス / ズボン）: 丸くふくらんだ回転体
    const lower = off ? L.pants : L.trunks;
    const trunks = new THREE.LatheGeometry(V2([[0.0001, -0.21], [0.13, -0.205], [0.186, -0.15], [0.196, -0.05], [0.186, 0.06], [0.176, 0.12], [0.0001, 0.13]]), 32);
    this.mesh(hips, [
      part(trunks, lower, { s: [1, 1, 0.8] }),
      part(new THREE.TorusGeometry(0.176, 0.028, 12, 36), off ? 0x0c0c10 : L.band, { p: [0, 0.1, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.8, 1] }),
    ]);
    // 腹・胸: まるい樽のような胴（逆三角形はゆるやかに）
    const torso = off ? L.shirt : skin;
    const abd = new THREE.LatheGeometry(V2([[0.17, -0.02], [0.162, 0.08], [0.165, 0.16], [0.176, 0.24]]), 32);
    this.mesh(spine, [part(abd, torso, { s: [1, 1, 0.8] })]);
    const chestG = new THREE.LatheGeometry(V2([[0.172, -0.03], [0.186, 0.06], [0.194, 0.15], [0.186, 0.23], [0.15, 0.29], [0.08, 0.325], [0.0001, 0.332]]), 32);
    const chestParts = [part(chestG, torso, { s: [1, 1, 0.76] })];
    for (const side of [1, -1]) chestParts.push(part(sph(0.082, 24, 18), torso, { p: [side * 0.198, 0.19, -0.005] }));
    if (off) {
      // 蝶ネクタイ
      chestParts.push(part(sph(0.03, 12, 10), L.tie, { p: [0.03, 0.29, 0.1], s: [1.3, 0.8, 0.6] }));
      chestParts.push(part(sph(0.03, 12, 10), L.tie, { p: [-0.03, 0.29, 0.1], s: [1.3, 0.8, 0.6] }));
      chestParts.push(part(sph(0.016, 10, 8), L.tie, { p: [0, 0.29, 0.11] }));
    }
    this.mesh(chest, chestParts);
    this.mesh(neck, [part(lathe(0.1, [[0, 0.066], [1, 0.07]], { seg: 24 }), skin, { p: [0, 0.08, 0] })]);

    // 頭: 大きくて丸い顔。眉はまっすぐ（真剣）・口は結ぶ・ほっぺは少し赤い
    const hy = HEAD_Y;
    const hp = [
      part(sph(HEAD_R, 40, 30), skin, { p: [0, hy, 0], s: [1, 0.98, 0.97] }),
      part(sph(0.03, 14, 10), skin, { p: [HEAD_R * 0.97, hy, -0.01], s: [0.5, 1, 0.8] }),
      part(sph(0.03, 14, 10), skin, { p: [-HEAD_R * 0.97, hy, -0.01], s: [0.5, 1, 0.8] }),
      part(sph(0.016, 12, 10), new THREE.Color(skin).multiplyScalar(0.94).getHex(), { p: [0, hy - 0.01, HEAD_R * 0.97], s: [1.1, 0.9, 0.8] }),
      part(sph(0.03, 16, 12), L.cheek, { p: [0.082, hy - 0.035, 0.118], s: [1.1, 0.6, 0.35] }),
      part(sph(0.03, 16, 12), L.cheek, { p: [-0.082, hy - 0.035, 0.118], s: [1.1, 0.6, 0.35] }),
      part(new THREE.CapsuleGeometry(0.004, 0.026, 4, 8), 0x6a3030, { p: [0, hy - 0.058, HEAD_R * 0.9], r: [0, 0, Math.PI / 2] }),
    ];
    // 眉（まっすぐ・少し内側が下がる = 集中している顔）
    for (const side of [1, -1]) hp.push(part(new THREE.CapsuleGeometry(0.009, 0.034, 4, 8), L.hair, { p: [side * 0.052, hy + 0.058, HEAD_R * 0.9], r: [0, 0, Math.PI / 2 + side * 0.18] }));
    if (L.style === 'topknot') {
      hp.push(part(sph(HEAD_R * 1.04, 40, 22, 0, Math.PI * 2, 0, Math.PI * 0.5), L.hair, { p: [0, hy + 0.008, -0.006], s: [1, 1, 1.02] }));
      hp.push(part(sph(0.052, 20, 16), L.hair, { p: [0, hy + 0.15, -0.07] }));
      hp.push(part(new THREE.CapsuleGeometry(0.02, 0.06, 6, 12), L.hair, { p: [0, hy + 0.17, -0.13], r: [1.3, 0, 0] }));
    } else if (L.style === 'buzz') {
      hp.push(part(sph(HEAD_R * 1.025, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.46), L.hair, { p: [0, hy + 0.004, -0.004] }));
    } else {
      hp.push(part(sph(HEAD_R * 1.03, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.4), L.hair, { p: [0, hy + 0.006, -0.02] }));
      for (const side of [1, -1]) hp.push(part(sph(0.05, 16, 12), L.hair, { p: [side * 0.12, hy + 0.02, -0.05], s: [0.6, 1, 1] }));
    }
    if (L.headband) {
      hp.push(part(new THREE.TorusGeometry(HEAD_R * 1.02, 0.017, 10, 48), 0xfbf8f0, { p: [0, hy + 0.06, 0.004], r: [Math.PI / 2 - 0.12, 0, 0] }));
      hp.push(part(new THREE.CapsuleGeometry(0.014, 0.1, 4, 8), 0xfbf8f0, { p: [0.03, hy + 0.0, -0.16], r: [0.4, 0, 0.35] }));
      hp.push(part(new THREE.CapsuleGeometry(0.014, 0.08, 4, 8), 0xfbf8f0, { p: [-0.03, hy + 0.01, -0.16], r: [0.45, 0, -0.3] }));
      hp.push(part(sph(0.02, 12, 10), 0xd0283c, { p: [0, hy + 0.078, HEAD_R * 1.0] }));
    }
    this.mesh(head, hp);
    // 目（別のメッシュ = まばたきできる）: 白目 + 黒目 + ハイライト
    const eyes = new THREE.Group();
    eyes.position.set(0, hy + 0.012, 0);
    head.add(eyes);
    const ep = [];
    for (const side of [1, -1]) {
      const x = side * 0.052;
      const z = Math.sqrt(HEAD_R * HEAD_R - x * x) * 0.965;
      ep.push(part(sph(0.03, 18, 14), 0xffffff, { p: [x, 0, z - 0.012], s: [0.9, 1.15, 0.5] }));
      ep.push(part(sph(0.021, 16, 12), L.iris, { p: [x - side * 0.002, -0.002, z - 0.002], s: [0.9, 1.15, 0.45] }));
      ep.push(part(sph(0.0065, 8, 6), 0xffffff, { p: [x + 0.008, 0.01, z + 0.006] }));
    }
    const eyeMesh = new THREE.Mesh(mergeGeometries(ep, false), this.mat);
    eyeMesh.userData.noShadow = true;
    eyes.add(eyeMesh);
    this.eyes = eyes;

    // 腕（上腕・前腕とも両端が丸い = 肘で丸く重なる）
    for (const side of [1, -1]) {
      const n = side > 0 ? 'L' : 'R';
      const sh = this.bone(`shoulder${n}`, chest, [side * D.shoulderX, D.shoulderY, -0.01]);
      const up = this.bone(`upper${n}`, sh, [0, 0, 0]);
      const fore = this.bone(`fore${n}`, up, [0, -D.upper, 0]);
      const hand = this.bone(`hand${n}`, fore, [0, -D.fore, 0]);
      if (off) {
        this.mesh(up, [part(lathe(0.14, PROF.sleeve, { seg: 24 }), L.shirt, {}), part(lathe(D.upper, PROF.upper, { seg: 24 }), skin, { s: [0.9, 1, 0.9] })]);
        this.mesh(fore, [part(lathe(D.fore, PROF.fore, { seg: 24 }), skin, {})]);
        // 手: 丸いミトン + 親指
        this.mesh(hand, [
          part(sph(0.052, 20, 16), skin, { p: [0, -0.045, 0.004], s: [0.95, 1.2, 0.72] }),
          part(new THREE.CapsuleGeometry(0.017, 0.03, 6, 10), skin, { p: [side * -0.045, -0.03, 0.02], r: [0, 0, side * 0.6] }),
        ]);
      } else {
        this.mesh(up, [part(lathe(D.upper, PROF.upper, { seg: 24 }), skin, {})]);
        this.mesh(fore, [part(lathe(D.fore, PROF.fore, { seg: 24 }), skin, {}), part(cyl(0.052, 0.052, 0.05, 24), L.tape, { p: [0, -D.fore + 0.03, 0] })]);
        // グローブ: ふっくらした拳 + 拳の前のふくらみ + 横にそった親指 + 袖口（白い帯）
        this.mesh(hand, [
          part(sph(0.118, 32, 24), L.glove, { p: [0, -0.085, 0.012], s: [0.98, 1.12, 1.06] }),
          part(sph(0.09, 28, 20), L.glove, { p: [0, -0.125, 0.045], s: [1.08, 0.8, 0.95] }),
          part(new THREE.CapsuleGeometry(0.038, 0.07, 8, 16), L.glove, { p: [side * -0.088, -0.07, 0.05], r: [0.25, 0, side * 0.35] }),
          part(lathe(0.12, [[0, 0.084], [1, 0.074]], { seg: 28, capTop: false }), L.glove, { p: [0, 0.07, 0] }),
          part(new THREE.TorusGeometry(0.08, 0.012, 10, 32), L.glove2, { p: [0, 0.03, 0], r: [Math.PI / 2, 0, 0] }),
          part(sph(0.028, 16, 12), L.glove2, { p: [0, -0.07, -0.108], s: [1, 1, 0.3] }),
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
    // 脚（太腿・脛とも両端が丸い = 膝で丸く重なる）+ まるいブーツ
    for (const side of [1, -1]) {
      const n = side > 0 ? 'L' : 'R';
      const th = this.bone(`thigh${n}`, hips, [side * D.hipX, -0.05, 0]);
      const sh = this.bone(`shin${n}`, th, [0, -D.thigh, 0]);
      const ft = this.bone(`foot${n}`, sh, [0, -D.shin, 0]);
      // 足: つま先の丸いカプセル + 靴底
      const toe = new THREE.CapsuleGeometry(0.058, 0.15, 8, 20);
      toe.rotateX(Math.PI / 2);
      const sole = new THREE.CapsuleGeometry(0.06, 0.16, 6, 20);
      sole.rotateX(Math.PI / 2);
      const shoe = off ? L.shoe : L.boot;
      const footParts = [part(toe, shoe, { p: [0, -D.ankle + 0.058, 0.06], s: [1.02, 0.92, 1] }), part(sole, L.sole, { p: [0, -D.ankle + 0.016, 0.06], s: [1.06, 0.3, 1.04] })];
      if (!off) for (let k = 0; k < 3; k++) footParts.push(part(new THREE.CapsuleGeometry(0.006, 0.05, 4, 8), L.lace, { p: [0, -D.ankle + 0.105 - k * 0.012, 0.1 - k * 0.028], r: [0, 0, Math.PI / 2] }));
      if (off) {
        this.mesh(th, [part(lathe(D.thigh, PROF.pantsT, { seg: 24 }), L.pants, {})]);
        this.mesh(sh, [part(lathe(D.shin, PROF.pantsS, { seg: 24 }), L.pants, {})]);
      } else {
        this.mesh(th, [part(lathe(0.2, [[0, 0.11], [1, 0.1]], { capBottom: false, seg: 24 }), L.trunks, {}), part(lathe(D.thigh, PROF.thigh, { seg: 24 }), L.skin, {})]);
        // ハイカットのブーツ（すね）+ 白い靴下の縁
        this.mesh(sh, [
          part(lathe(D.shin, PROF.shin, { seg: 24 }), L.skin, {}),
          part(lathe(0.2, [[0, 0.074], [1, 0.07]], { seg: 24, capTop: false }), L.boot, { p: [0, -D.shin + 0.2, 0] }),
          part(new THREE.TorusGeometry(0.072, 0.012, 8, 28), L.lace, { p: [0, -D.shin + 0.2, 0], r: [Math.PI / 2, 0, 0] }),
        ]);
      }
      this.mesh(ft, footParts);
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
    return this.bones.head.localToWorld(out.set(0, HEAD_Y, 0.02));
  }

  gloveWorld(n, out = new THREE.Vector3()) {
    return this.bones[`hand${n}`].localToWorld(out.set(0, -0.09, 0.02));
  }
}
