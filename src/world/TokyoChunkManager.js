import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createRng, hashInt, smoothstep } from '../core/math.js';
import {
  makeRoadTexture,
  makeSidewalkTexture,
  makeFenceTexture,
  makeSignAtlases,
} from './textures.js';
import { buildLandmark, disposeObject } from './Landmarks.js';
import areasData from '../data/areas.json';

// ローポリ × デジタル東京のチャンクストリーミング。
// 42.195km を 1 枚のマップにせず、前方のチャンクを生成 → 走る → 後方のスロットを再利用。
// 道路・歩道・柵はチャンクごとの「中心線に沿ったリボン」なのでカーブに追従する。
// ビル・看板・街灯はグローバル InstancedMesh の「スロット範囲」に書き込む（GC なし、draw call 固定）。

const L = CONFIG.chunk.length;
const SLOTS = CONFIG.chunk.ahead + CONFIG.chunk.behind + 2;
const PER = { building: 36, vsign: 10, hsign: 8, lamp: 10, cross: 1 };
const HALF = CONFIG.road.halfWidth;
const SW = CONFIG.road.sidewalk + 1;
const BUILD_X = HALF + CONFIG.road.sidewalk + 0.5;
const SECTIONS = 41; // 1 チャンク 120 単位を 3 単位刻みで
const MOAT = { wall: -12.6, water: -46, deckIn: -12.6, deckOut: -15.8, waterY: -0.9, deckY: 1.2 };

const BUILDING_VERT = /* glsl */ `
attribute vec3 iWin;
attribute vec3 iFacade;
attribute vec2 iParams;
varying vec3 vBPos;
varying vec3 vBNorm;
varying vec3 vBScale;
varying vec3 vWin;
varying vec3 vFacade;
varying vec2 vParams;
`;

