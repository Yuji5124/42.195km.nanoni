import * as THREE from 'three';
import { createStandCrowdMaterial, bigScreen, darkMetal, glow } from '../../src/world/LandmarksStadium.js';
import { makeStandCrowdTexture, makeCanvas, toTexture, FONT_JP } from '../../src/world/textures.js';
import { createHumanMaterial, createHumanInstances, applyLook, randomSpectatorLook, writeYawMatrix } from '../../src/world/RunnerModel.js';
import { createRng, clamp, damp } from '../../src/core/math.js';

// トランポリン会場: 1500m の国立競技場の部品（板の観客・照明・大型ビジョン・観客の人形）を
// 360 度のボウルに並べ直したもの。中央に競技用トランポリン、上に「左右へ開く」巨大な屋根。
//   座標: 会場の中心が原点。トランポリンの長い辺 = X。屋根の開口部は半径 ROOF.open
//   観客: 手前の数段は 3D の人形（Instanced、1 draw call）、奥は段に貼った板の観客（数万人でも 1 枚）

export const ARENA = { floorR: 30, standR: 31.5, tiers: 24, depth: 1.35, rise: 0.78, y0: 1.6, segs: 72 };
export const ROOF = { y: 37, open: 40, outer: 72, panelShift: 44 };

// 客席の段（蹴上げ = 観客の板 / 踏面 = 座席）を 360 度のリングで
function buildBowlGeometry() {
  const pos = [];
  const nor = [];
  const uv = [];
  const groups = [[], []];
  const N = ARENA.segs;
  const quad = (a, b, c, d, n, uvs, group) => {
    const base = pos.length / 3;
    for (const p of [a, b, c, d]) pos.push(...p);
    for (let k = 0; k < 4; k++) nor.push(...n);
    uv.push(...uvs);
    groups[group].push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let k = 0; k < ARENA.tiers; k++) {
    const r0 = ARENA.standR + k * ARENA.depth;
    const r1 = r0 + ARENA.depth;
    const yLow = k === 0 ? 0 : ARENA.y0 + (k - 1) * ARENA.rise;
    const yTop = ARENA.y0 + k * ARENA.rise;
    const circ = 2 * Math.PI * r0;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      // 蹴上げ（中心を向く）: 16m で板 1 枚ぶん
      const u0 = (i / N) * (circ / 16);
      const u1 = ((i + 1) / N) * (circ / 16);
      const am = (a0 + a1) / 2;
      quad([r0 * c1, yLow, r0 * s1], [r0 * c1, yTop, r0 * s1], [r0 * c0, yTop, r0 * s0], [r0 * c0, yLow, r0 * s0], [-Math.cos(am), 0, -Math.sin(am)], [u1, 0, u1, 1, u0, 1, u0, 0], 0);
      // 踏面（座席）
      quad([r0 * c0, yTop, r0 * s0], [r0 * c1, yTop, r0 * s1], [r1 * c1, yTop, r1 * s1], [r1 * c0, yTop, r1 * s0], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([...groups[0], ...groups[1]]);
  geo.addGroup(0, groups[0].length, 0);
  geo.addGroup(groups[0].length, groups[1].length, 1);
  return geo;
}

// 床（競技フロア）のテクスチャ: 青い床 + 白いライン + 中央のマーク
function floorTexture() {
  const [c, g] = makeCanvas(1024, 1024);
  g.fillStyle = '#1b3f73';
  g.fillRect(0, 0, 1024, 1024);
  const grad = g.createRadialGradient(512, 512, 40, 512, 512, 512);
  grad.addColorStop(0, 'rgba(90,150,230,.35)');
  grad.addColorStop(1, 'rgba(0,0,0,.25)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = 'rgba(255,255,255,.75)';
  g.lineWidth = 6;
  g.strokeRect(262, 382, 500, 260);
  g.beginPath();
  g.arc(512, 512, 330, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,.2)';
  g.font = `64px ${FONT_JP}`;
  g.textAlign = 'center';
  g.fillText('TRAMPOLINE FINAL', 512, 230);
  g.fillText('トランポリン、なのに。', 512, 850);
  return toTexture(c);
}

// 屋根のパネル（格子の梁）
function roofTexture() {
  const [c, g] = makeCanvas(512, 512);
  g.fillStyle = '#2b2f3e';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#4a5068';
  g.lineWidth = 10;
  for (let i = 0; i <= 512; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 512);
    g.moveTo(0, i);
    g.lineTo(512, i);
    g.stroke();
  }
  g.strokeStyle = '#1a1d28';
  g.lineWidth = 4;
  for (let i = -512; i <= 512; i += 128) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 512, 512);
    g.stroke();
  }
  return toTexture(c, { repeat: true });
}

