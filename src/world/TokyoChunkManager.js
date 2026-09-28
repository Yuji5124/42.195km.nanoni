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
// ビル・看板・街灯はすべてグローバル InstancedMesh の「スロット範囲」に書き込む（GC なし、draw call 固定）。

const L = CONFIG.chunk.length;
const SLOTS = CONFIG.chunk.ahead + CONFIG.chunk.behind + 2;
const PER = { building: 36, vsign: 10, hsign: 8, lamp: 10, cross: 1 };
const HALF = CONFIG.road.halfWidth;
const BUILD_X = HALF + CONFIG.road.sidewalk + 0.5;

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
float bhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

function createBuildingMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = { uTime: { value: 0 }, uWindowBoost: { value: 1 } };
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
          float lit = step(0.64, bhash(id + seed));
          vec3 wcol = vWin * (0.3 + 0.55 * bhash(id * 1.37 + seed));
          totalEmissiveRadiance += wcol * inWin * lit * 0.75 * uWindowBoost;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.04, 0.07), inWin * (1.0 - lit));
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
        }`
      );
  };
  mat.customProgramCacheKey = () => 'tokyo-building-v1';
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

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _c = new THREE.Color();

export class TokyoChunkManager {
  constructor(scene, distance, slice) {
    this.scene = scene;
    this.distance = distance;
    this.slice = slice;
    this.areas = areasData.areas;
    this.slotChunk = new Array(SLOTS).fill(null);
    this.chunkSlot = new Map();
    this.time = 0;

    this.backdropRanges = slice.landmarks
      .filter((l) => l.type === 'backdrop2d')
      .map((l) => [distance.kmToUnits(l.km) - 40, distance.kmToUnits(l.until) + 40]);

    this.buildStatic();
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

  // ---- 道路・歩道・柵: プレイヤーに追従する長い平面（テクスチャ周期でスナップしてズレを防ぐ）
  buildStatic() {
    const len = (CONFIG.chunk.ahead + CONFIG.chunk.behind + 1) * L;
    this.stripLength = len;

    const roadTex = makeRoadTexture();
    const road = new THREE.PlaneGeometry(HALF * 2, len, 1, 1);
    road.rotateX(-Math.PI / 2);
    this.scaleUv(road, 1, len / 14);
    this.road = new THREE.Mesh(road, new THREE.MeshLambertMaterial({ map: roadTex }));
    this.road.userData.period = 14;

    const swTex = makeSidewalkTexture();
    const sw = new THREE.PlaneGeometry(CONFIG.road.sidewalk + 1, len);
    sw.rotateX(-Math.PI / 2);
    this.scaleUv(sw, 1.4, len / 4);
    const swMat = new THREE.MeshLambertMaterial({ map: swTex });
    this.sidewalks = [-1, 1].map((side) => {
      const m = new THREE.Mesh(sw, swMat);
      m.position.set(side * (HALF + (CONFIG.road.sidewalk + 1) / 2), 0.12, 0);
      m.userData.period = 4;
      return m;
    });

    const fenceTex = makeFenceTexture();
    const fence = new THREE.PlaneGeometry(len, 1.0);
    this.scaleUv(fence, len / 16, 1);
    const fenceMat = new THREE.MeshLambertMaterial({ map: fenceTex, side: THREE.DoubleSide, emissive: 0x0a1a55 });
    this.fences = [-1, 1].map((side) => {
      const m = new THREE.Mesh(fence, fenceMat);
      m.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      m.position.set(side * (HALF + 0.35), 0.62, 0);
      m.userData.period = 16;
      return m;
    });

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(900, len + 400),
      new THREE.MeshLambertMaterial({ color: 0x0d0d14 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.02;

    this.strips = [this.road, ...this.sidewalks, ...this.fences, this.ground];
    for (const m of this.strips) this.scene.add(m);
  }

  scaleUv(geo, su, sv) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
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
    this.crosswalks = new THREE.InstancedMesh(
      crossGeo,
      new THREE.MeshLambertMaterial({ map: cwTex, transparent: true, depthWrite: false }),
      SLOTS * PER.cross
    );
    this.crosswalks.frustumCulled = false;
    this.crosswalks.position.y = 0.025;
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

  reset() {
    for (let slot = 0; slot < SLOTS; slot++) {
      if (this.slotChunk[slot] !== null) this.clearSlot(slot);
      this.slotChunk[slot] = null;
    }
    this.chunkSlot.clear();
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
    this.buildingMaterial.userData.uniforms.uTime.value = this.time;

    // 追従ストリップ
    const pz = this.distance.worldZ(playerS);
    for (const m of this.strips) {
      const period = m.userData.period ?? 1;
      const center = pz - this.stripLength * 0.3;
      m.position.z = Math.round(center / period) * period;
    }
    this.skyline.position.z = pz;
    this.skyline.visible = sideBlend < 0.5;

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
  }

  fillSlot(slot, idx) {
    this.clearSlot(slot);
    const rng = createRng(hashInt(idx * 7919 + 17));
    const s0 = idx * L;
    const km = this.distance.unitsToKm(s0 + L / 2);
    const area = this.areaAt(km);
    const z = (s) => this.distance.worldZ(s);

    const b = { i: 0, v: 0, h: 0, lamp: 0 };
    const battr = this.buildings.geometry.attributes;
    const [hMin, hMax] = area.height;

    const cross = idx > 0 && rng.chance(0.45) ? rng.range(28, 92) : null;
    if (cross !== null) {
      _m.makeTranslation(0, 0, z(s0 + cross));
      this.crosswalks.setMatrixAt(slot * PER.cross, _m);
    }

    const putBuilding = (x, sCenter, depth, height, width, neon) => {
      if (b.i >= PER.building) return;
      const i = slot * PER.building + b.i++;
      _m.compose(_p.set(x, 0, z(sCenter)), _q.identity(), _s.set(depth, height, width));
      this.buildings.setMatrixAt(i, _m);
      const w = area.window;
      const tint = rng.range(0.75, 1.15);
      battr.iWin.setXYZ(i, w[0] * tint, w[1] * tint, w[2] * tint);
      const f = area.facade;
      const fv = rng.range(0.8, 1.35);
      battr.iFacade.setXYZ(i, f[0] * fv, f[1] * fv, f[2] * fv);
      battr.iParams.setXY(i, rng.next(), neon ? 1 : 0);
    };

    for (const side of [-1, 1]) {
      let t = rng.range(0, 3);
      while (t < L - 4) {
        const width = area.style === 'towers' ? rng.range(14, 26) : rng.range(8, 17);
        if (cross !== null && t + width > cross - 6 && t < cross + 6) {
          t = cross + 6;
          continue;
        }
        const depth = rng.range(10, 22);
        const sCenter = s0 + t + width / 2;
        let height = rng.range(hMin, hMax);
        const lowRise = side < 0 && this.inBackdropRange(sCenter);
        if (lowRise) height = rng.range(3.4, 5.5);
        putBuilding(side * (BUILD_X + depth / 2), sCenter, depth, height, width, !lowRise && rng.chance(area.neon * 0.35));

        if (!lowRise && rng.chance(area.neon * 0.7) && b.v < PER.vsign) {
          const i = slot * PER.vsign + b.v++;
          const y = Math.min(height - 3.5, rng.range(5, 11));
          if (y > 3.5) {
            _e.set(0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0);
            _m.compose(_p.set(side * (BUILD_X - 0.25), y, z(sCenter + rng.range(-width / 3, width / 3))), _q.setFromEuler(_e), _s.set(1, 1, 1));
            this.vsigns.setMatrixAt(i, _m);
            this.vsigns.geometry.attributes.iUv.setXY(i, rng.int(0, 7) / 8, 0);
          }
        }
        if (!lowRise && rng.chance(area.neon * 0.55) && b.h < PER.hsign) {
          const i = slot * PER.hsign + b.h++;
          const y = Math.min(height - 2, rng.range(3.6, 8.5));
          _e.set(0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0);
          _m.compose(_p.set(side * (BUILD_X - 0.12), y, z(sCenter)), _q.setFromEuler(_e), _s.set(1, 1, 1));
          this.hsigns.setMatrixAt(i, _m);
          const cell = rng.int(0, 15);
          this.hsigns.geometry.attributes.iUv.setXY(i, (cell % 4) / 4, 1 - (Math.floor(cell / 4) + 1) / 4);
        }
        t += width + rng.range(0.4, 2.8);
      }
      // 奥の高層ビル
      const backCount = area.style === 'towers' ? 5 : 3;
      for (let k = 0; k < backCount; k++) {
        const sCenter = s0 + rng.range(8, L - 8);
        if (side < 0 && this.inBackdropRange(sCenter)) continue;
        const w = rng.range(16, 30);
        putBuilding(side * rng.range(48, 80), sCenter, w, rng.range(hMax * 0.8, hMax * 1.6), w, rng.chance(0.3));
      }
    }

    // 街灯
    for (let k = 0; k < 4; k++) {
      for (const side of [-1, 1]) {
        if (b.lamp >= PER.lamp) break;
        const i = slot * PER.lamp + b.lamp++;
        _e.set(0, 0, 0);
        _m.compose(_p.set(side * (HALF + 0.9), 0, z(s0 + 15 + k * 30)), _q.identity(), _s.set(1, 1, 1));
        this.poles.setMatrixAt(i, _m);
        _m.compose(_p.set(side * (HALF + 0.3), 0, z(s0 + 15 + k * 30)), _q.identity(), _s.set(1, 1, 1));
        this.lampHeads.setMatrixAt(i, _m);
      }
    }

    for (const mesh of [this.buildings, this.vsigns, this.hsigns, this.poles, this.lampHeads, this.crosswalks]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    battr.iWin.needsUpdate = battr.iFacade.needsUpdate = battr.iParams.needsUpdate = true;
    this.vsigns.geometry.attributes.iUv.needsUpdate = true;
    this.hsigns.geometry.attributes.iUv.needsUpdate = true;
  }

  updateLandmarks(playerS, dt, sideBlend) {
    const buildAhead = 420;
    const dropBehind = 160;
    for (const lm of this.landmarks) {
      const rel = lm.s - playerS;
      let active = rel < buildAhead && rel > -dropBehind;
      if (lm.def.type === 'backdrop2d') {
        const until = this.distance.kmToUnits(lm.def.until);
        active = playerS > lm.s - 200 && playerS < until + 100;
      }
      if (active && !lm.built) {
        lm.built = buildLandmark(lm.def);
        if (lm.built) {
          lm.built.group.position.z = this.distance.worldZ(lm.s);
          this.scene.add(lm.built.group);
        }
      } else if (!active && lm.built) {
        this.scene.remove(lm.built.group);
        disposeObject(lm.built.group);
        lm.built = null;
      }
      if (lm.built) {
        lm.built.update?.(dt);
        if (lm.built.followsPlayer) {
          lm.built.group.position.z = this.distance.worldZ(playerS);
          lm.built.setOpacity?.(smoothstep(0.35, 0.95, sideBlend));
        }
      }
    }
  }

  getLandmark(type) {
    return this.landmarks.find((l) => l.def.type === type)?.built ?? null;
  }
}
