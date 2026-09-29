import * as THREE from 'three';
import { TRACK, trackPoint, SEGMENTS } from '../race/trackLogic.js';
import { APRON } from './track.js';
import { patchMaterial } from '../fx/materialPatch.js';

// 客席（すり鉢状のボウル）。トラックの外周に沿って段を作り、蹴上げに「板の観客」を描く。
// 観客の動き（跳ねる・ウェーブ・静止・消える）はシェーダーの uniform だけで変える。

export const STAND = { off0: APRON + 0.6, depth: 1.25, rise: 0.62, y0: 0.9 };

function crowdTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d');
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#1e2748';
  g.fillRect(0, 0, 1024, 64);
  g.fillStyle = '#2b375e';
  for (let x = 0; x < 1024; x += 32) g.fillRect(x + 3, 46, 26, 18);
  const shirts = ['#ff3d7f', '#39e6ff', '#ffd23f', '#ffffff', '#ff7a2a', '#7a5cff', '#2ecc71', '#e8322a', '#1f7bff', '#f4f4f4', '#15151c'];
  const skins = ['#f1c9a5', '#e0ac85', '#c68b62', '#8d5a3c'];
  for (let i = 0; i < 32; i++) {
    if (rnd() < 0.06) continue;
    const cx = i * 32 + 16 + (rnd() - 0.5) * 6;
    g.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
    g.fillRect(cx - 9, 31, 18, 26);
    if (rnd() < 0.3) {
      g.fillRect(cx - 12, 12, 4, 21);
      g.fillRect(cx + 8, 12, 4, 21);
    }
    g.fillStyle = skins[Math.floor(rnd() * skins.length)];
    g.beginPath();
    g.arc(cx, 23, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rnd() < 0.25 ? '#6a4a2a' : '#15151c';
    g.fillRect(cx - 7, 15, 14, 5);
    if (rnd() < 0.1) {
      g.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
      g.fillRect(cx + 10, 3, 15, 11);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export const CROWD_UNIFORMS = {
  uTime: { value: 0 },
  uEnergy: { value: 0.3 }, // 0〜1 盛り上がり
  uWave: { value: 0 }, // ウェーブの強さ
  uWaveP: { value: 0 }, // ウェーブの位置（周回内の m）
  uFreeze: { value: 0 }, // 1 = 静止
  uVanish: { value: 0 }, // 1 = 全員消える（空席）
  uSync: { value: 0 }, // 1 = 全員同時に跳ぶ
};

function samples() {
  const out = [];
  const { S1, S2, S3 } = SEGMENTS;
  const push = (a, b, step) => {
    const n = Math.max(1, Math.ceil((b - a) / step));
    for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / n);
  };
  push(0, S1, 3);
  push(S1, S2, 6);
  push(S2, S3, 3);
  push(S3, TRACK.lap, 6);
  out.push(TRACK.lap);
  return out;
}

export function buildStands(deform, rows = 14) {
  const group = new THREE.Group();
  const ps = samples();
  const pt = {};
  const riser = { pos: [], uv: [], nor: [], idx: [] };
  const tread = { pos: [], nor: [], idx: [] };
  // 蹴上げ（観客）: 段ごとに p に沿った縦の帯
  for (let k = 0; k < rows; k++) {
    const off = STAND.off0 + k * STAND.depth;
    const yA = k === 0 ? 0 : STAND.y0 + (k - 1) * STAND.rise;
    const yB = STAND.y0 + k * STAND.rise;
    const base = riser.pos.length / 3;
    for (let i = 0; i < ps.length; i++) {
      trackPoint(ps[i], off, pt);
      riser.pos.push(pt.x, yA, pt.z, pt.x, yB, pt.z);
      riser.nor.push(-pt.rx, 0, -pt.rz, -pt.rx, 0, -pt.rz);
      const u = ps[i] / 5.5 + k * 0.37;
      riser.uv.push(u, 0, u, 1);
    }
    for (let i = 0; i < ps.length - 1; i++) {
      const a = base + i * 2;
      riser.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // 表面がトラック側を向く
    }
    // 踏面（座席）
    const tb = tread.pos.length / 3;
    for (let i = 0; i < ps.length; i++) {
      trackPoint(ps[i], off, pt);
      const x0 = pt.x;
      const z0 = pt.z;
      trackPoint(ps[i], off + STAND.depth, pt);
      tread.pos.push(x0, yB, z0, pt.x, yB, pt.z);
      tread.nor.push(0, 1, 0, 0, 1, 0);
    }
    for (let i = 0; i < ps.length - 1; i++) {
      const a = tb + i * 2;
      tread.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.Float32BufferAttribute(riser.pos, 3));
  rGeo.setAttribute('normal', new THREE.Float32BufferAttribute(riser.nor, 3));
  rGeo.setAttribute('uv', new THREE.Float32BufferAttribute(riser.uv, 2));
  rGeo.setIndex(riser.idx);
  const tex = crowdTexture(7);
  const crowdMat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x20202c, side: THREE.DoubleSide });
  crowdMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, CROWD_UNIFORMS);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime, uEnergy, uWave, uWaveP, uFreeze, uVanish, uSync;'
      )
      .replace(
        '#include <map_fragment>',
        `vec2 cuv = vMapUv;
        float pid = floor(cuv.x * 32.0);
        float t = uTime * (1.0 - uFreeze);
        float ownPhase = mix(t * (7.0 + fract(pid * 0.37) * 4.0) + pid * 1.7, t * 9.0, uSync);
        float hop = max(0.0, sin(ownPhase)) * (0.05 + uEnergy * 0.22);
        // ウェーブ: p（= u × 5.5）の位置で波が通る
        float pAlong = cuv.x * 5.5;
        float wd = abs(mod(pAlong - uWaveP + 200.0, 400.0) - 200.0);
        hop += uWave * smoothstep(14.0, 0.0, wd) * 0.45;
        cuv.y = clamp(cuv.y - hop, 0.0, 0.999);
        vec4 sampledDiffuseColor = texture2D(map, cuv);
        // 消える: 人のいない座席の色へ
        float seatRow = step(0.72, 1.0 - vMapUv.y);
        vec3 empty = mix(vec3(0.12, 0.15, 0.28), vec3(0.17, 0.22, 0.37), seatRow);
        sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, empty, uVanish);
        diffuseColor *= sampledDiffuseColor;`
      );
    deform.attach(shader);
  };
  crowdMat.customProgramCacheKey = () => 'stand-crowd-800';
  patchMaterial(crowdMat);
  const risers = new THREE.Mesh(rGeo, crowdMat);
  risers.frustumCulled = false;
  group.add(risers);

  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.Float32BufferAttribute(tread.pos, 3));
  tGeo.setAttribute('normal', new THREE.Float32BufferAttribute(tread.nor, 3));
  tGeo.setIndex(tread.idx);
  const seatMat = new THREE.MeshLambertMaterial({ color: 0x2a3456, side: THREE.DoubleSide });
  seatMat.onBeforeCompile = (shader) => deform.attach(shader);
  seatMat.customProgramCacheKey = () => 'seat-800';
  patchMaterial(seatMat);
  const treads = new THREE.Mesh(tGeo, seatMat);
  treads.frustumCulled = false;
  group.add(treads);

  // 最前列の壁（広告看板の帯）
  const wallPos = [];
  const wallUv = [];
  const wallIdx = [];
  for (let i = 0; i < ps.length; i++) {
    trackPoint(ps[i], STAND.off0 - 0.05, pt);
    wallPos.push(pt.x, 0, pt.z, pt.x, 1.0, pt.z);
    wallUv.push(-ps[i] / 12, 0, -ps[i] / 12, 1);
  }
  for (let i = 0; i < ps.length - 1; i++) {
    const a = i * 2;
    wallIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  wGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2));
  wGeo.setIndex(wallIdx);
  wGeo.computeVertexNormals();
  const adMat = new THREE.MeshBasicMaterial({ map: adTexture(), side: THREE.DoubleSide });
  adMat.onBeforeCompile = (shader) => deform.attach(shader);
  adMat.customProgramCacheKey = () => 'ad-800';
  patchMaterial(adMat);
  group.add(new THREE.Mesh(wGeo, adMat));

  const topOff = STAND.off0 + rows * STAND.depth;
  const topY = STAND.y0 + rows * STAND.rise;
  group.userData.top = { off: topOff, y: topY };
  return group;
}

function adTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d');
  const ads = [
    ['#0b0f24', '#39e6ff', '800m、なのに。'],
    ['#d8102c', '#ffffff', 'TOKYO 800'],
    ['#ffd23f', '#111111', '2周だけ'],
    ['#111111', '#ff3d7f', 'NANONI ATHLETICS'],
  ];
  ads.forEach(([bg, fg, text], i) => {
    g.fillStyle = bg;
    g.fillRect(i * 256, 0, 256, 64);
    g.fillStyle = fg;
    g.font = 'bold 30px "Dela Gothic One", "Chakra Petch", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, i * 256 + 128, 34);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
