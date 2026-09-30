import * as THREE from 'three';
import { makeCanvas, toTexture } from '../../src/world/textures.js';
import { createRng } from '../../src/core/math.js';

// 空へ飛んだ時に見える「会場の外」: 夜の街（ビルのインスタンス 1 draw call + 遠くの街あかりの板）/ 雲 / 帰る場所の目印。
// すべて world（会場ごと動くグループ）の中に置く。高く上がるほど world を縮めて下へずらす（見かけの大きさは正しいまま、
// 数値は小さいまま → 数十 km 上空でも描画が破綻しない）。普段（会場の中）は非表示で描画しない。

function windowTexture() {
  const [c, g] = makeCanvas(64, 128);
  g.fillStyle = '#06070d';
  g.fillRect(0, 0, 64, 128);
  const rng = createRng(9);
  for (let y = 4; y < 128; y += 8) {
    for (let x = 4; x < 64; x += 8) {
      if (rng.chance(0.42)) {
        g.fillStyle = rng.chance(0.8) ? '#ffd9a0' : '#bfe6ff';
        g.globalAlpha = 0.5 + rng.next() * 0.5;
        g.fillRect(x, y, 4, 4);
      }
    }
  }
  g.globalAlpha = 1;
  return toTexture(c, { repeat: true });
}

// 上から見た街あかり（道路の格子と光の粒）
function cityLightsTexture() {
  const [c, g] = makeCanvas(1024, 1024);
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, 1024, 1024);
  const rng = createRng(21);
  g.strokeStyle = 'rgba(255,190,110,.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 70; i++) {
    const x = rng.next() * 1024;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (rng.next() - 0.5) * 200, 1024);
    g.stroke();
    const y = rng.next() * 1024;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(1024, y + (rng.next() - 0.5) * 200);
    g.stroke();
  }
  for (let i = 0; i < 9000; i++) {
    const x = rng.next() * 1024;
    const y = rng.next() * 1024;
    const d = Math.hypot(x - 512, y - 512) / 512;
    if (rng.next() < d * 0.55) continue; // 中心（会場のまわり）ほど明るい
    g.fillStyle = rng.chance(0.8) ? 'rgba(255,205,140,.8)' : 'rgba(190,225,255,.8)';
    g.fillRect(x, y, 1.5, 1.5);
  }
  // 川
  g.strokeStyle = '#0a1426';
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(0, 700);
  g.bezierCurveTo(300, 600, 600, 900, 1024, 760);
  g.stroke();
  return toTexture(c);
}

function cloudTexture() {
  const [c, g] = makeCanvas(256, 128);
  const rng = createRng(5);
  for (let i = 0; i < 26; i++) {
    const x = 40 + rng.next() * 176;
    const y = 40 + rng.next() * 48;
    const r = 18 + rng.next() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(200,210,235,.55)');
    grad.addColorStop(1, 'rgba(200,210,235,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
  }
  return toTexture(c);
}

export class TrampolineSkyWorld {
  constructor(world) {
    this.group = new THREE.Group();
    this.group.visible = false;
    world.add(this.group);
    // ビル（会場のまわり 90m〜2.4km）
    const N = 2600;
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x1a1d2c, emissive: 0xffffff, emissiveMap: windowTexture(), emissiveIntensity: 1.3 });
    this.buildings = new THREE.InstancedMesh(box, mat, N);
    const rng = createRng(33);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const r = 95 + Math.pow(rng.next(), 0.7) * 2300;
      const a = rng.next() * Math.PI * 2;
      const tall = rng.chance(0.06) ? rng.range(80, 190) : rng.range(8, 45) * (1 - r / 3200);
      p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(a * 4) / 4);
      s.set(rng.range(14, 34), tall, rng.range(14, 34));
      m.compose(p, q, s);
      this.buildings.setMatrixAt(i, m);
    }
    this.buildings.frustumCulled = false;
    this.group.add(this.buildings);
    // 遠くまで続く街あかり（半径 40km の板）
    const lights = new THREE.Mesh(new THREE.CircleGeometry(40000, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: cityLightsTexture(), color: new THREE.Color(2.2, 2.2, 2.2) }));
    lights.material.map.repeat.set(12, 12);
    lights.material.map.wrapS = lights.material.map.wrapT = THREE.RepeatWrapping;
    lights.position.y = -0.3;
    this.lights = lights;
    this.group.add(lights);
    // 雲（1.2〜2.8km）
    const ctex = cloudTexture();
    this.clouds = new THREE.Group();
    for (let i = 0; i < 70; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, transparent: true, depthWrite: false, opacity: 0.85, fog: false }));
      const r = Math.pow(rng.next(), 0.6) * 5200;
      const a = rng.next() * Math.PI * 2;
      sp.position.set(Math.cos(a) * r, rng.range(1300, 2700), Math.sin(a) * r);
      const w = rng.range(500, 1300);
      sp.scale.set(w, w * 0.45, 1);
      this.clouds.add(sp);
    }
    this.group.add(this.clouds);
    // 帰る場所の目印（会場の真上に光る輪。高いほど大きくして、いつでも見える）
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x39e6ff, transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.target.position.y = 40;
    this.target.renderOrder = 5;
    this.group.add(this.target);
  }

  setVisible(on) {
    this.group.visible = on;
  }

  // alt: 高度（m）/ k: world の縮尺
  update(alt, k, time) {
    // 目印: 見かけの大きさがだいたい一定になるように
    // world は k 倍に縮むので、ここで alt に比例させると画面上の大きさがほぼ一定になる
    this.target.scale.setScalar(Math.max(18, alt * 0.05));
    void k;
    this.target.material.opacity = 0.55 + 0.35 * Math.sin(time * 4);
    // 高い所では雲・ビルは見えない（小さすぎる）→ 描画しない
    this.buildings.visible = alt < 9000;
    this.clouds.visible = alt < 16000;
  }
}