const BUILDING_FRAG = /* glsl */ `
varying vec3 vBPos;
varying vec3 vBNorm;
varying vec3 vBScale;
varying vec3 vWin;
varying vec3 vFacade;
varying vec2 vParams;
uniform float uTime;
uniform float uWindowBoost;
uniform float uWire;
uniform float uCrowdWin;
float bhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

function createBuildingMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = { uTime: { value: 0 }, uWindowBoost: { value: 1 }, uWire: { value: 0 }, uCrowdWin: { value: 0 } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${BUILDING_VERT}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vBPos = position * vBScale;
        vBNorm = normal;
        vWin = iWin; vFacade = iFacade; vParams = iParams;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BUILDING_FRAG}`)
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vFacade;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (abs(vBNorm.y) < 0.5) {
          bool sideX = abs(vBNorm.x) > 0.5;
          float u = sideX ? vBPos.z : vBPos.x;
          float v = vBPos.y;
          vec2 cellSize = vec2(3.0, 3.6);
          vec2 id = floor(vec2(u, v) / cellSize);
          vec2 f = fract(vec2(u, v) / cellSize);
          float inWin = step(0.16, f.x) * step(f.x, 0.84) * step(0.22, f.y) * step(f.y, 0.8);
          float seed = vParams.x * 17.31 + (sideX ? vBNorm.x : vBNorm.z * 3.0);
          float lit = step(0.64 - uCrowdWin * 0.34, bhash(id + seed));
          vec3 wcol = vWin * (0.3 + 0.55 * bhash(id * 1.37 + seed));
          // 1500m「観客、多すぎ」: 明かりのついた窓ごとに、手を振る人影
          float sil = 0.0;
          if (uCrowdWin > 0.01) {
            float pid = bhash(id * 3.1 + seed + 0.5);
            if (pid < uCrowdWin * 0.9) {
              float head = step(length((f - vec2(0.5, 0.63)) * vec2(1.0, 1.3)), 0.1);
              float body = step(abs(f.x - 0.5), 0.16) * step(0.22, f.y) * step(f.y, 0.53);
              float wave = sin(uTime * 7.0 + pid * 40.0);
              vec2 arm = f - vec2(0.5 + (pid < uCrowdWin * 0.45 ? 0.19 : -0.19), 0.5);
              float armM = step(abs(arm.x - arm.y * 0.5 * wave), 0.045) * step(0.0, arm.y) * step(arm.y, 0.26);
              sil = max(max(head, body), armM) * inWin * lit;
            }
          }
          totalEmissiveRadiance += wcol * inWin * lit * 0.75 * uWindowBoost * (1.0 + uCrowdWin * 0.5) * (1.0 - sil * 0.92);
          // 屋上の手すりに並ぶ観客（壁の最上部に頭と肩のシルエット、ぴょこぴょこ跳ねる）
          if (uCrowdWin > 0.01) {
            float top = vBScale.y - v;
            float cell = floor(u / 0.75);
            float hop = max(0.0, sin(uTime * 8.0 + cell * 2.3)) * 0.25;
            float cx = fract(u / 0.75) - 0.5;
            float headR = length(vec2(cx * 0.75, top - 0.62 + hop) * vec2(1.0, 1.1));
            float person = max(step(headR, 0.17), step(abs(cx), 0.26) * step(top, 0.52 + hop) * step(0.0, top));
            float rp = person * step(bhash(vec2(cell, vParams.x * 9.0)), uCrowdWin * 0.9) * step(top, 1.2);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.015), rp);
            totalEmissiveRadiance *= 1.0 - rp * 0.95;
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.04, 0.07), inWin * (1.0 - lit));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.01), sil);
          // 1 階の店舗の明かり
          float shop = step(v, 3.2) * step(0.6, v) * step(0.08, f.x) * step(f.x, 0.92);
          totalEmissiveRadiance += vWin * shop * 0.28;
          // 角のネオン帯
          if (vParams.y > 0.5) {
            float halfW = (sideX ? vBScale.z : vBScale.x) * 0.5;
            float edge = smoothstep(0.45, 0.0, halfW - abs(u));
            vec3 neonC = 0.5 + 0.5 * cos(6.2831 * (vParams.x + vec3(0.0, 0.33, 0.67)));
            float pulse = 0.75 + 0.25 * sin(uTime * 3.0 + vParams.x * 40.0);
            totalEmissiveRadiance += neonC * edge * 1.8 * pulse;
          }
        }
        // 「東京、読み込み中」: ワイヤーフレームを発光させる
        totalEmissiveRadiance += vec3(0.25, 0.95, 1.1) * uWire * (0.8 + 0.2 * sin(uTime * 20.0 + vBPos.y));`
      );
  };
  mat.customProgramCacheKey = () => 'tokyo-building-v3';
  return mat;
}

function instancedAttr(count, size) {
  return new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
}

function createSignMesh(texture, cols, rows, w, h, count) {
  const geo = new THREE.PlaneGeometry(w, h);
  geo.setAttribute('iUv', instancedAttr(count, 2));
  const mat = new THREE.MeshBasicMaterial({ map: texture });
  mat.color.setScalar(1.3);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 iUv;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vMapUv * vec2(${(1 / cols).toFixed(5)}, ${(1 / rows).toFixed(5)}) + iUv;`);
  };
  mat.customProgramCacheKey = () => `sign-${cols}x${rows}`;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  return mesh;
}

