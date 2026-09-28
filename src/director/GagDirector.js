import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../core/math.js';
import { CONFIG } from '../config.js';
import { createAnimalInstances, DOG_LOOKS, setAnimalLook } from '../world/AnimalModel.js';

// GagDirector: 「マラソン、なのに。」の一発ネタを台本どおりに動かす。
// EventDirector の event.gag で起動し、プレイヤーとの距離で進行する。
//   trainRace … 外濠沿いで総武線と競争（ダッシュで抜ければ勝ち）
//   dogPacer  … 柴犬 3 匹が伴走（近くを走ると WAN! ボーナス）
//   signal    … 赤信号。止まれば MANNERS、無視すると車が来る
//   giantDog  … ビジョンから出てきた巨大柴犬がコースをまたいで横切る（ランナーはお腹の下を通過）
// 画面・音・CHEER には hooks 経由でだけ触る（Game が実装）。

const LIMIT = CONFIG.road.runnerLimit;
const TRAIN = { lateral: -14.2, y: 1.35, cars: 6, carLen: 19.6, gap: 0.6 };

function buildTrain() {
  const body = new THREE.MeshLambertMaterial({ color: 0xc9cdd6 });
  const roof = new THREE.MeshLambertMaterial({ color: 0x8d919c });
  const stripe = new THREE.MeshBasicMaterial({ color: 0xffd400 });
  stripe.color.multiplyScalar(1.2);
  const win = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
  win.color.multiplyScalar(1.3);
  const dark = new THREE.MeshBasicMaterial({ color: 0x14161c });
  const cars = [];
  for (let i = 0; i < TRAIN.cars; i++) {
    const car = new THREE.Group();
    const add = (geo, mat, y, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, y, z);
      car.add(m);
    };
    add(new THREE.BoxGeometry(3.0, 3.0, TRAIN.carLen), body, 1.6);
    add(new THREE.BoxGeometry(3.04, 0.35, TRAIN.carLen + 0.02), stripe, 0.95);
    add(new THREE.BoxGeometry(3.06, 0.8, TRAIN.carLen - 2.5), win, 2.05);
    add(new THREE.BoxGeometry(2.6, 0.3, TRAIN.carLen - 0.4), roof, 3.25);
    if (i === 0) {
      add(new THREE.BoxGeometry(2.6, 1.1, 0.06), dark, 2.1, -TRAIN.carLen / 2 - 0.02);
      const lamp = new THREE.MeshBasicMaterial({ color: 0xffffff });
      lamp.color.multiplyScalar(2.5);
      for (const x of [-0.9, 0.9]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.06), lamp);
        l.position.set(x, 0.9, -TRAIN.carLen / 2 - 0.03);
        car.add(l);
      }
    }
    car.visible = false;
    cars.push(car);
  }
  return cars;
}

// 東京ドローン（無灯火の本体 + 光るローター）。頂点色は 1 を超えてよい → ブルームで光る
function colorBox(w, h, d, [x, y, z], rgb) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function createDroneMesh(count) {
  const body = [0.14, 0.15, 0.2];
  const rotor = [1.2, 2.4, 2.8];
  const parts = [
    colorBox(0.8, 0.24, 0.8, [0, 0, 0], body),
    colorBox(1.9, 0.08, 0.12, [0, 0.05, 0], body),
    colorBox(0.12, 0.08, 1.9, [0, 0.05, 0], body),
    colorBox(0.22, 0.1, 0.1, [0, 0, 0.42], [2.4, 0.3, 0.3]),
  ];
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    parts.push(colorBox(0.7, 0.04, 0.7, [x, 0.14, z], rotor));
  }
  const mesh = new THREE.InstancedMesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ vertexColors: true }), count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  return mesh;
}

function createBulletMesh(count) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  mat.color.multiplyScalar(2.2);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 1.0), mat, count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  return mesh;
}

function buildCar(color) {
  const car = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshBasicMaterial({ color: 0x223044 });
  const tire = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const light = new THREE.MeshBasicMaterial({ color: 0xfff4d0 });
  light.color.multiplyScalar(2.5);
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    car.add(m);
  };
  add(new THREE.BoxGeometry(1.8, 0.75, 4.3), paint, 0, 0.7, 0);
  add(new THREE.BoxGeometry(1.6, 0.62, 2.2), glass, 0, 1.38, 0.2);
  add(new THREE.BoxGeometry(1.5, 0.12, 2.0), paint, 0, 1.72, 0.2);
  for (const x of [-0.85, 0.85]) {
    for (const z of [-1.4, 1.4]) add(new THREE.BoxGeometry(0.25, 0.6, 0.6), tire, x, 0.3, z);
    add(new THREE.BoxGeometry(0.35, 0.18, 0.05), light, x * 0.8, 0.8, -2.16);
  }
  car.visible = false;
  return car;
}