export class TrampolineArena {
  constructor(scene, quality) {
    this.scene = scene;
    this.group = new THREE.Group(); // 会場の中身（空へ飛んだら丸ごと隠す）
    scene.add(this.group);
    this.crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0.2 } };
    this.time = 0;
    this.shake = 0;
    this.buildFloor();
    this.buildStands();
    this.buildRoof();
    this.buildScreens();
    this.buildCrowd(quality.crowd3d);
    this.buildLights();
    this.roofOpen = 0; // 0 = 閉 / 1 = 全開
    this.roofTarget = 0;
    this.wave = { on: false, angle: 0, speed: 1, left: 0, amt: 0 };
    this.buildFlashes();
  }

  // 観客席のカメラのフラッシュ（点滅する小さな光。1 draw call）
  buildFlashes() {
    const N = 260;
    const pos = new Float32Array(N * 3);
    const rng = createRng(77);
    this.flashData = [];
    for (let i = 0; i < N; i++) {
      const k = rng.int(1, ARENA.tiers - 2);
      const a = rng.range(0, Math.PI * 2);
      const r = ARENA.standR + (k + 0.5) * ARENA.depth;
      pos.set([Math.cos(a) * r, ARENA.y0 + k * ARENA.rise + 1.1, Math.sin(a) * r], i * 3);
      this.flashData.push({ t: rng.range(0, 6) });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.flashAlpha = new Float32Array(N);
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.flashAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = alpha * 900.0 / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * 2.0, a); }',
    });
    this.flashes = new THREE.Points(geo, mat);
    this.flashes.frustumCulled = false;
    this.stands.add(this.flashes);
    this.flashRate = 0.03;
    this.storm = 0;
  }

  // フラッシュが一斉に（ポーズ・着地）
  flashStorm(sec = 0.8) {
    this.storm = Math.max(this.storm, sec);
  }

  // 照明の演出（ライトバンクが順番に光って一周 → 最後に全部が光る）。世界の時間で dur 秒
  lightShow(dur = 2.4) {
    this.show = { t: 0, dur };
  }

  buildFloor() {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA.standR + 0.2, 64).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: floorTexture() }));
    floor.material.map.rotation = 0;
    this.group.add(floor);
    // 外の地面（空から見下ろした時用。スタジアムの外周）
    const ground = new THREE.Mesh(new THREE.RingGeometry(ROOF.outer - 2, 900, 48, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x1b1f2a }));
    ground.position.y = -0.05;
    this.ground = ground;
    this.scene.add(ground);
  }

  buildStands() {
    const crowdMats = [this.waveCrowdMaterial(), new THREE.MeshLambertMaterial({ color: 0x33415e })];
    this.bowl = new THREE.Mesh(buildBowlGeometry(), crowdMats);
    this.bowl.frustumCulled = false;
    this.stands = new THREE.Group(); // 「観客席全体が揺れる」はこのグループを揺らす
    this.stands.add(this.bowl);
    this.group.add(this.stands);
    // 最上段の外壁（ぐるっと一周）
    const topR = ARENA.standR + ARENA.tiers * ARENA.depth;
    const topY = ARENA.y0 + (ARENA.tiers - 1) * ARENA.rise;
    const wall = (this.wall = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR, ROOF.y - topY + 2, ARENA.segs, 1, true), new THREE.MeshLambertMaterial({ color: 0x252a3a, side: THREE.BackSide })));
    wall.position.y = topY + (ROOF.y - topY + 2) / 2;
    wall.material.side = THREE.DoubleSide; // 空から見下ろした時は外側が見える
    this.group.add(wall);
    // 客席の手すり（最前列の光るライン）
    const rail = new THREE.Mesh(new THREE.TorusGeometry(ARENA.standR - 0.05, 0.06, 4, 96).rotateX(Math.PI / 2), glow(0x39e6ff, 1.6));
    rail.position.y = 1.1;
    this.stands.add(rail);
  }

  // 1500m の板の観客（createStandCrowdMaterial）に「ウェーブ」を足したもの。
  // 元のシェーダーの書き換えをそのまま使い、その後に 1 行だけ足す（1500m 側のマテリアルは変わらない）
  waveCrowdMaterial() {
    const mat = createStandCrowdMaterial(makeStandCrowdTexture(3), this.crowdUniforms);
    this.waveU = { uWave: { value: 0 }, uWaveAmt: { value: 0 } };
    const base = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      base(shader, renderer);
      shader.uniforms.uWave = this.waveU.uWave;
      shader.uniforms.uWaveAmt = this.waveU.uWaveAmt;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTWorld;\nuniform float uWave;\nuniform float uWaveAmt;')
        .replace(
          'cuv.y = clamp(cuv.y - hop * (0.06 + uExcite * 0.2), 0.0, 0.999);',
          `float wd = abs(mod(atan(vTWorld.z, vTWorld.x) - uWave + 3.14159265, 6.2831853) - 3.14159265);
        float wv = smoothstep(0.3, 0.0, wd) * uWaveAmt;
        cuv.y = clamp(cuv.y - hop * (0.06 + uExcite * 0.2) - wv * 0.32, 0.0, 0.999);`
        )
        .replace('diffuseColor *= sampledDiffuseColor;', 'diffuseColor *= sampledDiffuseColor;\n        diffuseColor.rgb *= 1.0 + wv * 0.7;');
    };
    mat.customProgramCacheKey = () => 'stand-crowd-tramp-wave';
    return mat;
  }

  // 屋根: 外側のリング（固定）+ 開口部を覆う 2 枚のパネル（左右へスライドして開く）
  buildRoof() {
    const tex = roofTexture();
    tex.repeat.set(6, 6);
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    this.roof = new THREE.Group();
    this.group.add(this.roof);
    const ring = new THREE.Mesh(new THREE.RingGeometry(ROOF.open - 1, ROOF.outer, 64, 1).rotateX(Math.PI / 2), mat);
    ring.position.y = ROOF.y;
    this.roof.add(ring);
    // 開口部のふちの光（下から見える）
    const lip = new THREE.Mesh(new THREE.TorusGeometry(ROOF.open - 0.8, 0.35, 6, 96).rotateX(Math.PI / 2), glow(0xfff2d0, 2.2));
    lip.position.y = ROOF.y - 0.4;
    this.roof.add(lip);
    // 2 枚のパネル（半円 + 梁）。x = 0 の線で左右に分かれる
    // 開閉するパネルは半透明の膜（ETFE）: 閉じていても、夜空・飛行機・花火がうっすら見える
    const glassTex = roofTexture();
    glassTex.repeat.set(5, 5);
    const glass = new THREE.MeshBasicMaterial({ map: glassTex, color: 0x6f86b8, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
    this.panels = [];
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const half = new THREE.Mesh(new THREE.CircleGeometry(ROOF.open + 0.8, 48, side > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI).rotateX(Math.PI / 2), glass);
      g.add(half);
      // 厚みのある梁（大きな構造物に見えるように）
      for (let k = 0; k < 5; k++) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, (ROOF.open + 0.8) * 2 * Math.cos(Math.asin(clamp((k * 8) / (ROOF.open + 0.8), 0, 0.99)))), darkMetal);
        beam.position.set(side * (k * 8 + 1), -0.8, 0);
        g.add(beam);
      }
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, (ROOF.open + 0.8) * 2), glow(0xff3d7f, 1.2));
      edge.position.set(side * 0.4, -1.1, 0);
      g.add(edge);
      g.position.y = ROOF.y + 0.6;
      g.userData.side = side;
      this.roof.add(g);
      this.panels.push(g);
    }
  }

  buildScreens() {
    this.screens = [];
    for (const [a, lines] of [
      [0.35, ['TRAMPOLINE', "MEN'S INDIVIDUAL FINAL"]],
      [Math.PI + 0.35, ['トランポリン決勝', 'LIVE']],
    ]) {
      const s = bigScreen(lines);
      const r = 44;
      s.position.set(Math.cos(a) * r, 27, Math.sin(a) * r);
      s.lookAt(0, 12, 0);
      this.group.add(s);
      this.screens.push(s);
    }
    // 得点板（真面目な方）: 会場の奥に 1 枚。canvas を毎回描き直す
    const [c, g] = makeCanvas(1024, 512);
    this.boardCanvas = c;
    this.boardCtx = g;
    this.boardTex = toTexture(c);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: this.boardTex }));
    board.material.color.setScalar(1.25);
    board.position.set(0, 26, -52);
    board.lookAt(0, 14, 0);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(23, 12, 0.8), darkMetal);
    frame.position.copy(board.position);
    frame.quaternion.copy(board.quaternion);
    frame.translateZ(-0.45);
    this.group.add(frame, board);
    this.drawBoard({ name: 'SAMURAI', attempt: 0, of: 10, last: 0, total: 0 });
  }

  // 得点板（実況と同じくらい真面目）
  drawBoard({ name, attempt, of, last, total, note = '' }) {
    const g = this.boardCtx;
    g.fillStyle = '#060818';
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, 1024, 70);
    g.fillStyle = '#111';
    g.font = `bold 44px "Chakra Petch", sans-serif`;
    g.fillText("TRAMPOLINE  MEN'S FINAL", 30, 52);
    g.fillStyle = '#fff';
    g.font = `bold 64px "Chakra Petch", sans-serif`;
    g.fillText(name, 30, 160);
    g.font = `bold 40px "Chakra Petch", sans-serif`;
    g.fillStyle = '#39e6ff';
    g.fillText(`ATTEMPT ${attempt}/${of}`, 30, 230);
    g.fillStyle = '#fff';
    g.fillText('LAST', 30, 320);
    g.fillText('TOTAL', 30, 420);
    g.font = `bold 84px "Chakra Petch", sans-serif`;
    g.textAlign = 'right';
    g.fillText(last.toLocaleString('en-US'), 990, 330);
    g.fillStyle = '#ffd23f';
    g.fillText(total.toLocaleString('en-US'), 990, 440);
    g.textAlign = 'left';
    if (note) {
      g.fillStyle = '#ff3d7f';
      g.font = `36px ${FONT_JP}`;
      g.fillText(note, 30, 495);
    }
    this.boardTex.needsUpdate = true;
  }

  // 手前の 3D 観客（最前列から数段、ぐるっと一周）。奥は板の観客
  buildCrowd(count) {
    const mat = createHumanMaterial({ mode: 'spectator', rim: 0.08, rimColor: 0xff7ad9 });
    this.crowdMat = mat;
    mat.userData.uniforms.uPlayerXZ.value.set(9999, 9999); // 「選手に近い人ほど腕を上げる」は使わない（全員が同じ選手を見る）
    this.crowd = createHumanInstances(count, mat, 'low');
    const rng = createRng(1500);
    const arr = this.crowd.instanceMatrix.array;
    this.seats = [];
    const rows = 3;
    const perRow = Math.ceil(count / rows);
    for (let i = 0; i < count; i++) {
      const row = i % rows;
      const k = Math.floor(i / rows);
      const a = (k / perRow) * Math.PI * 2 + rng.range(-0.01, 0.01) + row * 0.013;
      const r = ARENA.standR + (row + 0.5) * ARENA.depth + rng.range(-0.15, 0.15);
      const y = ARENA.y0 + row * ARENA.rise;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const yaw = Math.atan2(x, z) + rng.range(-0.25, 0.25); // 中心を向く（人形の前は -Z）
      const scale = rng.range(0.92, 1.06);
      writeYawMatrix(arr, i, x, y, z, yaw, scale);
      applyLook(this.crowd, i, randomSpectatorLook(rng));
      this.crowd.geometry.attributes.iAnim.setXY(i, rng.next(), 1);
      this.seats.push({ a, r, x, y, z, yaw, scale });
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    this.crowd.geometry.attributes.iAnim.needsUpdate = true;
    this.stands.add(this.crowd);
  }

  buildLights() {
    // 屋根の下の照明（リング状のライトバンク）: 光る板だけ。実際の光はスポットと半球光
    const ring = new THREE.Group();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const bank = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), glow(0xfff6e0, 1.9));
      bank.position.set(Math.cos(a) * (ROOF.open + 3), ROOF.y - 1.2, Math.sin(a) * (ROOF.open + 3));
      bank.lookAt(0, 0, 0);
      ring.add(bank);
    }
    this.group.add(ring);
    this.lightBanks = ring;
    this.hemi = new THREE.HemisphereLight(0xb8c4ff, 0x2a2436, 1.25);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff0dc, 1.3);
    this.key.position.set(20, 60, 30);
    this.scene.add(this.key);
    // トランポリンを照らすスポット（中継の照明）
    this.spot = new THREE.SpotLight(0xffffff, 900, 80, 0.32, 0.5, 1.6);
    this.spot.position.set(0, ROOF.y - 2, 6);
    this.spot.target.position.set(0, 1, 0);
    this.scene.add(this.spot, this.spot.target);
  }

  // ---- 観客席の 3D の人形: 隠す（観客ドラマ）/ ウェーブ / 一人だけ飛ぶ
  hideSeats(list, hide) {
    for (const i of list) this.seats[i].hidden = hide;
    this.seatsDirty = true;
  }

  writeSeats() {
    const arr = this.crowd.instanceMatrix.array;
    const wave = this.wave;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      let dy = 0;
      if (wave.amt > 0) {
        const d = Math.abs(((s.a - wave.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        dy = Math.max(0, 1 - d / 0.3) * 0.55 * wave.amt;
      }
      writeYawMatrix(arr, i, s.x, s.y + dy, s.z, s.yaw, s.hidden ? 0 : s.scale);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    this.seatsDirty = false;
  }

  // 観客ウェーブ: angle から一周（speed rad/s、世界の時間）
  startWave(angle, speed = 1.1, laps = 1.2) {
    this.wave.angle = angle;
    this.wave.speed = speed;
    this.wave.left = laps * Math.PI * 2;
    this.wave.on = true;
  }

  // 一人だけ異常に高く跳ぶ観客（手前の席から）
  launchFlyer(rng) {
    if (!this.flyer) {
      this.flyer = createHumanInstances(1, this.crowdMat, 'high');
      applyLook(this.flyer, 0, { shirt: 0xffd23f, pants: 0x1f2a44, skin: 0xe0ac86, hat: 0x111111, hatScale: 0 });
      this.flyer.geometry.attributes.iAnim.setXY(0, 0.5, 1);
      this.stands.add(this.flyer);
    }
    // WIDE カメラから見える向こう側の最前列
    const cands = this.seats.map((s, i) => i).filter((i) => i % 3 === 0 && Math.abs(Math.atan2(Math.sin(this.seats[i].a + Math.PI / 2), Math.cos(this.seats[i].a + Math.PI / 2))) < 0.35);
    const i = cands[Math.floor(rng.next() * cands.length)] ?? 0;
    this.flyerSeat = i;
    this.flyerY = 0;
    this.flyerV = 17;
    this.flyer.visible = true;
    this.hideSeats([i], true);
    return this.seats[i];
  }

  // 観客が一斉に跳ぶ / 会場が揺れる（hop: m, shake: 0〜1）
  bump(hop = 0.6, shake = 0) {
    this.hopV = Math.max(this.hopV ?? 0, hop * 4.2);
    this.shake = Math.max(this.shake, shake);
  }

  // 会場の中身（観客席・観客・審判・トランポリン・照明）を描画するか。空の上では外側（屋根と外壁）だけ
  setInterior(on) {
    if (this.interior === on) return;
    this.interior = on;
    for (const c of this.group.children) {
      if (c === this.roof || c === this.wall) continue;
      c.visible = on;
    }
  }

  openRoof(open = true) {
    this.roofTarget = open ? 1 : 0;
  }

  // gameDt: 世界の時間（スロー中は遅い）/ realDt: 実時間（屋根は世界が止まっていても動く）
  update(gameDt, excitement, realDt = gameDt) {
    this.time += gameDt;
    this.crowdUniforms.uTime.value = this.time;
    this.crowdUniforms.uExcite.value = excitement;
    const u = this.crowdMat.userData.uniforms;
    u.uTime.value = this.time;
    u.uExcite.value = excitement;
    // 観客のジャンプ（上に速度、重力で戻る）
    this.hopY = (this.hopY ?? 0) + (this.hopV ?? 0) * gameDt;
    this.hopV = (this.hopV ?? 0) - 9.8 * gameDt;
    if (this.hopY <= 0) {
      this.hopY = 0;
      this.hopV = 0;
    }
    u.uHop.value = this.hopY;
    // ウェーブ
    const w = this.wave;
    if (w.on) {
      const step = w.speed * gameDt;
      w.angle = (w.angle + step) % (Math.PI * 2);
      w.left -= step;
      w.amt = Math.min(1, w.amt + gameDt * 2);
      if (w.left <= 0) w.on = false;
    } else w.amt = Math.max(0, w.amt - gameDt * 1.5);
    this.waveU.uWave.value = w.angle;
    this.waveU.uWaveAmt.value = w.amt;
    // 一人だけ飛ぶ観客
    if (this.flyer?.visible) {
      this.flyerV -= 9.8 * gameDt;
      this.flyerY += this.flyerV * gameDt;
      const s = this.seats[this.flyerSeat];
      if (this.flyerY <= 0 && this.flyerV < 0) {
        this.flyer.visible = false;
        this.hideSeats([this.flyerSeat], false);
      } else {
        writeYawMatrix(this.flyer.instanceMatrix.array, 0, s.x, s.y + this.flyerY, s.z, s.yaw + this.flyerY * 0.3, s.scale);
        this.flyer.instanceMatrix.needsUpdate = true;
      }
    }
    if (w.amt > 0 || this.seatsDirty) this.writeSeats();
    // フラッシュ
    this.storm = Math.max(0, this.storm - gameDt);
    const rate = this.storm > 0 ? 0.45 : this.flashRate * (0.5 + excitement);
    for (let i = 0; i < this.flashAlpha.length; i++) {
      const f = this.flashData[i];
      f.t -= gameDt;
      if (f.t <= 0) {
        // 光っていた → 消えて待つ / 待っていた → rate の確率で光る
        f.on = !f.on && Math.random() < rate;
        f.t = f.on ? 0.09 : 0.2 + Math.random() * 0.4;
      }
      this.flashAlpha[i] = f.on ? f.t / 0.09 : 0;
    }
    this.flashes.geometry.attributes.alpha.needsUpdate = true;
    // 照明の演出
    if (this.show) {
      this.show.t += gameDt;
      const k = this.show.t / this.show.dur;
      const banks = this.lightBanks.children;
      banks.forEach((b, i) => {
        const on = k < 0.85 ? Math.abs((k / 0.85) * banks.length - i) < 1.5 : k < 1;
        b.material.color.setHex(on ? 0xff7ad9 : 0x2a2a3a).multiplyScalar(on ? 3.2 : 1);
      });
      this.hemi.color.setHSL((k * 0.8) % 1, 0.6, 0.72);
      if (k >= 1.12) {
        this.show = null;
        banks.forEach((b) => b.material.color.setHex(0xfff6e0).multiplyScalar(1.9));
        this.hemi.color.setHex(0xb8c4ff);
      }
    }
    // 観客席の揺れ
    this.shake = Math.max(0, this.shake - gameDt * 0.8);
    const s = this.shake;
    this.stands.position.set(Math.sin(this.time * 31) * 0.25 * s, Math.sin(this.time * 23) * 0.35 * s, Math.cos(this.time * 27) * 0.25 * s);
    // 屋根: 巨大な構造物なので、ゆっくり動き出してゆっくり止まる
    const target = this.roofTarget;
    this.roofVel = damp(this.roofVel ?? 0, Math.sign(target - this.roofOpen) * 0.2, 1.2, realDt);
    if (Math.abs(target - this.roofOpen) < 0.002) this.roofVel = 0;
    this.roofOpen = clamp(this.roofOpen + this.roofVel * realDt, 0, 1);
    const e = this.roofOpen * this.roofOpen * (3 - 2 * this.roofOpen);
    for (const p of this.panels) {
      p.position.x = p.userData.side * e * ROOF.panelShift;
      p.position.y = ROOF.y + 0.6 + Math.sin(e * Math.PI) * 1.2; // 少し持ち上がってから滑る
    }
  }
}