// 中心線に沿ったリボン（strips 本 × SECTIONS 断面 × 2 頂点）
function createRibbonGeometry(strips) {
  const n = strips * SECTIONS * 2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  // 陸上トラック度（0 = 東京の道路 / 1 = トラック）。スタジアムの出入口でなめらかに変わる
  geo.setAttribute('aTrack', new THREE.BufferAttribute(new Float32Array(n), 1));
  const idx = [];
  for (let r = 0; r < strips; r++) {
    for (let k = 0; k < SECTIONS - 1; k++) {
      const a = (r * SECTIONS + k) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geo.setIndex(idx);
  return geo;
}

// リボンの素材に「トラック」を混ぜるシェーダー差分（aTrack = 0 なら元の見た目のまま）
function withTrackBlend(mat, kind) {
  const trackColor = {
    road: 'vec3(0.50, 0.12, 0.06)',
    apron: 'vec3(0.42, 0.10, 0.05)',
    wall: 'vec3(0.05, 0.13, 0.48)',
  }[kind];
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTrack;\nvarying float vTrack;\nvarying vec2 vRUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrack = aTrack;\nvRUv = uv;');
    let lanes = '';
    if (kind === 'road') {
      // 8 レーンの白線（端の 2 本を含めて 9 本）
      lanes = `float lx = vRUv.x * 8.0;
        float ld = min(fract(lx), 1.0 - fract(lx));
        float lw = fwidth(lx) * 0.8 + 0.02;
        tc = mix(tc, vec3(0.9), 1.0 - smoothstep(lw * 0.5, lw, ld));`;
    } else if (kind === 'wall') {
      lanes = 'tc = mix(tc, vec3(0.92), step(0.82, vRUv.y));';
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTrack;\nvarying vec2 vRUv;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (vTrack > 0.001) {
          vec3 tc = ${trackColor};
          ${lanes}
          diffuseColor.rgb = mix(diffuseColor.rgb, tc, vTrack);
        }`
      );
  };
  mat.customProgramCacheKey = () => `track-blend-${kind}`;
  return mat;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class TokyoChunkManager {
  constructor(scene, distance, slice, path) {
    this.scene = scene;
    this.distance = distance;
    this.slice = slice;
    this.path = path;
    this.areas = slice.areas ?? areasData.areas;
    // ランドマーク生成時に渡す共有情報（観客の uniform・レース時計など。Game が足す）
    this.landmarkCtx = { path, distance };
    this.slotChunk = new Array(SLOTS).fill(null);
    this.chunkSlot = new Map();
    this.time = 0;

    const range = (type, pad = 0) =>
      slice.landmarks
        .filter((l) => l.type === type)
        .map((l) => [distance.kmToUnits(l.km) - pad, distance.kmToUnits(l.until) + pad]);
    this.backdropRanges = range('backdrop2d', 40);
    this.moatRanges = range('moat');
    this.skyRanges = range('sky');
    this.stadiumRanges = range('stadium');
    // 信号のある交差点は、横切る道路のためにビルを建てない
    // 東京ドームの側は奥のビルを建てない
    this.domeRanges = slice.landmarks
      .filter((l) => l.type === 'dome')
      .map((l) => ({ side: l.side ?? 1, a: distance.kmToUnits(l.km) - 50, b: distance.kmToUnits(l.km) + 50 }));
    this.gapRanges = slice.landmarks
      .filter((l) => l.type === 'signal')
      .map((l) => [distance.kmToUnits(l.km) - 6, distance.kmToUnits(l.km) + 20]);

    this.buildRibbons();
    this.buildInstanced();
    this.buildSkyline();

    this.landmarks = slice.landmarks
      .map((lm) => ({ def: lm, s: distance.kmToUnits(lm.km), built: null }))
      .sort((a, b) => a.s - b.s);
  }

  areaAt(km) {
    let a = this.areas[0];
    for (const area of this.areas) if (km >= area.fromKm) a = area;
    return a;
  }

  // ---- 道路・歩道・柵・お堀: スロットごとのリボンメッシュ
  buildRibbons() {
    const roadTex = makeRoadTexture();
    const swTex = makeSidewalkTexture();
    const fenceTex = makeFenceTexture();
    const mats = {
      road: withTrackBlend(new THREE.MeshLambertMaterial({ map: roadTex }), 'road'),
      sidewalk: withTrackBlend(new THREE.MeshLambertMaterial({ map: swTex }), 'apron'),
      fence: withTrackBlend(new THREE.MeshLambertMaterial({ map: fenceTex, side: THREE.DoubleSide, emissive: 0x0a1a55 }), 'wall'),
      // 雲の上: 光るガラスの道と、ネオンの手すり
      skyRoad: new THREE.MeshLambertMaterial({ map: roadTex, color: 0xa8d8ff, emissive: 0x1a4a88 }),
      rail: (() => {
        const m = new THREE.MeshBasicMaterial({ color: 0x9ff2ff, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
        m.color.multiplyScalar(1.4);
        return m;
      })(),
      moat: [
        new THREE.MeshPhongMaterial({ color: 0x1d5a8a, emissive: 0x0c2e52, specular: 0x9ab8ff, shininess: 120 }),
        new THREE.MeshLambertMaterial({ color: 0x4a4852, side: THREE.DoubleSide }),
        new THREE.MeshLambertMaterial({ color: 0x5a5c66 }),
      ],
    };
    this.ribbonMats = mats;
    this.slotMeshes = [];
    for (let slot = 0; slot < SLOTS; slot++) {
      const road = new THREE.Mesh(createRibbonGeometry(1), mats.road);
      const sidewalk = new THREE.Mesh(createRibbonGeometry(2), mats.sidewalk);
      const fence = new THREE.Mesh(createRibbonGeometry(2), mats.fence);
      const moatGeo = createRibbonGeometry(3);
      const per = (SECTIONS - 1) * 6;
      moatGeo.addGroup(0, per, 0);
      moatGeo.addGroup(per, per, 1);
      moatGeo.addGroup(per * 2, per, 2);
      const moat = new THREE.Mesh(moatGeo, mats.moat);
      const meshes = { road, sidewalk, fence, moat };
      for (const m of Object.values(meshes)) {
        m.frustumCulled = false;
        m.visible = false;
        this.scene.add(m);
      }
      this.slotMeshes.push(meshes);
    }

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ color: 0x0d0d14 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -1.0;
    this.scene.add(this.ground);
    this.cloudFloor = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8a9cc4 }));
    this.cloudFloor.rotation.x = -Math.PI / 2;
    this.cloudFloor.visible = false;
    this.scene.add(this.cloudFloor);
  }

  // リボン 1 本分（断面 k の 2 頂点）を書き込む
  writeRibbon(geo, strip, k, s, x0, y0, x1, y1, uv0, uv1, normal) {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const i = (strip * SECTIONS + k) * 2;
    this.path.toWorld(s, x0, y0, _p);
    pos.setXYZ(i, _p.x, _p.y, _p.z);
    this.path.toWorld(s, x1, y1, _p);
    pos.setXYZ(i + 1, _p.x, _p.y, _p.z);
    nor.setXYZ(i, normal.x, normal.y, normal.z);
    nor.setXYZ(i + 1, normal.x, normal.y, normal.z);
    uv.setXY(i, uv0[0], uv0[1]);
    uv.setXY(i + 1, uv1[0], uv1[1]);
  }

  fillRibbons(slot, s0) {
    const { road, sidewalk, fence, moat } = this.slotMeshes[slot];
    let anyMoat = false;
    const side = new THREE.Vector3();
    const tr = [road.geometry.attributes.aTrack, sidewalk.geometry.attributes.aTrack, fence.geometry.attributes.aTrack];
    for (let k = 0; k < SECTIONS; k++) {
      const s = s0 + (k * L) / (SECTIONS - 1);
      const t = this.trackAmount(s);
      for (let v = 0; v < 4; v++) {
        if (v < 2) tr[0].setX(k * 2 + v, t);
        tr[1].setX(k * 2 + (v % 2) + (v >> 1) * SECTIONS * 2, t);
        tr[2].setX(k * 2 + (v % 2) + (v >> 1) * SECTIONS * 2, t);
      }
      const f = this.path.sample(s);
      side.set(f.cos, 0, -f.sin); // 右方向 R
      this.writeRibbon(road.geometry, 0, k, s, -HALF, 0, HALF, 0, [0, s / 14], [1, s / 14], _up);
      this.writeRibbon(sidewalk.geometry, 0, k, s, -HALF - SW, 0.12, -HALF, 0.12, [0, s / 4], [1.4, s / 4], _up);
      this.writeRibbon(sidewalk.geometry, 1, k, s, HALF, 0.12, HALF + SW, 0.12, [0, s / 4], [1.4, s / 4], _up);
      const fx = HALF + 0.35;
      this.writeRibbon(fence.geometry, 0, k, s, -fx, 0.12, -fx, 1.12, [s / 16, 0], [s / 16, 1], side);
      this.writeRibbon(fence.geometry, 1, k, s, fx, 0.12, fx, 1.12, [-s / 16, 0], [-s / 16, 1], side.clone().negate());

      // お堀（左側）: 範囲外は幅ゼロに潰す
      const inMoat = this.inMoat(s);
      anyMoat ||= inMoat;
      const w = inMoat ? 1 : 0;
      this.writeRibbon(moat.geometry, 0, k, s, MOAT.wall + (MOAT.water - MOAT.wall) * w, MOAT.waterY, MOAT.wall, MOAT.waterY, [0, 0], [0, 0], _up);
      this.writeRibbon(moat.geometry, 1, k, s, MOAT.wall, MOAT.waterY + (0.12 - MOAT.waterY) * w, MOAT.wall, MOAT.waterY, [0, 0], [0, 0], side);
      this.writeRibbon(moat.geometry, 2, k, s, MOAT.deckOut * w + MOAT.deckIn * (1 - w), MOAT.deckY, MOAT.deckIn, MOAT.deckY, [0, 0], [0, 0], _up);
    }
    for (const m of [road, sidewalk, fence, moat]) {
      const g = m.geometry.attributes;
      g.position.needsUpdate = g.normal.needsUpdate = g.uv.needsUpdate = g.aTrack.needsUpdate = true;
      m.visible = true;
    }
    moat.visible = anyMoat;
    // 雲の上のチャンク: 歩道なし、道はガラス、柵はネオンの手すり
    const sky = this.inSky(s0 + L / 2);
    road.material = sky ? this.ribbonMats.skyRoad : this.ribbonMats.road;
    fence.material = sky ? this.ribbonMats.rail : this.ribbonMats.fence;
    sidewalk.visible = !sky;
  }

  buildInstanced() {
    const n = SLOTS * PER.building;
    const bgeo = new THREE.BoxGeometry(1, 1, 1);
    bgeo.translate(0, 0.5, 0);
    bgeo.setAttribute('iWin', instancedAttr(n, 3));
    bgeo.setAttribute('iFacade', instancedAttr(n, 3));
    bgeo.setAttribute('iParams', instancedAttr(n, 2));
    this.buildingMaterial = createBuildingMaterial();
    this.buildings = new THREE.InstancedMesh(bgeo, this.buildingMaterial, n);
    this.buildings.frustumCulled = false;
    this.scene.add(this.buildings);

    const atlases = makeSignAtlases();
    this.vsigns = createSignMesh(atlases.vertical, 8, 1, 1.5, 6.0, SLOTS * PER.vsign);
    this.hsigns = createSignMesh(atlases.horizontal, 4, 4, 5.0, 2.5, SLOTS * PER.hsign);
    this.scene.add(this.vsigns, this.hsigns);

    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 7, 6);
    poleGeo.translate(0, 3.5, 0);
    this.poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x3a3d48 }), SLOTS * PER.lamp);
    const headGeo = new THREE.BoxGeometry(0.5, 0.18, 1.3);
    headGeo.translate(0, 7, 0);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });
    headMat.color.multiplyScalar(1.25);
    this.lampHeads = new THREE.InstancedMesh(headGeo, headMat, SLOTS * PER.lamp);
    this.poles.frustumCulled = this.lampHeads.frustumCulled = false;
    this.scene.add(this.poles, this.lampHeads);

    const cw = document.createElement('canvas');
    cw.width = 256;
    cw.height = 32;
    const g = cw.getContext('2d');
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = 'rgba(240,240,240,0.85)';
      g.fillRect(x + 4, 0, 18, 32);
    }
    const cwTex = new THREE.CanvasTexture(cw);
    cwTex.colorSpace = THREE.SRGBColorSpace;
    const crossGeo = new THREE.PlaneGeometry(HALF * 2, 4.5);
    crossGeo.rotateX(-Math.PI / 2);
    crossGeo.translate(0, 0.025, 0);
    this.crosswalks = new THREE.InstancedMesh(
      crossGeo,
      new THREE.MeshLambertMaterial({ map: cwTex, transparent: true, depthWrite: false }),
      SLOTS * PER.cross
    );
    this.crosswalks.frustumCulled = false;
    this.scene.add(this.crosswalks);

    for (const mesh of [this.buildings, this.vsigns, this.hsigns, this.poles, this.lampHeads, this.crosswalks]) {
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, ZERO);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // 遠景のスカイライン（プレイヤーに追従 → 無限遠に見える）
  buildSkyline() {
    const n = 160;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    geo.setAttribute('iWin', instancedAttr(n, 3));
    geo.setAttribute('iFacade', instancedAttr(n, 3));
    geo.setAttribute('iParams', instancedAttr(n, 2));
    this.skyline = new THREE.InstancedMesh(geo, this.buildingMaterial, n);
    this.skyline.frustumCulled = false;
    const rng = createRng(4242);
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * rng.range(95, 320);
      const z = rng.range(-520, 120);
      const h = rng.range(40, 190);
      const w = rng.range(14, 34);
      _m.compose(_p.set(x, 0, z), _q.identity(), _s.set(w, h, w));
      this.skyline.setMatrixAt(i, _m);
      geo.attributes.iWin.setXYZ(i, 0.55, 0.65, 1.0);
      geo.attributes.iFacade.setXYZ(i, 0.07, 0.08, 0.12);
      geo.attributes.iParams.setXY(i, rng.next(), rng.chance(0.25) ? 1 : 0);
    }
    this.scene.add(this.skyline);
  }

  // 1500m: ビルの窓に観客（0〜1）。区間の出入りでなめらかに
  setCrowdWindows(v) {
    this.crowdWinTarget = v;
  }

  setWireframe(on) {
    this.buildingMaterial.wireframe = on;
    this.buildingMaterial.userData.uniforms.uWire.value = on ? 1 : 0;
  }

  reset() {
    for (let slot = 0; slot < SLOTS; slot++) {
      if (this.slotChunk[slot] !== null) this.clearSlot(slot);
      this.slotChunk[slot] = null;
    }
    this.chunkSlot.clear();
    this.setWireframe(false);
    for (const lm of this.landmarks) {
      if (lm.built) {
        this.scene.remove(lm.built.group);
        disposeObject(lm.built.group);
        lm.built = null;
      }
    }
  }

  update(playerS, dt, sideBlend = 0) {
    this.time += dt;
    const bu = this.buildingMaterial.userData.uniforms;
    bu.uTime.value = this.time;
    bu.uCrowdWin.value += ((this.crowdWinTarget ?? 0) - bu.uCrowdWin.value) * Math.min(1, dt * 2);

    const f = this.path.sample(playerS);
    this.ground.position.set(f.x, -1.0, f.z);
    this.skyline.position.set(f.x, 0, f.z);
    this.skyline.rotation.y = f.theta;
    const skyAmt = this.skyAmount(playerS);
    this.skyline.visible = sideBlend < 0.5 && skyAmt < 0.5;
    this.ground.visible = skyAmt < 0.5;
    this.cloudFloor.visible = skyAmt > 0.01;
    this.cloudFloor.position.set(f.x, -7, f.z);

    // チャンクの確保と再利用
    const first = Math.floor(playerS / L) - CONFIG.chunk.behind;
    const last = Math.floor(playerS / L) + CONFIG.chunk.ahead;
    for (let slot = 0; slot < SLOTS; slot++) {
      const idx = this.slotChunk[slot];
      if (idx !== null && (idx < first || idx > last)) {
        this.clearSlot(slot);
        this.chunkSlot.delete(idx);
        this.slotChunk[slot] = null;
      }
    }
    for (let idx = first; idx <= last; idx++) {
      if (this.chunkSlot.has(idx)) continue;
      const slot = this.slotChunk.indexOf(null);
      if (slot < 0) break;
      this.slotChunk[slot] = idx;
      this.chunkSlot.set(idx, slot);
      this.fillSlot(slot, idx);
    }

    this.updateLandmarks(playerS, dt, sideBlend);
  }

  inBackdropRange(s) {
    return this.backdropRanges.some(([a, b]) => s >= a && s <= b);
  }

  inGap(a, b) {
    return this.gapRanges.some(([g0, g1]) => b > g0 && a < g1);
  }

  inSky(s) {
    return this.skyRanges.some(([a, b]) => s >= a && s <= b);
  }

  // 雲の上へのフェード（0〜1）。空の色・フォグ・照明の切り替えに使う
  skyAmount(s) {
    let v = 0;
    for (const [a, b] of this.skyRanges) v = Math.max(v, smoothstep(a - 40, a + 10, s) * (1 - smoothstep(b - 10, b + 40, s)));
    return v;
  }

  inMoat(s) {
    return this.moatRanges.some(([a, b]) => s >= a && s <= b);
  }

  inStadium(s) {
    return this.stadiumRanges.some(([a, b]) => s >= a && s <= b);
  }

  // トラック（1）↔ 道路（0）: スタジアムの外 40 単位でなめらかに切り替わる
  trackAmount(s) {
    let v = 0;
    for (const [a, b] of this.stadiumRanges) v = Math.max(v, smoothstep(a - 40, a, s) * (1 - smoothstep(b, b + 40, s)));
    return v;
  }

  // スタジアムの照明（空の色・環境光に使う）
  stadiumAmount(s) {
    let v = 0;
    for (const [a, b] of this.stadiumRanges) v = Math.max(v, smoothstep(a - 30, a + 20, s) * (1 - smoothstep(b - 20, b + 30, s)));
    return v;
  }

  clearSlot(slot) {
    const ranges = [
      [this.buildings, PER.building],
      [this.vsigns, PER.vsign],
      [this.hsigns, PER.hsign],
      [this.poles, PER.lamp],
      [this.lampHeads, PER.lamp],
      [this.crosswalks, PER.cross],
    ];
    for (const [mesh, per] of ranges) {
      for (let i = 0; i < per; i++) mesh.setMatrixAt(slot * per + i, ZERO);
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const m of Object.values(this.slotMeshes[slot])) m.visible = false;
  }

  // (s, x, y) に、進行方向 + yawOffset を向いた行列を作る
  placeMatrix(s, x, y, yawOffset, sx, sy, sz) {
    const f = this.path.sample(s);
    _p.set(f.x + f.cos * x, y, f.z - f.sin * x);
    _e.set(0, f.theta + yawOffset, 0);
    _m.compose(_p, _q.setFromEuler(_e), _s.set(sx, sy, sz));
    return _m;
  }

  fillSlot(slot, idx) {
    this.clearSlot(slot);
    const rng = createRng(hashInt(idx * 7919 + 17));
    const s0 = idx * L;
    const km = this.distance.unitsToKm(s0 + L / 2);
    const area = this.areaAt(km);
    this.fillRibbons(slot, s0);

    const b = { i: 0, v: 0, h: 0, lamp: 0 };
    const battr = this.buildings.geometry.attributes;
    const [hMin, hMax] = area.height;

    const cross = idx > 0 && !this.inSky(s0 + L / 2) && !this.inStadium(s0 + L / 2) && rng.chance(0.45) ? rng.range(28, 92) : null;
    if (cross !== null) this.crosswalks.setMatrixAt(slot * PER.cross, this.placeMatrix(s0 + cross, 0, 0, 0, 1, 1, 1));

    const putBuilding = (x, sCenter, depth, height, width, neon) => {
      if (b.i >= PER.building) return;
      const i = slot * PER.building + b.i++;
      this.buildings.setMatrixAt(i, this.placeMatrix(sCenter, x, 0, 0, depth, height, width));
      const w = area.window;
      const tint = rng.range(0.75, 1.15);
      battr.iWin.setXYZ(i, w[0] * tint, w[1] * tint, w[2] * tint);
      const f = area.facade;
      const fv = rng.range(0.8, 1.35);
      battr.iFacade.setXYZ(i, f[0] * fv, f[1] * fv, f[2] * fv);
      battr.iParams.setXY(i, rng.next(), neon ? 1 : 0);
    };

    for (const side of [-1, 1]) {
      const faceYaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      let t = rng.range(0, 3);
      while (t < L - 4) {
        const width = area.style === 'towers' ? rng.range(14, 26) : rng.range(8, 17);
        if (cross !== null && t + width > cross - 6 && t < cross + 6) {
          t = cross + 6;
          continue;
        }
        const depth = rng.range(10, 22);
        const sCenter = s0 + t + width / 2;
        t += width + rng.range(0.4, 2.8);
        // お堀側（左）・交差点・雲の上には手前のビルを建てない
        if (this.inSky(sCenter)) continue;
        if (this.inStadium(sCenter - width / 2) || this.inStadium(sCenter + width / 2)) continue;
        if (side < 0 && this.inMoat(sCenter)) continue;
        if (this.inGap(sCenter - width / 2, sCenter + width / 2)) continue;
        let height = rng.range(hMin, hMax);
        const lowRise = side < 0 && this.inBackdropRange(sCenter);
        if (lowRise) height = rng.range(3.4, 5.5);
        putBuilding(side * (BUILD_X + depth / 2), sCenter, depth, height, width, !lowRise && rng.chance(area.neon * 0.35));

        if (!lowRise && rng.chance(area.neon * 0.7) && b.v < PER.vsign) {
          const i = slot * PER.vsign + b.v++;
          const y = Math.min(height - 3.5, rng.range(5, 11));
          if (y > 3.5) {
            this.vsigns.setMatrixAt(i, this.placeMatrix(sCenter + rng.range(-width / 3, width / 3), side * (BUILD_X - 0.25), y, faceYaw, 1, 1, 1));
            this.vsigns.geometry.attributes.iUv.setXY(i, rng.int(0, 7) / 8, 0);
          }
        }
        if (!lowRise && rng.chance(area.neon * 0.55) && b.h < PER.hsign) {
          const i = slot * PER.hsign + b.h++;
          const y = Math.min(height - 2, rng.range(3.6, 8.5));
          this.hsigns.setMatrixAt(i, this.placeMatrix(sCenter, side * (BUILD_X - 0.12), y, faceYaw, 1, 1, 1));
          const cell = rng.int(0, 15);
          this.hsigns.geometry.attributes.iUv.setXY(i, (cell % 4) / 4, 1 - (Math.floor(cell / 4) + 1) / 4);
        }
      }
      // 奥の高層ビル
      const backCount = area.style === 'towers' ? 5 : 3;
      for (let k = 0; k < backCount; k++) {
        const sCenter = s0 + rng.range(8, L - 8);
        const w = rng.range(16, 30);
        const x = side * rng.range(52, 84);
        const h = rng.range(hMax * 0.8, hMax * 1.6);
        if (side < 0 && this.inBackdropRange(sCenter)) continue;
        if (this.inSky(sCenter)) continue;
        if (this.domeRanges.some((r) => r.side === side && sCenter > r.a && sCenter < r.b)) continue;
        putBuilding(x, sCenter, w, h, w, rng.chance(0.3));
      }
    }

    // 街灯
    for (let k = 0; k < 4; k++) {
      for (const side of [-1, 1]) {
        if (b.lamp >= PER.lamp) break;
        const i = slot * PER.lamp + b.lamp++;
        const s = s0 + 15 + k * 30;
        if (this.inSky(s) || this.inStadium(s)) continue;
        this.poles.setMatrixAt(i, this.placeMatrix(s, side * (HALF + 0.9), 0, 0, 1, 1, 1));
        this.lampHeads.setMatrixAt(i, this.placeMatrix(s, side * (HALF + 0.3), 0, 0, 1, 1, 1));
      }
    }

    for (const mesh of [this.buildings, this.vsigns, this.hsigns, this.poles, this.lampHeads, this.crosswalks]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    battr.iWin.needsUpdate = battr.iFacade.needsUpdate = battr.iParams.needsUpdate = true;
    this.vsigns.geometry.attributes.iUv.needsUpdate = true;
    this.hsigns.geometry.attributes.iUv.needsUpdate = true;
  }

  placeGroup(group, s) {
    const f = this.path.sample(s);
    group.position.set(f.x, 0, f.z);
    group.rotation.y = f.theta;
  }

  updateLandmarks(playerS, dt, sideBlend) {
    const buildAhead = 420;
    const dropBehind = 160;
    for (const lm of this.landmarks) {
      const rel = lm.s - playerS;
      let active = rel < buildAhead && rel > -dropBehind;
      if (lm.def.until !== undefined) {
        const until = this.distance.kmToUnits(lm.def.until);
        active = playerS > lm.s - buildAhead && playerS < until + dropBehind;
      }
      if (lm.def.type === 'moat') active = false; // お堀はリボンで描く
      if (active && !lm.built) {
        lm.built = buildLandmark(lm.def, this.landmarkCtx);
        if (lm.built) {
          if (!lm.built.worldSpace) this.placeGroup(lm.built.group, lm.s);
          this.scene.add(lm.built.group);
        }
      } else if (!active && lm.built) {
        this.scene.remove(lm.built.group);
        disposeObject(lm.built.group);
        lm.built = null;
      }
      if (lm.built) {
        lm.built.update?.(dt, playerS - lm.s);
        if (lm.built.followsPlayer) {
          this.placeGroup(lm.built.group, playerS);
          lm.built.setOpacity?.(smoothstep(0.35, 0.95, sideBlend));
        }
      }
    }
  }

  getLandmark(type) {
    return this.landmarks.find((l) => l.def.type === type)?.built ?? null;
  }

  getLandmarkById(id) {
    return this.landmarks.find((l) => l.def.id === id)?.built ?? null;
  }

  landmarkS(idOrType) {
    return this.landmarks.find((l) => l.def.id === idOrType || l.def.type === idOrType)?.s ?? null;
  }
}
