import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { createRng, clamp } from '../core/math.js';
import { createAnimalInstances, CAT_LOOKS, setAnimalLook } from './AnimalModel.js';

// コース上のゲームプレイ物体（障害物・アイテム・横スクロール区間のパターン）。
// 前方ウィンドウに距離ベースで生成し、後方に流れたらプールへ戻す。
// 密度やパターンは EventDirector.paramAt(km) から読む（データ駆動）。

const LIMIT = CONFIG.road.runnerLimit - 0.4;

function colored(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('uv');
  return geo;
}

function box(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return colored(g, hex);
}

function buildGeometries() {
  const cone = mergeGeometries([
    colored(new THREE.ConeGeometry(0.3, 0.75, 10).translate(0, 0.375, 0), 0xff6a1a),
    colored(new THREE.CylinderGeometry(0.2, 0.235, 0.12, 10).translate(0, 0.42, 0), 0xffffff),
    box(0.62, 0.06, 0.62, 0, 0.03, 0, 0x222222),
  ]);
  const barrier = mergeGeometries([
    box(2.6, 0.32, 0.1, 0, 0.84, 0, 0xffd21f),
    box(2.6, 0.12, 0.11, 0, 0.84, 0, 0x151515),
    box(0.08, 1.0, 0.5, -1.15, 0.5, 0, 0x3a3a3a),
    box(0.08, 1.0, 0.5, 1.15, 0.5, 0, 0x3a3a3a),
  ]);
  const banana = colored(new THREE.TorusGeometry(0.2, 0.065, 6, 12, Math.PI).rotateX(-Math.PI / 2).translate(0, 0.07, 0), 0xffe135);
  const hurdle = mergeGeometries([
    box(0.12, 0.95, 0.12, -0.7, 0.475, 0, 0xe8322a),
    box(0.12, 0.95, 0.12, 0.7, 0.475, 0, 0xe8322a),
    box(1.9, 0.12, 0.2, 0, 0.98, 0, 0x151515),
    box(1.6, 0.1, 0.14, 0, 0.78, 0, 0xe8322a),
  ]);
  const crate = mergeGeometries([
    box(1.05, 1.3, 1.05, 0, 0.65, 0, 0x9a6a3a),
    box(1.08, 0.12, 1.08, 0, 1.24, 0, 0x6a4520),
    box(1.08, 0.12, 1.08, 0, 0.06, 0, 0x6a4520),
  ]);
  const onigiri = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0, 0), 0xffffff),
    box(0.36, 0.2, 0.24, 0, -0.18, 0, 0x16261a),
  ]);
  const shoe = mergeGeometries([
    box(0.3, 0.22, 0.62, 0, 0, 0, 0x1db7ff),
    box(0.32, 0.08, 0.66, 0, -0.14, 0, 0xffffff),
    box(0.3, 0.14, 0.2, 0, 0.14, 0.2, 0x1db7ff),
  ]);
  const token = colored(new THREE.OctahedronGeometry(0.34, 0), 0xffffff);
  return { cone, barrier, banana, hurdle, crate, onigiri, shoe, token };
}

// kind: hazard（当たると影響）/ pickup（取ると得）
const TYPES = {
  cone: { kind: 'hazard', h: 0.75, halfW: 0.32, jumpable: true, effect: 'stagger', cap: 60 },
  barrier: { kind: 'hazard', h: 1.02, halfW: 1.3, jumpable: true, effect: 'fall', cap: 30 },
  banana: { kind: 'hazard', h: 0.18, halfW: 0.28, jumpable: true, effect: 'slip', cap: 20 },
  hurdle: { kind: 'hazard', h: 1.0, halfW: 0.95, jumpable: true, effect: 'stagger', cap: 30 },
  crate: { kind: 'hazard', h: 1.3, halfW: 0.55, jumpable: true, effect: 'fall', cap: 16 },
  onigiri: { kind: 'pickup', h: 0, halfW: 0.6, effect: 'stamina', cap: 12, y: 1.0 },
  shoe: { kind: 'pickup', h: 0, halfW: 0.6, effect: 'boost', cap: 10, y: 1.0 },
  token: { kind: 'pickup', h: 0, halfW: 0.55, effect: 'cheer', cap: 80, y: 1.6 },
  // 横切る猫（近づくと歩道から飛び出す）。ジャンプで飛び越えられる
  cat: { kind: 'hazard', h: 0.8, halfW: 0.6, jumpable: true, effect: 'cat', cap: 90, animal: true },
};

