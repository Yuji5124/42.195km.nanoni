import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TIERS, CORE, R0, TRACK } from './StadiumLayout.js';
import { RUNWAY, BOX, BAR, PIT, JUDGE_TABLE, BENCH, CLOCK_BOARD, TUNNEL, SCREEN, TOWERS } from './field.js';
import { trackTexture, grassTexture, matTexture, barTexture, ledTexture, concreteTexture, glowTexture, boardCanvas } from './textures.js';

// 夜の陸上競技場の見た目（座席の人はビルボード群衆 = CrowdField が描く。ここは器と道具だけ）。
//   地面・トラック（8 レーン）・芝・助走路・ボックス・マット・支柱・バー・審判席・ベンチ・試技時計
//   スタンド（1 階は 1 周 / 2 階は直線だけ）・前の壁の LED 広告・屋根と屋根の照明・照明塔 4 本・大型ビジョン・放送ブース
// 段・屋根などは「断面（d, y）を 1 周ぶん押し出す」1 つのジオメトリにまとめる（draw call を増やさない）。

const sx = CORE.sx;

// ループのパラメータ t（0〜4）: 0 メイン直線（-X → +X）/ 1 東カーブ / 2 バック直線（+X → -X）/ 3 西カーブ
export function loopPoint(d, t, out = new THREE.Vector3()) {
  const r = R0 + d;
  const seg = Math.min(3, Math.floor(t));
  const k = t - seg;
  if (seg === 0) return out.set(-sx + k * 2 * sx, 0, r);
  if (seg === 1) {
    const a = Math.PI / 2 - k * Math.PI;
    return out.set(sx + r * Math.cos(a), 0, r * Math.sin(a));
  }
  if (seg === 2) return out.set(sx - k * 2 * sx, 0, -r);
  const a = -Math.PI / 2 - k * Math.PI;
  return out.set(-sx + r * Math.cos(a), 0, r * Math.sin(a));
}

function loopTs(segs, straightN = 10, curveN = 44) {
  const ts = [];
  for (const s of segs) {
    const n = s % 2 === 0 ? straightN : curveN;
    for (let i = 0; i <= n; i++) ts.push(s + i / n);
  }
  return ts;
}