export class GagDirector {
  constructor(scene, path, distance, chunks, hooks) {
    this.path = path;
    this.distance = distance;
    this.chunks = chunks;
    this.hooks = hooks;

    this.dogs = createAnimalInstances('dog', 4);
    this.dogs.count = 4;
    for (let i = 0; i < 3; i++) setAnimalLook(this.dogs, i, DOG_LOOKS[i]);
    setAnimalLook(this.dogs, 3, DOG_LOOKS[0]);
    scene.add(this.dogs);

    this.trainCars = buildTrain();
    for (const c of this.trainCars) scene.add(c);
    this.cars = [buildCar(0xffc21a), buildCar(0xeeeeee), buildCar(0xd02030), buildCar(0x2050c0)];
    for (const c of this.cars) scene.add(c);
    this.droneMesh = createDroneMesh(40);
    this.bulletMesh = createBulletMesh(60);
    scene.add(this.droneMesh, this.bulletMesh);
    this.time = 0;

    this.reset();
  }

  reset() {
    this.train = { active: false };
    this.pacers = { active: false, dogs: [] };
    this.signal = { state: 'off', t: 0, lineS: this.chunks.landmarkS('signal') ?? Infinity, cars: [] };
    this.giant = { state: 'off' };
    this.shooter = { active: false, ending: false, drones: [], bullets: [], cooldown: 0, spawnS: 0, kills: 0 };
    this.droneMesh.count = 0;
    this.bulletMesh.count = 0;
    for (const c of this.trainCars) c.visible = false;
    for (const c of this.cars) c.visible = false;
    for (let i = 0; i < 4; i++) this.path.writeMatrix(this.dogs.instanceMatrix.array, i, 0, 0, 0, 0, 0);
    this.dogs.instanceMatrix.needsUpdate = true;
  }

  trigger(name, player) {
    if (name === 'trainRace') this.startTrain(player);
    else if (name === 'dogPacer') this.startPacers(player);
    else if (name === 'signal') this.signal.state = 'armed';
    else if (name === 'giantDog') this.startGiant(player);
    else if (name === 'shooterOn') this.shooter = { active: true, ending: false, drones: [], bullets: [], cooldown: 0, spawnS: player.s + 55, kills: 0 };
    else if (name === 'shooterOff') this.shooter.ending = true;
  }

  // ---- ルール・AI への影響
  get signalActive() {
    return this.signal.state === 'yellow' || this.signal.state === 'red';
  }

  rulesPatch(player) {
    if (this.signalActive && player.s < this.signal.lineS + 2) return { brake: true };
    return null;
  }

  get stopLine() {
    return { s: this.signal.lineS, active: this.signalActive };
  }

  // ================= 電車と競争 =================
  startTrain(player) {
    const moat = this.chunks.moatRanges[0] ?? [player.s, player.s + 600];
    this.train = {
      active: true,
      // 少し前から並走スタート → ダッシュで抜けるかの勝負
      head: player.s + 30,
      speed: 16,
      endS: moat[1] - 20,
      moat,
      lastLead: -30,
      passed: false,
      finished: false,
      horn: 0,
    };
    this.hooks.sfx('horn');
  }

  updateTrain(dt, player) {
    const tr = this.train;
    if (!tr.active) return;
    tr.speed = Math.min(19.2, tr.speed + dt * 1.2);
    tr.head += tr.speed * dt;
    const lead = player.s - tr.head;
    if (!tr.finished) {
      if (lead > 0 && tr.lastLead <= 0) {
        this.hooks.cheer('trainPass');
        this.hooks.say(tr.passed ? '抜き返した！ 電車を抜き返した！' : '電車を…抜いた!? 人間が総武線を抜きました！');
        tr.passed = true;
      } else if (lead < 0 && tr.lastLead >= 0 && tr.passed) {
        this.hooks.say('電車が抜き返す！ さすが JR！');
        this.hooks.sfx('horn');
      }
      if (player.s > tr.endS) {
        tr.finished = true;
        if (lead > 0) {
          this.hooks.cheer('trainBeat');
          this.hooks.fever('電車に勝った!!');
          this.hooks.say('勝ちました！ マラソンランナーが電車に勝ちました！ …これ、マラソンですよね？', true);
          this.hooks.hype(0.5);
        } else {
          this.hooks.say('電車の勝ち！ …まあ、当たり前です！', true);
        }
      }
    }
    tr.lastLead = lead;

    // トンネル（お堀の外）に入った車両は隠す
    this.trainCars.forEach((car, i) => {
      const sc = tr.head - TRAIN.carLen / 2 - i * (TRAIN.carLen + TRAIN.gap);
      const inside = sc > tr.moat[0] + 10 && sc < tr.moat[1] - 10;
      car.visible = inside;
      if (!inside) return;
      this.path.toWorld(sc, TRAIN.lateral, TRAIN.y, car.position);
      car.rotation.y = this.path.heading(sc);
    });
    if (tr.head - TRAIN.cars * 20 > tr.moat[1] + 50 || (tr.finished && tr.head < player.s - 400)) {
      tr.active = false;
      for (const c of this.trainCars) c.visible = false;
    }
  }

