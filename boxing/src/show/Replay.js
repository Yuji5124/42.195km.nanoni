import * as THREE from 'three';
import { RING } from '../arena/BoxingArena.js';

// リプレイ: 直近 4 秒の 3 人（侍・王者・レフェリー）のポーズを毎フレーム記録しておき（関節の値だけ。約 100KB）、
// 分割画面（1 → 2 → 4 → 8 → 16）で それぞれ別のカメラ・別の速さで再生する。
//   拳カメラ・床カメラ・天井カメラ・観客のスマホ・魚眼・スーパースロー・早送り・巻き戻し・白黒 …
//   three.js の webgl_multiple_views と同じ「ビューポート + シザー」で 1 枚のキャンバスに描く（描画先を増やさない）。
//   白黒・セピアなどはセルの上の DOM の backdrop-filter（GPU の合成で軽い）。
// 選手のポーズは本物の記録だけ（リプレイで動きを作り変えない）。

const SCAL = ['x', 'y', 'z', 'yaw', 'hipY', 'hipX', 'hipZ', 'heelL', 'heelR'];
const VECS = ['hipRot', 'spine', 'chest', 'head', 'footL', 'footR', 'gloveL', 'gloveR', 'elbowL', 'elbowR', 'kneeL', 'kneeR'];
const STRIDE = SCAL.length + VECS.length * 3;
const FRAMES = 300;
const Y = RING.y;

const CELLS = [
  { cam: 'broadcast', speed: 0.5, label: 'CAM 1 · SLOW ×0.5' },
  { cam: 'close', speed: 0.25, label: 'SUPER SLOW ×0.25' },
  { cam: 'fist', speed: 0.5, label: 'FIST CAM（侍の右拳）' },
  { cam: 'floor', speed: 1, label: 'FLOOR CAM' },
  { cam: 'ceiling', speed: 1, label: 'CEILING CAM', filter: 'mono' },
  { cam: 'phone', speed: 1, label: '観客のスマホ' },
  { cam: 'reverse', speed: 2, label: '×2 FAST' },
  { cam: 'fisheye', speed: 0.5, label: 'FISHEYE' },
  { cam: 'broadcast', speed: 0.1, label: 'ULTRA SLOW ×0.1', filter: 'sepia' },
  { cam: 'orbit', speed: 0.5, label: '360°' },
  { cam: 'close', speed: -1, label: 'REWIND ◀◀' },
  { cam: 'glove', speed: 1, label: 'GLOVE CAM（王者）' },
  { cam: 'ref', speed: 0.5, label: 'REFEREE CAM' },
  { cam: 'tele', speed: 1, label: '×400', filter: 'hot' },
  { cam: 'floor', speed: 0.25, label: 'B/W SLOW', filter: 'mono' },
  { cam: 'high', speed: 4, label: '×4 FAST', filter: 'neg' },
];
const GRID = { 1: [1, 1], 2: [2, 1], 4: [2, 2], 8: [4, 2], 16: [4, 4] };

const _p = new THREE.Vector3();
const _e = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _m = new THREE.Vector3();

export class Replay {
  constructor(m) {
    this.m = m;
    this.buf = new Float32Array(FRAMES * 3 * STRIDE);
    this.times = new Float64Array(FRAMES);
    this.head = 0;
    this.len = 0;
    this.clock = 0;
    this.active = false;
    this.queued = null;
    this.count = 0;
    this.cams = [];
    for (let i = 0; i < 16; i++) {
      const c = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
      c.layers.enable(1);
      this.cams.push(c);
    }
    this.poses = [{}, {}, {}];
    this.el = document.getElementById('replay');
    this.cellsEl = document.getElementById('rpCells');
  }

  // 毎フレーム（ゲーム内の時刻で）記録
  record(dt, poses) {
    this.clock += dt;
    const o = this.head * 3 * STRIDE;
    for (let k = 0; k < 3; k++) {
      const p = poses[k];
      let j = o + k * STRIDE;
      for (const s of SCAL) this.buf[j++] = p[s] ?? 0;
      for (const v of VECS) {
        const a = p[v] ?? [0, 0, 0];
        this.buf[j++] = a[0];
        this.buf[j++] = a[1];
        this.buf[j++] = a[2];
      }
    }
    this.times[this.head] = this.clock;
    this.head = (this.head + 1) % FRAMES;
    this.len = Math.min(FRAMES, this.len + 1);
  }

