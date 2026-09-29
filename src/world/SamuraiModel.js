import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp, smoothstep } from '../core/math.js';
import { FONT_JP } from './textures.js';

// 主人公「侍ランナー」だけの専用モデル（CPU ランナーは従来の軽いインスタンス人形のまま）。
//
// 見た目: PS2 後期〜PS3 初期くらいのローポリ。丸みのある頭・首・肩・胸・腰、上腕/肘/前腕、太腿/膝/脛、靴。
//   後ろで結んだ黒髪、白い鉢巻、深紅の小袖に白い襟、金の帯、黒漆の袖（肩当て）と小手、
//   走りやすい短めの袴と白い脚絆、草履 × ランニングシューズ、腰に刀。重い鎧は着ない。
// 骨ごとにパーツを 1 つのジオメトリへ結合（頂点カラー）→ 全身で 20 draw call 程度。
//
// 動き: すべて手続き的（アニメーションデータなし）
//   - 歩幅とピッチを速度から決め、接地中の足はワールドに固定（2 ボーン IK）→ 足が滑らない
//   - 腰の上下動・骨盤のひねりと胸の逆ひねり・前傾・腕振り（肩→肘→前腕）
//   - idle / jog / run / sprint / jump / landing / stumble / fall / スタート前の「よーい」
//   - 髪・鉢巻の尾・袴・刀はばね（遅れて揺れる）。重力の向きが変わるとそちらへ垂れる

const C = {
  skin: 0xe8b38c,
  hair: 0x17131b,
  kimono: 0xa51f2b,
  kimonoDark: 0x7a141d,
  collar: 0xf3efe4,
  obi: 0xd8a33a,
  hakama: 0x1d1d2a,
  hakamaEdge: 0x34344c,
  armor: 0x24242f,
  gold: 0xcaa244,
  steel: 0x8c93a0,
  wrap: 0xefece2,
  sole: 0xf6f6f6,
  straw: 0xc9a86b,
  thong: 0xcc1f2a,
  saya: 0x101014,
  tsuka: 0x1b2552,
  band: 0xffffff,
  tasuki: 0xece4d2,
  eye: 0x120d12,
  mouth: 0x6a2a2a,
};

const L_THIGH = 0.44;
const L_SHIN = 0.41;
const ANKLE_H = 0.075;
const HIP_X = 0.1;

// ---- ジオメトリ
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _eul = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();