  // ================= 柴犬の伴走 =================
  startPacers(player) {
    const offsets = [
      { dx: 1.5, lead: 1.4 },
      { dx: 2.6, lead: -0.6 },
      { dx: -1.5, lead: 0.4 },
    ];
    this.pacers = {
      active: true,
      untilS: player.s + this.distance.kmToUnits(0.19),
      timer: 0,
      dogs: offsets.map((o, i) => ({
        ...o,
        s: player.s - 10 - i * 3,
        x: (i === 2 ? -1 : 1) * 8.5,
        speed: player.speed + 6,
        phase: i * 1.7,
        leaving: false,
      })),
    };
    this.hooks.sfx('bark', 1);
  }

  updatePacers(dt, player) {
    const pc = this.pacers;
    if (!pc.active) return;
    const leaving = player.s > pc.untilS;
    if (leaving && !pc.saidBye) {
      pc.saidBye = true;
      this.hooks.say('柴犬たち、ここでお別れです！ ありがとう！');
    }
    let near = 0;
    let anyVisible = false;
    pc.dogs.forEach((d, i) => {
      let tx;
      let ts;
      if (leaving) {
        tx = (d.dx > 0 ? 1 : -1) * 9.2;
        ts = d.s;
      } else {
        // 柵ぎわでは反対側に回り込む
        const side = player.x + d.dx > LIMIT || player.x + d.dx < -LIMIT ? -1 : 1;
        tx = clamp(player.x + d.dx * side, -LIMIT, LIMIT);
        ts = player.s + d.lead;
      }
      const want = leaving ? 0 : player.speed + clamp((ts - d.s) * 2.2, -6, 10);
      d.speed += (want - d.speed) * Math.min(1, dt * 4);
      d.s += d.speed * dt;
      d.x += clamp((tx - d.x) * 3, -7, 7) * dt;
      d.phase += dt * (3 + d.speed * 0.9);
      const dist = Math.hypot(d.s - player.s, d.x - player.x);
      if (dist < 3.4) near++;
      const visible = d.s > player.s - 60;
      anyVisible ||= visible;
      this.path.writeMatrix(this.dogs.instanceMatrix.array, i, d.s, d.x, 0, 0, visible ? 1.5 : 0);
      this.dogs.geometry.attributes.iAnim.setXY(i, d.phase, d.speed > 1 ? 1 : 0.1);
    });
    if (!leaving && near >= 2) {
      pc.timer += dt;
      if (pc.timer > 1.3) {
        pc.timer = 0;
        this.hooks.cheer('wan');
        this.hooks.sfx('bark', 0.8 + Math.random() * 0.4);
      }
    }
    if (leaving && !anyVisible) {
      pc.active = false;
      for (let i = 0; i < 3; i++) this.path.writeMatrix(this.dogs.instanceMatrix.array, i, 0, 0, 0, 0, 0);
    }
  }