  sample(t, k, out) {
    // 近いフレーム（記録は 60Hz 前後なので補間しなくても十分なめらか）
    let best = -1;
    let bd = 1e9;
    for (let i = 0; i < this.len; i++) {
      const idx = (this.head - 1 - i + FRAMES) % FRAMES;
      const d = Math.abs(this.times[idx] - t);
      if (d < bd) {
        bd = d;
        best = idx;
      } else if (this.times[idx] < t) break;
    }
    if (best < 0) return null;
    let j = best * 3 * STRIDE + k * STRIDE;
    for (const s of SCAL) out[s] = this.buf[j++];
    for (const v of VECS) {
      out[v] = out[v] ?? [0, 0, 0];
      out[v][0] = this.buf[j++];
      out[v][1] = this.buf[j++];
      out[v][2] = this.buf[j++];
    }
    return out;
  }

  // delay 秒後に始める（その後の様子も記録に入れる）
  queue(kind, { delay = 0.8, cells = null } = {}) {
    if (this.active || this.queued) return;
    this.queued = { kind, at: this.clock + delay, cells };
  }

  update(dt) {
    if (this.queued && !this.active && this.clock >= this.queued.at) {
      this.start(this.queued);
      this.queued = null;
    }
    if (!this.active) return;
    this.t += dt;
    if (this.t >= this.dur) this.stop();
  }

  start({ kind, cells }) {
    this.count++;
    const n = cells ?? [1, 2, 4, 8, 16][Math.min(4, this.count - 1)];
    this.n = n;
    this.kind = kind;
    this.clipLen = Math.min(2.2, this.clock - this.times[(this.head - this.len + FRAMES) % FRAMES] - 0.05);
    this.clipEnd = this.clock;
    this.t = 0;
    this.dur = n === 1 ? 3.6 : 4.8;
    this.active = true;
    // 1 画面目はいつも同じ（中継のスロー）、残りは毎回少しずつ違う組み合わせ
    const rest = CELLS.slice(1);
    const off = (this.count * 3) % rest.length;
    this.cells = [CELLS[0], ...rest.slice(off), ...rest.slice(0, off)].slice(0, n);
    const [cols, rows] = GRID[n];
    this.cols = cols;
    this.rows = rows;
    this.cellsEl.innerHTML = this.cells.map((c) => `<div class="rp-cell ${c.filter ?? ''}"><em>${c.label}</em></div>`).join('');
    this.layoutCells();
    document.getElementById('rpInfo').textContent = `${kind} · ${n} VIEW${n > 1 ? 'S' : ''}`;
    this.el.classList.remove('hidden');
    document.body.classList.add('replaying');
    this.m.P.bones.head.visible = true;
    this.m.audio.whoosh?.();
  }

  layoutCells() {
    const W = innerWidth;
    const H = innerHeight;
    [...this.cellsEl.children].forEach((el, i) => {
      const c = i % this.cols;
      const r = Math.floor(i / this.cols);
      el.style.left = `${(c * W) / this.cols}px`;
      el.style.top = `${(r * H) / this.rows}px`;
      el.style.width = `${W / this.cols}px`;
      el.style.height = `${H / this.rows}px`;
    });
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.el.classList.add('hidden');
    document.body.classList.remove('replaying');
    this.cellsEl.innerHTML = '';
    if (this.m.systems.primary?.id === 'fps') this.m.P.bones.head.visible = false;
    this.m.rig.cut();
  }

