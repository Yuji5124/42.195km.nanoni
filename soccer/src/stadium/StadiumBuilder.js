import * as THREE from 'three';
import { TIERS, CORE, R0, AISLE, SEG, pointAt, arcLen, sAfterArc } from './StadiumLayout.js';
import {
  makePitchTexture,
  makeAdTexture,
  makeNumberAtlas,
  makeWindowTexture,
  makeRoofTexture,
  makeFasciaTexture,
  makeHaloTexture,
  makeSkyTexture,
} from './stadiumTextures.js';

// 10 万人スタジアムの見た目（静的なメッシュ）。座席の論理（StadiumLayout）と同じ式で段を組むので、
// 観客のビルボードはちょうど段の上に座る。
//
//   段: 蹴上げ（riser）と踏面（tread）を 1 つのジオメトリに（頂点カラー。通路の階段は明るい色）
//   ブロック番号: 上層は手すり壁、下層は VIP 席の壁、上層の最上段の壁に大きく
//   列番号: 通路の蹴上げに 1 列ずつ（双眼鏡なら読める）
//   屋根・照明（加算のハロ）・LED 広告・大型ビジョンの枠・夜空

export const ROOF = { dIn: 52, dOut: 90, yIn: 69, yOut: 61 };
export const JUMBO = { d: 54, w: 44, h: 22.6, y: 53.2 };
// 主人公が立つ場所: 南スタンド下層、ブロック 21 の手前の通路、14 列目（0 始まり）の踏面。背中に出入口（トンネル）
export const PLAYER_SPOT = { tier: 0, blockNumber: 21, row: 14, tunnelRows: [15, 21] };

const COL = {
  tread: new THREE.Color(0x3a3e4a),
  riser: new THREE.Color(0x2a2d37),
  aisle: new THREE.Color(0x6d7282),
  nosing: new THREE.Color(0x565a66),
  wall: new THREE.Color(0x22252f),
  soffit: new THREE.Color(0x191b23),
};

class GeoBuilder {
  constructor({ uv = false } = {}) {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = uv ? [] : null;
    this.idx = [];
  }
  quad(a, b, c, d, n, color, uvs) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) {
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
    }
    if (this.uv) this.uv.push(...(uvs ?? [0, 0, 1, 0, 1, 1, 0, 1]));
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// s の区間 [a, b] を刻む: 区間の境目 + 角（円弧）の中だけ約 step m ごと（直線は分けない）
function sampleS(tierId, a, b, d, step = 5) {
  const out = [a];
  const { cum } = SEG[tierId];
  const pts = [];
  for (let base = Math.floor(a); base <= Math.floor(b); base++) {
    for (let i = 0; i < 9; i++) {
      const c0 = base + cum[i];
      const c1 = base + cum[i + 1];
      if (c0 > a + 1e-6 && c0 < b - 1e-6) pts.push(c0);
      if (!(i === 1 || i === 3 || i === 5 || i === 7)) continue;
      const lo = Math.max(a, c0);
      const hi = Math.min(b, c1);
      if (hi <= lo) continue;
      const len = arcLen(tierId, lo, hi, d);
      const n = Math.max(1, Math.round(len / step));
      for (let k = 1; k < n; k++) pts.push(lo + ((hi - lo) * k) / n);
    }
  }
  pts.sort((x, y) => x - y);
  for (const p of pts) if (p - out[out.length - 1] > 1e-5) out.push(p);
  if (b - out[out.length - 1] > 1e-6) out.push(b);
  else out[out.length - 1] = b;
  return out;
}

const _p = {};
const _q = {};
function P(tierId, s, d, y) {
  pointAt(tierId, s, d, _p);
  return [_p.x, y, _p.z];
}
function inward(tierId, s) {
  pointAt(tierId, s, 10, _q);
  return [-_q.nx, 0, -_q.nz];
}