  // ================= 赤信号 =================
  updateSignal(dt, player) {
    const sg = this.signal;
    const lm = this.chunks.getLandmark('signal');
    if (sg.state === 'off' || sg.state === 'done') {
      this.updateCars(dt, player);
      return;
    }
    const prevS = sg.prevS ?? player.s;
    sg.prevS = player.s;
    if (sg.state === 'armed') {
      lm?.setLight('green');
      if (player.s > sg.lineS - 115) {
        sg.state = 'yellow';
        sg.t = 0;
        lm?.setLight('yellow');
        this.hooks.sfx('signal');
        this.hooks.hint('赤信号！ ↓ / S で止まる（止まれば MANNERS ボーナス）', '赤信号！ ▼ で止まる（止まれば MANNERS ボーナス）');
      }
    } else if (sg.state === 'yellow') {
      sg.t += dt;
      if (sg.t > 1.3) {
        sg.state = 'red';
        sg.t = 0;
        lm?.setLight('red');
        this.hooks.say('赤信号です！ …止まるのか!? マラソン中ですよ!?', true);
        this.spawnCars();
      }
    } else if (sg.state === 'red') {
      sg.t += dt;
      if (!sg.ignored && prevS < sg.lineS && player.s >= sg.lineS) {
        sg.ignored = true;
        this.hooks.cheer('ignoreSignal');
        this.hooks.sfx('whistle');
        this.hooks.sfx('boo');
        this.hooks.fever('信号無視!?');
        this.hooks.say('信号無視！ …マラソン中でも交通ルールは守りましょう！', true);
      }
      if (!sg.mannered && !sg.ignored && player.s > sg.lineS - 25 && player.s < sg.lineS && player.speed < 2) {
        sg.mannered = true;
        this.hooks.cheer('manners');
        this.hooks.sfx('applause');
        this.hooks.say('止まった！ マラソン中なのに、ちゃんと信号を守りました！', true);
      }
      if (sg.t > 5.5) {
        sg.state = 'done';
        lm?.setLight('green');
        this.hooks.sfx('signal');
        if (!sg.ignored) this.hooks.say('青になりました！ 全員、再スタート！');
      }
    }
    this.updateCars(dt, player);
  }

  spawnCars() {
    const sg = this.signal;
    sg.cars = [
      { delay: 0.3, dir: 1, ds: 8.5 },
      { delay: 1.4, dir: -1, ds: 13.5 },
      { delay: 2.6, dir: 1, ds: 8.5 },
      { delay: 3.7, dir: -1, ds: 13.5 },
    ].map((c, i) => ({ ...c, x: -c.dir * 48, mesh: this.cars[i], t: 0, jumped: false }));
  }

