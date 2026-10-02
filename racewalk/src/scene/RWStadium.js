// 競歩の競技場（棒高跳びの StadiumBuilder を継承して、助走路・マットの代わりに競歩の道具を置く）。
//   フィニッシュライン（ホームストレートの端）・周回板と鐘・レースの時計・警告掲示板（赤カード）・
//   審判の机 6 つ・給水所（レーン 3〜4 の机とボトル）・ペナルティゾーン（レーン 7）・LED 広告・大型ビジョン。
//   polevault のファイルは変えない（buildVaultArea を上書きするだけ）。

import * as THREE from 'three';
import { StadiumBuilder } from '../../../polevault/src/stadium/StadiumBuilder.js';
import { boardCanvas } from '../../../polevault/src/stadium/textures.js';
import { TRACK, SX, RM, JUDGES, WATER, PENALTY, BOARD, LAP_BOARD, trackPoint, yawOf } from '../race/track.js';

const _p = {};

function placeOnTrack(obj, s, y, h = 0, face = 'fwd') {
  trackPoint(s, y, _p);
  obj.position.set(_p.x, h, _p.z);
  const yaw = yawOf(_p.dx, _p.dz);
  // fwd: 進む向き / back: 来る選手の方を向く / out: 外向き / in: 内向き
  obj.rotation.y = face === 'fwd' ? yaw : face === 'back' ? yaw + Math.PI : face === 'out' ? yaw - Math.PI / 2 : yaw + Math.PI / 2;
  return obj;
}

