import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK, trackPoint } from '../race/trackLogic.js';
import { STAND } from './stands.js';
import { patchMaterial } from '../fx/materialPatch.js';

// 最前列の観客（3D）。後ろの段は板の観客（stands.js）。
// 1 つの InstancedMesh。腕を上げる・跳ねるはシェーダー（uniform）で、CPU はほぼ使わない。
// 観客の Modifier: 巨大化 / 一人だけ巨大 / 走り出す / 後ろを向く / 増える / 消える / 静止 / 同期 / 全員ランナーになる

const PARTS = { body: 0, head: 1, armL: 2, armR: 3 };

function spectatorGeometry() {
  const part = (geo, id, [x, y, z]) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
    return g;
  };
  return mergeGeometries([
    part(new THREE.BoxGeometry(0.42, 0.62, 0.26), PARTS.body, [0, 1.12, 0]),
    part(new THREE.BoxGeometry(0.34, 0.6, 0.24), PARTS.body, [0, 0.5, 0]),
    part(new THREE.IcosahedronGeometry(0.15, 1), PARTS.head, [0, 1.6, 0]),
    part(new THREE.BoxGeometry(0.11, 0.56, 0.12), PARTS.armL, [-0.27, 1.12, 0]),
    part(new THREE.BoxGeometry(0.11, 0.56, 0.12), PARTS.armR, [0.27, 1.12, 0]),
  ]);
}

export const SPECTATOR_UNIFORMS = {
  uTime: { value: 0 },
  uEnergy: { value: 0.3 },
  uFreeze: { value: 0 },
  uSync: { value: 0 },
  uWave: { value: 0 },
  uWaveP: { value: 0 },
  uRunning: { value: 0 },
};

export class Crowd {
  constructor(scene, deform, count, rng) {
    this.count = count;
    const geo = spectatorGeometry();
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2));
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, SPECTATOR_UNIFORMS);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aPart; attribute vec3 iColor; attribute vec2 iSeed;
          uniform float uTime, uEnergy, uFreeze, uSync, uWave, uWaveP, uRunning;
          varying vec3 vCol;`
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
          float t = uTime * (1.0 - uFreeze);
          float ph = mix(t * (5.0 + iSeed.x * 4.0) + iSeed.y * 30.0, t * 7.0, uSync);
          // ウェーブ: 周回内の位置（iSeed.y × 400m）で波が通る
          float wd = abs(mod(iSeed.y * 400.0 - uWaveP + 200.0, 400.0) - 200.0);
          float wave = uWave * smoothstep(16.0, 0.0, wd);
          float excite = clamp(uEnergy + wave, 0.0, 1.5);
          float arm = clamp(excite * 1.6 - 0.2 + 0.3 * sin(ph * 0.5), 0.0, 1.0) * 2.6;
          if (uRunning > 0.5) arm = 0.9 + 0.6 * sin(t * 12.0 + iSeed.y * 40.0);
          if (aPart > 1.5) {
            float side = aPart < 2.5 ? -1.0 : 1.0;
            vec3 piv = vec3(side * 0.27, 1.38, 0.0);
            vec3 q = transformed - piv;
            float a = side * arm * (uRunning > 0.5 ? 0.3 : 1.0);
            float ca = cos(a), sa = sin(a);
            q = vec3(q.x * ca - q.y * sa, q.x * sa + q.y * ca, q.z);
            if (uRunning > 0.5) { float s2 = sin(t * 12.0 + iSeed.y * 40.0) * side; q = vec3(q.x, q.y * cos(s2) - q.z * sin(s2), q.y * sin(s2) + q.z * cos(s2)); }
            transformed = piv + q;
          }
          float jump = max(0.0, sin(ph)) * (0.05 + excite * 0.35) + wave * 0.5;
          transformed.y += jump;
          vCol = aPart > 0.5 && aPart < 1.5 ? vec3(0.93, 0.74, 0.58) : iColor;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCol;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vCol;');
      deform.attach(shader);
    };
    mat.customProgramCacheKey = () => 'spectator-800';
    patchMaterial(mat);
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    // 置き場所: 最前列 2 段にばらまく（seed で決まる）
    const colors = [0xff3d7f, 0x39e6ff, 0xffd23f, 0xffffff, 0xff7a2a, 0x7a5cff, 0x2ecc71, 0xe8322a, 0x1f7bff, 0x222228].map((c) => new THREE.Color(c));
    this.seats = [];
    for (let i = 0; i < count; i++) {
      const tier = i % 2;
      const p = ((i + rng.range(-0.3, 0.3)) / count) * TRACK.lap;
      this.seats.push({ p, tier, jitter: rng.range(-0.25, 0.25), scale: rng.range(0.92, 1.06) });
      const c = rng.pick(colors);
      geo.attributes.iColor.setXYZ(i, c.r, c.g, c.b);
      geo.attributes.iSeed.setXY(i, rng.next(), p / TRACK.lap);
    }
    this.giantIndex = Math.floor(rng.range(0.05, 0.3) * count);
    this.runP = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this.pt = {};
    this.dirty = true;
    this.lastKey = '';
  }

  // P.crowd を反映。走る・巨大化などで配置が変わる時だけ行列を書き直す
  update(dt, C, playerD) {
    const running = C.run > 0.01 || C.runners > 0.01;
    if (running) this.runP += dt * (C.runners > 0.5 ? 7.4 : 5.2);
    const key = `${C.giant.toFixed(2)}|${C.giantOne.toFixed(2)}|${C.reverse}|${C.clone}|${C.vanish > 0.5}|${running}`;
    if (!running && key === this.lastKey && !this.dirty) return;
    this.lastKey = key;
    this.dirty = false;
    const m = this.mesh;
    const pt = this.pt;
    const visibleN = C.vanish > 0.5 ? 0 : C.clone > 0.5 ? this.count : Math.ceil(this.count * 0.75);
    for (let i = 0; i < this.count; i++) {
      const s = this.seats[i];
      if (i >= visibleN) {
        m.setMatrixAt(i, this._m.makeScale(0, 0, 0));
        continue;
      }
      let p = s.p;
      let off = STAND.off0 + (s.tier + 0.5) * STAND.depth + s.jitter;
      let y = STAND.y0 + s.tier * STAND.rise;
      if (C.runners > 0.5) {
        // 全員ランナー: トラックの外側のレーンを一緒に走る
        p = playerD + 20 + ((i * 37) % 160) - 60 + this.runP * 0.2;
        off = 6 + ((i * 13) % 50) / 10;
        y = 0;
      } else if (running) p += this.runP;
      trackPoint(p, off, pt);
      let scale = s.scale * C.giant;
      if (i === this.giantIndex) scale *= 1 + C.giantOne * 11;
      // トラックの方を向く（走っている時は進行方向）
      let yaw = Math.atan2(-pt.hz, pt.hx);
      if (running) yaw = pt.heading;
      if (C.reverse > 0.5) yaw += Math.PI;
      this._q.setFromEuler(this._e.set(0, yaw, 0));
      this._m.compose(this._p.set(pt.x, y, pt.z), this._q, this._s.setScalar(scale));
      m.setMatrixAt(i, this._m);
    }
    m.instanceMatrix.needsUpdate = true;
    SPECTATOR_UNIFORMS.uRunning.value = running ? 1 : 0;
  }
}
