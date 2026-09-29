import * as THREE from 'three';
import { BED } from './TrampolinePhysics.js';
import { darkMetal, glow } from '../../src/world/LandmarksStadium.js';
import { makeCanvas, toTexture } from '../../src/world/textures.js';

// 競技用トランポリンの見た目: 鉄のフレーム・脚・青い保護パッド・ばね（周囲）・ベッド（網）。
// ベッドは格子の頂点を毎フレーム動かす疑似ソフトボディ:
//   足の位置を中心に沈み、フレームへ向かってなだらかに戻る。沈むほどばねが伸びる（張力が見える）。
//   離れた後は少し波打って収まる（ベッドの揺れは TrampolinePhysics の d）。

const SEG_X = 28;
const SEG_Z = 14;
const FRAME_PAD = 0.62; // ベッドの端からフレームまで（ばねの長さ）

function bedTexture() {
  const [c, g] = makeCanvas(512, 256);
  g.fillStyle = '#10131c';
  g.fillRect(0, 0, 512, 256);
  // 網の目
  g.strokeStyle = 'rgba(80,90,120,.35)';
  g.lineWidth = 1;
  for (let x = 0; x < 512; x += 6) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  for (let y = 0; y < 256; y += 6) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
  }
  // 競技のマーク（中央の赤い十字と区画の線）
  g.strokeStyle = '#e8322a';
  g.lineWidth = 6;
  g.strokeRect(166, 64, 180, 128);
  g.beginPath();
  g.moveTo(256, 96);
  g.lineTo(256, 160);
  g.moveTo(224, 128);
  g.lineTo(288, 128);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.55)';
  g.lineWidth = 3;
  g.strokeRect(40, 22, 432, 212);
  return toTexture(c);
}