  updateCars(dt, player) {
    for (const c of this.signal.cars) {
      c.t += dt;
      if (c.t < c.delay) continue;
      c.x += c.dir * 17 * dt;
      const s = this.signal.lineS + c.ds;
      const visible = Math.abs(c.x) < 50;
      c.mesh.visible = visible;
      if (!visible) continue;
      this.path.toWorld(s, c.x, 0, c.mesh.position);
      c.mesh.rotation.y = this.path.heading(s) + (c.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      // プレイヤーとの接触（飛び越えれば CAR JUMP）
      if (Math.abs(player.s - s) < 1.3 && Math.abs(player.x - c.x) < 2.5) {
        if (player.y >= 1.45) {
          if (!c.jumped) {
            c.jumped = true;
            this.hooks.cheer('leapCar');
            this.hooks.say('車を…飛び越えた!? 危ないのでやめてください！');
          }
        } else if (!player.falling && player.invuln <= 0) {
          player.fall('car');
          this.hooks.sfx('carHorn');
          this.hooks.say('危ない！ …セーフ！ 転んだだけです！', true);
        }
      }
    }
  }

  // ================= 巨大柴犬 =================
  startGiant(player) {
    // ビジョンのある側から出てきて、プレイヤーの少し前でコースをまたぐ
    const side = this.chunks.slice.landmarks.find((l) => l.id === 'dogVision')?.side ?? -1;
    this.giant = { state: 'wait', s: player.s + 130, x: side * 42, dir: -side, phase: 0 };
  }

  updateGiant(dt, player) {
    const g = this.giant;
    if (g.state === 'off') return;
    if (g.state === 'wait') {
      if (player.s > g.s - 66) {
        g.state = 'cross';
        this.chunks.getLandmarkById('dogVision')?.setAway();
        this.hooks.sfx('bigBark');
        this.hooks.shake(0.35);
        this.hooks.hype(0.6);
      }
      return;
    }
    const prev = g.phase;
    g.phase += dt * 4.2;
    g.x += g.dir * 13 * dt;
    if (Math.floor(prev / Math.PI) !== Math.floor(g.phase / Math.PI) && Math.abs(g.s - player.s) < 90) {
      this.hooks.shake(0.12);
      this.hooks.sfx('thump');
    }
    const yaw = g.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.path.writeMatrix(this.dogs.instanceMatrix.array, 3, g.s, g.x, 0, yaw, 9);
    this.dogs.geometry.attributes.iAnim.setXY(3, g.phase, 1);
    if (Math.abs(g.x) > 60) {
      g.state = 'off';
      this.path.writeMatrix(this.dogs.instanceMatrix.array, 3, 0, 0, 0, 0, 0);
    }
  }

  // ================= 見下ろしシューティング =================
  // ドローンは前方をゆっくり進みながら左右に揺れる。プレイヤーは追いついて撃つ。ぶつかるとよろける
  nearestDrone(player, range = 45) {
    let best = null;
    for (const d of this.shooter.drones) {
      const ds = d.s - player.s;
      if (ds > 0 && ds < range && (!best || ds < best.s - player.s)) best = d;
    }
    return best;
  }

  updateShooter(dt, player, fire) {
    const sh = this.shooter;
    if (!sh.active) {
      this.droneMesh.count = 0;
      this.bulletMesh.count = 0;
      return;
    }
    const rng = Math.random;
    if (!sh.ending) {
      while (sh.spawnS < player.s + 110) {
        const n = 2 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          sh.drones.push({ s: sh.spawnS + rng() * 6, x: (rng() * 2 - 1) * 5.4, y: 2.3, vs: 7 + rng() * 3, phase: rng() * 6.28 });
        }
        sh.spawnS += 16 + rng() * 10;
      }
    }
    // 射撃
    sh.cooldown -= dt;
    if (fire && sh.cooldown <= 0 && !player.falling) {
      sh.cooldown = 0.16;
      sh.bullets.push({ s: player.s + 0.8, x: player.x, y: player.y + 1.3, life: 0.5 });
      this.hooks.sfx('shoot');
    }
    for (const b of sh.bullets) {
      b.s += 55 * dt;
      b.life -= dt;
      for (const d of sh.drones) {
        if (d.dead || Math.abs(d.s - b.s) > 1.8 || Math.abs(d.x - b.x) > 1.6) continue;
        d.dead = true;
        b.life = 0;
        sh.kills++;
        this.hooks.cheer('droneDown');
        this.hooks.sfx('explode');
        this.hooks.burst(d.s, d.x, d.y, [2, 1.2, 0.4]);
        if (sh.kills === 10 || sh.kills === 25) this.hooks.say(`ドローン ${sh.kills} 機撃墜！ …これ、マラソンですよね!?`);
        break;
      }
    }
    for (const d of sh.drones) {
      if (d.dead) continue;
      d.phase += dt;
      d.s += d.vs * dt;
      d.x = clamp(d.x + Math.sin(d.phase * 1.7) * 1.4 * dt, -LIMIT, LIMIT);
      d.y = sh.ending ? d.y + 7 * dt : 2.3 + Math.sin(d.phase * 3) * 0.2;
      if (!sh.ending && Math.abs(d.s - player.s) < 1.2 && Math.abs(d.x - player.x) < 1.2 && !player.falling && player.invuln <= 0) {
        d.dead = true;
        player.hitStagger(0.35);
        this.hooks.sfx('explode');
        this.hooks.burst(d.s, d.x, d.y, [1.5, 0.5, 0.3]);
        this.hooks.shake(0.3);
      }
      if (d.s < player.s - 20 || d.y > 30) d.dead = true;
    }
    sh.drones = sh.drones.filter((d) => !d.dead);
    sh.bullets = sh.bullets.filter((b) => b.life > 0);
    if (sh.ending && sh.drones.length === 0) sh.active = false;

    const da = this.droneMesh.instanceMatrix.array;
    const n = Math.min(sh.drones.length, 40);
    for (let i = 0; i < n; i++) {
      const d = sh.drones[i];
      this.path.writeMatrix(da, i, d.s, d.x, d.y, this.time * 1.5 + d.phase, 2.2);
    }
    this.droneMesh.count = n;
    this.droneMesh.instanceMatrix.needsUpdate = true;
    const ba = this.bulletMesh.instanceMatrix.array;
    const m = Math.min(sh.bullets.length, 60);
    for (let i = 0; i < m; i++) {
      const b = sh.bullets[i];
      this.path.writeMatrix(ba, i, b.s, b.x, b.y, 0, 1);
    }
    this.bulletMesh.count = m;
    this.bulletMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, player, { fire = false } = {}) {
    this.time += dt;
    this.updateShooter(dt, player, fire);
    this.updateTrain(dt, player);
    this.updatePacers(dt, player);
    this.updateSignal(dt, player);
    this.updateGiant(dt, player);
    this.dogs.instanceMatrix.needsUpdate = true;
    this.dogs.geometry.attributes.iAnim.needsUpdate = true;
  }
}
