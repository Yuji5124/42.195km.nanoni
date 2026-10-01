import * as THREE from 'three';

// 鳥。鳥も NPC（少しだけ物語がある）。
//   2 羽（実は付き合っている。今日は会場へデートに来ている）: 夜空から入ってくる → 照明塔のまわりを回ってとまる
//   → バックスタンドの屋根の縁に並んでとまる → 月の前を横切る → また屋根 → 最後に 2 羽で夜空へ飛んでいく。
//   ほかに鳩の群れ（照明塔のまわりをときどき回る）。
// 形は胴（楕円体）+ 翼 2 枚（はばたき = 翼の回転）+ 頭。1 羽 = Group。

function birdMesh(color = 0x2a2a30, belly = 0xd8d8d0, scale = 1) {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color });
  const mb = new THREE.MeshLambertMaterial({ color: belly });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), m);
  body.scale.set(0.8, 0.7, 1.7);
  const bel = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), mb);
  bel.scale.set(0.7, 0.6, 1.4);
  bel.position.set(0, -0.02, 0.01);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), m);
  head.position.set(0, 0.04, 0.15);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 4), new THREE.MeshLambertMaterial({ color: 0xffb030 }));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.035, 0.21);
  const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.12), m);
  tail.rotation.x = -Math.PI / 2 + 0.2;
  tail.position.set(0, 0, -0.19);
  const headG = new THREE.Group();
  headG.add(head, beak);
  g.add(body, bel, headG, tail);
  const wings = [];
  for (const s of [1, -1]) {
    const wg = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.07, s * 0.36, 0, -0.02, 0, 0, -0.08, s * 0.36, 0, -0.02, s * 0.2, 0, -0.1, 0, 0, -0.08], 3));
    geo.computeVertexNormals();
    const w = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
    wg.add(w);
    wg.position.set(s * 0.04, 0.03, 0.02);
    g.add(wg);
    wings.push(wg);
  }
  g.scale.setScalar(scale);
  g.userData = { wings, head: headG };
  return g;
}

// キーフレーム [t, x, y, z, perch?] → Catmull-Rom
function track(keys) {
  return keys.map((k) => ({ t: k[0], p: new THREE.Vector3(k[1], k[2], k[3]), perch: !!k[4] }));
}
function sample(keys, t, out) {
  if (t <= keys[0].t) return { pos: out.copy(keys[0].p), perch: keys[0].perch, i: 0 };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t) {
      const k = (t - a.t) / (b.t - a.t);
      const p0 = keys[Math.max(0, i - 1)].p;
      const p3 = keys[Math.min(keys.length - 1, i + 2)].p;
      const k2 = k * k;
      const k3 = k2 * k;
      out.set(0, 0, 0)
        .addScaledVector(p0, -0.5 * k3 + k2 - 0.5 * k)
        .addScaledVector(a.p, 1.5 * k3 - 2.5 * k2 + 1)
        .addScaledVector(b.p, -1.5 * k3 + 2 * k2 + 0.5 * k)
        .addScaledVector(p3, 0.5 * k3 - 0.5 * k2);
      return { pos: out, perch: a.perch && b.perch && a.p.distanceTo(b.p) < 0.5, i };
    }
  }
  return { pos: out.copy(keys[keys.length - 1].p), perch: keys[keys.length - 1].perch, i: keys.length - 1 };
}

