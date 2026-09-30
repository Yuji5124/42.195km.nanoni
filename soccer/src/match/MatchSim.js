import * as THREE from 'three';
import { createHumanMaterial, createHumanInstances, applyLook, writeYawMatrix } from '../../../src/world/RunnerModel.js';
import { makeBlobTexture } from '../../../src/world/textures.js';
import { clamp, damp } from '../../../src/core/math.js';

// ピッチの上のサッカー（見た目のための疑似試合）。
// 22 人を高度な AI にしない。MatchDirector が「次の行動（パス・ドリブル・シュート…）」を渡し、
// 選手は「チームの形（ボールに寄る・押し上げる）」+「役目（受け手は落下点へ・一番近い守備は寄せる）」で動くだけ。
// 速さは本物どおり（ジョグ 3.5m/s・スプリント 7.8m/s・パス 12〜22m/s・シュート 26m/s）。時計だけが速く進む。
//
// 座標: ピッチ中心が原点、ゴールは x = ±52.5（北 = +X）。前半は日本（home）が北へ攻める。

export const PITCH = { hx: 52.5, hz: 34, goalW: 7.32, goalH: 2.44 };

// 4-4-2（自陣ゴールが -u 側）。u = 攻める方向、v = 横
const FORMATION = [
  { role: 'GK', u: -50, v: 0 },
  { role: 'LB', u: -34, v: -21 },
  { role: 'CB', u: -37, v: -7 },
  { role: 'CB', u: -37, v: 7 },
  { role: 'RB', u: -34, v: 21 },
  { role: 'LM', u: -16, v: -23 },
  { role: 'CM', u: -19, v: -7 },
  { role: 'CM', u: -19, v: 7 },
  { role: 'RM', u: -16, v: 23 },
  { role: 'ST', u: -3, v: -7 },
  { role: 'ST', u: -3, v: 7 },
];
const NUMBERS = [1, 5, 4, 22, 2, 14, 7, 17, 10, 9, 11];
export const NAMES = {
  home: ['TANAKA', 'ITO', 'YOSHIDA', 'TOMIYASU', 'SUGAWARA', 'MITOMA', 'ENDO', 'MORITA', 'KUBO', 'UEDA', 'SAMURAI'],
  away: ['ALISSON', 'SANTOS', 'SILVA', 'MARQUES', 'COSTA', 'LIMA', 'ROCHA', 'ALVES', 'NETO', 'PEREIRA', 'NANONI'],
};

export const KITS = {
  home: { shirt: 0x1d3fb5, pants: 0xf2f2f2, gk: 0x21b35a },
  away: { shirt: 0xf2d02a, pants: 0x1d3fb5, gk: 0x222222 },
  ref: { shirt: 0x151515, pants: 0x151515 },
};

const _m = new THREE.Vector3();

export class Player {
  constructor(team, idx, dir) {
    this.team = team;
    this.idx = idx;
    this.role = FORMATION[idx].role;
    this.base = FORMATION[idx];
    this.num = NUMBERS[idx];
    this.name = NAMES[team][idx];
    this.dir = dir;
    this.pos = new THREE.Vector2(this.base.u * dir, this.base.v);
    this.vel = new THREE.Vector2();
    this.target = this.pos.clone();
    this.face = dir > 0 ? 0 : Math.PI;
    this.phase = Math.random() * 6;
    this.amp = 0;
    this.urgency = 0.5;
    this.override = null; // { x, z, speed } 役目で上書き
    this.celebrate = 0;
  }
}