function part(geo, color, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  _mat4.compose(_pos.set(...p), _quat.setFromEuler(_eul.set(...r)), _scl.set(...s));
  g.applyMatrix4(_mat4);
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

const cyl = (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const sph = (r, w = 10, h = 8, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// 関節から下へ伸びる円柱
const limb = (rt, rb, len, seg = 8) => cyl(rt, rb, len, seg).translate(0, -len / 2, 0);

function mergeParts(parts) {
  const g = mergeGeometries(parts, false);
  g.computeBoundingSphere();
  return g;
}

// ---- 素材: 頂点カラー + リムライト（輪郭が夜景に埋もれない）
function makeMaterial(uniforms, { ghost = false } = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (ghost) {
    m.transparent = true;
    m.opacity = 0.42;
    m.depthWrite = false;
    m.color.set(0x9fe8ff);
    m.emissive.set(0x163a4a);
  }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = uniforms.uRim;
    shader.uniforms.uRimColor = uniforms.uRimColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSamView;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSamView = -mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSamView;\nuniform float uRim;\nuniform vec3 uRimColor;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float samRim = pow(1.0 - abs(dot(normalize(vSamView), normal)), 3.4);
        totalEmissiveRadiance += uRimColor * samRim * uRim;`
      );
  };
  m.customProgramCacheKey = () => (ghost ? 'samurai-ghost' : 'samurai');
  return m;
}

function makeBibTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f7f2';
  g.fillRect(0, 0, 128, 96);
  g.fillStyle = '#d8102c';
  g.fillRect(0, 0, 128, 14);
  g.fillStyle = '#111';
  g.font = `64px ${FONT_JP}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('侍', 64, 56);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- ばね（遅れて揺れる二次モーション）
class Spring {
  constructor(k, c, x = 0) {
    this.k = k;
    this.c = c;
    this.x = x;
    this.v = 0;
  }

  step(dt, target) {
    const a = this.k * (target - this.x) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

function joint(parent, x, y, z) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

export class SamuraiModel {
  constructor({ ghost = false } = {}) {
    this.uniforms = { uRim: { value: 0.5 }, uRimColor: { value: new THREE.Color(0x39e6ff) } };
    this.material = makeMaterial(this.uniforms, { ghost });
    this.root = new THREE.Group();
    this.meshes = [];
    this.build(ghost);
    this.reset();
  }

  mesh(bone, parts) {
    const m = new THREE.Mesh(mergeParts(parts), this.material);
    m.frustumCulled = false;
    bone.add(m);
    this.meshes.push(m);
    return m;
  }

  build(ghost) {
    const root = this.root;
    const hips = joint(root, 0, 0.93, 0);
    this.hips = hips;

    // ---- 腰: 袴の腰まわり・金の帯・背中の腰板
    this.mesh(hips, [
      part(cyl(0.165, 0.19, 0.22, 12), C.hakama, { p: [0, -0.03, 0], s: [1, 1, 0.78] }),
      part(cyl(0.172, 0.172, 0.09, 12), C.obi, { p: [0, 0.1, 0], s: [1, 1, 0.8] }),
      part(box(0.08, 0.07, 0.05), C.obi, { p: [0.05, 0.1, 0.145], r: [0, 0, 0.3] }),
      part(box(0.22, 0.13, 0.03), C.hakama, { p: [0, 0.02, 0.15], r: [-0.12, 0, 0] }),
      part(box(0.2, 0.012, 0.032), C.hakamaEdge, { p: [0, 0.085, 0.158], r: [-0.12, 0, 0] }),
    ]);

    // 袴の前後の布（ばねで揺れる）
    this.hakamaFront = joint(hips, 0, 0.0, -0.12);
    this.mesh(this.hakamaFront, [
      part(box(0.3, 0.44, 0.025), C.hakama, { p: [0, -0.22, 0] }),
      part(box(0.02, 0.4, 0.028), C.hakamaEdge, { p: [-0.06, -0.21, 0] }),
      part(box(0.02, 0.4, 0.028), C.hakamaEdge, { p: [0.06, -0.21, 0] }),
    ]);
    this.hakamaBack = joint(hips, 0, 0.0, 0.13);
    this.mesh(this.hakamaBack, [part(box(0.32, 0.42, 0.025), C.hakama, { p: [0, -0.21, 0] })]);

    // 刀（左腰に差す。柄は前上、鞘は後ろ下）
    this.katana = joint(hips, -0.2, 0.09, -0.02);
    this.mesh(this.katana, [
      part(cyl(0.021, 0.017, 0.8, 8).rotateX(Math.PI / 2), C.saya, { p: [0, 0, 0.4] }),
      part(cyl(0.023, 0.023, 0.03, 8).rotateX(Math.PI / 2), C.gold, { p: [0, 0, 0.79] }),
      part(cyl(0.048, 0.048, 0.012, 12).rotateX(Math.PI / 2), C.gold, { p: [0, 0, -0.01] }),
      part(cyl(0.02, 0.022, 0.25, 8).rotateX(Math.PI / 2), C.tsuka, { p: [0, 0, -0.14] }),
      part(box(0.012, 0.03, 0.22), C.collar, { p: [0, 0.01, -0.14], r: [0, 0.8, 0] }),
      part(cyl(0.024, 0.024, 0.02, 8).rotateX(Math.PI / 2), C.gold, { p: [0, 0, -0.27] }),
    ]);
    this.katana.rotation.set(0.35, 0.18, 0);

    // ---- 背骨・胸
    const spine = joint(hips, 0, 0.1, 0);
    const chest = joint(spine, 0, 0.14, 0);
    this.spine = spine;
    this.chest = chest;
    this.mesh(spine, [part(cyl(0.16, 0.165, 0.16, 12), C.kimono, { p: [0, 0.06, 0], s: [1, 1, 0.72] })]);
    const torso = [
      part(cyl(0.2, 0.16, 0.34, 12), C.kimono, { p: [0, 0.1, 0], s: [1, 1, 0.68] }),
      // 丸い肩
      part(sph(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), C.kimono, { p: [0, 0.26, 0], s: [1, 0.36, 0.68] }),
      // 白い襟（V 字）と下の襦袢
      part(box(0.034, 0.27, 0.02), C.collar, { p: [-0.048, 0.15, -0.123], r: [0.08, 0, -0.38] }),
      part(box(0.034, 0.27, 0.02), C.collar, { p: [0.048, 0.15, -0.123], r: [0.08, 0, 0.38] }),
      part(box(0.07, 0.06, 0.02), C.collar, { p: [0, 0.27, -0.112] }),
      // 背中のたすき（X）
      part(box(0.028, 0.44, 0.014), C.tasuki, { p: [0, 0.12, 0.123], r: [-0.08, 0, 0.62] }),
      part(box(0.028, 0.44, 0.014), C.tasuki, { p: [0, 0.12, 0.123], r: [-0.08, 0, -0.62] }),
      // 小袖の濃い裾
      part(cyl(0.165, 0.165, 0.03, 12), C.kimonoDark, { p: [0, -0.06, 0], s: [1, 1, 0.7] }),
    ];
    this.mesh(chest, torso);
    // ゼッケン（「侍」）
    if (!ghost) {
      const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.11), new THREE.MeshLambertMaterial({ map: makeBibTexture() }));
      bib.position.set(0, 0.06, -0.117);
      bib.rotation.y = Math.PI;
      bib.rotation.x = 0.06;
      bib.scale.x = -1;
      chest.add(bib);
      this.bib = bib;
    }

    // ---- 首・頭
    const neck = joint(chest, 0, 0.29, 0);
    this.neck = neck;
    this.mesh(neck, [part(cyl(0.05, 0.058, 0.11, 8), C.skin, { p: [0, 0.03, 0.005] })]);
    const head = joint(neck, 0, 0.08, 0);
    this.head = head;
    this.mesh(head, [
      part(sph(0.122, 14, 10), C.skin, { p: [0, 0.1, 0], s: [0.94, 1.1, 1.02] }),
      part(sph(0.07, 10, 6), C.skin, { p: [0, 0.045, -0.035], s: [1, 0.8, 1] }),
      // 髪（頭頂〜後頭部）
      // 前は鉢巻の上（生え際）、後ろはうなじまで
      part(sph(0.131, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), C.hair, { p: [0, 0.112, 0.008], r: [0.42, 0, 0], s: [0.97, 1.1, 1.06] }),
      part(sph(0.105, 10, 8), C.hair, { p: [0, 0.085, 0.06], s: [1, 1.05, 0.9] }),
      part(box(0.014, 0.05, 0.03), C.hair, { p: [-0.114, 0.095, -0.03] }),
      part(box(0.014, 0.05, 0.03), C.hair, { p: [0.114, 0.095, -0.03] }),
      // 顔（目・眉・鼻・口・耳）
      part(box(0.03, 0.015, 0.01), C.eye, { p: [-0.042, 0.103, -0.12] }),
      part(box(0.03, 0.015, 0.01), C.eye, { p: [0.042, 0.103, -0.12] }),
      part(box(0.046, 0.013, 0.012), C.hair, { p: [-0.045, 0.128, -0.118], r: [0, 0, -0.28] }),
      part(box(0.046, 0.013, 0.012), C.hair, { p: [0.045, 0.128, -0.118], r: [0, 0, 0.28] }),
      part(box(0.022, 0.036, 0.024), C.skin, { p: [0, 0.083, -0.127] }),
      part(box(0.042, 0.008, 0.006), C.mouth, { p: [0, 0.045, -0.118] }),
      part(sph(0.024, 6, 5), C.skin, { p: [-0.118, 0.09, 0.005], s: [0.6, 1, 1] }),
      part(sph(0.024, 6, 5), C.skin, { p: [0.118, 0.09, 0.005], s: [0.6, 1, 1] }),
      // 鉢巻（白）と後ろの結び目
      part(cyl(0.132, 0.134, 0.034, 16, true), C.band, { p: [0, 0.148, 0.006], s: [0.97, 1, 1.08] }),
      part(box(0.05, 0.045, 0.035), C.band, { p: [0, 0.148, 0.14] }),
      // 髷の根元の元結（白）
      part(cyl(0.03, 0.03, 0.03, 8).rotateX(Math.PI / 2 - 0.5), C.band, { p: [0, 0.19, 0.11] }),
    ]);

    // 後ろで結んだ髪（3 節のばね）
    this.hairJoints = [];
    let parent = joint(head, 0, 0.19, 0.12);
    const hr = [0.034, 0.028, 0.02];
    for (let k = 0; k < 3; k++) {
      this.mesh(parent, [part(limb(hr[k], hr[k] * 0.78, 0.1, 7), C.hair)]);
      this.hairJoints.push(parent);
      parent = joint(parent, 0, -0.095, 0);
    }
    // 鉢巻の尾（2 本）
    this.bandTails = [];
    for (const side of [-1, 1]) {
      const t = joint(head, side * 0.02, 0.148, 0.15);
      this.mesh(t, [part(box(0.032, 0.2, 0.006), C.band, { p: [0, -0.1, 0] })]);
      const t2 = joint(t, 0, -0.195, 0);
      this.mesh(t2, [part(box(0.03, 0.14, 0.006), C.band, { p: [0, -0.07, 0] })]);
      this.bandTails.push([t, t2, side]);
    }

    // ---- 腕（肩 → 上腕（袖・肩当て）→ 肘 → 前腕（小手）→ 拳）
    this.arms = {};
    for (const side of [-1, 1]) {
      const shoulder = joint(chest, side * 0.215, 0.235, 0.005);
      this.mesh(shoulder, [
        part(sph(0.07, 10, 8), C.kimono),
        part(limb(0.07, 0.06, 0.29, 9), C.kimono),
        // 肩当て（黒漆 + 金の縁）
        part(box(0.03, 0.17, 0.15), C.armor, { p: [side * 0.068, -0.075, 0], r: [0, 0, side * 0.22] }),
        part(box(0.032, 0.014, 0.152), C.gold, { p: [side * 0.086, -0.155, 0], r: [0, 0, side * 0.22] }),
        part(box(0.032, 0.012, 0.152), C.gold, { p: [side * 0.07, -0.08, 0], r: [0, 0, side * 0.22] }),
      ]);
      const elbow = joint(shoulder, 0, -0.29, 0);
      this.mesh(elbow, [
        part(sph(0.056, 8, 6), C.kimono),
        part(limb(0.052, 0.042, 0.24, 8), C.armor),
        part(box(0.022, 0.15, 0.05), C.steel, { p: [side * 0.045, -0.12, 0] }),
        part(cyl(0.047, 0.047, 0.02, 8), C.gold, { p: [0, -0.235, 0] }),
        // 拳
        part(sph(0.047, 8, 6), C.skin, { p: [0, -0.285, -0.005], s: [0.9, 1.05, 1.15] }),
      ]);
      this.arms[side] = { shoulder, elbow };
    }

    // ---- 脚（太腿（袴）→ 膝 → 脛（脚絆）→ 足首 → 草履シューズ）
    this.legs = {};
    for (const side of [-1, 1]) {
      const thigh = joint(hips, side * HIP_X, -0.03, 0);
      this.mesh(thigh, [part(limb(0.1, 0.132, L_THIGH, 10), C.hakama), part(limb(0.101, 0.101, 0.02, 10), C.hakamaEdge, { p: [0, -0.2, 0] })]);
      const knee = joint(thigh, 0, -L_THIGH, 0);
      this.mesh(knee, [
        // 膝下で結んだ袴の裾
        part(cyl(0.128, 0.115, 0.1, 10), C.hakama, { p: [0, -0.03, 0] }),
        part(limb(0.058, 0.045, L_SHIN - 0.02, 8), C.wrap),
        part(cyl(0.06, 0.06, 0.018, 8), C.hakamaEdge, { p: [0, -0.11, 0] }),
        part(cyl(0.05, 0.05, 0.018, 8), C.hakamaEdge, { p: [0, -0.33, 0] }),
      ]);
      const ankle = joint(knee, 0, -L_SHIN, 0);
      this.mesh(ankle, [
        part(box(0.105, 0.03, 0.28), C.sole, { p: [0, -ANKLE_H + 0.015, -0.055] }),
        part(box(0.094, 0.05, 0.24), C.straw, { p: [0, -ANKLE_H + 0.055, -0.05] }),
        part(box(0.02, 0.03, 0.09), C.thong, { p: [0, -ANKLE_H + 0.085, -0.1] }),
        part(box(0.1, 0.02, 0.02), C.thong, { p: [0, -ANKLE_H + 0.08, -0.05] }),
        part(sph(0.04, 8, 6), C.wrap, { p: [0, -0.01, 0] }),
      ]);
      this.legs[side] = { thigh, knee, ankle, plantZ: 0, lastPsi: 0 };
    }

    this.springs = {
      hairP: new Spring(60, 7, -0.5),
      hairR: new Spring(60, 7),
      hair2: new Spring(80, 8),
      tailP: new Spring(90, 6, -0.3),
      tailR: new Spring(70, 5),
      hakF: new Spring(110, 9),
      hakB: new Spring(110, 9),
      katP: new Spring(140, 8, 0.35),
      katR: new Spring(120, 7),
    };
  }

  reset() {
    this.psi = 0;
    this.time = 0;
    this.air = 0;
    this.landT = 0;
    this.lastHipY = 0.93;
    this.hipVel = 0;
    this.lastSpeed = 0;
    this.lean = 0;
    this.ready = 0;
    this.stumbleT = 0;
    this.touchdowns = 0;
    for (const s of Object.values(this.springs ?? {})) s.v = 0;
  }

  setRim(color, strength) {
    if (color !== undefined) this.uniforms.uRimColor.value.set(color);
    this.uniforms.uRim.value = strength;
  }

  // 太腿 → 脛の 2 ボーン IK（腰のローカル座標で解く）。膝は前に曲がる
  solveLeg(leg, side, tx, ty, tz, footPitch) {
    const hx = side * HIP_X;
    const hy = this.hips.position.y - 0.03;
    const fwd = -(tz - 0);
    const down = hy - ty;
    const lat = tx - hx;
    let d = Math.hypot(fwd, down);
    const maxD = (L_THIGH + L_SHIN) * 0.999;
    d = clamp(d, 0.08, maxD);
    const beta = Math.atan2(fwd, down);
    const cosHip = clamp((L_THIGH * L_THIGH + d * d - L_SHIN * L_SHIN) / (2 * L_THIGH * d), -1, 1);
    const cosKnee = clamp((L_THIGH * L_THIGH + L_SHIN * L_SHIN - d * d) / (2 * L_THIGH * L_SHIN), -1, 1);
    const thighA = beta + Math.acos(cosHip);
    const kneeFlex = Math.PI - Math.acos(cosKnee);
    leg.thigh.rotation.x = thighA;
    leg.thigh.rotation.z = Math.atan2(lat, Math.max(0.2, down)) * 0.8;
    leg.knee.rotation.x = -kneeFlex;
    // 足首: footPitch = 0 で地面と平行
    leg.ankle.rotation.x = -(thighA - kneeFlex) + footPitch;
  }

  // st: { dt, speed, grounded, y, vy, vx, falling, fallT, stumble, dashing, ready, gravityTilt, jumpLead }
  animate(st) {
    const dt = Math.min(0.05, st.dt);
    this.time += dt;
    const v = Math.max(0, st.speed);
    const sprint = smoothstep(8, 22, v);
    const moving = v > 0.4;
    this.touchdowns = 0;

    // 空中・着地・よろけ・よーい
    const airborne = !st.grounded && !st.falling;
    if (airborne) this.air = Math.min(1, this.air + dt * 9);
    else {
      if (this.air > 0.5) this.landT = 0.2;
      this.air = Math.max(0, this.air - dt * 12);
    }
    this.landT = Math.max(0, this.landT - dt);
    this.ready = damp(this.ready, st.ready ? 1 : 0, 6, dt);
    if (st.stumble > 0) this.stumbleT += dt;
    else this.stumbleT = 0;

    // ---- 歩調: ピッチは速さで上がり、接地中の足は後ろへ「速さぴったり」で流れる（足が滑らない）
    const stepRate = clamp(2.2 + 0.2 * v, 2.6, 7.2);
    const cycle = stepRate / 2;
    if (moving && !st.falling) this.psi = (((this.psi + dt * cycle * (st.reverse ? -1 : 1)) % 1) + 1) % 1;
    const duty = moving ? Math.min(0.38, (0.8 * cycle) / Math.max(0.1, v)) : 1;
    const sweep = moving ? (v * duty) / cycle : 0;
    const liftH = 0.12 + 0.34 * sprint;
    const kickBack = 0.08 + 0.2 * sprint;

    // ---- 腰の高さ: 接地の真ん中で一番低く、空中で高い
    const bob = moving ? (0.012 + 0.03 * sprint) * -Math.cos(4 * Math.PI * (this.psi - duty / 2)) : Math.sin(this.time * 1.8) * 0.004;
    let hipY = 0.93 - 0.035 * sprint + bob;
    hipY -= this.ready * 0.17;
    hipY -= (this.landT / 0.2) * 0.14;
    if (st.falling) hipY = 0.93;
    this.hips.position.y = hipY;
    const hipVel = (hipY - this.lastHipY) / Math.max(1e-3, dt);
    const hipAcc = (hipVel - this.hipVel) / Math.max(1e-3, dt);
    this.hipVel = hipVel;
    this.lastHipY = hipY;

    // ---- 脚
    for (const side of [-1, 1]) {
      const leg = this.legs[side];
      let tz;
      let ty;
      let pitch = 0;
      if (st.falling) {
        // 転倒: 脚は後ろへ伸びる
        tz = 0.35 + side * 0.05;
        ty = hipY - 0.8;
        pitch = -0.6;
      } else if (this.air > 0.01 && !moving) {
        tz = side * 0.1;
        ty = ANKLE_H + 0.3;
      } else if (!moving) {
        // 立ち（よーい: 片足前）
        tz = lerp(side * 0.02, side < 0 ? -0.34 : 0.32, this.ready);
        ty = ANKLE_H;
      } else {
        const ph = (this.psi + (side > 0 ? 0.5 : 0)) % 1;
        if (ph < duty) {
          // 接地: 前から後ろへ（地面に固定）
          const u = ph / duty;
          tz = lerp(-sweep / 2, sweep / 2, u);
          ty = ANKLE_H;
          pitch = u > 0.7 ? -(u - 0.7) * 1.6 : 0; // つま先で蹴る
        } else {
          // 振り出し: 踵を引き上げ → 膝を前へ → 着地の位置へ
          const u = (ph - duty) / (1 - duty);
          const s1 = smoothstep(0.05, 0.95, u);
          tz = lerp(sweep / 2, -sweep / 2 - 0.02, s1) + kickBack * Math.sin(Math.PI * Math.min(1, u / 0.55)) * (1 - u);
          ty = ANKLE_H + liftH * Math.pow(Math.sin(Math.PI * u), 0.75);
          pitch = -0.5 * Math.sin(Math.PI * u);
        }
        if (!st.reverse && ph < leg.lastPsi && ph < duty) this.touchdowns++;
        leg.lastPsi = ph;
      }
      // 空中: 前脚を上げ、後ろ脚をたたむ（ハードル走っぽく）
      if (this.air > 0) {
        const lead = side === (st.jumpLead ?? 1);
        const az = lead ? -0.32 : 0.3;
        const ay = lead ? hipY - 0.55 : hipY - 0.45;
        tz = lerp(tz, az, this.air);
        ty = lerp(ty, ay, this.air);
        pitch = lerp(pitch, lead ? 0.2 : -0.7, this.air);
      }
      this.solveLeg(leg, side, side * HIP_X, ty, tz, pitch);
    }

    // ---- 骨盤のひねりと胸の逆ひねり、前傾
    const swing = moving ? Math.sin(2 * Math.PI * (this.psi - duty / 2)) : 0;
    const twist = swing * (0.07 + 0.08 * sprint) * (1 - this.air);
    this.hips.rotation.y = twist;
    this.hips.rotation.z = moving ? Math.cos(2 * Math.PI * (this.psi - duty / 2)) * 0.035 : 0;
    const accel = (v - this.lastSpeed) / Math.max(1e-3, dt);
    this.lastSpeed = v;
    const targetLean = -(0.05 + 0.2 * sprint + clamp(accel * 0.012, -0.08, 0.15)) - this.ready * 0.8;
    this.lean = damp(this.lean, st.falling ? -0.2 : targetLean, 8, dt);
    let stumble = 0;
    if (this.stumbleT > 0) stumble = Math.sin(this.stumbleT * 18) * Math.exp(-this.stumbleT * 3) * 0.35;
    this.spine.rotation.x = this.lean * 0.45 - stumble * 0.5 + (this.landT / 0.2) * -0.18;
    this.chest.rotation.x = this.lean * 0.55 - stumble * 0.5;
    this.chest.rotation.y = -twist * 1.35;
    this.chest.rotation.z = clamp(-st.vx * 0.02, -0.12, 0.12);
    // 頭は視線を前に保つ（前傾を打ち消す）
    this.neck.rotation.x = -this.lean * 0.6 + stumble * 0.4;
    this.head.rotation.x = -this.lean * 0.25;
    this.head.rotation.y = twist * 0.6;

    // ---- 腕: 反対側の脚と逆に振る（肩 → 肘 → 前腕の連動）
    const armAmp = 0.55 + 0.6 * sprint;
    for (const side of [-1, 1]) {
      const { shoulder, elbow } = this.arms[side];
      const legT = this.legs[side].thigh.rotation.x;
      let sx = moving ? clamp(-legT * 0.95, -1.2, 1.2) * (armAmp / 1.1) : 0.05;
      let elb = 1.35 + 0.35 * sprint + (moving ? Math.max(0, sx) * 0.3 : -0.9);
      let abd = 0.1 + 0.06 * sprint;
      // よーい: 左腕前・右腕後ろ
      sx = lerp(sx, side < 0 ? -0.75 : 1.0, this.ready);
      elb = lerp(elb, 1.45, this.ready);
      if (this.air > 0) {
        sx = lerp(sx, side === (st.jumpLead ?? 1) ? -0.5 : 1.1, this.air);
        abd = lerp(abd, 0.55, this.air);
        elb = lerp(elb, 0.9, this.air);
      }
      if (st.falling) {
        sx = 2.6;
        elb = 0.3;
        abd = 0.3;
      }
      if (stumble) {
        abd += Math.abs(Math.sin(this.stumbleT * 22 + side)) * 0.9;
        sx += Math.sin(this.stumbleT * 25 + side * 2) * 0.6;
      }
      shoulder.rotation.x = sx;
      shoulder.rotation.z = side * abd;
      elbow.rotation.x = elb;
    }

    // ---- 二次モーション（ばね）
    const S = this.springs;
    const tilt = st.gravityTilt ?? 0;
    // 髪: 速さで後ろへなびき、上下動で跳ねる。重力の向きへ垂れる
    S.hairP.v += hipAcc * 0.01;
    const hairP = S.hairP.step(dt, -0.45 - v * 0.035 - this.air * 0.4);
    const hairR = S.hairR.step(dt, tilt * 0.9 - st.vx * 0.03);
    const hair2 = S.hair2.step(dt, hairP * 0.35);
    this.hairJoints[0].rotation.set(hairP, 0, hairR);
    this.hairJoints[1].rotation.set(hair2 + Math.sin(this.time * 9) * 0.05 * sprint, 0, hairR * 0.4);
    this.hairJoints[2].rotation.set(hair2 * 0.8, 0, hairR * 0.3);
    // 鉢巻の尾: スピードで水平にはためく
    const tailP = S.tailP.step(dt, -0.3 - Math.min(1.25, v * 0.06) - this.air * 0.3);
    const tailR = S.tailR.step(dt, tilt * 0.8);
    for (const [t, t2, side] of this.bandTails) {
      const flutter = Math.sin(this.time * 21 + side * 1.7) * (0.08 + 0.22 * sprint);
      t.rotation.set(tailP + flutter * 0.4, 0, side * 0.12 + tailR);
      t2.rotation.set(flutter + tailP * 0.15, 0, tailR * 0.5);
    }
    // 袴: 前に出た膝に押され、後ろは風で流れる
    const tl = this.legs[-1].thigh.rotation.x;
    const tr = this.legs[1].thigh.rotation.x;
    this.hakamaFront.rotation.x = S.hakF.step(dt, Math.max(0, Math.max(tl, tr)) * 0.62 + this.air * 0.3);
    this.hakamaBack.rotation.x = S.hakB.step(dt, Math.min(0, Math.min(tl, tr)) * 0.5 - v * 0.012);
    this.hakamaFront.rotation.z = this.hakamaBack.rotation.z = tilt * 0.3;
    // 刀: 腰の上下とひねりで揺れる
    S.katP.v += hipAcc * 0.012;
    this.katana.rotation.x = S.katP.step(dt, 0.35 + v * 0.004 + (st.falling ? 0.6 : 0));
    this.katana.rotation.z = S.katR.step(dt, -twist * 0.8 + tilt * 0.35 - st.vx * 0.02);
  }
}