export class StadiumBuilder {
  constructor(scene, layout) {
    this.scene = scene;
    this.layout = layout;
    this.group = new THREE.Group();
    this.group.name = 'stadium';
    scene.add(this.group);
    this.time = 0;
    this.halos = [];
    this.buildSky();
    this.buildGround();
    this.buildStands();
    this.buildSigns();
    this.buildRoof();
    this.buildLights();
    this.buildAds();
    this.buildGoals();
    this.buildJumboFrames();
  }

  // 主人公の立ち位置（通路の中央）と前方
  playerSpot() {
    const T = TIERS[PLAYER_SPOT.tier];
    const blk = this.layout.blocks.find((b) => b.number === PLAYER_SPOT.blockNumber);
    const r = PLAYER_SPOT.row;
    const d = T.d0 + (r + 0.5) * T.depth;
    const s0 = blk.s0 < 0 ? blk.s0 + 1 : blk.s0;
    const sA = sAfterArc(T.id, s0, AISLE * 0.5, d) % 1;
    pointAt(T.id, sA, d, _p);
    return { x: _p.x, y: T.h0 + r * T.rise, z: _p.z, nx: _p.nx, nz: _p.nz, s: sA, d, blockIndex: blk.index };
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(1400, 24, 16);
    const mat = new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10;
    this.group.add(sky);
    // 星（屋根の上に少しだけ見える）
    const n = 400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = 0.35 + Math.random() * 1.1;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * 1300;
      pos[i * 3 + 1] = Math.sin(e) * 1300;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 1300;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9fb0ff, size: 1.6, sizeAttenuation: false, fog: false })));
  }

  buildGround() {
    // ピッチの外（スタンドの内側まで）: 角丸長方形
    const shape = new THREE.Shape();
    const { sx, sz } = CORE;
    const r = R0 + 0.6;
    shape.moveTo(sx + r, 0);
    shape.absarc(sx, sz, r, 0, Math.PI / 2, false);
    shape.absarc(-sx, sz, r, Math.PI / 2, Math.PI, false);
    shape.absarc(-sx, -sz, r, Math.PI, 1.5 * Math.PI, false);
    shape.absarc(sx, -sz, r, 1.5 * Math.PI, 2 * Math.PI, false);
    const g = new THREE.ShapeGeometry(shape, 12);
    g.rotateX(Math.PI / 2);
    const surround = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x1f5a2a, side: THREE.DoubleSide }));
    surround.position.y = -0.02;
    this.group.add(surround);

    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), new THREE.MeshLambertMaterial({ map: makePitchTexture() }));
    pitch.rotation.x = -Math.PI / 2;
    this.group.add(pitch);
    this.pitch = pitch;
  }

  // 段（蹴上げ + 踏面）・通路・VIP 席の壁・上層の手すり壁・最上段の壁・出入口のトンネル
  buildStands() {
    const gb = new GeoBuilder();
    const lab = new GeoBuilder({ uv: true }); // 通路の列番号
    const rowAtlas = makeNumberAtlas({ count: 60, cols: 10, cellW: 96, cellH: 48, bg: '#2a2d37', fg: '#ffd23f' });
    this.rowAtlas = rowAtlas;
    const spot = this.playerSpot();
    const tunnelBlock = spot.blockIndex;

    for (const T of TIERS) {
      const blocks = this.layout.blocks.filter((b) => b.tier === T.id);
      for (let r = 0; r < T.rows; r++) {
        const da = T.d0 + r * T.depth;
        const db = da + T.depth;
        const y = T.h0 + r * T.rise;
        const yLow = r === 0 ? (T.id === 0 ? 0 : T.h0 - 1.6) : T.h0 + (r - 1) * T.rise;
        for (const blk of blocks) {
          const s0 = blk.s0 < 0 ? blk.s0 + 1 : blk.s0;
          const s1 = s0 + (blk.s1 - blk.s0);
          const sA = sAfterArc(T.id, s0, AISLE, (da + db) / 2);
          const tunnel = T.id === PLAYER_SPOT.tier && blk.index === tunnelBlock && r >= PLAYER_SPOT.tunnelRows[0] && r <= PLAYER_SPOT.tunnelRows[1];
          const pieces = [
            [s0, sA, true],
            [sA, s1, false],
          ];
          for (const [a, b, isAisle] of pieces) {
            if (tunnel && isAisle) continue;
            const ss = sampleS(T.id, a, b, db, isAisle ? 50 : 5);
            for (let i = 0; i < ss.length - 1; i++) {
              const u = ss[i];
              const v = ss[i + 1];
              // 踏面
              gb.quad(P(T.id, u, da, y), P(T.id, v, da, y), P(T.id, v, db, y), P(T.id, u, db, y), [0, 1, 0], isAisle ? COL.aisle : COL.tread);
              // 蹴上げ（ピッチ側を向く）
              const n = inward(T.id, (u + v) / 2);
              gb.quad(P(T.id, v, da, yLow), P(T.id, u, da, yLow), P(T.id, u, da, y), P(T.id, v, da, y), n, isAisle ? COL.nosing : COL.riser);
            }
            if (isAisle && r > 0) {
              // 列番号（通路の蹴上げ）
              const n = inward(T.id, (a + b) / 2);
              const [u0, v0, du, dv] = rowAtlas.uv(r);
              const off = 0.01;
              pointAt(T.id, a, da - off, _p);
              const A = [_p.x, yLow + 0.04, _p.z];
              const D = [_p.x, y - 0.04, _p.z];
              pointAt(T.id, b, da - off, _p);
              const B = [_p.x, yLow + 0.04, _p.z];
              const C = [_p.x, y - 0.04, _p.z];
              lab.quad(B, A, D, C, n, COL.aisle, [u0, v0, u0 + du, v0, u0 + du, v0 + dv, u0, v0 + dv]);
            }
          }
        }
      }
      // 最上段の後ろの壁（下層: VIP 席の壁 / 上層: 屋根まで）
      const yTop = T.top;
      const dBack = T.d1;
      const yWall = T.id === 0 ? TIERS[1].h0 - 1.6 : this.roofY(dBack);
      const ss = sampleS(T.id, 0, 1, dBack, 6);
      for (let i = 0; i < ss.length - 1; i++) {
        const u = ss[i];
        const v = ss[i + 1];
        const n = inward(T.id, (u + v) / 2);
        gb.quad(P(T.id, v, dBack, yTop), P(T.id, u, dBack, yTop), P(T.id, u, dBack, yWall), P(T.id, v, dBack, yWall), n, COL.wall);
      }
      if (T.id === 1) {
        // 上層の下面（VIP 席の天井）: 下層の最上段の壁から上層の手すり壁まで
        const dA = TIERS[0].d1;
        const yS = T.h0 - 1.6;
        const s2 = sampleS(1, 0, 1, T.d0, 6);
        for (let i = 0; i < s2.length - 1; i++) {
          const u = s2[i];
          const v = s2[i + 1];
          pointAt(0, u, dA, _p);
          const a = [_p.x, yS, _p.z];
          pointAt(0, v, dA, _p);
          const b = [_p.x, yS, _p.z];
          gb.quad(P(1, v, T.d0, yS), P(1, u, T.d0, yS), a, b, [0, -1, 0], COL.soffit);
        }
      }
    }

    // 出入口のトンネル（主人公の背中）: 通路の幅で、床は 14 列目の高さ
    {
      const T = TIERS[PLAYER_SPOT.tier];
      const blk = this.layout.blocks[tunnelBlock];
      const s0 = blk.s0 < 0 ? blk.s0 + 1 : blk.s0;
      const [r0, r1] = PLAYER_SPOT.tunnelRows;
      const dFront = T.d0 + r0 * T.depth;
      const dBack = T.d0 + (r1 + 1) * T.depth + 14;
      const yF = T.h0 + (r0 - 1) * T.rise;
      const yC = yF + 2.6;
      const sA = sAfterArc(T.id, s0, AISLE, dFront);
      const L = (s, d, yy) => P(T.id, s, d, yy);
      const dark = new THREE.Color(0x0c0d12);
      const wallC = new THREE.Color(0x16171e);
      // 床・天井・左右の壁
      gb.quad(L(s0, dFront, yF), L(sA, dFront, yF), L(sA, dBack, yF), L(s0, dBack, yF), [0, 1, 0], dark);
      gb.quad(L(sA, dFront, yC), L(s0, dFront, yC), L(s0, dBack, yC), L(sA, dBack, yC), [0, -1, 0], dark);
      for (const [s, sgn] of [
        [s0, 1],
        [sA, -1],
      ]) {
        const a = L(s, dFront, yF);
        const b = L(s, dBack, yF);
        const c = L(s, dBack, yC + 6);
        const d = L(s, dFront, yC + 6);
        if (sgn > 0) gb.quad(a, b, c, d, [0, 0, 0], wallC);
        else gb.quad(b, a, d, c, [0, 0, 0], wallC);
      }
      // 奥のコンコース（白く光る出口）
      this.tunnel = { s0, sA, dFront, dBack, yF, yC };
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff4dc });
      glowMat.color.multiplyScalar(1.6);
      const gp = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
      const pa = L((s0 + sA) / 2, dBack - 0.1, (yF + yC) / 2);
      gp.position.set(pa[0], pa[1], pa[2]);
      gp.scale.set(AISLE, yC - yF, 1);
      const n = inward(T.id, (s0 + sA) / 2);
      gp.lookAt(pa[0] + n[0], pa[1], pa[2] + n[2]);
      this.group.add(gp);
    }

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const stands = new THREE.Mesh(gb.build(), mat);
    stands.name = 'stands';
    this.group.add(stands);
    this.stands = stands;
    const labMat = new THREE.MeshBasicMaterial({ map: rowAtlas.texture, polygonOffset: true, polygonOffsetFactor: -1, side: THREE.DoubleSide });
    labMat.color.setScalar(0.85);
    this.group.add(new THREE.Mesh(lab.build(), labMat));
  }

  roofY(d) {
    const t = (d - ROOF.dIn) / (ROOF.dOut - ROOF.dIn);
    return ROOF.yIn + (ROOF.yOut - ROOF.yIn) * t;
  }

  // ブロック番号（上層の手すり壁・下層の VIP 席の壁・上層の最上段の壁）+ VIP の窓
  buildSigns() {
    const atlas = makeNumberAtlas({ count: 96, cols: 12, cellW: 128, cellH: 72, bg: '#0b1a4a', fg: '#ffffff', border: '#39e6ff' });
    this.blockAtlas = atlas;
    const gb = new GeoBuilder({ uv: true });
    const white = new THREE.Color(1, 1, 1);
    const sign = (tierId, s, d, y0, y1, w, number) => {
      const n = inward(tierId, s);
      pointAt(tierId, s, d, _p);
      const tx = -n[2];
      const tz = n[0];
      const [u0, v0, du, dv] = atlas.uv(number - 1);
      const hw = w / 2;
      gb.quad(
        [_p.x + tx * hw, y0, _p.z + tz * hw],
        [_p.x - tx * hw, y0, _p.z - tz * hw],
        [_p.x - tx * hw, y1, _p.z - tz * hw],
        [_p.x + tx * hw, y1, _p.z + tz * hw],
        n,
        white,
        [u0, v0, u0 + du, v0, u0 + du, v0 + dv, u0, v0 + dv]
      );
    };
    const up = TIERS[1];
    const low = TIERS[0];
    for (const b of this.layout.blocks) {
      if (b.tier === 1) {
        sign(1, b.mid, up.d0 - 0.06, up.h0 - 1.45, up.h0 - 0.2, 2.4, b.number);
        if (!this.layout.boothBlocks.includes(b.index)) sign(1, b.mid, up.d1 - 0.08, up.top + 1.2, up.top + 4.4, 6.2, b.number);
      } else {
        sign(0, b.mid, low.d1 - 0.06, low.top + 0.25, low.top + 1.35, 2.2, b.number);
      }
    }
    const mat = new THREE.MeshBasicMaterial({ map: atlas.texture });
    mat.color.setScalar(1.25);
    this.group.add(new THREE.Mesh(gb.build(), mat));

    // VIP 席の窓（下層の最上段の壁）
    const wb = new GeoBuilder({ uv: true });
    const ss = sampleS(0, 0, 1, low.d1, 6);
    let acc = 0;
    for (let i = 0; i < ss.length - 1; i++) {
      const u = ss[i];
      const v = ss[i + 1];
      const len = arcLen(0, u, v, low.d1);
      const n = inward(0, (u + v) / 2);
      pointAt(0, u, low.d1 - 0.03, _p);
      const a = [_p.x, low.top + 0.1, _p.z];
      const d = [_p.x, up.h0 - 1.7, _p.z];
      pointAt(0, v, low.d1 - 0.03, _p);
      const b = [_p.x, low.top + 0.1, _p.z];
      const c = [_p.x, up.h0 - 1.7, _p.z];
      const k = 1 / 16;
      wb.quad(b, a, d, c, n, white, [(acc + len) * k, 0, acc * k, 0, acc * k, 1, (acc + len) * k, 1]);
      acc += len;
    }
    const wm = new THREE.MeshBasicMaterial({ map: makeWindowTexture() });
    wm.color.setScalar(0.9);
    const win = new THREE.Mesh(wb.build(), wm);
    win.renderOrder = -1;
    this.group.add(win);

    // 放送ブース（南上層の座席の無いところ）
    const booth = this.layout.boothBlocks.map((i) => this.layout.blocks[i]);
    if (booth.length) {
      const s0 = Math.min(...booth.map((b) => b.s0));
      const s1 = Math.max(...booth.map((b) => b.s1));
      const r0 = up.rows - this.layout.boothRows;
      const bb = new GeoBuilder();
      const dA = up.d0 + r0 * up.depth;
      const yA = up.h0 + r0 * up.rise;
      const glass = new THREE.Color(0x2c3a5a);
      const ssb = sampleS(1, s0, s1, dA, 4);
      for (let i = 0; i < ssb.length - 1; i++) {
        const u = ssb[i];
        const v = ssb[i + 1];
        const n = inward(1, (u + v) / 2);
        bb.quad(P(1, v, dA, yA - 0.5), P(1, u, dA, yA - 0.5), P(1, u, dA, up.top + 2), P(1, v, dA, up.top + 2), n, glass);
        bb.quad(P(1, u, dA, up.top + 2), P(1, v, dA, up.top + 2), P(1, v, up.d1, up.top + 2), P(1, u, up.d1, up.top + 2), [0, 1, 0], COL.wall);
      }
      const bm = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x0a1020, side: THREE.DoubleSide });
      this.group.add(new THREE.Mesh(bb.build(), bm));
    }
  }

  buildRoof() {
    const gb = new GeoBuilder({ uv: true });
    const ss = sampleS(1, 0, 1, ROOF.dIn, 8);
    const white = new THREE.Color(1, 1, 1);
    let acc = 0;
    for (let i = 0; i < ss.length - 1; i++) {
      const u = ss[i];
      const v = ss[i + 1];
      const len = arcLen(1, u, v, ROOF.dIn);
      const k = 1 / 12;
      // 裏面（下を向く）
      gb.quad(P(1, u, ROOF.dIn, ROOF.yIn), P(1, v, ROOF.dIn, ROOF.yIn), P(1, v, ROOF.dOut, ROOF.yOut), P(1, u, ROOF.dOut, ROOF.yOut), [0, -1, 0], white, [
        acc * k, 0, (acc + len) * k, 0, (acc + len) * k, 3, acc * k, 3,
      ]);
      acc += len;
    }
    const mat = new THREE.MeshLambertMaterial({ map: makeRoofTexture(), side: THREE.DoubleSide });
    mat.color.setScalar(0.8);
    this.group.add(new THREE.Mesh(gb.build(), mat));

    // 屋根の縁（スタンド名）
    const sides = [
      ['NORTH STAND', 0],
      ['EAST STAND', 0.25],
      ['SOUTH STAND', 0.5],
      ['WEST STAND', 0.75],
    ];
    for (const [text, s] of sides) {
      const tex = makeFasciaTexture(text);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(38, 3.6), new THREE.MeshBasicMaterial({ map: tex }));
      const n = inward(1, s);
      pointAt(1, s, ROOF.dIn - 0.2, _p);
      m.position.set(_p.x, ROOF.yIn - 1.4, _p.z);
      m.lookAt(_p.x + n[0], ROOF.yIn - 1.4, _p.z + n[2]);
      this.group.add(m);
    }
    // 縁の帯（ぐるり）
    const band = new GeoBuilder();
    const s2 = sampleS(1, 0, 1, ROOF.dIn, 8);
    const bandC = new THREE.Color(0x0b1030);
    for (let i = 0; i < s2.length - 1; i++) {
      const u = s2[i];
      const v = s2[i + 1];
      const n = inward(1, (u + v) / 2);
      band.quad(P(1, v, ROOF.dIn, ROOF.yIn - 3.3), P(1, u, ROOF.dIn, ROOF.yIn - 3.3), P(1, u, ROOF.dIn, ROOF.yIn + 0.3), P(1, v, ROOF.dIn, ROOF.yIn + 0.3), n, bandC);
    }
    this.group.add(new THREE.Mesh(band.build(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }

  // 照明: 屋根の縁に並ぶ投光器（発光）+ 加算のハロ + シーンの光
  buildLights() {
    const scene = this.scene;
    scene.add(new THREE.HemisphereLight(0xb8c6ff, 0x1c2a1c, 1.25));
    const key = new THREE.DirectionalLight(0xfff4e6, 1.35);
    key.position.set(-40, 120, 60);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
    fill.position.set(60, 90, -80);
    scene.add(fill);

    const lamps = new GeoBuilder();
    const n = 88;
    const halo = new Float32Array(n * 3);
    const lampC = new THREE.Color(0xfff6e0).multiplyScalar(3);
    for (let i = 0; i < n; i++) {
      const s = i / n;
      const nn = inward(1, s);
      pointAt(1, s, ROOF.dIn + 0.6, _p);
      const tx = -nn[2];
      const tz = nn[0];
      const y = ROOF.yIn - 1.9;
      const w = 2.6;
      const h = 1.1;
      lamps.quad(
        [_p.x + tx * w, y - h, _p.z + tz * w],
        [_p.x - tx * w, y - h, _p.z - tz * w],
        [_p.x - tx * w, y + h, _p.z - tz * w],
        [_p.x + tx * w, y + h, _p.z + tz * w],
        nn,
        lampC
      );
      halo[i * 3] = _p.x + nn[0] * 0.6;
      halo[i * 3 + 1] = y;
      halo[i * 3 + 2] = _p.z + nn[2] * 0.6;
    }
    this.group.add(new THREE.Mesh(lamps.build(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(halo, 3));
    const hm = new THREE.PointsMaterial({
      map: makeHaloTexture(),
      size: 22,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xfff1d6,
      opacity: 0.8,
    });
    this.haloPoints = new THREE.Points(hg, hm);
    this.group.add(this.haloPoints);
  }

  // LED 広告ボード（ピッチの周り）: テクスチャを流す
  buildAds() {
    const tex = makeAdTexture();
    tex.repeat.set(1, 1);
    this.adTex = tex;
    const gb = new GeoBuilder({ uv: true });
    const white = new THREE.Color(1, 1, 1);
    const H = 0.95;
    const X = 52.5 + 5.2;
    const Z = 34 + 4.2;
    const segs = [
      [[-X, -Z], [X, -Z]],
      [[X, -Z], [X, Z]],
      [[X, Z], [-X, Z]],
      [[-X, Z], [-X, -Z]],
    ];
    let acc = 0;
    for (const [[x0, z0], [x1, z1]] of segs) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const k = 1 / 64;
      const nx = -(z1 - z0) / len;
      const nz = (x1 - x0) / len;
      gb.quad([x0, 0, z0], [x1, 0, z1], [x1, H, z1], [x0, H, z0], [nx, 0, nz], white, [acc * k, 0, (acc + len) * k, 0, (acc + len) * k, 1, acc * k, 1]);
      acc += len;
    }
    // 表（ピッチ側）だけ広告。裏（観客席側）は無地の黒いパネル
    const geo = gb.build();
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    mat.color.setScalar(1.3);
    this.ads = new THREE.Mesh(geo, mat);
    this.group.add(this.ads);
    this.group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x14161e, side: THREE.BackSide })));
  }

  buildGoals() {
    const post = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 });
    const g = new THREE.Group();
    const W = 7.32;
    const H = 2.44;
    const D = 2.2;
    const netPts = [];
    for (const side of [-1, 1]) {
      const x = side * 52.5;
      for (const z of [-W / 2, W / 2]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, H, 8), post);
        p.position.set(x, H / 2, z);
        g.add(p);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, W, 8), post);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(x, H, 0);
      g.add(bar);
      // ネット（線）
      const xb = x + side * D;
      for (let i = 0; i <= 14; i++) {
        const z = -W / 2 + (W * i) / 14;
        netPts.push(x, H, z, xb, H * 0.8, z, xb, H * 0.8, z, xb, 0, z);
      }
      for (let j = 0; j <= 6; j++) {
        const y = (H * 0.8 * j) / 6;
        netPts.push(xb, y, -W / 2, xb, y, W / 2);
        netPts.push(x, Math.min(H, y * 1.25), -W / 2, xb, y, -W / 2, x, Math.min(H, y * 1.25), W / 2, xb, y, W / 2);
      }
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(netPts, 3));
    g.add(new THREE.LineSegments(ng, new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.55 })));
    // コーナーフラッグ
    const flagMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5), post);
        pole.position.set(sx * 52.5, 0.75, sz * 34);
        g.add(pole);
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), flagMat);
        f.position.set(sx * 52.5 + 0.22, 1.35, sz * 34);
        g.add(f);
      }
    }
    this.group.add(g);
  }

  // 大型ビジョンの枠（北と南、屋根から吊る）。画面は Broadcast が貼る
  buildJumboFrames() {
    this.jumbos = [];
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x15171f });
    for (const s of [0, 0.5]) {
      const g = new THREE.Group();
      const n = inward(1, s);
      pointAt(1, s, JUMBO.d, _p);
      g.position.set(_p.x, JUMBO.y, _p.z);
      g.lookAt(_p.x + n[0], JUMBO.y, _p.z + n[2]);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(JUMBO.w + 1.6, JUMBO.h + 1.6, 1.2), frameMat);
      frame.position.z = -0.7;
      g.add(frame);
      // 吊り下げのケーブル
      for (const x of [-JUMBO.w / 3, JUMBO.w / 3]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 12, 0.3), frameMat);
        c.position.set(x, JUMBO.h / 2 + 6, -0.7);
        g.add(c);
      }
      this.group.add(g);
      this.jumbos.push({ group: g, s, center: new THREE.Vector3(_p.x, JUMBO.y, _p.z) });
    }
  }

  update(dt, time) {
    this.time = time;
    if (this.adTex) this.adTex.offset.x = (time * 0.035) % 1;
  }
}
