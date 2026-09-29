import * as THREE from 'three';
import { TRACK, MAX_OFF, trackPoint, SEGMENTS } from '../race/trackLogic.js';
import { patchMaterial } from '../fx/materialPatch.js';

// 見た目のトラック（Visual track）。論理トラックをなぞってジオメトリを作り、
// レーンの白線・フィニッシュライン・ブレイクラインはシェーダーで描く（テクスチャなし）。
// 波打つ・傾く・ねじれる等の変形は WorldDeform（uniform 共有）で「見た目だけ」行う。

export const CURB = -0.32; // 内側の縁石（計測線から 0.3m 内側）
export const OUTER = MAX_OFF + 0.9;
export const APRON = OUTER + 4.2;

// p（周回内の距離）を 0〜400 でサンプル。カーブは細かく、直線は粗く
function samplePs() {
  const ps = [];
  const { S1, S2, S3 } = SEGMENTS;
  const push = (a, b, step) => {
    const n = Math.max(1, Math.ceil((b - a) / step));
    for (let i = 0; i < n; i++) ps.push(a + ((b - a) * i) / n);
  };
  push(0, S1, 1.2);
  push(S1, S2, 3);
  push(S2, S3, 1.2);
  push(S3, TRACK.lap, 3);
  ps.push(TRACK.lap);
  return ps;
}

// 帯状のリボン（off0〜off1）を周回ぶん作る。uv = (off, p)
export function buildRing(off0, off1, y = 0, cols = 2) {
  const ps = samplePs();
  const pos = [];
  const uv = [];
  const idx = [];
  const pt = {};
  for (let i = 0; i < ps.length; i++) {
    for (let c = 0; c < cols; c++) {
      const off = off0 + ((off1 - off0) * c) / (cols - 1);
      trackPoint(ps[i], off, pt);
      pos.push(pt.x, y, pt.z);
      uv.push(off, ps[i]);
    }
  }
  for (let i = 0; i < ps.length - 1; i++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = a + cols;
      idx.push(a, a + 1, b, a + 1, b + 1, b); // 上向き
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // 裏表: 上向きに揃える
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return geo;
}

const TRACK_FRAG = /* glsl */ `
float lineAA(float d, float w) {
  float fw = fwidth(d) * 1.2;
  return 1.0 - smoothstep(w - fw, w + fw, abs(d));
}
`;

export function buildTrack(deform) {
  const group = new THREE.Group();

  // 走路（レーン 8 本）
  const geo = buildRing(CURB, OUTER, 0.0, 12);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTrk;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTrk = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vTrk;\n${TRACK_FRAG}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float off = vTrk.x;
        float p = vTrk.y;
        vec3 base = vec3(0.62, 0.19, 0.11);
        // 細かい粒（ゴムチップ）
        float grain = fract(sin(dot(floor(vec2(off * 18.0, p * 18.0)), vec2(12.9898, 78.233))) * 43758.5453);
        base *= 0.92 + grain * 0.12;
        float lines = 0.0;
        // レーンの白線（計測線の 0.3m 内側 = 縁石から 1.22m ごと）
        float laneD = mod(off - ${CURB.toFixed(2)} + 0.61, ${TRACK.laneWidth.toFixed(2)}) - 0.61;
        if (off > ${CURB.toFixed(2)} + 0.1 && off < ${(CURB + TRACK.laneWidth * TRACK.lanes + 0.1).toFixed(2)}) lines = max(lines, lineAA(laneD, 0.025));
        // フィニッシュライン（p = 0 / 400）
        float fp = min(p, 400.0 - p);
        lines = max(lines, lineAA(fp, 0.05) * step(off, ${(CURB + TRACK.laneWidth * TRACK.lanes).toFixed(2)}));
        // ブレイクライン（第 2 コーナー出口: 緑）
        float br = lineAA(p - ${SEGMENTS.S1.toFixed(2)}, 0.05) * step(0.0, off);
        // 200m ごとの目印（黄）
        float m200 = lineAA(p - 200.0, 0.04) * step(off, 0.9);
        vec3 col = mix(base, vec3(0.95), lines);
        col = mix(col, vec3(0.2, 0.8, 0.35), br);
        col = mix(col, vec3(1.0, 0.85, 0.2), m200);
        diffuseColor.rgb = col;`
      );
    deform.attach(shader);
  };
  mat.customProgramCacheKey = () => 'track-800';
  patchMaterial(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  group.add(mesh);
  group.userData.trackMesh = mesh;

  // 縁石（内側、白と灰）
  const curbGeo = buildRing(CURB - 0.12, CURB, 0.06, 2);
  const curbMat = new THREE.MeshLambertMaterial({ color: 0xe8e8ee });
  curbMat.onBeforeCompile = (shader) => deform.attach(shader);
  curbMat.customProgramCacheKey = () => 'curb-800';
  patchMaterial(curbMat);
  group.add(new THREE.Mesh(curbGeo, curbMat));

  // 外側のエプロン（灰色）
  const apronMat = new THREE.MeshLambertMaterial({ color: 0x8a4234 });
  apronMat.onBeforeCompile = (shader) => deform.attach(shader);
  apronMat.customProgramCacheKey = () => 'apron-800';
  patchMaterial(apronMat);
  group.add(new THREE.Mesh(buildRing(OUTER, APRON, -0.01, 2), apronMat));

  // 内側の芝生（楕円 = 長方形 + 半円 2 つ）
  const shape = new THREE.Shape();
  const r = TRACK.radius + CURB - 0.12;
  const hl = TRACK.straight / 2;
  shape.moveTo(-hl, r);
  shape.lineTo(hl, r);
  shape.absarc(hl, 0, r, Math.PI / 2, -Math.PI / 2, true);
  shape.lineTo(-hl, -r);
  shape.absarc(-hl, 0, r, -Math.PI / 2, Math.PI / 2, true);
  const grassGeo = new THREE.ShapeGeometry(shape, 24);
  grassGeo.rotateX(Math.PI / 2);
  // ShapeGeometry の頂点は (x, y) → 回転後 (x, 0, y)。トラックは z = +R がホーム側なので合う
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x2f7a3a });
  grassMat.side = THREE.DoubleSide;
  grassMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.86 + 0.14 * step(0.5, fract(vGW.x / 9.0));');
    deform.attach(shader);
  };
  grassMat.customProgramCacheKey = () => 'grass-800';
  patchMaterial(grassMat);
  const grass = new THREE.Mesh(grassGeo, grassMat);
  grass.position.y = -0.02;
  group.add(grass);

  // 地面（遠景）
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x14161e }));
  ground.position.y = -0.6;
  group.add(ground);
  group.userData.ground = ground;
  return group;
}
