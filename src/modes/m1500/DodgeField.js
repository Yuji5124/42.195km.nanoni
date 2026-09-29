import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../../config.js';
import { clamp } from '../../core/math.js';

// 見下ろし回避（銃なし）: 道路に赤い警告エリアが出て、少し遅れて物が落ちてくる / 転がってくる。
//   drop   … 金ダライ・植木鉢が空から降る（丸い警告）→ 横に逃げる
//   roller … ドラム缶が道路を横切って転がる（帯の警告）→ タイミングをずらすか、跳び越える
// 当たるとよろける。ギリギリでかわすと NEAR MISS（CHEER）。新しいランナーは出さない。

const LIMIT = CONFIG.road.runnerLimit;
const MAX = 24;
const WARN_TIME = 1.05;
const DROP_R = 1.45;

function colorGeo(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function warningTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  if (kind === 'circle') {
    g.fillStyle = 'rgba(255,40,70,0.32)';
    g.beginPath();
    g.arc(64, 64, 60, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(255,60,90,1)';
    g.stroke();
    g.fillStyle = '#fff';
    g.font = 'bold 64px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('!', 64, 68);
  } else {
    g.fillStyle = 'rgba(255,40,70,0.25)';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,70,90,0.9)';
    for (let x = -128; x < 256; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 14, 0);
      g.lineTo(x + 14 + 128, 128);
      g.lineTo(x + 128, 128);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class DodgeField {
  // hooks: { onHit(kind), onNearMiss(kind, dist), onLand(kind, s, x) }
  constructor(scene, path, hooks) {
    this.path = path;
    this.hooks = hooks;
    const mk = (tex) => {
      const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      m.color.setScalar(1.6);
      return m;
    };
    const circleGeo = new THREE.PlaneGeometry(DROP_R * 2.2, DROP_R * 2.2).rotateX(-Math.PI / 2);
    this.circles = new THREE.InstancedMesh(circleGeo, mk(warningTexture('circle')), MAX);
    const bandGeo = new THREE.PlaneGeometry(CONFIG.road.halfWidth * 2, 2.4).rotateX(-Math.PI / 2);
    this.bands = new THREE.InstancedMesh(bandGeo, mk(warningTexture('band')), MAX);
    // 金ダライ（ドリフ）と植木鉢
    const tarai = mergeGeometries([
      colorGeo(new THREE.CylinderGeometry(0.85, 0.62, 0.32, 16, 1, true).translate(0, 0.16, 0), 0xd9b35a),
      colorGeo(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 16).translate(0, 0.02, 0), 0xc9a24a),
      colorGeo(new THREE.TorusGeometry(0.86, 0.05, 5, 18).rotateX(Math.PI / 2).translate(0, 0.32, 0), 0xf0d080),
    ]);
    const drum = mergeGeometries([
      // 軸は進行方向（z）。横に転がる
      colorGeo(new THREE.CylinderGeometry(0.5, 0.5, 1.15, 12).rotateX(Math.PI / 2), 0x2f6fd0),
      colorGeo(new THREE.CylinderGeometry(0.52, 0.52, 0.08, 12).rotateX(Math.PI / 2).translate(0, 0, 0.32), 0x1a3a7a),
      colorGeo(new THREE.CylinderGeometry(0.52, 0.52, 0.08, 12).rotateX(Math.PI / 2).translate(0, 0, -0.32), 0x1a3a7a),
    ]);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x202020 });
    this.taraiMesh = new THREE.InstancedMesh(tarai, mat, MAX);
    this.drumMesh = new THREE.InstancedMesh(drum, mat, MAX);
    for (const m of [this.circles, this.bands, this.taraiMesh, this.drumMesh]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.items = [];
    this.active = false;
  }

  reset() {
    this.items.length = 0;
    this.active = false;
    this.timer = 0;
    this.write();
  }

  start({ gentle = false } = {}) {
    this.active = true;
    this.gentle = gentle;
    this.timer = 1.6; // カメラが真上に回りきるのを待つ
    this.wave = 0;
  }

  stop() {
    this.active = false;
  }

  // AI 用: 警告エリアの近くにいたら、どちらへ逃げるか（横方向の目標のずれ）
  avoid(s, x) {
    for (const it of this.items) {
      if (it.kind !== 'drop' || it.t > WARN_TIME + 0.2) continue;
      const ds = it.s - s;
      if (ds > -1 && ds < 9 && Math.abs(it.x - x) < DROP_R + 0.8) return it.x > x ? -2.4 : 2.4;
    }
    return 0;
  }

  spawn(player) {
    const v = Math.max(8, player.speed);
    const pattern = this.wave++ % 5;
    if (pattern === 3 && !this.gentle) {
      // ドラム缶が横切る: プレイヤーの今の横位置に来るころ、ちょうど通りかかる
      const from = Math.random() < 0.5 ? -1 : 1;
      const x0 = from * 9.5;
      const speed = 10;
      const tArrive = WARN_TIME + Math.abs(x0 - player.x) / speed;
      this.items.push({ kind: 'roller', s: player.s + v * tArrive + (Math.random() - 0.5) * 4, x: x0, vx: -from * speed, t: 0, spin: 0, near: false });
      return 2.1;
    }
    // 金ダライ: プレイヤーの到着地点を狙う（1〜3 個。どこかに逃げ道がある）
    const n = this.gentle ? 1 : pattern === 4 ? 3 : pattern === 1 ? 2 : 1;
    const sT = player.s + v * WARN_TIME + (Math.random() - 0.5) * 2;
    const base = clamp(player.x + (Math.random() - 0.5) * 1.2, -LIMIT + 1, LIMIT - 1);
    for (let k = 0; k < n; k++) {
      const x = clamp(base + (k - (n - 1) / 2) * DROP_R * 2.1 * (n === 3 ? 1 : 1.2), -LIMIT, LIMIT);
      this.items.push({ kind: 'drop', s: sT + k * 1.5, x, t: 0, y: 14, landed: false, near: false });
    }
    return this.gentle ? 1.9 : 1.35 + Math.random() * 0.6;
  }

  update(dt, player, canHit) {
    if (this.active) {
      this.timer -= dt;
      if (this.timer <= 0) this.timer = this.spawn(player);
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const ds = it.s - player.s;
      if (it.kind === 'drop') {
        if (it.t >= WARN_TIME) {
          if (!it.landed) {
            it.y = Math.max(0, it.y - dt * 40);
            if (it.y <= 0) {
              it.landed = true;
              const dx = Math.abs(it.x - player.x);
              const hit = canHit && Math.abs(ds) < DROP_R && dx < DROP_R && player.y < 1.6 && !player.falling && player.invuln <= 0;
              if (hit) this.hooks.onHit('drop');
              else if (canHit && Math.abs(ds) < DROP_R + 2.4 && dx < DROP_R + 1.3 && !player.falling) this.hooks.onNearMiss('drop', Math.hypot(ds, dx));
              this.hooks.onLand?.('drop', it.s, it.x);
            }
          }
        }
        if (it.t > WARN_TIME + 1.6 || ds < -30) this.items.splice(i, 1);
        continue;
      }
      // ドラム缶
      if (it.t >= WARN_TIME) {
        it.x += it.vx * dt;
        it.spin += it.vx * dt * 2;
        const dx = Math.abs(it.x - player.x);
        if (canHit && !it.hit && Math.abs(ds) < 1.2 && dx < 0.9 && player.y < 1.0 && !player.falling && player.invuln <= 0) {
          it.hit = true;
          this.hooks.onHit('roller');
        } else if (canHit && !it.hit && !it.near && Math.abs(ds) < 2.6 && dx < 1.3 && !player.falling && (player.y >= 1.0 || Math.abs(ds) >= 1.2)) {
          it.near = true;
          this.hooks.onNearMiss('roller', Math.abs(ds));
        }
      }
      if (Math.abs(it.x) > 12 || ds < -30) this.items.splice(i, 1);
    }
    this.write();
  }

  write() {
    const counts = { circles: 0, bands: 0, tarai: 0, drum: 0 };
    const set = (mesh, key, s, x, y, yaw, scale, roll = 0) => {
      this.path.writeMatrix(mesh.instanceMatrix.array, counts[key]++, s, x, y, yaw, scale, roll);
    };
    for (const it of this.items) {
      if (it.kind === 'drop') {
        if (it.t < WARN_TIME + 0.15) {
          const pulse = 0.85 + 0.15 * Math.sin(it.t * 26);
          set(this.circles, 'circles', it.s, it.x, 0.05, 0, pulse * (0.6 + 0.4 * Math.min(1, it.t * 4)));
        }
        if (it.t > WARN_TIME - 0.4) set(this.taraiMesh, 'tarai', it.s, it.x, it.y, it.t * 2, 1);
      } else {
        if (it.t < WARN_TIME + 0.9) set(this.bands, 'bands', it.s, 0, 0.05, 0, 0.9 + 0.1 * Math.sin(it.t * 22));
        set(this.drumMesh, 'drum', it.s, it.x, 0.5, 0, 1, -it.spin);
      }
    }
    this.circles.count = counts.circles;
    this.bands.count = counts.bands;
    this.taraiMesh.count = counts.tarai;
    this.drumMesh.count = counts.drum;
    for (const m of [this.circles, this.bands, this.taraiMesh, this.drumMesh]) m.instanceMatrix.needsUpdate = true;
  }
}