// 断面 prof = [[d, y, color], ...] を ts に沿って押し出す
function extrude(prof, ts, { closed = false, uScale = 0.25 } = {}) {
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const p = new THREE.Vector3();
  const cols = prof.length;
  let along = 0;
  let prev = null;
  ts.forEach((t, i) => {
    loopPoint(0, t, p);
    if (prev) along += p.distanceTo(prev);
    prev = prev ? prev.copy(p) : p.clone();
    let vAcc = 0;
    prof.forEach(([d, y, c], j) => {
      const q = loopPoint(d, t);
      pos.push(q.x, y, q.z);
      const cc = new THREE.Color(c);
      col.push(cc.r, cc.g, cc.b);
      if (j > 0) vAcc += Math.hypot(d - prof[j - 1][0], y - prof[j - 1][1]);
      uv.push(along * uScale, vAcc * 0.25);
    });
    if (i > 0) {
      const a = (i - 1) * cols;
      const b = i * cols;
      for (let j = 0; j < cols - 1; j++) {
        idx.push(a + j, b + j, a + j + 1, b + j, b + j + 1, a + j + 1);
      }
    }
  });
  void closed;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// スタジアム形（直線 ±hx・半径 r）の輪郭
function stadiumShape(hx, r, n = 48) {
  const s = new THREE.Shape();
  s.moveTo(-hx, -r);
  s.lineTo(hx, -r);
  s.absarc(hx, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-hx, r);
  s.absarc(-hx, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  void n;
  return s;
}
function stadiumPath(hx, r) {
  const p = new THREE.Path();
  p.moveTo(-hx, -r);
  p.lineTo(hx, -r);
  p.absarc(hx, 0, r, -Math.PI / 2, Math.PI / 2, false);
  p.lineTo(-hx, r);
  p.absarc(-hx, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return p;
}

export class StadiumBuilder {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'stadium';
    scene.add(this.group);
    this.glowTex = glowTexture();
    this.lamps = []; // 照明の位置（被写体: 照明）
    this.buildGround();
    this.buildVaultArea();
    this.buildStands();
    this.buildRoofAndLights();
    this.buildScreen();
    this.buildExtras();
  }

  add(mesh, { shadow = false, receive = false } = {}) {
    mesh.castShadow = shadow;
    mesh.receiveShadow = receive;
    this.group.add(mesh);
    return mesh;
  }

  buildGround() {
    // 外の地面（暗い）
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: 0x15171c }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.add(ground);
    // 芝（内側）
    const grass = new THREE.Mesh(new THREE.ShapeGeometry(stadiumShape(sx, TRACK.rIn), 48), new THREE.MeshLambertMaterial({ map: grassTexture() }));
    grass.rotation.x = -Math.PI / 2;
    // ShapeGeometry の uv は座標そのまま → 芝のしまの間隔
    const uv = grass.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 14, uv.getY(i) / 14);
    this.add(grass, { receive: true });
    // トラック（内側の縁から外側のエプロンまで）
    const ring = stadiumShape(sx, TRACK.rOut + 1.2);
    ring.holes.push(stadiumPath(sx, TRACK.rIn));
    const track = new THREE.Mesh(new THREE.ShapeGeometry(ring, 64), new THREE.MeshLambertMaterial({ map: trackTexture() }));
    const tuv = track.geometry.attributes.uv;
    for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) / 40, tuv.getY(i) / 40);
    track.rotation.x = -Math.PI / 2;
    track.position.y = 0.01;
    this.add(track, { receive: true });
    // エプロン（トラックの外 → スタンドの前の壁）
    const apron = stadiumShape(sx, R0);
    apron.holes.push(stadiumPath(sx, TRACK.rOut + 1.2));
    const ap = new THREE.Mesh(new THREE.ShapeGeometry(apron, 64), new THREE.MeshLambertMaterial({ color: 0x3b4a5c }));
    ap.rotation.x = -Math.PI / 2;
    ap.position.y = 0.012;
    this.add(ap, { receive: true });
    // レーンの白線（1 つのジオメトリに）
    const lines = [];
    for (let i = 0; i <= TRACK.lanes; i++) {
      const r = TRACK.rIn + i * TRACK.lane;
      const s = stadiumShape(sx, r + 0.025);
      s.holes.push(stadiumPath(sx, r - 0.025));
      lines.push(new THREE.ShapeGeometry(s, 64));
    }
    // フィニッシュライン（ホームストレートの端）
    const fin = new THREE.PlaneGeometry(0.06, TRACK.rOut - TRACK.rIn);
    fin.rotateX(-Math.PI / 2);
    fin.rotateY(0);
    const l = mergeGeometries(lines.map((g) => g.toNonIndexed()));
    const lm = new THREE.Mesh(l, new THREE.MeshLambertMaterial({ color: 0xf2efe8 }));
    lm.rotation.x = -Math.PI / 2;
    lm.position.y = 0.02;
    this.add(lm);
    const fm = new THREE.Mesh(fin, new THREE.MeshLambertMaterial({ color: 0xf2efe8 }));
    fm.position.set(sx, 0.021, -(TRACK.rIn + TRACK.rOut) / 2);
    this.add(fm);
  }

  buildVaultArea() {
    const z = RUNWAY.z;
    // 助走路（タータン + 両側の白線）
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(BOX.x - RUNWAY.x0, RUNWAY.width + 0.6), new THREE.MeshLambertMaterial({ map: trackTexture() }));
    rw.material.map.repeat.set(10, 0.3);
    rw.rotation.x = -Math.PI / 2;
    rw.position.set((BOX.x + RUNWAY.x0) / 2, 0.03, z);
    this.add(rw, { receive: true });
    for (const s of [-1, 1]) {
      const ln = new THREE.Mesh(new THREE.PlaneGeometry(BOX.x - RUNWAY.x0, 0.05), new THREE.MeshLambertMaterial({ color: 0xf2efe8 }));
      ln.rotation.x = -Math.PI / 2;
      ln.position.set((BOX.x + RUNWAY.x0) / 2, 0.035, z + s * RUNWAY.width / 2);
      this.add(ln);
    }
    // 助走の目印（距離のマーク）
    for (let k = 1; k <= 8; k++) {
      const mk = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.25), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      mk.rotation.x = -Math.PI / 2;
      mk.position.set(BOX.x - k * 4, 0.036, z + RUNWAY.width / 2 + 0.18);
      this.add(mk);
    }
    // ボックス（金属の溝）
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.6), new THREE.MeshStandardMaterial({ color: 0x2d3038, metalness: 0.7, roughness: 0.4 }));
    box.position.set(BOX.x - 0.5, 0.02, z);
    this.add(box);
    // 着地マット（本体 + ボックスを囲む前の 2 枚）
    const matMat = new THREE.MeshLambertMaterial({ map: matTexture() });
    const side = new THREE.MeshLambertMaterial({ color: 0x173f96 });
    const mats = [side, side, matMat, side, side, side];
    const main = new THREE.Mesh(new THREE.BoxGeometry(PIT.x1 - PIT.x0, PIT.h, PIT.z1 - PIT.z0), mats);
    main.position.set((PIT.x0 + PIT.x1) / 2, PIT.h / 2, (PIT.z0 + PIT.z1) / 2);
    this.add(main, { receive: true });
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.2, PIT.h * 0.9, 2.3), mats);
      w.position.set(PIT.x0 - 0.6, PIT.h * 0.45, z + s * 1.85);
      this.add(w, { receive: true });
    }
    this.pitTop = PIT.h;
    // 支柱（2 本）: 土台 + 柱 + バーを載せるピン
    const metal = new THREE.MeshStandardMaterial({ color: 0xe8e8ea, metalness: 0.4, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24262c, metalness: 0.5, roughness: 0.5 });
    this.standards = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.5), dark);
      base.position.y = 0.06;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 7.2, 10), metal);
      post.position.y = 3.6;
      g.add(base, post);
      // 黒と黄色のしま（高さの目盛り）
      for (let k = 0; k < 14; k++) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.12, 10), new THREE.MeshLambertMaterial({ color: k % 2 ? 0x1c1c22 : 0xffd23f }));
        band.position.y = 0.5 + k * 0.5;
        g.add(band);
      }
      g.position.set(BAR.x + 0.15, 0, z + s * BAR.standZ);
      this.add(g, { shadow: true });
      this.standards.push(g);
    }
    // バー（VaultSet が高さを動かす）
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, BAR.half * 2, 10), new THREE.MeshLambertMaterial({ map: barTexture() }));
    bar.rotation.x = Math.PI / 2;
    bar.castShadow = true;
    this.bar = bar;
    this.group.add(bar);
    // 審判席（机 + 椅子 + 赤白の旗）
    const table = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.8), new THREE.MeshLambertMaterial({ color: 0xe8e8ea }));
    table.position.set(JUDGE_TABLE.x, 0.74, JUDGE_TABLE.z);
    this.add(table, { shadow: true });
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.02), new THREE.MeshLambertMaterial({ color: 0x1b3a8a }));
    cloth.position.set(JUDGE_TABLE.x, 0.38, JUDGE_TABLE.z + 0.4);
    this.add(cloth);
    for (const k of [-0.7, 0.7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.72, 0.6), dark);
      leg.position.set(JUDGE_TABLE.x + k * 1.4, 0.36, JUDGE_TABLE.z);
      this.add(leg);
    }
    for (const k of [-0.6, 0.6]) {
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), dark);
      chair.position.set(JUDGE_TABLE.x + k, 0.22, JUDGE_TABLE.z - 0.55);
      this.add(chair);
    }
    // ベンチ（選手の待機）
    const bench = new THREE.Mesh(new THREE.BoxGeometry(BENCH.len, 0.08, 0.5), new THREE.MeshLambertMaterial({ color: 0x5c6470 }));
    bench.position.set(BENCH.x, 0.45, BENCH.z);
    this.add(bench, { shadow: true });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(BENCH.len, 0.05, 1.3), new THREE.MeshLambertMaterial({ color: 0xc8d4e0, transparent: true, opacity: 0.55 }));
    roof.position.set(BENCH.x, 2.2, BENCH.z + 0.2);
    this.add(roof);
    // 選手のバッグ・ポールのケース
    for (let k = 0; k < 5; k++) {
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.42, 4, 10), new THREE.MeshLambertMaterial({ color: [0x8a1424, 0x1d3f8a, 0x222222, 0x6a5a20, 0x1f5f3a][k] }));
      bag.rotation.z = Math.PI / 2;
      bag.position.set(BENCH.x - 3 + k * 1.4, 0.13, BENCH.z + 0.7);
      this.add(bag);
    }
    // 試技時計（残り時間の表示）
    this.clockBoard = boardCanvas(256, 128);
    const cb = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: this.clockBoard.tex, toneMapped: false }));
    cb.position.set(CLOCK_BOARD.x, 1.6, CLOCK_BOARD.z);
    cb.rotation.y = -Math.PI / 2 + 0.25;
    this.add(cb);
    const cbPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), dark);
    cbPost.position.set(CLOCK_BOARD.x, 0.6, CLOCK_BOARD.z);
    this.add(cbPost);
    this.clockMesh = cb;
  }

  buildStands() {
    const L = TIERS[0];
    const U = TIERS[1];
    const concrete = concreteTexture();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: concrete });
    // 1 階: 前の壁 → 段 → 後ろの壁・通路
    const seatCol = 0x26324e;
    const riser = 0x7c818c;
    const prof = [[0, 0, riser], [0, L.h0, riser]];
    for (let r = 0; r < L.rows; r++) {
      const d0 = L.d0 + r * L.depth;
      const y = L.h0 + r * L.rise;
      prof.push([d0, y, seatCol], [d0 + L.depth, y, seatCol]);
      if (r < L.rows - 1) prof.push([d0 + L.depth, y + L.rise, riser]);
    }
    prof.push([L.d1, L.top + 1.3, 0x5a5f69], [L.d1 + 1.4, L.top + 1.3, 0x4a4f58], [L.d1 + 1.4, L.top + 3.2, 0x3a3e46]);
    const lower = extrude(prof, loopTs([0, 1, 2, 3]));
    this.add(new THREE.Mesh(lower, mat), { receive: true });
    // 2 階（直線だけ）: 前の壁（手すり）→ 段 → 後ろの壁
    const prof2 = [[U.d0 - 1.6, L.top + 1.3, 0x4a4f58], [U.d0 - 1.6, U.h0 - 0.2, 0x8a8f99], [U.d0 - 0.3, U.h0 - 0.2, 0x8a8f99], [U.d0 - 0.3, U.h0 + 0.9, 0x9aa0aa], [U.d0, U.h0 + 0.9, 0x9aa0aa], [U.d0, U.h0, riser]];
    for (let r = 0; r < U.rows; r++) {
      const d0 = U.d0 + r * U.depth;
      const y = U.h0 + r * U.rise;
      prof2.push([d0, y, seatCol], [d0 + U.depth, y, seatCol]);
      if (r < U.rows - 1) prof2.push([d0 + U.depth, y + U.rise, riser]);
    }
    prof2.push([U.d1, U.top + 2.5, 0x3a3e46], [U.d1 + 0.6, U.top + 2.5, 0x2a2e36], [U.d1 + 0.6, 0, 0x2a2e36]);
    for (const seg of [0, 2]) {
      const g = extrude(prof2, loopTs([seg], 12));
      this.add(new THREE.Mesh(g, mat), { receive: true });
      // 2 階の端の壁（直線の両端を閉じる）
      for (const k of [0, 1]) {
        const t = seg + k;
        const shape = new THREE.Shape();
        shape.moveTo(U.d0 - 1.6, L.top + 1.3);
        prof2.forEach(([d, y]) => shape.lineTo(d, y));
        shape.lineTo(U.d0 - 1.6, 0);
        const sg = new THREE.ShapeGeometry(shape);
        // (d, y) → ワールド: d は外向き（z 方向）
        const pos = sg.attributes.position;
        const p = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          const d = pos.getX(i);
          const y = pos.getY(i);
          loopPoint(d, t, p);
          pos.setXYZ(i, p.x, y, p.z);
        }
        sg.computeVertexNormals();
        this.add(new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: 0x3e434c, side: THREE.DoubleSide })));
      }
    }
    // カーブの外側の壁（1 階の後ろ）
    const outer = extrude([[L.d1 + 1.4, 0, 0x262a32], [L.d1 + 1.4, L.top + 3.2, 0x2e323a]], loopTs([1, 3]));
    this.add(new THREE.Mesh(outer, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    // 前の壁の LED 広告（光る帯）
    const led = ledTexture();
    led.repeat.set(5, 1);
    const ledG = extrude([[-0.04, 0.3, 0xffffff], [-0.04, 1.15, 0xffffff]], loopTs([0, 1, 2, 3], 16, 60), { uScale: 1 / 90 });
    const ledM = new THREE.MeshBasicMaterial({ map: led, color: new THREE.Color(1.35, 1.35, 1.35), side: THREE.DoubleSide });
    this.ledMat = ledM;
    this.add(new THREE.Mesh(ledG, ledM));
    // 1 階の手すり（ガラス）
    const glass = extrude([[0.05, L.h0, 0xbcd4ff], [0.05, L.h0 + 0.9, 0xbcd4ff]], loopTs([0, 1, 2, 3]));
    this.add(new THREE.Mesh(glass, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })));
  }

  buildRoofAndLights() {
    const U = TIERS[1];
    // 屋根（メインとバックの直線の上）: 前ほど高い片持ちの屋根
    const roofProf = [[14, 33.2, 0xd8dde6], [U.d1 + 1.5, 29.5, 0xb9c0cc]];
    const under = [[14, 32.6, 0x2a2e38], [U.d1 + 1.5, 28.9, 0x2a2e38]];
    const fascia = [[14, 31.2, 0x9aa3b2], [14, 33.4, 0xc8ced8]];
    const roofMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.lightStrips = [];
    const glow = this.glowTex;
    for (const seg of [0, 2]) {
      for (const p of [roofProf, under, fascia]) this.add(new THREE.Mesh(extrude(p, loopTs([seg], 16)), roofMat));
      // 屋根の前の照明（光る帯 + ランプの玉）
      const strip = extrude([[13.6, 31.25, 0xffffff], [13.6, 31.9, 0xffffff]], loopTs([seg], 16));
      const sm = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 5.3, 4.8), side: THREE.DoubleSide });
      this.add(new THREE.Mesh(strip, sm));
      this.lightStrips.push(sm);
      const p = new THREE.Vector3();
      for (let i = 0; i <= 12; i++) {
        loopPoint(13.4, seg + i / 12, p);
        p.y = 31.6;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(1.6, 1.5, 1.3), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        sp.position.copy(p);
        sp.scale.setScalar(9);
        this.group.add(sp);
        this.lamps.push(p.clone());
      }
      // 屋根の支柱
      for (let i = 0; i <= 6; i++) {
        loopPoint(U.d1 + 0.8, seg + i / 6, p);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 30, 8), new THREE.MeshLambertMaterial({ color: 0x3a3f48 }));
        col.position.set(p.x, 15, p.z);
        this.add(col);
      }
    }
    // 照明塔（カーブの斜め）: 柱 + ランプの面（光る小さな四角の格子）+ グロー + 光の筋
    const lampGeo = [];
    const towerMat = new THREE.MeshLambertMaterial({ color: 0x4a505c });
    this.beams = [];
    this.towerHeads = [];
    for (const t of TOWERS) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, t.h, 10), towerMat);
      pole.position.set(t.x, t.h / 2, t.z);
      this.add(pole);
      const head = new THREE.Group();
      head.position.set(t.x, t.h + 3, t.z);
      head.lookAt(0, 0, 0);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(11, 7, 0.6), new THREE.MeshLambertMaterial({ color: 0x2a2e36 }));
      head.add(frame);
      this.group.add(head);
      head.updateMatrixWorld(true);
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 4; j++) {
          const q = new THREE.PlaneGeometry(1.35, 1.2);
          q.translate(-4.3 + i * 1.72, -2.4 + j * 1.6, 0.32);
          q.applyMatrix4(head.matrixWorld);
          lampGeo.push(q);
        }
      }
      const c = new THREE.Vector3(0, 0, 1.5).applyMatrix4(head.matrixWorld);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(2.2, 2.1, 1.9), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sp.position.copy(c);
      sp.scale.setScalar(34);
      this.group.add(sp);
      this.towerHeads.push(c.clone());
      this.lamps.push(c.clone());
      // 光の筋（薄い霧に照らされた円すい）
      const len = 95;
      const cone = new THREE.ConeGeometry(16, len, 20, 1, true);
      cone.translate(0, -len / 2, 0);
      const beamMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uAmt: { value: 0.05 } },
        vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
          void main(){ vY = -position.y / ${len.toFixed(1)}; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform float uAmt; varying float vY; varying vec3 vN; varying vec3 vV;
          void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float a = uAmt * (1.0 - vY) * (1.0 - vY) * edge; gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * a, 1.0); }`,
      });
      const beam = new THREE.Mesh(cone, beamMat);
      beam.position.copy(c);
      const target = new THREE.Vector3(t.x * 0.15, 0, t.z * 0.15);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target.clone().sub(c).normalize());
      beam.renderOrder = 5;
      this.group.add(beam);
      this.beams.push(beamMat);
    }
    const lamps = new THREE.Mesh(mergeGeometries(lampGeo), new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 6.8, 6.2), side: THREE.DoubleSide }));
    this.add(lamps);
    this.towerLampMat = lamps.material;
    // 放送ブース（メインスタンド 2 階の上段・ガラスの箱）
    const booth = new THREE.Mesh(new THREE.BoxGeometry(58, 5, 5), [
      new THREE.MeshLambertMaterial({ color: 0x2a2e36 }),
      new THREE.MeshLambertMaterial({ color: 0x2a2e36 }),
      new THREE.MeshLambertMaterial({ color: 0x2a2e36 }),
      new THREE.MeshLambertMaterial({ color: 0x2a2e36 }),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.15, 0.8) }),
      new THREE.MeshLambertMaterial({ color: 0x2a2e36 }),
    ]);
    booth.position.set(0, 23.5, R0 + U.d0 + 15.5);
    booth.rotation.y = Math.PI;
    this.add(booth);
  }

  buildScreen() {
    const s = SCREEN;
    this.screen = boardCanvas(1024, 448);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(s.w + 1.6, s.h + 1.6, 1.2), new THREE.MeshLambertMaterial({ color: 0x1b1e26 }));
    frame.position.set(s.x + 0.7, s.y, s.z);
    frame.rotation.y = -Math.PI / 2;
    this.add(frame);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ map: this.screen.tex, color: new THREE.Color(1.25, 1.25, 1.25) }));
    scr.position.set(s.x, s.y, s.z);
    scr.rotation.y = -Math.PI / 2;
    this.add(scr);
    this.screenMesh = scr;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2, s.y - s.h / 2, 2), new THREE.MeshLambertMaterial({ color: 0x2a2e36 }));
    leg.position.set(s.x + 1.5, (s.y - s.h / 2) / 2, s.z);
    this.add(leg);
  }

  buildExtras() {
    // 選手の出入りのトンネル（メインスタンドの西の端・1 階の前の壁の暗い口）
    const tun = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 4), new THREE.MeshBasicMaterial({ color: 0x07080c }));
    tun.position.set(TUNNEL.x, 1.3, TUNNEL.z + 1.6);
    this.add(tun);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.4, 0.4), new THREE.MeshLambertMaterial({ color: 0x9aa0aa }));
    lip.position.set(TUNNEL.x, 2.8, TUNNEL.z - 0.3);
    this.add(lip);
    const tl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.6) }));
    tl.position.set(TUNNEL.x, 2.5, TUNNEL.z - 0.05);
    tl.rotation.y = Math.PI;
    this.add(tl);
    // 写真席の看板・カメラの三脚（トラックの外・マットの横）
    const pmat = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });
    for (let k = 0; k < 4; k++) {
      const tri = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), pmat);
      tri.position.set(27 + k * 1.6, 0.65, 33.4);
      this.add(tri);
      const cam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.6), pmat);
      cam.position.set(27 + k * 1.6, 1.4, 33.4);
      cam.rotation.y = -0.6;
      this.add(cam);
    }
  }

  // ---- 試技時計（残り秒 + 名前）
  drawClock(sec, name, on = true) {
    const { g, tex, canvas } = this.clockBoard;
    g.fillStyle = '#06070c';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (on) {
      g.fillStyle = sec <= 15 ? '#ff4040' : '#ffd23f';
      g.font = 'bold 64px "Chakra Petch", monospace';
      g.textAlign = 'center';
      g.fillText(`${Math.floor(sec / 60)}:${String(Math.max(0, Math.floor(sec % 60))).padStart(2, '0')}`, 128, 70);
      g.fillStyle = '#ffffff';
      g.font = 'bold 26px "Chakra Petch", sans-serif';
      g.fillText(name, 128, 112);
    }
    tex.needsUpdate = true;
  }

  // ---- 大型ビジョン
  drawScreen({ title = 'MEN’S POLE VAULT FINAL', name = '', nat = '', height = '', marks = '', note = '', big = '' } = {}) {
    const { g, tex, canvas } = this.screen;
    const W = canvas.width;
    const H = canvas.height;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#0b1440');
    grd.addColorStop(1, '#05060f');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, W, 60);
    g.fillStyle = '#05060f';
    g.font = 'bold 38px "Chakra Petch", sans-serif';
    g.textAlign = 'left';
    g.fillText(title, 24, 44);
    g.textAlign = 'right';
    g.fillText('ATTENDANCE 30,000', W - 24, 44);
    g.textAlign = 'left';
    if (big) {
      g.fillStyle = '#ffffff';
      g.font = 'bold 120px "Chakra Petch", "Dela Gothic One", sans-serif';
      g.textAlign = 'center';
      g.fillText(big, W / 2, 230);
      g.font = 'bold 54px "Dela Gothic One", sans-serif';
      g.fillStyle = '#39e6ff';
      g.fillText(note, W / 2, 330);
    } else {
      g.fillStyle = '#ffffff';
      g.font = 'bold 76px "Dela Gothic One", "Chakra Petch", sans-serif';
      g.fillText(name, 40, 170);
      g.fillStyle = '#9ad8ff';
      g.font = 'bold 48px "Chakra Petch", sans-serif';
      g.fillText(nat, 44, 236);
      g.textAlign = 'right';
      g.fillStyle = '#ffd23f';
      g.font = 'bold 150px "Chakra Petch", sans-serif';
      g.fillText(height, W - 40, 250);
      g.textAlign = 'left';
      g.fillStyle = '#ffffff';
      g.font = 'bold 56px "Chakra Petch", sans-serif';
      g.fillText(marks, 44, 330);
      g.fillStyle = '#39e6ff';
      g.font = 'bold 40px "Dela Gothic One", sans-serif';
      g.fillText(note, 44, 404);
    }
    tex.needsUpdate = true;
  }

  update(dt, t) {
    // 光の筋がゆっくりゆらぐ（霧）
    for (let i = 0; i < this.beams.length; i++) this.beams[i].uniforms.uAmt.value = 0.045 + 0.012 * Math.sin(t * 0.3 + i * 1.7);
  }
}
