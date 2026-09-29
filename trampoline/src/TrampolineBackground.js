import * as THREE from 'three';
import { Particles } from '../../src/fx/Particles.js';
import { glow, darkMetal } from '../../src/world/LandmarksStadium.js';

// 背景は選手と関係なく、勝手に動いている:
//   花火（会場内の演出花火）/ 飛行機 / 鳥の群れ / 取材ヘリのライト / 照明の演出 / 観客ウェーブ / カメラのフラッシュ
// 跳ぶたびに「この跳躍の間のどこか」で起きるよう予定を立てる（時刻は世界の時間。選手の動きとは無関係に決まる）。
// それぞれの「見せ場の瞬間」に選手が頂点・回転・ポーズ・着地のどれかだったら → 偶然の一致（sync）。
// 保証が必要な時だけ（force）、見せ場の瞬間を頂点にぴったり合わせる。本人には区別がつかない。

const PALETTE = [
  [1.6, 0.5, 0.9],
  [0.4, 1.4, 1.8],
  [1.8, 1.4, 0.4],
  [0.6, 1.8, 0.7],
  [1.8, 0.6, 0.4],
  [1.6, 1.6, 1.8],
];

const FLIGHT = 0.9; // 花火が打ち上がって開くまで（世界の時間）

export class TrampolineBackground {
  constructor(scene, arena, rng) {
    this.scene = scene;
    this.arena = arena;
    this.rng = rng;
    this.sparks = new Particles(scene, { capacity: 3200, additive: true });
    this.rockets = [];
    this.items = [];
    this.lastBurst = new THREE.Vector3(0, 22, -24);
    this.syncPoint = new THREE.Vector3();
    this.time = 0;
    this.jt = 0;
    this.buildPlane();
    this.buildBirds();
    this.buildHeli();
  }

