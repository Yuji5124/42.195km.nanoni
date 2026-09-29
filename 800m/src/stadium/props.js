import * as THREE from 'three';
import { TRACK, trackPoint } from '../race/trackLogic.js';
import { STAND } from './stands.js';
import { patchMaterial } from '../fx/materialPatch.js';
import { formatTime } from '../core/mathx.js';

// 競技場の小物: 照明塔・メインスタンドの屋根・電光掲示板・選手入場トンネル・スタートの号砲台
// すべてジオメトリ生成（外部モデルなし）。

function mat(color, opts = {}, deform) {
  const m = new THREE.MeshLambertMaterial({ color, ...opts });
  if (deform) {
    m.onBeforeCompile = (shader) => deform.attach(shader);
    m.customProgramCacheKey = () => `prop-${color}`;
  }
  return patchMaterial(m);
}

function glow(color, k = 2.2, deform) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.color.multiplyScalar(k);
  if (deform) {
    m.onBeforeCompile = (shader) => deform.attach(shader);
    m.customProgramCacheKey = () => `glow-${color}`;
  }
  return patchMaterial(m);
}

export function buildProps(deform, top) {
  const group = new THREE.Group();
  const steel = mat(0x23252f, {}, deform);
  const concrete = mat(0x6a6d78, {}, deform);
  const lampMat = glow(0xfff4dc, 3.0, deform);

  // ---- 照明塔（4 本、コーナーの外）
  const r = TRACK.radius + top.off + 4;
  const hl = TRACK.straight / 2;
  const corners = [
    [hl + r * 0.72, r * 0.72],
    [hl + r * 0.72, -r * 0.72],
    [-hl - r * 0.72, -r * 0.72],
    [-hl - r * 0.72, r * 0.72],
  ];
  for (const [x, z] of corners) {
    const g = new THREE.Group();
    const h = 46;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.1, h, 8), steel);
    mast.position.y = h / 2;
    g.add(mast);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(9, 5.5, 0.8), steel);
    panel.position.y = h + 2;
    g.add(panel);
    const lamps = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 4.8), lampMat);
    lamps.position.set(0, h + 2, 0.45);
    g.add(lamps);
    g.position.set(x, 0, z);
    g.lookAt(0, h * 0.2, 0);
    panel.rotation.x = lamps.rotation.x = 0.3;
    group.add(g);
  }

  // ---- メインスタンドの屋根（ホームストレート側）
  const roofLen = TRACK.straight + 40;
  const roofDepth = 22;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(roofLen, 0.7, roofDepth), mat(0x303442, {}, deform));
  const zRoof = TRACK.radius + top.off - roofDepth / 2 + 5;
  roof.position.set(0, top.y + 9, zRoof);
  roof.rotation.x = -0.08;
  group.add(roof);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(roofLen, 0.25, 0.4), lampMat);
  strip.position.set(0, top.y + 8.4, zRoof - roofDepth / 2 + 1);
  group.add(strip);
  for (let i = 0; i < 6; i++) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, top.y + 9, 0.8), concrete);
    pillar.position.set(-roofLen / 2 + 6 + (i * (roofLen - 12)) / 5, (top.y + 9) / 2, TRACK.radius + top.off + 2);
    group.add(pillar);
  }

  // ---- 電光掲示板（西側カーブの向こう）
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 1024;
  boardCanvas.height = 512;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTex });
  boardMat.color.setScalar(1.25);
  if (deform) {
    boardMat.onBeforeCompile = (shader) => deform.attach(shader);
    boardMat.customProgramCacheKey = () => 'board-800';
  }
  patchMaterial(boardMat);
  const board = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(30, 15, 1.2), steel);
  board.add(frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(28.5, 13.8), boardMat);
  screen.position.z = 0.65;
  board.add(screen);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(1.2, 18, 1.2), steel);
  legs.position.y = -16;
  board.add(legs);
  board.position.set(-hl - TRACK.radius - top.off - 6, top.y + 12, 0);
  board.rotation.y = Math.PI / 2;
  group.add(board);

  // ---- 選手入場トンネル（南西、メインスタンドの端）
  const tp = trackPoint(TRACK.lap - 20, STAND.off0 + 1, {});
  const tunnel = new THREE.Group();
  const arch = new THREE.Mesh(new THREE.BoxGeometry(6, 4.2, 3), concrete);
  arch.position.y = 2.1;
  tunnel.add(arch);
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.2), new THREE.MeshBasicMaterial({ color: 0x050508 }));
  hole.position.set(0, 1.6, -1.52);
  hole.rotation.y = Math.PI;
  tunnel.add(hole);
  tunnel.position.set(tp.x, 0, tp.z);
  tunnel.rotation.y = tp.heading + Math.PI / 2;
  group.add(tunnel);

  // 掲示板の描画（Modifier が mirrored / lie を切り替える）
  let last = '';
  const board$ = {
    group,
    mirrored: false,
    draw(info) {
      const key = JSON.stringify(info) + this.mirrored;
      if (key === last) return;
      last = key;
      const g = boardCanvas.getContext('2d');
      g.save();
      g.fillStyle = '#05060c';
      g.fillRect(0, 0, 1024, 512);
      if (this.mirrored) {
        g.translate(1024, 0);
        g.scale(-1, 1);
      }
      g.fillStyle = '#ffcf3a';
      g.font = 'bold 64px "Chakra Petch", Arial, sans-serif';
      g.textAlign = 'left';
      g.fillText("MEN'S 800m FINAL", 40, 88);
      g.fillStyle = '#39e6ff';
      g.font = 'bold 150px "Chakra Petch", Arial, sans-serif';
      g.fillText(info.time != null ? formatTime(info.time) : '0:00.00', 40, 270);
      g.fillStyle = '#ffffff';
      g.font = 'bold 60px "Chakra Petch", Arial, sans-serif';
      g.fillText(info.lap ?? 'LAP 1 / 2', 40, 380);
      g.fillStyle = '#ff3d7f';
      g.fillText(info.leader ?? '', 40, 470);
      g.restore();
      boardTex.needsUpdate = true;
    },
  };
  group.userData.board = board$;
  return board$;
}