export class TrampolineBed {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const W = BED.halfX * 2;
    const L = BED.halfZ * 2;
    // ベッド（格子）
    this.geo = new THREE.PlaneGeometry(W, L, SEG_X, SEG_Z).rotateX(-Math.PI / 2);
    this.base = Float32Array.from(this.geo.attributes.position.array);
    this.bed = new THREE.Mesh(this.geo, new THREE.MeshLambertMaterial({ map: bedTexture(), side: THREE.DoubleSide }));
    this.bed.position.y = BED.top;
    this.group.add(this.bed);
    // フレーム（外周の鉄パイプ）と脚
    const fx = BED.halfX + FRAME_PAD;
    const fz = BED.halfZ + FRAME_PAD;
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x8c93a0 });
    for (const [w, d, x, z] of [
      [fx * 2 + 0.2, 0.12, 0, fz],
      [fx * 2 + 0.2, 0.12, 0, -fz],
      [0.12, fz * 2, fx, 0],
      [0.12, fz * 2, -fx, 0],
    ]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), frameMat);
      bar.position.set(x, BED.top - 0.02, z);
      this.group.add(bar);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, BED.top, 0.1), frameMat);
        leg.position.set(sx * (fx - 0.3), BED.top / 2, sz * fz);
        this.group.add(leg);
      }
    }
    // 保護パッド（フレームの上の青いカバー）
    const padMat = new THREE.MeshLambertMaterial({ color: 0x1f5fd0 });
    for (const [w, d, x, z] of [
      [fx * 2 + 0.7, 0.56, 0, fz + 0.05],
      [fx * 2 + 0.7, 0.56, 0, -fz - 0.05],
      [0.56, fz * 2 - 0.5, fx + 0.05, 0],
      [0.56, fz * 2 - 0.5, -fx - 0.05, 0],
    ]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), padMat);
      pad.position.set(x, BED.top + 0.04, z);
      this.group.add(pad);
    }
    // 両端の安全マット（エンドデッキ）
    for (const sx of [-1, 1]) {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, fz * 2 + 1.2), padMat);
      deck.position.set(sx * (fx + 1.6), 0.25, 0);
      this.group.add(deck);
    }
    // 床の青いマット
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(fx * 2 + 8, fz * 2 + 6).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2a64c8 }));
    mat.position.y = 0.02;
    this.group.add(mat);
    // ばね（周囲に並ぶ。沈むと伸びる）: InstancedMesh 1 つ
    const springs = [];
    const nx = 22;
    const nz = 11;
    for (let i = 0; i < nx; i++) {
      const x = -BED.halfX + (i + 0.5) * (W / nx);
      springs.push([x, BED.halfZ, 0, 1], [x, -BED.halfZ, 0, -1]);
    }
    for (let i = 0; i < nz; i++) {
      const z = -BED.halfZ + (i + 0.5) * (L / nz);
      springs.push([BED.halfX, z, 1, 0], [-BED.halfX, z, -1, 0]);
    }
    this.springData = springs;
    this.springs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 5).rotateZ(Math.PI / 2), darkMetal, springs.length);
    this.springs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.springs);
    // ベッドの下の影（沈むと濃く）
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(W, L).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    this.shadow.position.y = 0.04;
    this.group.add(this.shadow);
    // 踏み込みの瞬間に光る輪（「踏んだ！」）
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.55, 40).rotateX(-Math.PI / 2), glow(0x39e6ff, 1.8));
    this.ring.material.transparent = true;
    this.ring.material.opacity = 0;
    this.ring.material.depthWrite = false;
    this.ring.position.y = BED.top + 0.03;
    this.group.add(this.ring);
    this.ringT = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._axis = new THREE.Vector3();
    this.update(0, 0, 0, 0);
  }

  flash(power = 1) {
    this.ringT = 1;
    this.ringPower = power;
  }

  // d: 沈み（下向き +）/ cx, cz: 足の位置（ベッドの座標）
  update(dt, d, cx = 0, cz = 0) {
    const pos = this.geo.attributes.position.array;
    const b = this.base;
    const hx = BED.halfX;
    const hz = BED.halfZ;
    for (let i = 0; i < pos.length; i += 3) {
      const x = b[i];
      const z = b[i + 2];
      // フレームで 0、足の真下で 1。中央ほど深く（なだらかな皿）
      const ex = 1 - (x / hx) ** 2;
      const ez = 1 - (z / hz) ** 2;
      const dx = x - cx;
      const dz = z - cz;
      const local = Math.exp(-(dx * dx + dz * dz * 2) * 0.45);
      const w = Math.max(0, ex) * Math.max(0, ez) * (0.35 + 0.65 * local);
      pos[i + 1] = -d * w;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    // ばね: フレームからベッドの端（少し沈んだ点）へ
    const edgeSag = Math.max(0, d) * 0.28;
    for (let i = 0; i < this.springData.length; i++) {
      const [a, bb, nx, nz] = this.springData[i];
      const onX = nz !== 0; // 長い辺
      const bx = onX ? a : a;
      const bz = onX ? bb : bb;
      const inner = this._p.set(bx, BED.top - edgeSag, bz);
      const outer = new THREE.Vector3(bx + nx * FRAME_PAD, BED.top - 0.02, bz + nz * FRAME_PAD);
      const dir = this._axis.copy(outer).sub(inner);
      const len = dir.length();
      dir.normalize();
      this._q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      this._m.compose(inner.clone().add(outer).multiplyScalar(0.5), this._q, this._s.set(len, 1 + Math.max(0, d) * 0.4, 1 + Math.max(0, d) * 0.4));
      this.springs.setMatrixAt(i, this._m);
    }
    this.springs.instanceMatrix.needsUpdate = true;
    this.shadow.material.opacity = 0.2 + Math.max(0, d) * 0.3;
    // 光る輪
    if (this.ringT > 0) {
      this.ringT = Math.max(0, this.ringT - dt * 2.2);
      const t = 1 - this.ringT;
      this.ring.scale.setScalar(1 + t * 6 * (this.ringPower ?? 1));
      this.ring.material.opacity = this.ringT * 0.9;
      this.ring.position.set(cx, BED.top + 0.03 - d * 0.6, cz);
    } else this.ring.material.opacity = 0;
  }
}