const CAT_SCALE = 2.0;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class CourseManager {
  constructor(scene, bus, distance, events, path) {
    this.bus = bus;
    this.path = path;
    this.distance = distance;
    this.events = events;
    const geos = buildGeometries();
    this.meshes = {};
    for (const [type, def] of Object.entries(TYPES)) {
      if (def.animal) {
        const mesh = createAnimalInstances('cat', def.cap);
        scene.add(mesh);
        this.meshes[type] = mesh;
        continue;
      }
      let mat;
      if (type === 'token') {
        mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
        mat.color.setRGB(0.6, 2.2, 2.6);
      } else if (def.kind === 'pickup') {
        mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x333333 });
      } else {
        mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      }
      const mesh = new THREE.InstancedMesh(geos[type], mat, def.cap);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      scene.add(mesh);
      this.meshes[type] = mesh;
    }
    this.items = [];
    this.reset();
  }

  reset(startS = 0) {
    this.items.length = 0;
    this.nextS = startS + 60;
    this.rng = createRng(777);
    this.time = 0;
  }

  countOf(type) {
    let c = 0;
    for (const it of this.items) if (it.type === type) c++;
    return c;
  }

  add(type, s, x, extra = {}) {
    if (this.countOf(type) >= TYPES[type].cap) return null;
    const def = TYPES[type];
    const item = {
      type,
      def,
      s,
      x,
      y: extra.y ?? def.y ?? 0,
      resolved: false,
      hit: false,
      knock: null,
      spin: this.rng.range(0, Math.PI * 2),
      ...extra,
    };
    this.items.push(item);
    return item;
  }

  // 横スクロール区間のパターン: レーン上にハードル・木箱、上空に ♪ トークン
  spawnSide2D(s, lane) {
    const r = this.rng.next();
    if (r < 0.55) {
      this.add('hurdle', s, lane);
      // 地上（中心 0.9）では届かず、ジャンプ頂点（中心 ≒ 2.6）で取れる高さ
      for (const [ds, y] of [[-2.2, 2.2], [0, 3.0], [2.2, 2.2]]) this.add('token', s + ds, lane, { y });
      return 22 + this.rng.range(0, 10);
    }
    if (r < 0.75) {
      this.add('hurdle', s, lane);
      this.add('hurdle', s + 7.5, lane);
      this.add('token', s + 3.75, lane, { y: 2.6 });
      return 30 + this.rng.range(0, 8);
    }
    this.add('crate', s, lane);
    this.add('token', s, lane, { y: 3.2 });
    for (let k = 1; k <= 3; k++) this.add('token', s + 6 + k * 2.2, lane, { y: 1.3 });
    return 28 + this.rng.range(0, 8);
  }

  // 歩道で待ち、プレイヤーが近づくと横切る猫
  spawnCat(s, { trigger, speed, from } = {}) {
    const rng = this.rng;
    const side = from ?? (rng.chance(0.5) ? -1 : 1);
    this.add('cat', s, side * rng.range(8.4, 10.5), {
      vx: -side * (speed ?? rng.range(2.6, 4.6)),
      trigger: trigger ?? rng.range(32, 62),
      started: false,
      look: rng.int(0, CAT_LOOKS.length - 1),
    });
  }

  // 猫の大移動: 両側から群れで横切る
  spawnCatWave(s) {
    const n = this.rng.int(3, 5);
    for (let k = 0; k < n; k++) {
      this.spawnCat(s + this.rng.range(-1.5, 1.5), { trigger: 75, speed: this.rng.range(3.5, 6.5) });
    }
    return this.rng.range(4, 7);
  }

  spawnNormal(s, density, cats = 0) {
    const rng = this.rng;
    if (cats > 0 && rng.chance(cats)) {
      this.spawnCat(s);
      return rng.range(14, 26) / Math.max(0.3, density);
    }
    const r = rng.next();
    if (r < 0.1) {
      this.add('onigiri', s, rng.range(-LIMIT, LIMIT));
    } else if (r < 0.17) {
      this.add('shoe', s, rng.range(-LIMIT, LIMIT));
    } else if (r < 0.32) {
      // コーンの列（どこかに隙間）
      const gap = rng.int(0, 4);
      for (let k = 0; k < 5; k++) {
        if (k === gap) continue;
        this.add('cone', s, -LIMIT + 0.3 + k * ((LIMIT * 2 - 0.6) / 4));
      }
    } else if (r < 0.62) {
      this.add('cone', s, rng.range(-LIMIT, LIMIT));
      if (rng.chance(0.5)) this.add('cone', s + rng.range(3, 6), rng.range(-LIMIT, LIMIT));
    } else if (r < 0.85) {
      this.add('barrier', s, rng.range(-LIMIT + 1, LIMIT - 1));
    } else {
      this.add('banana', s, rng.range(-LIMIT, LIMIT));
    }
    return rng.range(18, 34) / Math.max(0.25, density);
  }

  update(dt, player, running) {
    this.time += dt;
    // 生成
    const horizon = player.s + 330;
    let guard = 0;
    while (this.nextS < horizon && guard++ < 50) {
      const km = this.distance.unitsToKm(this.nextS);
      const pattern = this.events.paramAt('pattern', km);
      if (pattern === 'side2d') {
        const lane = this.events.paramAt('rules', km)?.lane ?? 4;
        this.nextS += this.spawnSide2D(this.nextS, lane);
        continue;
      }
      if (pattern === 'catStampede') {
        this.nextS += this.spawnCatWave(this.nextS);
        continue;
      }
      const density = this.events.paramAt('obstacles', km);
      const cats = this.events.paramAt('cats', km) ?? 0;
      if (density > 0 || cats > 0) this.nextS += this.spawnNormal(this.nextS, density, cats);
      else this.nextS += 12;
    }

    if (running) this.collide(player);

    // 後方の破棄 + 吹き飛びアニメ
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.type === 'cat' && !it.knock) {
        if (!it.started && player.s > it.s - it.trigger) it.started = true;
        if (it.started) it.x += it.vx * dt;
        if (Math.abs(it.x) > 11 && it.started && Math.sign(it.x) === Math.sign(it.vx)) it.gone = true;
      }
      if (it.knock) {
        it.knock.t += dt;
        it.knock.vy -= 20 * dt;
        it.x += it.knock.vx * dt;
        it.y = Math.max(0, it.y + it.knock.vy * dt);
        it.s += it.knock.vs * dt;
        it.spin += it.knock.spin * dt;
      }
      if (it.gone || it.s < player.s - 25 || (it.collected && it.collectT > 0.35) || (it.knock && it.knock.t > 1.6)) {
        this.items.splice(i, 1);
      } else if (it.collected) {
        it.collectT += dt;
      }
    }
    this.writeInstances();
  }

  collide(player) {
    for (const it of this.items) {
      if (it.resolved) continue;
      const ds = it.s - player.s;
      const dx = Math.abs(it.x - player.x);
      const def = it.def;
      if (def.kind === 'pickup') {
        if (Math.abs(ds) < 0.9 && dx < def.halfW + 0.45 && Math.abs(player.y + 0.9 - it.y) < 1.1) {
          it.resolved = true;
          it.collected = true;
          it.collectT = 0;
          this.bus.emit('pickup', { type: it.type, item: it });
        } else if (ds < -1.5) {
          it.resolved = true;
        }
        continue;
      }
      // 障害物
      if (Math.abs(ds) < 0.55 && dx < def.halfW + 0.28 && player.y < def.h - 0.05 && !player.falling && player.invuln <= 0) {
        it.resolved = true;
        it.hit = true;
        it.knock = {
          t: 0,
          vx: (it.x - player.x >= 0 ? 1 : -1) * 3 + (Math.random() - 0.5) * 2,
          vy: def.animal ? 8 : 5 + Math.random() * 3,
          vs: player.speed * 0.8,
          spin: def.animal ? 0 : 9, // 猫は着地が得意
        };
        this.bus.emit('hazardHit', { type: it.type, effect: def.effect, item: it });
        continue;
      }
      if (ds < -0.8) {
        it.resolved = true;
        if (dx < def.halfW + 0.28 && player.y >= def.h - 0.05) {
          const clearance = player.y - def.h;
          this.bus.emit('hazardClear', { type: it.type, clearance, perfect: clearance < 0.35 });
        } else if (dx < def.halfW + 0.95 && !player.falling) {
          this.bus.emit('hazardNearMiss', { type: it.type, dx });
        }
      }
    }
  }

  // AI 用: 前方 range 以内で横位置が重なる最も近い障害物
  hazardAhead(s, x, range) {
    let best = null;
    let bestD = range;
    for (const it of this.items) {
      if (it.def.kind !== 'hazard' || it.knock) continue;
      const d = it.s - s;
      if (d <= 0 || d > bestD) continue;
      if (Math.abs(it.x - x) < it.def.halfW + 0.6) {
        best = it;
        bestD = d;
      }
    }
    return best ? { s: best.s, x: best.x, halfW: best.def.halfW, jumpable: best.def.jumpable } : null;
  }

  // 最終直線などで前方の障害物を片付ける
  clearAhead(fromS) {
    this.items = this.items.filter((it) => it.s < fromS);
    this.nextS = Math.max(this.nextS, fromS);
  }

  writeInstances() {
    const counts = {};
    for (const type of Object.keys(TYPES)) counts[type] = 0;
    for (const it of this.items) {
      const mesh = this.meshes[it.type];
      const i = counts[it.type]++;
      if (i >= TYPES[it.type].cap) continue;
      let scale = 1;
      let yaw = 0;
      let pitch = 0;
      let y = it.y;
      if (it.def.kind === 'pickup') {
        yaw = this.time * 2.5 + it.spin;
        y += Math.sin(this.time * 3 + it.spin) * 0.12;
        if (it.collected) scale = clamp(1 + it.collectT * 4, 0, 3) * (1 - it.collectT / 0.35);
      }
      if (it.knock) {
        pitch = it.spin;
        yaw = it.spin * 0.6;
      }
      if (it.def.animal) {
        // 進む向きを向いて、走っている間だけ脚を動かす
        scale = CAT_SCALE;
        yaw = it.vx > 0 ? -Math.PI / 2 : Math.PI / 2;
        const moving = it.started || it.knock;
        mesh.geometry.attributes.iAnim.setXY(i, this.time * (moving ? 16 : 2.5) + it.spin, moving ? 1 : 0);
        setAnimalLook(mesh, i, CAT_LOOKS[it.look]);
      }
      const f = this.path.sample(it.s);
      _e.set(pitch, f.theta + yaw, 0, 'YXZ');
      _m.compose(_p.set(f.x + f.cos * it.x, y, f.z - f.sin * it.x), _q.setFromEuler(_e), _s.setScalar(Math.max(0.0001, scale)));
      mesh.setMatrixAt(i, _m);
    }
    for (const [type, mesh] of Object.entries(this.meshes)) {
      mesh.count = Math.min(counts[type], TYPES[type].cap);
      mesh.instanceMatrix.needsUpdate = true;
      if (TYPES[type].animal) mesh.geometry.attributes.iAnim.needsUpdate = true;
    }
  }
}