export class Birds {
  constructor(scene, { camPos, moonDirAt, tower }) {
    this.scene = scene;
    this.camPos = new THREE.Vector3(camPos.x, camPos.y, camPos.z);
    this.pair = [birdMesh(0x3a3c44, 0xe8e4da, 1.15), birdMesh(0x4a4038, 0xf0e8dc, 1.05)];
    for (const b of this.pair) scene.add(b);
    // 月の前を通る点（カメラ → 月 の線の上、120m 先）
    const m1 = moonDirAt(104).multiplyScalar(118).add(this.camPos);
    const m2 = moonDirAt(174.5).multiplyScalar(150).add(this.camPos);
    const tw = new THREE.Vector3(tower.x, tower.h + 5.5, tower.z);
    const roof = new THREE.Vector3(26, 33.6, -64.2);
    const roof2 = roof.clone().add(new THREE.Vector3(-3, 0, 0));
    const ring = (c, r, t0, n, dt, y = 0) => Array.from({ length: n }, (_, i) => [t0 + i * dt, c.x + Math.cos(i * 1.2) * r, c.y + y + Math.sin(i * 0.7) * 2, c.z + Math.sin(i * 1.2) * r]);
    // 1 羽目（先を飛ぶ）
    this.keysA = track([
      [0, 260, 70, -160],
      [50, 230, 66, -140],
      [56, 150, 60, -95],
      ...ring(tw, 9, 60, 5, 1.6),
      [68, tw.x - 0.6, tw.y + 0.2, tw.z + 0.8, 1],
      [82, tw.x - 0.6, tw.y + 0.2, tw.z + 0.8, 1],
      [88, 60, 45, -60],
      [93, roof.x, roof.y + 0.15, roof.z, 1],
      [100, roof.x, roof.y + 0.15, roof.z, 1],
      [101.8, roof.x - 6, roof.y + 6, roof.z + 14],
      [104, m1.x, m1.y, m1.z],
      [106.5, m1.x + 18, m1.y + 6, m1.z - 10],
      [111, 40, 40, -30],
      [116, roof2.x, roof2.y + 0.15, roof2.z, 1],
      [150, roof2.x, roof2.y + 0.15, roof2.z, 1],
      [155, 10, 38, -10],
      [160, -10, 42, 10],
      [165, 15, 40, 15],
      [170, 35, 36, -20],
      [174.5, m2.x, m2.y, m2.z],
      [180, m2.x + 60, m2.y + 70, m2.z - 80],
      [190, m2.x + 200, m2.y + 200, m2.z - 300],
    ]);
    // 2 羽目（少し遅れてついていく・止まる時は隣）
    const side = new THREE.Vector3(0.45, 0, 0.1);
    this.keysB = track(
      this.keysA.map((k) => {
        const off = k.perch ? side : new THREE.Vector3(1.2, 0.5, -0.8);
        return [k.t + (k.perch ? 0 : 0.35), k.p.x + off.x, k.p.y + off.y, k.p.z + off.z, k.perch];
      }).map((k) => [k[0], k[1], k[2], k[3], k[4]])
    );
    // 鳩の群れ（照明塔のまわり）
    this.flock = [];
    const fc = new THREE.Vector3(-tower.x, tower.h - 6, tower.z);
    for (let i = 0; i < 6; i++) {
      const b = birdMesh(0x6a6e78, 0xb8bcc4, 0.95);
      scene.add(b);
      this.flock.push({ mesh: b, ph: i * 1.05, r: 10 + (i % 3) * 2.5, c: fc, h: (i % 2) * 2 });
    }
    this.flockOn = [[40, 70], [120, 150]];
    this._p = new THREE.Vector3();
    this._q = new THREE.Vector3();
    this.time = 0;
    this.state = 'away';
  }

  update(t, dt) {
    this.time = t;
    const keys = [this.keysA, this.keysB];
    this.pair.forEach((b, i) => {
      const s = sample(keys[i], t, this._p);
      b.position.copy(s.pos);
      const ahead = sample(keys[i], t + 0.12, this._q).pos;
      const dir = ahead.sub(b.position);
      const W = b.userData.wings;
      if (s.perch || dir.lengthSq() < 1e-5) {
        // とまっている: 翼をたたむ・頭をときどき相手へ
        W[0].rotation.z = -0.1;
        W[1].rotation.z = 0.1;
        b.rotation.set(0, i === 0 ? -0.5 : 2.6, 0);
        b.userData.head.rotation.y = Math.sin(t * 0.9 + i) > 0.6 ? (i === 0 ? 0.8 : -0.8) : 0.2 * Math.sin(t * 2 + i);
      } else {
        b.lookAt(this._q.copy(b.position).add(dir));
        const flap = Math.sin(t * 15 + i * 1.3);
        const glide = Math.sin(t * 0.8 + i) > 0.55 ? 0.15 : 1;
        W[0].rotation.z = flap * 0.75 * glide;
        W[1].rotation.z = -flap * 0.75 * glide;
        b.userData.head.rotation.y = 0;
      }
      b.visible = t > 40 && t < 186;
    });
    this.state = this.stateAt(t);
    // 鳩
    const on = this.flockOn.some(([a, b]) => t > a && t < b);
    for (const f of this.flock) {
      f.mesh.visible = on;
      if (!on) continue;
      const a = t * 0.55 + f.ph;
      f.mesh.position.set(f.c.x + Math.cos(a) * f.r, f.c.y + f.h + Math.sin(a * 2) * 1.5, f.c.z + Math.sin(a) * f.r);
      f.mesh.lookAt(f.c.x + Math.cos(a + 0.2) * f.r, f.mesh.position.y, f.c.z + Math.sin(a + 0.2) * f.r);
      const flap = Math.sin(t * 16 + f.ph * 3);
      f.mesh.userData.wings[0].rotation.z = flap * 0.7;
      f.mesh.userData.wings[1].rotation.z = -flap * 0.7;
    }
  }

  // いま何をしているか（撮影の判定・実況）
  stateAt(t) {
    if (t < 50) return 'away';
    if (t < 60) return 'enter';
    if (t < 68) return 'circle';
    if (t < 83) return 'tower';
    if (t < 93) return 'fly';
    if (t < 100.5) return 'roof';
    if (t < 107) return 'moon';
    if (t < 116) return 'fly';
    if (t < 150) return 'roof';
    if (t < 170) return 'circle';
    if (t < 180) return 'leave';
    return 'away';
  }

  center(out = new THREE.Vector3()) {
    return out.copy(this.pair[0].position).add(this.pair[1].position).multiplyScalar(0.5);
  }

  get flockVisible() {
    return this.flock[0].mesh.visible;
  }

  flockCenter(out = new THREE.Vector3()) {
    return out.copy(this.flock[0].c);
  }
}
