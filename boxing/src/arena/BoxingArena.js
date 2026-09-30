import * as THREE from 'three';
import { ARENA_TIERS, perimeter, pointAtArc } from './ArenaLayout.js';
import { makeCanvasTexture, makeApronTexture, makeAdTexture, makeGateTexture, makeHaloTexture, makeBeamTexture } from './arenaTextures.js';

// ボクシングの大会場（静的なメッシュ + 照明）。
//   リング: 7.3m 四方・高さ 1.2m の台 + キャンバス（6.1m 四方のロープの内側）+ コーナーポスト 4 本 + ロープ 4 段
//   リングサイド: 審判席・実況席・ゴング係（ゴング）・TV カメラ（HYPE で増える）・クレーン
//   天井: 照明トラス（スポットライト）と 4 面の吊り下げビジョン
//   スタンド: 1 階・2 階の段（観客は CrowdField のビルボード）+ LED 広告の帯 + 入場ゲート
// 座標: リングの中心が原点、キャンバスの上面が y = RING.y。赤コーナー = (-X, -Z)、青コーナー = (+X, +Z)

export const RING = { y: 1.2, half: 3.05, post: 3.25, apron: 3.65, ropes: [0.42, 0.78, 1.14, 1.48] };
export const JUMBO = { y: 13.5, w: 7.2, h: 4.2 };

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.idx = [];
  }
  quad(a, b, c, d, n, color) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) {
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// 角丸長方形を一周する点列（角は 8 分割）
function loop(d, core, cornerSegs = 8) {
  const P = perimeter(d, core);
  const pts = [];
  const { sx, sz, r0 } = core;
  const q = (Math.PI / 2) * (r0 + d);
  const marks = [0];
  const segs = [2 * sz, q, 2 * sx, q, 2 * sz, q, 2 * sx, q];
  let acc = 0;
  segs.forEach((len, i) => {
    const n = i % 2 ? cornerSegs : 1;
    for (let k = 1; k <= n; k++) marks.push(acc + (len * k) / n);
    acc += len;
  });
  const p = {};
  for (const m of marks) {
    pointAtArc(d, m, p, core);
    pts.push([p.x, p.z]);
  }
  void P;
  return pts;
}

export class BoxingArena {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'arena';
    scene.add(this.group);
    this.cameraRigs = [];
    this.time = 0;
    this.buildFloor();
    this.buildStands();
    this.buildRing();
    this.buildRingside();
    this.buildCeiling();
    this.buildLights();
    this.buildGate();
  }

  buildFloor() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x0b0c12, roughness: 0.55, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    // リングの周りの床（紺のカーペット）
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), new THREE.MeshStandardMaterial({ color: 0x141a3a, roughness: 0.95 }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.y = 0.005;
    carpet.receiveShadow = true;
    this.group.add(carpet);
    // 入場の花道（-X）
    const aisle = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshStandardMaterial({ color: 0x2a0f22, roughness: 0.8, emissive: 0x12040c }));
    aisle.rotation.x = -Math.PI / 2;
    aisle.position.set(-11, 0.01, 0);
    this.group.add(aisle);
    // 花道の両脇のライン（光る）
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xff3d7f });
    lineMat.color.multiplyScalar(1.6);
    for (const z of [-1.35, 1.35]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(14, 0.04, 0.08), lineMat);
      l.position.set(-11, 0.03, z);
      this.group.add(l);
    }
    this.aisleLines = lineMat;
  }

  // 段（蹴上げ + 踏面）
  buildStands() {
    const gb = new GeoBuilder();
    const tread = new THREE.Color(0x24262f);
    const riser = new THREE.Color(0x1a1b22);
    const wall = new THREE.Color(0x121319);
    for (const T of ARENA_TIERS) {
      if (T.flat) continue;
      for (let r = 0; r < T.rows; r++) {
        const da = T.d0 + r * T.depth;
        const db = da + T.depth;
        const y = T.h0 + r * T.rise;
        const yLow = r === 0 ? (T.id === 1 ? 0 : T.h0 - 1.4) : T.h0 + (r - 1) * T.rise;
        const A = loop(da, T.core);
        const B = loop(db, T.core);
        for (let i = 0; i < A.length - 1; i++) {
          const [ax, az] = A[i];
          const [bx, bz] = A[i + 1];
          const [cx, cz] = B[i + 1];
          const [dx, dz] = B[i];
          gb.quad([ax, y, az], [bx, y, bz], [cx, y, cz], [dx, y, dz], [0, 1, 0], tread);
          const nx = -(ax + bx) / 2;
          const nz = -(az + bz) / 2;
          const nl = Math.hypot(nx, nz) || 1;
          gb.quad([bx, yLow, bz], [ax, yLow, az], [ax, y, az], [bx, y, bz], [nx / nl, 0, nz / nl], riser);
        }
      }
      // 最上段の後ろの壁
      const top = T.top;
      const W = loop(T.d1, T.core);
      const yTop = T.id === 1 ? ARENA_TIERS[2].h0 - 1.4 : 40;
      for (let i = 0; i < W.length - 1; i++) {
        const [ax, az] = W[i];
        const [bx, bz] = W[i + 1];
        gb.quad([bx, top, bz], [ax, top, az], [ax, yTop, az], [bx, yTop, bz], [-(ax + bx) / 2, 0, -(az + bz) / 2], wall);
      }
    }
    const stands = new THREE.Mesh(gb.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    stands.name = 'stands';
    this.group.add(stands);

    // 1 階と 2 階の間の LED 広告の帯（流れる）
    const T1 = ARENA_TIERS[1];
    const ring = loop(T1.d1 + 0.02, T1.core, 12);
    const pos = [];
    const uv = [];
    const idx = [];
    let acc = 0;
    const y0 = T1.top + 0.3;
    const y1 = ARENA_TIERS[2].h0 - 1.6;
    for (let i = 0; i < ring.length; i++) {
      const [x, z] = ring[i];
      if (i > 0) acc += Math.hypot(x - ring[i - 1][0], z - ring[i - 1][1]);
      pos.push(x, y0, z, x, y1, z);
      uv.push(acc / 26, 0, acc / 26, 1);
      if (i > 0) {
        const b = (i - 1) * 2;
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    lg.setIndex(idx);
    this.adTex = makeAdTexture();
    const adMat = new THREE.MeshBasicMaterial({ map: this.adTex, side: THREE.DoubleSide });
    adMat.color.setScalar(1.25);
    this.group.add(new THREE.Mesh(lg, adMat));
  }

  buildRing() {
    const g = new THREE.Group();
    g.name = 'ring';
    const H = RING.y;
    // 台
    const apronMat = new THREE.MeshStandardMaterial({ map: makeApronTexture(), roughness: 0.7 });
    const side = new THREE.Mesh(new THREE.BoxGeometry(RING.apron * 2, H, RING.apron * 2), [apronMat, apronMat, new THREE.MeshStandardMaterial({ color: 0x20243a }), apronMat, apronMat, apronMat]);
    side.position.y = H / 2;
    side.castShadow = false;
    side.receiveShadow = true;
    g.add(side);
    // キャンバス
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(RING.apron * 2 - 0.1, RING.apron * 2 - 0.1), new THREE.MeshStandardMaterial({ map: makeCanvasTexture(), roughness: 0.92 }));
    canvas.rotation.x = -Math.PI / 2;
    canvas.position.y = H + 0.012;
    canvas.receiveShadow = true;
    g.add(canvas);
    this.canvasMesh = canvas;
    // ポスト（赤・白・青・白）+ コーナーパッド
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.7, 10);
    const padGeo = new THREE.BoxGeometry(0.22, 1.25, 0.22);
    const cols = { red: 0xc3182e, blue: 0x1d3fb5, white: 0xe8e8ee };
    const corners = [
      [-1, -1, 'red'],
      [1, -1, 'white'],
      [1, 1, 'blue'],
      [-1, 1, 'white'],
    ];
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc8, metalness: 0.7, roughness: 0.35 });
    this.corners = {};
    for (const [sx, sz, c] of corners) {
      const post = new THREE.Mesh(postGeo, metal);
      post.position.set(sx * RING.post, H + 0.85, sz * RING.post);
      post.castShadow = true;
      g.add(post);
      const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color: cols[c], roughness: 0.6 }));
      pad.position.set(sx * (RING.post - 0.08), H + 0.95, sz * (RING.post - 0.08));
      pad.rotation.y = Math.PI / 4;
      g.add(pad);
      this.corners[c === 'white' ? `white${sx}` : c] = new THREE.Vector3(sx * (RING.half - 0.35), H, sz * (RING.half - 0.35));
    }
    // ロープ 4 段（少したるむ）
    const ropeCols = [0xe8e8ee, 0xc3182e, 0xe8e8ee, 0x1d3fb5];
    this.ropes = [];
    RING.ropes.forEach((h, k) => {
      const mat = new THREE.MeshStandardMaterial({ color: ropeCols[k], roughness: 0.4 });
      for (let e = 0; e < 4; e++) {
        const a = corners[e];
        const b = corners[(e + 1) % 4];
        const pts = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          const sag = Math.sin(t * Math.PI) * 0.05;
          pts.push(new THREE.Vector3((a[0] + (b[0] - a[0]) * t) * RING.post, H + h - sag, (a[1] + (b[1] - a[1]) * t) * RING.post));
        }
        const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.022, 6, false), mat);
        rope.castShadow = true;
        g.add(rope);
        this.ropes.push(rope);
      }
    });
    // 階段（赤・青コーナー）
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.8 });
    for (const [sx, sz] of [
      [-1, -1],
      [1, 1],
    ]) {
      for (let i = 0; i < 3; i++) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3 * (i + 1), 0.4), stepMat);
        st.position.set(sx * (RING.apron + 0.25 + (2 - i) * 0.4) * 0.72, 0.15 * (i + 1), sz * (RING.apron + 0.25 + (2 - i) * 0.4) * 0.72);
        st.rotation.y = Math.PI / 4;
        g.add(st);
      }
    }
    this.group.add(g);
    this.ring = g;
  }

  // リングサイド: 審判席・実況席・ゴング係・TV カメラ・クレーン
  buildRingside() {
    const table = new THREE.MeshStandardMaterial({ color: 0x1a1d2c, roughness: 0.6 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x0b1a4a, roughness: 0.9 });
    const screen = new THREE.MeshBasicMaterial({ color: 0x3fa9ff });
    screen.color.multiplyScalar(0.9);
    const tables = [
      [0, -4.9, 0, 5.2], // 実況席（-Z）
      [4.9, 0, Math.PI / 2, 4.2], // 審判（+X）
      [0, 4.9, Math.PI, 5.2], // 審判・記者（+Z）
    ];
    for (const [x, z, ry, w] of tables) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.75, 0.7), [table, table, table, table, cloth, table]);
      t.position.set(x, 0.375, z);
      t.rotation.y = ry;
      this.group.add(t);
      for (let k = -1; k <= 1; k++) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28), screen);
        s.position.set(x + Math.cos(ry) * k * (w / 3), 0.92, z + Math.sin(-ry) * k * (w / 3));
        s.rotation.y = ry + Math.PI;
        this.group.add(s);
      }
    }
    // ゴング（ゴング係の机の上）
    const gold = new THREE.MeshStandardMaterial({ color: 0xd6a53a, metalness: 0.8, roughness: 0.3 });
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    bell.position.set(-1.9, 0.76, -4.9);
    bell.rotation.x = Math.PI;
    bell.position.y = 0.95;
    this.group.add(bell);
    this.gong = bell;

    // TV カメラ（三脚 + 本体）。HYPE で増える: 最初は 4 台、最大 16 台
    const camMat = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.5, metalness: 0.3 });
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0f, roughness: 0.1, metalness: 0.8 });
    const redLight = new THREE.MeshBasicMaterial({ color: 0xff2030 });
    const makeCam = () => {
      const c = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 5), camMat);
        const a = (i / 3) * Math.PI * 2;
        leg.position.set(Math.cos(a) * 0.22, 0.72, Math.sin(a) * 0.22);
        leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
        c.add(leg);
      }
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.55), camMat);
      body.position.y = 1.62;
      c.add(body);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.3, 10), lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 1.62, 0.4);
      c.add(lens);
      const tally = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), redLight);
      tally.position.set(0, 1.8, 0.2);
      c.add(tally);
      return c;
    };
    const spots = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.2;
      const r = 5.8 + (i % 3) * 0.9;
      spots.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    spots.forEach(([x, z], i) => {
      const c = makeCam();
      c.position.set(x, 0, z);
      c.lookAt(0, 0, 0);
      c.visible = i % 4 === 0;
      this.group.add(c);
      this.cameraRigs.push(c);
    });
    // クレーン（ジブ）: 長い腕がゆっくり動く
    const jib = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.4, 10), camMat);
    base.position.y = 0.7;
    jib.add(base);
    const arm = new THREE.Group();
    arm.position.y = 1.5;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 7), camMat);
    beam.position.z = 2.2;
    arm.add(beam);
    const head = makeCam();
    head.scale.setScalar(0.8);
    head.position.set(0, -1.3, 5.6);
    arm.add(head);
    jib.add(arm);
    jib.position.set(-7.5, 0, 6.5);
    jib.rotation.y = -2.4;
    this.jib = { group: jib, arm };
    this.group.add(jib);
  }

  // 天井: 照明トラス + 4 面の吊り下げビジョン
  buildCeiling() {
    const truss = new THREE.MeshStandardMaterial({ color: 0x23252e, metalness: 0.6, roughness: 0.4 });
    const y = 8.5;
    const S = 4.6;
    for (let e = 0; e < 4; e++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(S * 2 + 0.4, 0.35, 0.35), truss);
      bar.position.set(e < 2 ? 0 : (e === 2 ? -S : S), y, e < 2 ? (e === 0 ? -S : S) : 0);
      if (e >= 2) bar.rotation.y = Math.PI / 2;
      this.group.add(bar);
    }
    // 投光器（発光する円盤）
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff4de });
    lampMat.color.multiplyScalar(2.2);
    const lampGeo = new THREE.CircleGeometry(0.2, 12);
    this.lamps = [];
    for (let i = 0; i < 16; i++) {
      const e = Math.floor(i / 4);
      const t = ((i % 4) + 0.5) / 4 * 2 - 1;
      const x = e < 2 ? t * S : e === 2 ? -S : S;
      const z = e < 2 ? (e === 0 ? -S : S) : t * S;
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x, y - 0.25, z);
      lamp.lookAt(0, RING.y, 0);
      this.group.add(lamp);
      this.lamps.push(lamp);
    }
    // 吊り下げビジョン（4 面）: 画面は Jumbotron が貼る
    const jumbo = new THREE.Group();
    jumbo.position.y = JUMBO.y;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(JUMBO.w + 0.4, JUMBO.h + 0.4, JUMBO.w + 0.4), new THREE.MeshStandardMaterial({ color: 0x101117, metalness: 0.5, roughness: 0.4 }));
    jumbo.add(frame);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x39e6ff });
    ledMat.color.multiplyScalar(1.5);
    for (const yy of [JUMBO.h / 2 + 0.35, -JUMBO.h / 2 - 0.35]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(JUMBO.w + 0.5, 0.3, JUMBO.w + 0.5), ledMat);
      band.position.y = yy;
      jumbo.add(band);
    }
    this.jumboLed = ledMat;
    this.jumboFaces = [];
    for (let k = 0; k < 4; k++) {
      const face = new THREE.Group();
      face.rotation.y = (k * Math.PI) / 2;
      const holder = new THREE.Object3D();
      holder.position.z = JUMBO.w / 2 + 0.21;
      face.add(holder);
      jumbo.add(face);
      this.jumboFaces.push(holder);
    }
    // 吊るすワイヤー
    for (const [x, z] of [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 20, 4), truss);
      w.position.set(x, JUMBO.y + JUMBO.h / 2 + 10, z);
      this.group.add(w);
    }
    this.group.add(jumbo);
    this.jumbo = jumbo;
    // 屋根（暗い天井）
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshBasicMaterial({ color: 0x06070c }));
    roof.rotation.x = Math.PI / 2;
    roof.position.y = 40;
    this.group.add(roof);
  }

  buildLights() {
    const scene = this.scene;
    scene.add(new THREE.HemisphereLight(0x8a96c8, 0x14121c, 0.8));
    // リングを照らすスポット 2 つ（影はボクサーとレフェリーだけ）
    const key = new THREE.SpotLight(0xfff2e0, 4.2, 40, 0.55, 0.45, 0);
    key.position.set(-3.5, 12, -4);
    key.target.position.set(0, RING.y, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 22;
    key.shadow.bias = -0.0006;
    scene.add(key, key.target);
    const fill = new THREE.SpotLight(0xdfe8ff, 2.6, 40, 0.6, 0.5, 0);
    fill.position.set(4.5, 11, 3.5);
    fill.target.position.set(0, RING.y, 0);
    scene.add(fill, fill.target);
    this.keyLight = key;
    this.fillLight = fill;
    // 客席を少しだけ照らす（暗めの会場）
    const house = new THREE.DirectionalLight(0x6a78b0, 0.35);
    house.position.set(0, 30, 10);
    scene.add(house);
    this.house = house;

    // ハロ（投光器のまぶしさ）
    const halo = new THREE.PointsMaterial({ map: makeHaloTexture(), size: 2.4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff1d6, opacity: 0.75 });
    const hp = new Float32Array(this.lamps.length * 3);
    this.lamps.forEach((l, i) => {
      hp[i * 3] = l.position.x;
      hp[i * 3 + 1] = l.position.y;
      hp[i * 3 + 2] = l.position.z;
    });
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
    this.group.add(new THREE.Points(hg, halo));

    // HYPE 用の動く光の筋（最初は消えている）
    const beamTex = makeBeamTexture();
    this.beams = [];
    const beamGeo = new THREE.ConeGeometry(2.2, 30, 16, 1, true);
    beamGeo.translate(0, -15, 0);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.MeshBasicMaterial({ map: beamTex, color: [0xff3d7f, 0x39e6ff, 0xffd23f, 0xa56bff][i % 4], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const b = new THREE.Mesh(beamGeo, m);
      const a = (i / 8) * Math.PI * 2;
      b.position.set(Math.cos(a) * 18, 32, Math.sin(a) * 14);
      this.group.add(b);
      this.beams.push({ mesh: b, phase: i * 0.8 });
    }
  }

  // 入場ゲート（-X の 1 階スタンドの下）
  buildGate() {
    const g = new THREE.Group();
    const T1 = ARENA_TIERS[1];
    const x = -(T1.core.sx + T1.core.r0 + T1.d0) - 0.2;
    const frame = new THREE.MeshStandardMaterial({ color: 0x15161c, metalness: 0.5, roughness: 0.4 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: makeGateTexture() }));
    screen.position.set(0, 5.2, 0);
    g.add(screen);
    for (const z of [-1.8, 1.8]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.8, 0.4), frame);
      p.position.set(0, 3.4, z);
      g.add(p);
    }
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.6), new THREE.MeshBasicMaterial({ color: 0x020203 }));
    dark.position.set(-0.05, 1.8, 0);
    g.add(dark);
    g.position.set(x, 0, 0);
    g.rotation.y = Math.PI / 2;
    this.group.add(g);
    this.gate = g;
  }

  // 横スクロールの時: 手前（+Z）のロープを消す
  setNearRopes(on) {
    this.ropes.forEach((r, i) => {
      if (i % 4 === 2) r.visible = on;
    });
  }

  // HYPE（0〜1）で会場が騒がしくなる: カメラが増える・光の筋・LED
  setHype(h, time) {
    const nCam = 4 + Math.floor(h * 12);
    this.cameraRigs.forEach((c, i) => {
      const order = (i % 4) * 4 + Math.floor(i / 4);
      c.visible = order < nCam;
    });
    for (const b of this.beams) {
      const on = Math.max(0, (h - 0.35) / 0.65);
      b.mesh.material.opacity = on * (0.12 + 0.08 * Math.sin(time * 3 + b.phase));
      b.mesh.visible = on > 0.01;
      b.mesh.rotation.x = Math.sin(time * 0.7 + b.phase) * 0.45;
      b.mesh.rotation.z = Math.cos(time * 0.55 + b.phase * 1.3) * 0.45;
    }
    this.jumboLed.color.setHSL((time * 0.1 * (0.2 + h)) % 1, 0.8, 0.55).multiplyScalar(1 + h);
  }

  update(dt, time) {
    this.time = time;
    this.adTex.offset.x = (time * 0.03) % 1;
    this.jib.arm.rotation.x = -0.25 + Math.sin(time * 0.3) * 0.15;
    this.jib.group.rotation.y = -2.4 + Math.sin(time * 0.21) * 0.5;
  }
}