  // カメラ（記録の中の 2 人の位置から）
  aim(cam, kind, t) {
    const [pp, pe, pr] = this.poses;
    _p.set(pp.x, Y, pp.z);
    _e.set(pe.x, Y, pe.z);
    _d.subVectors(_e, _p).setY(0);
    if (_d.lengthSq() < 1e-6) _d.set(1, 0, 0);
    _d.normalize();
    _r.set(-_d.z, 0, _d.x);
    _m.addVectors(_p, _e).multiplyScalar(0.5);
    let fov = 40;
    const look = new THREE.Vector3(_m.x, Y + 1.25, _m.z);
    switch (kind) {
      case 'broadcast':
        cam.position.copy(_m).addScaledVector(_r, -6.5).setY(Y + 2.4);
        fov = 28;
        break;
      case 'close':
        cam.position.copy(_p).addScaledVector(_d, -0.9).addScaledVector(_r, 0.45).setY(Y + 1.6);
        look.set(_e.x, Y + 1.5, _e.z);
        fov = 26;
        break;
      case 'fist': {
        this.m.P.root.updateMatrixWorld(true);
        this.m.E.root.updateMatrixWorld(true);
        const g = this.m.P.gloveWorld('R', new THREE.Vector3());
        cam.position.copy(g).addScaledVector(_d, -0.12);
        this.m.E.headWorld(look);
        fov = 70;
        break;
      }
      case 'glove': {
        this.m.P.root.updateMatrixWorld(true);
        this.m.E.root.updateMatrixWorld(true);
        const g = this.m.E.gloveWorld('L', new THREE.Vector3());
        cam.position.copy(g).addScaledVector(_d, 0.12);
        this.m.P.headWorld(look);
        fov = 70;
        break;
      }
      case 'floor':
        cam.position.copy(_m).addScaledVector(_r, 1.4).setY(Y + 0.08);
        look.y = Y + 1.4;
        fov = 60;
        break;
      case 'ceiling':
        cam.position.set(_m.x + 0.01, Y + 7, _m.z);
        look.set(_m.x, Y, _m.z);
        fov = 34;
        break;
      case 'phone':
        cam.position.set(0.9 + Math.sin(t * 7) * 0.02, 1.45 + Math.sin(t * 5) * 0.02, 7.6);
        fov = 18;
        break;
      case 'reverse':
        cam.position.copy(_e).addScaledVector(_d, 2.3).addScaledVector(_r, -0.6).setY(Y + 1.7);
        fov = 44;
        break;
      case 'fisheye':
        cam.position.copy(_m).addScaledVector(_r, 1.1).setY(Y + 1.5);
        fov = 118;
        break;
      case 'orbit': {
        const a = t * 1.2;
        cam.position.set(_m.x + Math.cos(a) * 3, Y + 1.4, _m.z + Math.sin(a) * 3);
        fov = 40;
        break;
      }
      case 'ref':
        cam.position.set(pr.x, Y + 1.7, pr.z);
        fov = 55;
        break;
      case 'tele':
        cam.position.set(-8, 25, -40);
        fov = 4.5;
        break;
      default:
        cam.position.set(5, Y + 6, -5);
        fov = 32;
    }
    cam.fov = fov;
    cam.up.set(0, 1, 0);
    if (kind === 'ceiling') cam.up.set(_d.x, 0, _d.z);
    cam.lookAt(look);
  }

  // 分割画面を描く（ポストエフェクトなし・直接キャンバスへ）
  render(renderer, scene, field) {
    const W = innerWidth;
    const H = innerHeight;
    const pr = renderer.getPixelRatio();
    const models = [this.m.P, this.m.E, this.m.R];
    renderer.setScissorTest(true);
    this.cells.forEach((c, i) => {
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      const w = W / this.cols;
      const h = H / this.rows;
      const x = col * w;
      const y = H - (row + 1) * h;
      const len = this.clipLen;
      let local = (this.t * Math.abs(c.speed)) % len;
      if (c.speed < 0) local = len - local;
      const ts = this.clipEnd - len + local;
      for (let k = 0; k < 3; k++) {
        if (this.sample(ts, k, this.poses[k])) models[k].apply(this.poses[k]);
      }
      const cam = this.cams[i];
      this.aim(cam, c.cam, this.t);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      field.uniforms.uPxScale.value = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
      renderer.setViewport(x, y, w, h);
      renderer.setScissor(x, y, w, h);
      renderer.render(scene, cam);
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
  }
}
