import * as THREE from 'three';
import { POLE_LEN, GRIP } from '../stadium/field.js';

// しなるポール。中心線（N 点）から細い管の頂点を毎フレーム作り直す（N × 6 頂点だけなので軽い）。
//   まっすぐ: 先端 tip と向き dir
//   曲がり: 先端（ボックス）→ 上の手（弧の長さ GRIP の円弧。弦が短いほど強く曲がる）+ 手より上はまっすぐ
//   曲がる向き: 弦の「上・ピット側」がふくらむ（下の手で押し上げる向き）

const N = 24;
const SIDES = 6;
const RAD = 0.022;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

export class Pole {
  constructor(color = 0x1c2230, tape = 0xffd23f) {
    this.pts = Array.from({ length: N }, () => new THREE.Vector3());
    const pos = new Float32Array(N * SIDES * 3);
    const col = new Float32Array(N * SIDES * 3);
    const idx = [];
    const c1 = new THREE.Color(color);
    const c2 = new THREE.Color(tape);
    for (let i = 0; i < N; i++) {
      const s = (i / (N - 1)) * POLE_LEN;
      const isTape = s > GRIP - 0.85 && s < GRIP + 0.12;
      const c = isTape ? c2 : i === 0 ? new THREE.Color(0xdddddd) : c1;
      for (let j = 0; j < SIDES; j++) {
        const o = (i * SIDES + j) * 3;
        col[o] = c.r;
        col[o + 1] = c.g;
        col[o + 2] = c.b;
        if (i < N - 1) {
          const a = i * SIDES + j;
          const b = i * SIDES + ((j + 1) % SIDES);
          const c3 = (i + 1) * SIDES + j;
          const d = (i + 1) * SIDES + ((j + 1) % SIDES);
          idx.push(a, c3, b, b, c3, d);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2 }));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.bend = 0;
  }

  // まっすぐ（tip から dir の向きへ POLE_LEN）
  straight(tip, dir) {
    for (let i = 0; i < N; i++) this.pts[i].copy(tip).addScaledVector(dir, (i / (N - 1)) * POLE_LEN);
    this.bend = 0;
    this.rebuild();
  }

  // 曲げる: 先端 A（ボックス）から上の手 B まで弧の長さ GRIP。返り値: 曲がり（0〜1）
  bent(A, B) {
    const chord = _a.subVectors(B, A);
    const L = chord.length();
    const S = GRIP;
    const dir = chord.clone().normalize();
    if (L >= S * 0.995) {
      this.straight(A, dir);
      return 0;
    }
    // sin x / x = L / S を x（半角）について解く
    const r = L / S;
    let x = Math.sqrt(6 * (1 - r));
    for (let k = 0; k < 8; k++) {
      const f = Math.sin(x) / x - r;
      const df = (x * Math.cos(x) - Math.sin(x)) / (x * x);
      x -= f / df;
      x = Math.max(1e-3, Math.min(Math.PI * 0.95, x));
    }
    const R = S / (2 * x);
    // ふくらむ向き: 弦に垂直・上（とピット側）
    _n.set(dir.y, -dir.x, 0);
    if (_n.y < 0 || (Math.abs(_n.y) < 1e-3 && _n.x < 0)) _n.negate();
    const M = _b.copy(A).addScaledVector(chord, 0.5);
    const C = M.clone().addScaledVector(_n, -R * Math.cos(x));
    const a0 = A.clone().sub(C);
    const b0 = B.clone().sub(C);
    const ang0 = Math.atan2(a0.y, a0.x);
    const cross = a0.x * b0.y - a0.y * b0.x;
    const sgn = cross >= 0 ? 1 : -1;
    for (let i = 0; i < N; i++) {
      const s = (i / (N - 1)) * POLE_LEN;
      if (s <= S) {
        const a = ang0 + sgn * (s / R);
        this.pts[i].set(C.x + R * Math.cos(a), C.y + R * Math.sin(a), A.z + (B.z - A.z) * (s / S));
      } else {
        // 手より上: 弧の接線の向きにまっすぐ
        const a = ang0 + sgn * (S / R);
        const tx = -Math.sin(a) * sgn;
        const ty = Math.cos(a) * sgn;
        const e = s - S;
        this.pts[i].set(B.x + tx * e, B.y + ty * e, B.z);
      }
    }
    this.bend = Math.min(1, (1 - r) * 3.2);
    this.rebuild();
    return this.bend;
  }

  // 中心線の点 s（先端からの長さ）
  pointAt(s, out = new THREE.Vector3()) {
    const f = Math.max(0, Math.min(1, s / POLE_LEN)) * (N - 1);
    const i = Math.min(N - 2, Math.floor(f));
    return out.lerpVectors(this.pts[i], this.pts[i + 1], f - i);
  }

  rebuild() {
    const pos = this.geo.attributes.position.array;
    const t = new THREE.Vector3();
    const u = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const p = this.pts[i];
      const q = this.pts[Math.min(N - 1, i + 1)];
      const r = this.pts[Math.max(0, i - 1)];
      t.subVectors(q, r).normalize();
      u.set(0, 0, 1).cross(t);
      if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
      u.normalize();
      v.crossVectors(t, u).normalize();
      const rad = i === 0 ? RAD * 0.8 : RAD;
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const ca = Math.cos(a) * rad;
        const sa = Math.sin(a) * rad;
        const o = (i * SIDES + j) * 3;
        pos[o] = p.x + u.x * ca + v.x * sa;
        pos[o + 1] = p.y + u.y * ca + v.y * sa;
        pos[o + 2] = p.z + u.z * ca + v.z * sa;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
