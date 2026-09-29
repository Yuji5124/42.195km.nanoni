import * as THREE from 'three';
import { createHumanMaterial, createHumanInstances, applyLook, writeYawMatrix } from '../../src/world/RunnerModel.js';
import { glow } from '../../src/world/LandmarksStadium.js';
import { damp } from '../../src/core/math.js';

// 観客ドラマの 2 人（A / B）。台本（data/dramas.js）の act に合わせて動く。
// 人形は観客と同じインスタンス人形（腕を上げる = uExcite）。1 人 1 マテリアル（別々に腕を上げられる）。
// 2 人がいる席の元の観客と、カメラの近くの観客は、ドラマの間だけ隠す。

const LOOKS = [
  { shirt: 0x2b6b8a, pants: 0x1f2a44, skin: 0xe0ac86, hat: 0x2b1a10, hatScale: 0 },
  { shirt: 0xd8d8d8, pants: 0x3a3a46, skin: 0xf1c7a3, hat: 0x111111, hatScale: 0.7 },
];

export class TrampolineDrama {
  constructor(scene, arena, fx) {
    this.arena = arena;
    this.fx = fx;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.actors = LOOKS.map((look) => {
      const mat = createHumanMaterial({ mode: 'spectator', rim: 0.25, rimColor: 0xffd2a0 });
      mat.userData.uniforms.uPlayerXZ.value.set(9999, 9999);
      const mesh = createHumanInstances(1, mat, 'high');
      applyLook(mesh, 0, look);
      mesh.geometry.attributes.iAnim.setXY(0, Math.random(), 1);
      this.group.add(mesh);
      return { mesh, mat, pos: new THREE.Vector3(), yaw: 0, y: 0, arms: 0, target: { off: 0.45, yaw: 0, y: 0, arms: 0, hop: 0 }, hopT: 0 };
    });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 16), glow(0xffd23f, 3));
    this.ring.visible = false;
    this.group.add(this.ring);
    this.hat = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.1, 10), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    this.hat.visible = false;
    this.group.add(this.hat);
    this.center = new THREE.Vector3();
    this.cameraPos = new THREE.Vector3();
    this.playing = false;
    this.hidden = [];
  }

  // 台本を再生する。席は最前列からランダム
  play(script, rng) {
    const seats = this.arena.seats;
    const front = seats.map((s, i) => ({ s, i })).filter((o) => o.i % 3 === 0);
    // カメラ（WIDE）の反対側は避ける（背景に選手が入る向き）
    const pick = front[Math.floor(rng.next() * front.length)];
    const s = pick.s;
    this.script = script;
    this.t = 0;
    this.step = -1;
    this.playing = true;
    this.group.visible = true;
    this.base = { a: s.a, r: s.r, y: s.y };
    // 2 人の中心 / カメラ（2 人の後ろ・2 列上から、競技場の中心の方を見る）
    this.center.set(Math.cos(s.a) * s.r, s.y + 1.5, Math.sin(s.a) * s.r);
    const ca = s.a + 0.03;
    const cr = s.r + 2.1;
    this.cameraPos.set(Math.cos(ca) * cr, s.y + 1.95, Math.sin(ca) * cr);
    // 元の観客と、カメラと 2 人の間（視線をさえぎる所）の観客を隠す
    this.hidden = [];
    const cx = this.cameraPos.x;
    const cz = this.cameraPos.z;
    const dx = this.center.x - cx;
    const dz = this.center.z - cz;
    const len2 = dx * dx + dz * dz;
    seats.forEach((o, i) => {
      const k = Math.max(0, Math.min(1, ((o.x - cx) * dx + (o.z - cz) * dz) / len2));
      const dSeg = Math.hypot(o.x - (cx + dx * k), o.z - (cz + dz * k));
      const dA = Math.hypot(o.x - this.center.x, o.z - this.center.z);
      if (dA < 1.3 || dSeg < 1.5) this.hidden.push(i);
    });
    this.arena.hideSeats(this.hidden, true);
    for (const [k, a] of this.actors.entries()) {
      a.target = { off: script.steps[0].act === 'apart' ? 1.0 : 0.42, yaw: 0, y: 0, arms: 0, hop: 0 };
      a.off = a.target.off;
      a.side = k === 0 ? -1 : 1;
      a.face = 'center';
      a.y = 0;
      a.arms = 0;
      a.hopT = 0;
    }
    this.ring.visible = false;
    this.hat.visible = script.steps.some((st) => st.act === 'hat');
    this.hatT = -1;
    this.apply(0);
  }

  stop() {
    if (!this.playing && !this.group.visible) return;
    this.playing = false;
    this.group.visible = false;
    this.arena.hideSeats(this.hidden, false);
    this.hidden = [];
  }

  act(name, hud) {
    const [A, B] = this.actors;
    const both = (f) => this.actors.forEach(f);
    switch (name) {
      case 'look':
        both((a) => (a.face = 'other'));
        break;
      case 'apart':
        both((a) => (a.target.off = 1.0));
        break;
      case 'kneel':
        A.face = 'other';
        A.target.y = -0.42;
        break;
      case 'ring':
        this.ring.visible = true;
        break;
      case 'surprise':
        B.target.arms = 1;
        B.hopT = 0.5;
        break;
      case 'hug':
        A.target.y = 0;
        both((a) => {
          a.face = 'other';
          a.target.off = 0.2;
          a.target.arms = 0.5;
        });
        this.ring.visible = false;
        break;
      case 'handshake':
        both((a) => {
          a.face = 'other';
          a.target.off = 0.36;
          a.target.arms = 0.15;
        });
        break;
      case 'cheer':
        both((a) => {
          a.target.arms = 1;
          a.hopT = 0.6;
        });
        break;
      case 'hat':
        this.hatT = 0;
        break;
      case 'turn':
        both((a) => (a.face = 'center'));
        break;
      case 'confetti':
        this.fx.confettiBurst({ x: this.center.x, y: this.center.y - 5.5, z: this.center.z }, 140, 1.6);
        both((a) => (a.target.arms = 1));
        break;
    }
    void hud;
  }

  // realDt で進む（台本は実時間。世界がスローでも観客ドラマは普通の速さ）
  update(realDt, hud) {
    if (!this.playing) return;
    this.t += realDt;
    const steps = this.script.steps;
    while (this.step + 1 < steps.length && steps[this.step + 1].t <= this.t) {
      this.step++;
      const st = steps[this.step];
      if (st.caption) hud.caption(st.caption, 1.6);
      this.act(st.act, hud);
    }
    this.apply(realDt);
    if (this.t >= this.script.duration) this.playing = false;
  }

  apply(dt) {
    const b = this.base;
    const tangent = new THREE.Vector3(-Math.sin(b.a), 0, Math.cos(b.a));
    const toCenter = Math.atan2(Math.cos(b.a), Math.sin(b.a)); // yaw: 中心を向く（人形の前 = -Z → 前の向き (-sin yaw, -cos yaw)）
    for (const a of this.actors) {
      a.off = damp(a.off, a.target.off, 4, dt);
      a.y = damp(a.y, a.target.y, 6, dt);
      a.arms = damp(a.arms, a.target.arms, 5, dt);
      a.hopT = Math.max(0, a.hopT - dt);
      const hop = a.hopT > 0 ? Math.abs(Math.sin(a.hopT * 12)) * 0.18 : 0;
      a.pos.set(Math.cos(b.a) * b.r, b.y + a.y + hop, Math.sin(b.a) * b.r).addScaledVector(tangent, a.side * a.off);
      // 向き: 中心 or 相手（相手の方向 = tangent × -side）
      const yawTarget = a.face === 'other' ? Math.atan2(tangent.x * a.side, tangent.z * a.side) : toCenter;
      let d = yawTarget - a.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.yaw += d * Math.min(1, dt * 6 || 1);
      writeYawMatrix(a.mesh.instanceMatrix.array, 0, a.pos.x, a.pos.y, a.pos.z, a.yaw, 1);
      a.mesh.instanceMatrix.needsUpdate = true;
      const u = a.mat.userData.uniforms;
      u.uExcite.value = a.arms;
      u.uTime.value += dt;
    }
    // 指輪は 2 人の間で光って回る
    if (this.ring.visible) {
      const [A, B] = this.actors;
      this.ring.position.lerpVectors(A.pos, B.pos, 0.5);
      this.ring.position.y = b.y + 1.05;
      this.ring.rotation.y += dt * 3;
    }
    // 帽子: A の頭から飛んで、B の手元へ
    if (this.hat.visible) {
      const [A, B] = this.actors;
      if (this.hatT < 0) this.hat.position.set(A.pos.x, A.pos.y + 1.72, A.pos.z);
      else {
        this.hatT = Math.min(1, this.hatT + dt / 1.6);
        const k = this.hatT;
        this.hat.position.lerpVectors(A.pos, B.pos, k);
        this.hat.position.y = b.y + 1.72 + Math.sin(k * Math.PI) * 1.2 - k * 0.5;
        this.hat.rotation.z += dt * 8;
      }
    }
  }
}