export class MatchSim {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.players = [];
    for (let i = 0; i < 11; i++) this.players.push(new Player('home', i, 1));
    for (let i = 0; i < 11; i++) this.players.push(new Player('away', i, -1));
    this.ref = { pos: new THREE.Vector2(0, -8), vel: new THREE.Vector2(), face: 0, phase: 0, amp: 0 };
    this.dir = { home: 1, away: -1 };
    this.ball = {
      pos: new THREE.Vector3(0, 0.11, 0),
      vel: new THREE.Vector3(),
      state: 'dead',
      holder: null,
      flight: null,
      spin: 0,
    };
    this.possession = 'home';
    this.mode = 'play'; // play / celebrate / reset / frozen
    this.buildMeshes();
  }

  team(t) {
    return this.players.filter((p) => p.team === t);
  }

  gk(t) {
    return this.players.find((p) => p.team === t && p.role === 'GK');
  }

  buildMeshes() {
    const mat = createHumanMaterial({ mode: 'runner', rim: 0.25, rimColor: 0xffffff });
    this.mat = mat;
    const n = 23;
    this.mesh = createHumanInstances(n, mat, 'high');
    this.mesh.name = 'players';
    this.players.forEach((p, i) => {
      const kit = KITS[p.team];
      applyLook(this.mesh, i, { shirt: p.role === 'GK' ? kit.gk : kit.shirt, pants: kit.pants, skin: [0xe0ac86, 0xc98e6a, 0xf1c7a3, 0x8d5a3b][i % 4], hat: 0x151515, hatScale: 0 });
    });
    applyLook(this.mesh, 22, { shirt: KITS.ref.shirt, pants: KITS.ref.pants, skin: 0xe0ac86, hat: 0x222222, hatScale: 0 });
    this.scene.add(this.mesh);

    // ボール（見やすさのため少し大きい）
    const bc = document.createElement('canvas');
    bc.width = 64;
    bc.height = 32;
    const g = bc.getContext('2d');
    g.fillStyle = '#f4f4f4';
    g.fillRect(0, 0, 64, 32);
    g.fillStyle = '#222';
    for (let i = 0; i < 6; i++) g.fillRect(i * 11 + (i % 2) * 4, 8 + (i % 2) * 10, 6, 6);
    const tex = new THREE.CanvasTexture(bc);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), new THREE.MeshLambertMaterial({ map: tex, emissive: 0x444444 }));
    this.scene.add(this.ballMesh);

    // 影（丸いぼかし）: 選手 23 + ボール
    const blob = new THREE.MeshBasicMaterial({ map: makeBlobTexture(), transparent: true, depthWrite: false, opacity: 0.55, color: 0x000000 });
    const bg = new THREE.PlaneGeometry(1, 1);
    bg.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(bg, blob, 24);
    this.shadows.frustumCulled = false;
    this.scene.add(this.shadows);
  }

  // ---- ボール
  // to: {x, z}（地面）/ h: 放物線の高さ / speed m/s / receiver: 受ける選手（落下点へ走る）
  kick(to, { h = 0, speed = 16, receiver = null, y1 = 0.11, curve = 0 } = {}) {
    const b = this.ball;
    const from = b.pos.clone();
    from.y = Math.max(0.11, from.y);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const dur = Math.max(0.25, dist / speed);
    b.flight = { from, to: new THREE.Vector3(to.x, y1, to.z), h, t: 0, dur, curve, receiver };
    b.state = 'flying';
    b.holder = null;
    if (receiver) receiver.override = { x: to.x, z: to.z, speed: 7.5, until: dur + 0.3 };
    return dur;
  }

  give(player) {
    const b = this.ball;
    b.holder = player;
    b.state = 'held';
    b.flight = null;
    this.possession = player.team;
  }

  dead(x, z) {
    const b = this.ball;
    b.state = 'dead';
    b.holder = null;
    b.flight = null;
    b.pos.set(x, 0.11, z);
    b.vel.set(0, 0, 0);
  }

  // ---- 選手の目標位置（チームの形）
  formationTarget(p, out) {
    const b = this.ball.pos;
    const dir = this.dir[p.team];
    const attacking = this.possession === p.team;
    const ub = b.x * dir;
    if (p.role === 'GK') {
      const gx = -PITCH.hx + 1.2;
      out.set(gx * dir, clamp(b.z * 0.18, -3, 3));
      return out;
    }
    let u = p.base.u * 0.55 + ub * 0.5 + (attacking ? 11 : -3);
    // 最終ラインはオフサイドラインより上がらない
    u = clamp(u, -PITCH.hx + 6, attacking ? PITCH.hx - 8 : PITCH.hx - 20);
    let v = p.base.v * (attacking ? 0.95 : 0.72) + b.z * 0.28;
    v = clamp(v, -PITCH.hz + 2, PITCH.hz - 2);
    out.set(u * dir, v);
    return out;
  }

  // 役目: 一番近い守備が寄せる
  nearestTo(team, x, z, exclude = null) {
    let best = null;
    let bd = Infinity;
    for (const p of this.players) {
      if (p.team !== team || p === exclude || p.role === 'GK') continue;
      const d = (p.pos.x - x) ** 2 + (p.pos.y - z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  update(dt) {
    this.time += dt;
    const b = this.ball;
    // ---- ボール
    if (b.state === 'flying') {
      const f = b.flight;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const x = f.from.x + (f.to.x - f.from.x) * k;
      const z = f.from.z + (f.to.z - f.from.z) * k + Math.sin(k * Math.PI) * f.curve;
      const y = f.from.y + (f.to.y - f.from.y) * k + Math.sin(k * Math.PI) * f.h;
      b.vel.set((x - b.pos.x) / dt, (y - b.pos.y) / dt, (z - b.pos.z) / dt);
      b.pos.set(x, y, z);
      b.spin += dt * 14;
      if (k >= 1) {
        b.flight = null;
        if (f.receiver) this.give(f.receiver);
        else {
          b.state = 'rolling';
          b.vel.y = 0;
          b.vel.multiplyScalar(0.35);
        }
        if (f.onArrive) f.onArrive();
      }
    } else if (b.state === 'held' && b.holder) {
      const h = b.holder;
      const fx = Math.cos(h.face);
      const fz = Math.sin(h.face);
      const lead = 0.55 + 0.25 * Math.abs(Math.sin(h.phase * 0.5));
      b.pos.x = damp(b.pos.x, h.pos.x + fx * lead, 18, dt);
      b.pos.z = damp(b.pos.z, h.pos.y + fz * lead, 18, dt);
      b.pos.y = h.role === 'GK' && h.holdHands ? 1.2 : 0.11;
      b.spin += dt * h.vel.length() * 3;
    } else if (b.state === 'rolling') {
      b.pos.addScaledVector(b.vel, dt);
      b.vel.multiplyScalar(Math.exp(-1.2 * dt));
      b.pos.y = 0.11;
    } else if (b.state === 'net') {
      b.vel.multiplyScalar(Math.exp(-6 * dt));
      b.pos.addScaledVector(b.vel, dt);
      b.pos.y = Math.max(0.11, b.pos.y - dt * 2.5);
    }

    // ---- 選手
    const tgt = _m;
    for (const p of this.players) {
      const t2 = p.target;
      if (p.override) {
        t2.set(p.override.x, p.override.z);
        if (p.override.until !== undefined) {
          p.override.until -= dt;
          if (p.override.until <= 0 && !p.override.hold) p.override = null;
        }
      } else if (this.mode === 'reset' || this.mode === 'kickoff') {
        const dir = this.dir[p.team];
        t2.set(p.base.u * dir * 0.98 + (p.base.u > -10 ? -dir * 4 : 0), p.base.v);
      } else {
        this.formationTarget(p, t2);
      }
      // 持っている人: ドリブルの方向へ
      if (b.holder === p && p.dribble) {
        t2.set(p.dribble.x, p.dribble.z);
      }
      const dx = t2.x - p.pos.x;
      const dz = t2.y - p.pos.y;
      const dist = Math.hypot(dx, dz);
      let maxV = p.override?.speed ?? (dist > 12 ? 6.4 : dist > 4 ? 4.2 : 2.4);
      if (b.holder === p) maxV = Math.min(maxV, p.dribble?.speed ?? 5.2);
      if (this.mode === 'reset') maxV = Math.min(maxV, dist > 20 ? 4.5 : 2.6);
      const want = dist > 0.3 ? Math.min(maxV, dist * 1.4) : 0;
      const vx = dist > 0.01 ? (dx / dist) * want : 0;
      const vz = dist > 0.01 ? (dz / dist) * want : 0;
      p.vel.x = damp(p.vel.x, vx, 3.2, dt);
      p.vel.y = damp(p.vel.y, vz, 3.2, dt);
      p.pos.addScaledVector(p.vel, dt);
      const sp = p.vel.length();
      // 向き: 動いている方向。止まっている時はボール
      const faceTo = sp > 0.6 ? Math.atan2(p.vel.y, p.vel.x) : Math.atan2(b.pos.z - p.pos.y, b.pos.x - p.pos.x);
      let df = faceTo - p.face;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      p.face += df * Math.min(1, dt * 8);
      p.phase += dt * (sp * 2.3 + (sp > 0.2 ? 2 : 0));
      p.amp = damp(p.amp, Math.min(1, sp / 6.5), 6, dt);
    }
    // 審判: ボールの斜め後ろ
    const r = this.ref;
    const rx = b.pos.x - 8;
    const rz = clamp(b.pos.z * 0.6 - 10, -PITCH.hz + 4, PITCH.hz - 4);
    const rdx = rx - r.pos.x;
    const rdz = rz - r.pos.y;
    const rd = Math.hypot(rdx, rdz);
    const rv = rd > 0.5 ? Math.min(5, rd * 0.8) : 0;
    r.vel.x = damp(r.vel.x, rd > 0 ? (rdx / rd) * rv : 0, 3, dt);
    r.vel.y = damp(r.vel.y, rd > 0 ? (rdz / rd) * rv : 0, 3, dt);
    r.pos.addScaledVector(r.vel, dt);
    const rs = r.vel.length();
    r.face = Math.atan2(b.pos.z - r.pos.y, b.pos.x - r.pos.x);
    r.phase += dt * (rs * 2.3 + (rs > 0.2 ? 2 : 0));
    r.amp = Math.min(1, rs / 6.5);

    this.writeMeshes();
  }

  writeMeshes() {
    const arr = this.mesh.instanceMatrix.array;
    const anim = this.mesh.geometry.attributes.iAnim;
    const sh = this.shadows;
    const m = new THREE.Matrix4();
    const put = (i, x, z, face, phase, amp, jump = 0) => {
      // 人形の前は -Z。face（XZ 平面の角度）→ yaw
      const yaw = Math.atan2(-Math.cos(face), -Math.sin(face));
      writeYawMatrix(arr, i, x, jump, z, yaw, 1.08);
      anim.setXY(i, phase, amp);
      m.makeScale(1.1, 1, 1.1).setPosition(x, 0.02, z);
      sh.setMatrixAt(i, m);
    };
    this.players.forEach((p, i) => put(i, p.pos.x, p.pos.y, p.face, p.phase, p.amp, p.celebrate > 0 ? Math.max(0, Math.sin(this.time * 9 + i)) * 0.35 : 0));
    put(22, this.ref.pos.x, this.ref.pos.y, this.ref.face, this.ref.phase, this.ref.amp);
    this.mesh.instanceMatrix.needsUpdate = true;
    anim.needsUpdate = true;
    const b = this.ball;
    this.ballMesh.position.copy(b.pos);
    this.ballMesh.rotation.set(b.spin, b.spin * 0.3, 0);
    const s = Math.max(0.2, 0.5 - b.pos.y * 0.05);
    m.makeScale(s, 1, s).setPosition(b.pos.x, 0.021, b.pos.z);
    sh.setMatrixAt(23, m);
    sh.instanceMatrix.needsUpdate = true;
    this.mat.userData.uniforms.uTime.value = this.time;
  }
}