function ledCanvas() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 64;
  const g = c.getContext('2d');
  const ads = [
    ['NIGHT GAMES TOKYO', '#ffd23f', '#0b1440'],
    ['なのに。 SPORTS', '#ffffff', '#c3122f'],
    ['42.195', '#39e6ff', '#05060f'],
    ['RACE WALK FINAL', '#ffffff', '#0d3b8c'],
    ['全然疲れてない', '#05060f', '#ff3d7f'],
    ['LIVE OK', '#ffffff', '#c3122f'],
    ['ASAKUSA RAMEN', '#ffffff', '#b8331b'],
    ['競歩、なのに。', '#0b1440', '#9ad8ff'],
  ];
  const w = 2048 / ads.length;
  ads.forEach(([t, fg, bg], i) => {
    g.fillStyle = bg;
    g.fillRect(i * w, 0, w, 64);
    g.fillStyle = fg;
    g.font = 'bold 40px "Chakra Petch", "Dela Gothic One", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, i * w + w / 2, 34);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(5, 1);
  t.anisotropy = 8;
  return t;
}

export class RWStadium extends StadiumBuilder {
  // 棒高跳びの助走路・マットの代わり（コンストラクタの途中で呼ばれる）
  buildVaultArea() {
    // buildGround が最後に置いたフィニッシュライン（バックストレート）を、ホームストレートの端へ
    const fm = this.group.children[this.group.children.length - 1];
    if (fm?.geometry?.type === 'PlaneGeometry') fm.position.set(SX, 0.021, (TRACK.rIn + TRACK.rOut) / 2);
    this.rw = {};
    this.buildFinish();
    this.buildJudgeTables();
    this.buildBoard();
    this.buildWater();
    this.buildPenalty();
  }

  buildFinish() {
    // 周回板（LAPS TO GO）と鐘
    const lb = boardCanvas(256, 256);
    this.rw.lap = lb;
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), new THREE.MeshLambertMaterial({ color: 0x30343c }));
    post.position.y = 1.1;
    g.add(post);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: lb.tex, toneMapped: false }));
    scr.position.set(0, 2.9, 0.08);
    g.add(scr);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.62, 1.62, 0.12), new THREE.MeshLambertMaterial({ color: 0x15171c }));
    back.position.set(0, 2.9, 0);
    g.add(back);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), new THREE.MeshStandardMaterial({ color: 0xd9a531, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }));
    bell.position.set(0.95, 2.1, 0.1);
    g.add(bell);
    this.rw.bell = bell;
    placeOnTrack(g, LAP_BOARD.s, LAP_BOARD.y, 0, 'back');
    this.add(g);
    // レースの時計（フィニッシュの先の芝）
    const cb = boardCanvas(512, 128);
    this.rw.clock = cb;
    const cg = new THREE.Group();
    const cpost = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.1), new THREE.MeshLambertMaterial({ color: 0x30343c }));
    cpost.position.y = 0.8;
    cg.add(cpost);
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshBasicMaterial({ map: cb.tex, toneMapped: false }));
    cs.position.set(0, 1.85, 0.06);
    cg.add(cs);
    const cbk = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.65, 0.1), new THREE.MeshLambertMaterial({ color: 0x0c0d12 }));
    cbk.position.set(0, 1.85, 0);
    cg.add(cbk);
    placeOnTrack(cg, 3, -2.6, 0, 'back');
    this.add(cg);
    // フィニッシュのやぐら（写真判定のカメラ）
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.4, 1.2), new THREE.MeshLambertMaterial({ color: 0xe8e8ee }));
    tower.position.set(SX, 1.7, RM + TRACK.lanes * TRACK.lane + 2.2);
    this.add(tower);
    this.drawLap(5);
    this.drawClock2(31 * 60 + 46.2);
  }

  buildJudgeTables() {
    const tm = new THREE.MeshLambertMaterial({ color: 0xf0f0f4 });
    const um = new THREE.MeshLambertMaterial({ color: 0x1d4fa8, side: THREE.DoubleSide });
    for (const j of JUDGES) {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.6), tm);
      top.position.set(0.85, 0.74, -0.35);
      g.add(top);
      for (const [x, z] of [[0.45, -0.6], [1.25, -0.6], [0.45, -0.1], [1.25, -0.1]]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.72, 0.04), tm);
        l.position.set(x, 0.36, z);
        g.add(l);
      }
      // パラソル
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.3, 6), tm);
      pole.position.set(0.85, 1.15, -0.35);
      g.add(pole);
      const um1 = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.35, 10, 1, true), um);
      um1.position.set(0.85, 2.3, -0.35);
      g.add(um1);
      // 番号札
      const nb = boardCanvas(128, 64);
      nb.g.fillStyle = '#ffd23f';
      nb.g.fillRect(0, 0, 128, 64);
      nb.g.fillStyle = '#05060f';
      nb.g.font = 'bold 40px "Chakra Petch", sans-serif';
      nb.g.textAlign = 'center';
      nb.g.fillText(`J${j.id}`, 64, 47);
      nb.tex.needsUpdate = true;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshBasicMaterial({ map: nb.tex }));
      sign.position.set(0.85, 0.6, -0.04);
      g.add(sign);
      placeOnTrack(g, j.s, j.y - 0.3, 0, 'out');
      this.add(g);
    }
  }

  // 警告掲示板（赤カード）
  buildBoard() {
    const bc = boardCanvas(512, 384);
    this.rw.board = bc;
    const g = new THREE.Group();
    for (const x of [-1.1, 1.1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), new THREE.MeshLambertMaterial({ color: 0x30343c }));
      l.position.set(x, 0.6, 0);
      g.add(l);
    }
    const s = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), new THREE.MeshBasicMaterial({ map: bc.tex, toneMapped: false }));
    s.position.set(0, 2.0, 0.05);
    g.add(s);
    const bk = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.9, 0.08), new THREE.MeshLambertMaterial({ color: 0x0c0d12 }));
    bk.position.set(0, 2.0, 0);
    g.add(bk);
    placeOnTrack(g, BOARD.s, BOARD.y, 0, 'back');
    g.rotation.y += 0.55; // 来る選手の方へ少し向ける
    this.add(g);
    this.drawBoard([]);
  }

  buildWater() {
    const g = new THREE.Group();
    const tm = new THREE.MeshLambertMaterial({ color: 0xf2f2f6 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.7), tm);
    top.position.y = 0.76;
    g.add(top);
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.5, 0.72), new THREE.MeshLambertMaterial({ color: 0x1d4fa8 }));
    cloth.position.y = 0.5;
    g.add(cloth);
    const bm = [new THREE.MeshLambertMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.85 }), new THREE.MeshLambertMaterial({ color: 0xffd23f }), new THREE.MeshLambertMaterial({ color: 0xffffff })];
    const bg = new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8);
    for (let i = 0; i < 14; i++) {
      const b = new THREE.Mesh(bg, bm[i % 3]);
      b.position.set(-1.15 + (i % 7) * 0.38, 0.9, i < 7 ? -0.15 : 0.15);
      g.add(b);
    }
    const sb = boardCanvas(256, 64);
    sb.g.fillStyle = '#1d4fa8';
    sb.g.fillRect(0, 0, 256, 64);
    sb.g.fillStyle = '#ffffff';
    sb.g.font = 'bold 40px "Chakra Petch", sans-serif';
    sb.g.textAlign = 'center';
    sb.g.fillText('WATER', 128, 47);
    sb.tex.needsUpdate = true;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: sb.tex }));
    sign.position.set(0, 0.5, 0.37);
    g.add(sign);
    placeOnTrack(g, WATER.s, WATER.y + 0.4, 0, 'in');
    this.add(g);
  }

  buildPenalty() {
    const g = new THREE.Group();
    // 白線の四角（進む向きに 4m × 横 2.4m）
    const lm = new THREE.MeshBasicMaterial({ color: 0xf6f6f6 });
    for (const [w, d, x, z] of [[2.4, 0.06, 0, -2], [2.4, 0.06, 0, 2], [0.06, 4, -1.2, 0], [0.06, 4, 1.2, 0]]) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lm);
      l.rotation.x = -Math.PI / 2;
      l.position.set(x, 0.025, z);
      g.add(l);
    }
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4), new THREE.MeshBasicMaterial({ color: 0xc3122f, transparent: true, opacity: 0.22 }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.022;
    g.add(fill);
    // 看板 + 残り秒（ゾーンの先・来る選手の方を向く）
    const pb = boardCanvas(512, 160);
    this.rw.penalty = pb;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.69), new THREE.MeshBasicMaterial({ map: pb.tex, toneMapped: false }));
    sign.position.set(0, 1.7, 2.25);
    sign.rotation.y = Math.PI;
    g.add(sign);
    for (const x of [-0.9, 0.9]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 0.06), new THREE.MeshLambertMaterial({ color: 0x30343c }));
      l.position.set(x, 0.7, 2.28);
      g.add(l);
    }
    const cm = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
    for (const [x, z] of [[-1.2, -2], [1.2, -2], [-1.2, 2], [1.2, 2]]) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.42, 10), cm);
      c.position.set(x, 0.21, z);
      g.add(c);
    }
    placeOnTrack(g, PENALTY.s, PENALTY.y, 0, 'fwd');
    this.add(g);
    this.drawPenalty(null);
  }

  // ---- 描きかえ
  replaceLed() {
    if (this.ledMat) {
      this.ledMat.map = ledCanvas();
      this.ledMat.needsUpdate = true;
    }
  }

  drawLap(n) {
    const { g, tex } = this.rw.lap;
    g.fillStyle = '#05060f';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#ffd23f';
    g.font = 'bold 30px "Chakra Petch", sans-serif';
    g.textAlign = 'center';
    g.fillText(n <= 1 ? 'LAST LAP' : 'LAPS TO GO', 128, 46);
    g.fillStyle = n <= 1 ? '#ff3d3d' : '#ffffff';
    g.font = 'bold 170px "Chakra Petch", sans-serif';
    g.fillText(String(Math.max(0, n)), 128, 215);
    tex.needsUpdate = true;
  }

  drawClock2(sec) {
    const { g, tex } = this.rw.clock;
    g.fillStyle = '#05060f';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#ffd23f';
    g.font = 'bold 96px "Chakra Petch", monospace';
    g.textAlign = 'center';
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    g.fillText(`${m}:${s.toFixed(1).padStart(4, '0')}`, 256, 100);
    tex.needsUpdate = true;
  }

  // entries: [{ bib, short, red, marks: ['~','<',...] }]
  drawBoard(entries) {
    const { g, tex } = this.rw.board;
    g.fillStyle = '#06070c';
    g.fillRect(0, 0, 512, 384);
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, 512, 56);
    g.fillStyle = '#05060f';
    g.font = 'bold 34px "Chakra Petch", sans-serif';
    g.textAlign = 'center';
    g.fillText('WARNING BOARD', 256, 41);
    g.textAlign = 'left';
    const rows = entries.filter((e) => e.red > 0).slice(0, 6);
    if (!rows.length) {
      g.fillStyle = '#5a6070';
      g.font = 'bold 30px "Chakra Petch", sans-serif';
      g.fillText('— NO RED CARDS —', 110, 210);
    }
    rows.forEach((e, i) => {
      const y = 100 + i * 48;
      g.fillStyle = '#ffffff';
      g.font = 'bold 34px "Chakra Petch", sans-serif';
      g.fillText(String(e.bib).padStart(3, ' '), 24, y + 12);
      g.font = 'bold 26px "Dela Gothic One", sans-serif';
      g.fillText(e.short, 100, y + 10);
      for (let k = 0; k < Math.min(4, e.red); k++) {
        g.fillStyle = '#e8132e';
        g.fillRect(340 + k * 40, y - 20, 32, 40);
        g.fillStyle = '#ffffff';
        g.font = 'bold 26px "Chakra Petch", sans-serif';
        g.fillText(e.marks[k] ?? '~', 347 + k * 40, y + 9);
      }
    });
    tex.needsUpdate = true;
  }

  drawPenalty(sec) {
    const { g, tex } = this.rw.penalty;
    g.fillStyle = '#c3122f';
    g.fillRect(0, 0, 512, 160);
    g.fillStyle = '#ffffff';
    g.font = 'bold 50px "Chakra Petch", sans-serif';
    g.textAlign = 'center';
    g.fillText('PENALTY ZONE', 256, 66);
    if (sec != null) {
      g.font = 'bold 64px "Chakra Petch", monospace';
      g.fillText(`${Math.ceil(sec)}`, 256, 140);
    }
    tex.needsUpdate = true;
  }

  drawRaceScreen(rows, note = '') {
    // 大型ビジョン: 上位 5 人
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
    g.font = 'bold 36px "Chakra Petch", sans-serif';
    g.textAlign = 'left';
    g.fillText('MEN’S 10000m RACE WALK FINAL', 24, 44);
    g.textAlign = 'right';
    g.fillText(note, W - 24, 44);
    rows.slice(0, 5).forEach((r, i) => {
      const y = 112 + i * 66;
      g.textAlign = 'left';
      g.fillStyle = r.player ? '#ff3d7f' : '#ffffff';
      g.font = 'bold 48px "Chakra Petch", sans-serif';
      g.fillText(`${i + 1}`, 40, y + 14);
      g.font = 'bold 44px "Dela Gothic One", sans-serif';
      g.fillText(r.name, 110, y + 14);
      g.fillStyle = '#9ad8ff';
      g.font = 'bold 36px "Chakra Petch", sans-serif';
      g.fillText(r.nat, 640, y + 12);
      g.textAlign = 'right';
      g.fillStyle = '#ffd23f';
      g.fillText(r.gap, W - 40, y + 12);
    });
    tex.needsUpdate = true;
  }
}
