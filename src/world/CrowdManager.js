import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createRng, hashInt, clamp } from '../core/math.js';
import { createHumanMaterial, createHumanInstances, applyLook, randomSpectatorLook } from './RunnerModel.js';

const _v = new THREE.Vector3();

// 沿道の観客。リングバッファで「後方に流れた観客を前方へ再配置」する。
// 盛り上がり（excitement）はシェーダーの uniform だけで全員に反映 → CPU コストほぼゼロ。
//   段階: 拍手(腕) → 歓声(ジャンプ) → スマホ撮影(フラッシュ) → 紙吹雪(EffectManager)

const HALF = CONFIG.road.halfWidth;
const LANES = [
  { side: -1, row: 0 },
  { side: 1, row: 0 },
  { side: -1, row: 1 },
  { side: 1, row: 1 },
];

const FLASH_VERT = /* glsl */ `
attribute float aSeed;
attribute float aOn;
uniform float uTime;
uniform float uLevel;
uniform float uScale;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float t = uTime * (1.5 + fract(aSeed * 13.1) * 2.0) + aSeed * 50.0;
  float blink = step(0.93, fract(t)) ;
  vA = blink * aOn * uLevel;
  gl_PointSize = (vA > 0.0 ? 0.45 : 0.0) * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
const FLASH_FRAG = /* glsl */ `
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(d)) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * 2.0, a);
}
`;

export class CrowdManager {
  constructor(scene, distance, events, path) {
    this.scene = scene;
    this.distance = distance;
    this.path = path;
    this.events = events;
    this.spacing = CONFIG.crowd.spacing;
    this.perLane = Math.floor((CONFIG.crowd.windowAhead + CONFIG.crowd.windowBehind) / this.spacing);
    this.count = this.perLane * LANES.length;

    this.material = createHumanMaterial({ mode: 'spectator', rim: 0.08, rimColor: 0xff7ad9 });
    this.mesh = createHumanInstances(this.count, this.material, 'low');
    this.scene.add(this.mesh);

    // スマホのフラッシュ（最前列のみ）
    const flashN = this.perLane * 2;
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flashN * 3), 3));
    fgeo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(flashN), 1));
    fgeo.setAttribute('aOn', new THREE.BufferAttribute(new Float32Array(flashN), 1));
    this.flashUniforms = {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uScale: { value: 800 },
    };
    this.flashes = new THREE.Points(
      fgeo,
      new THREE.ShaderMaterial({
        vertexShader: FLASH_VERT,
        fragmentShader: FLASH_FRAG,
        uniforms: this.flashUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.flashes.frustumCulled = false;
    this.scene.add(this.flashes);

    this.laneBase = new Array(LANES.length).fill(null);
    this.time = 0;
  }

  reset() {
    this.laneBase.fill(null);
  }

  placeCell(laneIdx, cell) {
    const lane = LANES[laneIdx];
    const slot = ((cell % this.perLane) + this.perLane) % this.perLane;
    const i = laneIdx * this.perLane + slot;
    const rng = createRng(hashInt(cell * 131 + laneIdx * 977 + 5));
    const s = cell * this.spacing + rng.range(-0.25, 0.25);
    const km = this.distance.unitsToKm(s);
    const density = this.events.paramAt('crowd', km);
    const p = lane.row === 0 ? clamp(density, 0, 1) : clamp(density - 0.5, 0, 1);
    const visible = s > -40 && rng.next() < p;
    const arr = this.mesh.instanceMatrix.array;
    const x = lane.side * (HALF + 1.25 + lane.row * 0.95 + rng.range(-0.15, 0.2));
    const yaw = (lane.side < 0 ? -Math.PI / 2 : Math.PI / 2) + rng.range(-0.35, 0.35);
    this.path.writeMatrix(arr, i, s, x, 0.12, yaw, visible ? rng.range(0.92, 1.06) : 0);
    applyLook(this.mesh, i, randomSpectatorLook(rng));
    this.mesh.geometry.attributes.iAnim.setXY(i, rng.next(), 1);

    if (lane.row === 0) {
      const fi = (laneIdx % 2) * this.perLane + slot;
      const pos = this.flashes.geometry.attributes.position;
      this.path.toWorld(s - 0.2, x - lane.side * 0.3, 1.9, _v);
      pos.setXYZ(fi, _v.x, _v.y, _v.z);
      this.flashes.geometry.attributes.aSeed.setX(fi, rng.next());
      this.flashes.geometry.attributes.aOn.setX(fi, visible && rng.chance(0.45) ? 1 : 0);
    }
  }

  update(playerS, dt, excitement) {
    this.time += dt;
    let dirty = false;
    for (let l = 0; l < LANES.length; l++) {
      const base = Math.floor((playerS - CONFIG.crowd.windowBehind) / this.spacing);
      const prev = this.laneBase[l];
      if (prev === null || Math.abs(base - prev) >= this.perLane) {
        for (let c = base; c < base + this.perLane; c++) this.placeCell(l, c);
        dirty = true;
      } else if (base > prev) {
        for (let c = prev + this.perLane; c < base + this.perLane; c++) this.placeCell(l, c);
        dirty = true;
      }
      this.laneBase[l] = base;
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      const g = this.mesh.geometry.attributes;
      g.iAnim.needsUpdate = g.iShirt.needsUpdate = g.iPants.needsUpdate = g.iSkin.needsUpdate = g.iHatCol.needsUpdate = true;
      const fg = this.flashes.geometry.attributes;
      fg.position.needsUpdate = fg.aSeed.needsUpdate = fg.aOn.needsUpdate = true;
    }

    const u = this.material.userData.uniforms;
    u.uTime.value = this.time;
    u.uExcite.value = excitement;
    const f = this.path.sample(playerS);
    u.uPlayerXZ.value.set(f.x, f.z);
    this.flashUniforms.uTime.value = this.time;
    this.flashUniforms.uLevel.value = clamp((excitement - 0.35) * 2.2, 0, 1);
  }

  setPointScale(scale) {
    this.flashUniforms.uScale.value = scale;
  }
}