  // ---- 見た目
  buildPlane() {
    const g = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: 0xc8ccd8 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.4, 34, 8).rotateZ(Math.PI / 2), white);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 36), white);
    wing.position.x = 2;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 0.4), white);
    tail.position.set(-15, 3, 0);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 11), white);
    stab.position.set(-15, 0.6, 0);
    this.planeLights = [new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 4), glow(0xff2020, 4)), new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 4), glow(0x20ff60, 4)), new THREE.Mesh(new THREE.SphereGeometry(1.1, 6, 4), glow(0xffffff, 6))];
    this.planeLights[0].position.set(2, 0, -18);
    this.planeLights[1].position.set(2, 0, 18);
    this.planeLights[2].position.set(-17, 6, 0);
    g.add(body, wing, tail, stab, ...this.planeLights);
    g.visible = false;
    this.plane = g;
    this.scene.add(g);
  }

  buildBirds() {
    const geo = new THREE.BufferGeometry();
    // V 字（2 枚の三角形）
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -1.1, 0.25, -0.1, 0, 0, -0.3, 0, 0, 0.3, 0, 0, -0.3, 1.1, 0.25, -0.1], 3));
    geo.computeVertexNormals();
    this.birds = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x0c0d16, side: THREE.DoubleSide }), 18);
    this.birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.birds.frustumCulled = false;
    this.birds.visible = false;
    this.birdOff = [];
    for (let i = 0; i < 18; i++) {
      const row = Math.floor((i + 1) / 2);
      const side = i % 2 ? 1 : -1;
      this.birdOff.push(new THREE.Vector3(-row * 2.4, (this.rng.next() - 0.5) * 1.5, side * row * 2.2));
    }
    this.scene.add(this.birds);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  buildHeli() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 8).scale(1.6, 1, 1), darkMetal);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(7, 0.6, 0.6), darkMetal);
    tail.position.x = -5.5;
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 0.5), darkMetal);
    this.rotor.position.y = 2.3;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), glow(0xffffff, 6));
    lamp.position.set(2.5, -1.8, 0);
    const blink = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 4), glow(0xff2020, 5));
    blink.position.set(-8.5, 0.6, 0);
    this.heliBlink = blink;
    g.add(body, tail, this.rotor, lamp, blink);
    // ライトの光の筋（上が細い円錐。加算合成）
    const beamGeo = new THREE.CylinderGeometry(0.4, 4.5, 1, 16, 1, true).translate(0, -0.5, 0);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.beam.frustumCulled = false;
    g.visible = false;
    this.heli = g;
    this.heliPos = new THREE.Vector3(78, 82, -62);
    g.position.copy(this.heliPos);
    this.scene.add(g, this.beam);
    this.beam.visible = false;
    this.beamTarget = new THREE.Vector3();
  }

  // ---- 予定: 跳んだ瞬間に「この跳躍の間の見せ場」を決める
  // j: { tApex, tLand（世界の時間, 秒）, level, force: Set(kind) }
  scheduleJump(j) {
    this.items = [];
    this.jt = 0;
    const r = this.rng;
    const rand = () => 0.12 + r.next() * Math.max(0.2, j.tLand - 0.25);
    const at = (kind) => (j.force.has(kind) ? j.tApex : rand());
    const add = (kind, T, data = {}) => this.items.push({ kind, T, done: false, started: false, ...data });
    if (j.level >= 1) {
      const n = j.level >= 3 ? 3 : j.level >= 2 ? 2 : 1;
      for (let i = 0; i < n; i++) add('firework', i === 0 ? at('firework') : rand());
      if (r.chance(0.45) || j.force.has('wave')) add('wave', at('wave'));
      if (r.chance(0.4) || j.force.has('lights')) add('lights', at('lights'));
      if (r.chance(0.5) || j.force.has('flashes')) add('flashes', at('flashes'));
    }
    if (j.level >= 2) {
      if (r.chance(0.5) || j.force.has('plane')) add('plane', at('plane'));
      if (r.chance(0.4) || j.force.has('birds')) add('birds', at('birds'));
      if (r.chance(0.35) || j.force.has('heli')) add('heli', at('heli'));
    }
    // 開始の準備（見せ場より前から動かす必要があるもの）
    for (const it of this.items) {
      if (it.kind === 'firework') it.start = it.T - FLIGHT;
      else if (it.kind === 'lights') it.start = it.T - 2.0;
      else if (it.kind === 'wave') it.start = it.T - 1.6;
      else if (it.kind === 'flashes') it.start = it.T - 0.1;
      else it.start = it.T - 3.0;
    }
  }

  clearJump() {
    this.items = [];
  }

  // ---- 毎フレーム（世界の時間）。返り値: この瞬間に起きた「偶然の一致」
  // ctx: { airborne, vy, height, wordAge（最後に単語を打ち終えてからの世界の時間）, pose, rotSpeed, timeToLand, com }
  update(gameDt, ctx) {
    this.time += gameDt;
    this.jt += gameDt;
    const syncs = [];
    for (const it of this.items) {
      if (!it.started && this.jt >= it.start) {
        it.started = true;
        this.begin(it);
      }
      if (it.started && !it.done && this.jt >= it.T) {
        it.done = true;
        const s = this.peak(it, ctx);
        if (s) syncs.push(s);
      }
    }
    this.updateRockets(gameDt);
    this.updatePlane();
    this.updateBirds(gameDt);
    this.updateHeli(gameDt);
    this.sparks.update(gameDt, this.time);
    return syncs;
  }

  begin(it) {
    const r = this.rng;
    switch (it.kind) {
      case 'firework': {
        // 会場の向こう側（中継のカメラから見える側）の床から打ち上げる
        const a = -Math.PI / 2 + (r.next() - 0.5) * 2.2;
        const rad = 20 + r.next() * 6;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        const h = 17 + r.next() * 8;
        const dur = Math.max(0.2, it.T - this.jt);
        this.rockets.push({ it, x, z, y: 0.5, vy: (h - 0.5) / dur, t: 0, dur, h, color: PALETTE[Math.floor(r.next() * PALETTE.length)] });
        break;
      }
      case 'lights':
        this.arena.lightShow(Math.max(0.3, it.T - this.jt) / 0.85);
        break;
      case 'wave': {
        const speed = 1.3;
        this.arena.startWave(-Math.PI / 2 - speed * Math.max(0, it.T - this.jt), speed, 1.1);
        break;
      }
      case 'plane': {
        const dir = r.next() * Math.PI * 2;
        const off = (r.next() - 0.5) * 30;
        this.planePath = { T: it.T, dir: new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir)), side: new THREE.Vector3(-Math.sin(dir), 0, Math.cos(dir)).multiplyScalar(off), speed: 70 };
        this.plane.visible = true;
        break;
      }
      case 'birds': {
        const dir = r.next() * Math.PI * 2;
        this.birdPath = { T: it.T, dir: new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir)), speed: 14, y: 50 + r.next() * 10 };
        this.birds.visible = true;
        break;
      }
      case 'heli': {
        const dir = r.next() * Math.PI * 2;
        this.heliPath = { T: it.T, dir: new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir)), speed: 3.2 };
        this.heli.visible = true;
        this.beam.visible = true;
        break;
      }
    }
  }

  // 見せ場の瞬間: 選手が何をしていたか
  peak(it, c) {
    if (!c.airborne) return null;
    const apex = Math.abs(c.vy) < 0.9;
    const turning = c.wordAge < 0.2; // 単語を打ち終えた瞬間 = 回り始め
    const pose = c.pose;
    const landing = c.timeToLand < 0.12;
    let moment = null;
    switch (it.kind) {
      case 'firework':
        this.burst(it);
        moment = apex ? 'apex' : pose ? 'pose' : turning ? 'rotation' : landing ? 'landing' : null;
        if (moment) this.syncPoint.copy(this.lastBurst);
        break;
      case 'lights':
        moment = apex ? 'apex' : pose ? 'pose' : null;
        if (moment) this.syncPoint.set(0, 36, -40);
        break;
      case 'wave':
        moment = apex ? 'apex' : pose ? 'pose' : null;
        if (moment) this.syncPoint.set(0, 8, -38);
        break;
      case 'flashes':
        this.arena.flashStorm(0.9);
        moment = pose ? 'pose' : null;
        break;
      case 'plane':
        moment = Math.abs(c.vy) < 2 && c.height > 2 ? 'apex' : null;
        if (moment) this.syncPoint.copy(this.plane.position);
        break;
      case 'birds':
        moment = turning || (apex && c.rotSpeed > 3) ? 'rotation' : null;
        if (moment) this.syncPoint.set(this.birds.userData.cx ?? 0, this.birdPath?.y ?? 50, this.birds.userData.cz ?? 0);
        break;
      case 'heli':
        moment = c.height > 2 ? 'apex' : null;
        if (moment) this.syncPoint.copy(this.heliPos);
        break;
    }
    return moment ? { kind: it.kind, moment, point: this.syncPoint.clone() } : null;
  }

  burst(it) {
    const rk = this.rockets.find((r) => r.it === it);
    if (!rk) return;
    rk.dead = true;
    this.lastBurst.set(rk.x, rk.h, rk.z);
    this.sparks.emit({ x: rk.x, y: rk.h, z: rk.z, spread: 7.5, color: rk.color, size: 0.7, life: 1.7, gravity: 2.2, drag: 1.1, count: 130 });
    this.sparks.emit({ x: rk.x, y: rk.h, z: rk.z, spread: 3, color: [2, 2, 2], size: 1.3, life: 0.35, gravity: 0, count: 12 });
  }

  updateRockets(dt) {
    for (const rk of this.rockets) {
      if (rk.dead) continue;
      rk.t += dt;
      rk.y = Math.min(rk.h, 0.5 + rk.vy * rk.t);
      this.sparks.emit({ x: rk.x, y: rk.y, z: rk.z, vy: -1, spread: 0.3, color: [1.6, 1.1, 0.5], size: 0.28, life: 0.5, gravity: 1, count: 1 });
      // 予定の瞬間を過ぎていたら開く（見せ場の判定とは別に、見た目は必ず開く）
      if (rk.t >= rk.dur + 0.05) this.burst(rk.it);
    }
    this.rockets = this.rockets.filter((r) => !r.dead);
  }

  updatePlane() {
    const p = this.planePath;
    if (!p) return;
    const d = (this.jt - p.T) * p.speed;
    this.plane.position.set(0, 300, 0).add(p.side).addScaledVector(p.dir, d);
    this.plane.rotation.y = Math.atan2(-p.dir.z, p.dir.x);
    this.planeLights[2].visible = Math.floor(this.time * 2.2) % 2 === 0;
    if (Math.abs(d) > 1400) {
      this.plane.visible = false;
      this.planePath = null;
    }
  }

  updateBirds(dt) {
    const p = this.birdPath;
    if (!p) return;
    const d = (this.jt - p.T) * p.speed;
    const cx = p.dir.x * d;
    const cz = p.dir.z * d;
    this.birds.userData.cx = cx;
    this.birds.userData.cz = cz;
    const yaw = Math.atan2(-p.dir.z, p.dir.x);
    this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (let i = 0; i < this.birdOff.length; i++) {
      const o = this.birdOff[i];
      const flap = 0.4 + Math.abs(Math.sin(this.time * 9 + i)) * 0.9;
      this._p.set(o.x, o.y, o.z).applyQuaternion(this._q).add(new THREE.Vector3(cx, p.y, cz));
      this._m.compose(this._p, this._q, this._s.set(1.4, flap * 1.4, 1.4));
      this.birds.setMatrixAt(i, this._m);
    }
    this.birds.instanceMatrix.needsUpdate = true;
    if (Math.abs(d) > 420) {
      this.birds.visible = false;
      this.birdPath = null;
    }
    void dt;
  }

  updateHeli(dt) {
    this.rotor.rotation.y += dt * 40;
    this.heliBlink.visible = Math.floor(this.time * 1.6) % 2 === 0;
    const p = this.heliPath;
    if (!p) return;
    // ライトの当たる所が床をなめるように動き、T の瞬間に中心を通る
    const d = (this.jt - p.T) * p.speed;
    this.beamTarget.set(p.dir.x * d, 0.2, p.dir.z * d);
    this.heli.position.copy(this.heliPos);
    const from = this._p.set(this.heliPos.x + 2.5, this.heliPos.y - 1.8, this.heliPos.z);
    const len = from.distanceTo(this.beamTarget);
    this.beam.position.copy(from);
    this.beam.scale.set(1, len, 1);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.beamTarget.clone().sub(from).normalize());
    if (Math.abs(d) > 40) {
      this.heliPath = null;
      this.beam.visible = false;
    }
  }
}
