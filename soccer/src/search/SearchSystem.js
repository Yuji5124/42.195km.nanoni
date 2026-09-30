import * as THREE from 'three';
import { KIND, EMPTYISH } from '../crowd/SeatPlan.js';
import { TIERS } from '../stadium/StadiumLayout.js';

// 席探しのルール。
//   調べる（タップ）: 画面の点 → 座席（解析的に逆算）。その席が画面で小さすぎたら「遠すぎて見えない」。
//     指の下の数席の中から「空席っぽく見えて、今見えている席」を優先して調べる（指より細かい精度を求めない）。
//     結果: 人がいる / トイレ中の人の席 / 荷物 / 子供 / 寝ている人 / 前の人が立っていて見えない / あなたの席！
//   候補（長押し）: A B C の 3 つまで。遠くて調べられない点も登録できる。
//   ヒント: LEVEL → SIDE → BLOCK の十の位 → ROW の十の位。分かっている条件に合う席の数を数えて見せる（10 万 → 約 2 千）。
//
// 公平性: 本物の空席はいつも 1 つ。デコイは本物のすぐ隣には置かない。双眼鏡で見れば必ず判別できる距離にある。

const _ray = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _pos = new THREE.Vector3();

export const RESULT_TEXT = {
  person: ['人がいる。', '普通に人がいる。', 'めちゃくちゃ試合を見ている人だった。', '目が合った。', '人だった。'],
  temp: ['空席……じゃない。トイレに行っている人の席だった。', '売店に行っている人の席だった。', 'さっきまで人がいた席。すぐ戻ってくるらしい。'],
  bag: ['荷物が置いてあるだけだった。', 'リュックだった。', 'ユニフォームがたたんで置いてあった。'],
  kid: ['小さい子が座っていた。', '子供だった。すごく見られた。'],
  hood: ['座席と同じ色の服で寝ている人だった。', 'フードをかぶって寝ている人。この試合で？', '人だった。座席の色の服を着ている。'],
  blocked: ['前の人が立っていて見えない。', '前の人の頭で見えない。'],
  wave: ['ウェーブで見えない。', 'みんな立ち上がって見えない。'],
  far: ['遠すぎて見えない。', '小さすぎて分からない。'],
  none: ['スタンドじゃない。', '空だ。'],
  pitch: ['ピッチだ。試合は、席に座ってから見よう。', '選手がいる。……席じゃない。', 'ピッチの上に席は無い。'],
};

export class SearchSystem {
  constructor({ layout, plan, crowd, field, near, view, camera, rng }) {
    this.layout = layout;
    this.plan = plan;
    this.crowd = crowd;
    this.field = field;
    this.near = near;
    this.view = view;
    this.camera = camera;
    this.rng = rng;
    this.target = plan.target;
    this.address = layout.address(this.target);
    this.tool = 'eye';
    this.hasBinoculars = false;
    this.binoZoom = 6;
    this.pins = [];
    this.pinLetters = ['A', 'B', 'C'];
    this.pinNext = 0;
    this.checked = new Set();
    this.falseAlarms = 0;
    this.known = { level: false, side: false, block: false, row: false };
    this.found = false;
    this.lastProgress = 0;
    this.time = 0;
    this.pending = null; // 調べている途中（0.35 秒）
    this.returns = []; // トイレから戻ってくる人
    this.seatsLeft = layout.count;
    this.marks = [];
  }

  // ---- 道具
  giveBinoculars() {
    this.hasBinoculars = true;
  }

  setTool(tool) {
    if (tool === 'binoculars' && !this.hasBinoculars) return false;
    this.tool = tool;
    this.view.setZoom(tool === 'binoculars' ? this.binoZoom : 1);
    this.view.handShake = tool === 'binoculars' ? 1 : 0;
    return true;
  }

  toggleTool() {
    return this.setTool(this.tool === 'eye' ? 'binoculars' : 'eye');
  }

  zoomBy(factor) {
    if (this.tool !== 'binoculars') {
      if (factor > 1.02 && this.hasBinoculars) this.setTool('binoculars');
      return;
    }
    // 最小倍率からさらに縮めると肉眼へ戻る
    if (factor < 1 && this.binoZoom <= 4.01) {
      this.under = (this.under ?? 1) * factor;
      if (this.under < 0.8) {
        this.under = 1;
        this.setTool('eye');
      }
      return;
    }
    this.under = 1;
    this.binoZoom = Math.min(8, Math.max(4, this.binoZoom * factor));
    this.view.setZoom(this.binoZoom);
  }

  // ---- 画面の点 → 座席
  rayFrom(clientX, clientY) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    _ndc.set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1, 0.5);
    _ndc.unproject(this.camera);
    _ray.copy(_ndc).sub(this.camera.position).normalize();
    return _ray;
  }

  pickAt(clientX, clientY) {
    const r = this.rayFrom(clientX, clientY);
    const o = this.camera.position;
    const t0 = performance.now();
    const id = this.layout.pick(o.x, o.y, o.z, r.x, r.y, r.z);
    this.pickMs = performance.now() - t0;
    return id;
  }

  seatWorld(id, out = _pos) {
    return out.set(this.layout.x[id], this.layout.y[id] + 0.75, this.layout.z[id]);
  }

  // 座席の画面上の幅（CSS px）
  seatPx(id) {
    const d = this.camera.position.distanceTo(this.seatWorld(id));
    const pxPerM = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * d);
    return 0.5 * pxPerM;
  }

  screenOf(id, out = {}) {
    _pos.copy(this.seatWorld(id)).project(this.camera);
    out.x = (_pos.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-_pos.y * 0.5 + 0.5) * window.innerHeight;
    out.visible = _pos.z < 1 && _pos.z > -1 && Math.abs(_pos.x) < 1.2 && Math.abs(_pos.y) < 1.2;
    return out;
  }

  // 座席が今見えるか（前の列の人が立っている / ウェーブ）
  occlusion(id) {
    const L = this.layout;
    const wave = this.crowd.waveAt(id);
    if (wave > 0.45) return 'wave';
    const r = L.row[id];
    if (r > 0) {
      const f = L.seatInRow(L.tier[id], r - 1, L.s[id]);
      if (f >= 0 && this.plan.kind[f] === KIND.PERSON) {
        const pose = this.crowd.poseAt(f);
        if (pose[0] > 0.55) return 'blocked';
      }
    }
    return null;
  }

  // ---- 調べる
  inspect(clientX, clientY) {
    const id0 = this.pickAt(clientX, clientY);
    if (id0 < 0) {
      // 地面（ピッチ）を指した？
      const r = this.rayFrom(clientX, clientY);
      const o = this.camera.position;
      if (r.y < -0.01) {
        const t = -o.y / r.y;
        if (Math.abs(o.x + r.x * t) < 60 && Math.abs(o.z + r.z * t) < 40) return { kind: 'none', text: this.pickText('pitch') };
      }
      return { kind: 'none', text: this.pickText('none') };
    }
    const px = this.seatPx(id0);
    if (px < 2.6) {
      return { kind: 'far', seat: id0, text: this.pickText('far') + (this.hasBinoculars ? (this.tool === 'eye' ? '（双眼鏡で見よう）' : '（もっと寄れる？）') : ''), px };
    }
    // 指の下の数席の中から、空席っぽく見える席を優先
    const L = this.layout;
    const radius = Math.min(5, Math.max(0.6, 15 / px));
    const nb = L.neighbors(id0, radius, []);
    let best = -1;
    let bd = Infinity;
    const sp = {};
    for (const id of nb) {
      if (!EMPTYISH(this.plan.kind[id])) continue;
      if (this.occlusion(id)) continue;
      this.screenOf(id, sp);
      const d = Math.hypot(sp.x - clientX, sp.y - clientY);
      if (d < bd && d < 22 + px * 0.6) {
        bd = d;
        best = id;
      }
    }
    const id = best >= 0 ? best : id0;
    const kind = this.plan.kind[id];
    const occ = this.occlusion(id);
    let res;
    if (best < 0 && occ && EMPTYISH(kind)) res = { kind: occ };
    else if (kind === KIND.TARGET) res = { kind: 'target' };
    else if (kind === KIND.TEMP) res = { kind: 'temp' };
    else if (kind === KIND.BAG) res = { kind: 'bag' };
    else if (kind === KIND.KID) res = { kind: 'kid' };
    else if (kind === KIND.HOOD) res = { kind: 'hood' };
    else res = { kind: 'person' };
    res.seat = id;
    res.px = px;
    res.label = L.label(id);
    res.text = res.kind === 'target' ? 'あなたの席……！' : this.pickText(res.kind);
    if (res.kind !== 'blocked' && res.kind !== 'wave') {
      const isNew = !this.checked.has(id);
      this.checked.add(id);
      if (isNew && EMPTYISH(kind) && kind !== KIND.TARGET) this.falseAlarms++;
      if (isNew && this.inRegion(id)) this.progress();
    }
    if (res.kind === 'temp') this.scheduleReturn(id);
    if (res.kind === 'target') this.found = true;
    this.mark(id, res.kind === 'target' ? 6 : 1.6);
    return res;
  }

  pickText(kind) {
    const a = RESULT_TEXT[kind];
    return a[Math.floor(this.rng.next() * a.length)];
  }

  // トイレの人が戻ってくる（数秒後に空席っぽさが消える）
  scheduleReturn(id) {
    if (this.returns.some((r) => r.id === id)) return;
    this.returns.push({ id, at: this.time + 6 + this.rng.next() * 10 });
  }

  // 席を光らせる（最大 4 つ）
  mark(id, seconds) {
    this.marks = this.marks.filter((m) => m.id !== id);
    this.marks.push({ id, until: this.time + seconds, t0: this.time });
    if (this.marks.length > 4) this.marks.shift();
  }

  // ---- 候補
  addPin(clientX, clientY) {
    const id = this.pickAt(clientX, clientY);
    if (id < 0) return null;
    const existing = this.pins.find((p) => p.seat === id);
    if (existing) return existing;
    const letter = this.pinLetters[this.pinNext % 3];
    this.pinNext++;
    this.pins = this.pins.filter((p) => p.letter !== letter);
    const pin = { letter, seat: id, t: this.time };
    this.pins.push(pin);
    this.pins.sort((a, b) => a.letter.localeCompare(b.letter));
    if (this.inRegion(id)) this.progress();
    return pin;
  }

  // ---- ヒント
  learn(key) {
    this.known[key] = true;
    this.seatsLeft = this.countLeft();
    this.progress();
  }

  matches(id) {
    const L = this.layout;
    const a = this.address;
    const b = L.blocks[L.block[id]];
    if (this.known.level && b.tier !== a.tier) return false;
    if (this.known.side && b.side !== a.side) return false;
    if (this.known.block && Math.floor(b.number / 10) !== Math.floor(a.block / 10)) return false;
    if (this.known.row && Math.floor((L.row[id] + 1) / 10) !== Math.floor(a.row / 10)) return false;
    return true;
  }

  countLeft() {
    let n = 0;
    for (let i = 0; i < this.layout.count; i++) if (this.matches(i)) n++;
    return n;
  }

  // 分かっているヒントの範囲内か（進展の判定）
  inRegion(id) {
    const L = this.layout;
    const a = this.address;
    const b = L.blocks[L.block[id]];
    return b.tier === a.tier && b.side === a.side && Math.abs(b.number - a.block) <= 6;
  }

  progress() {
    this.lastProgress = this.time;
  }

  hintVars() {
    const a = this.address;
    const sideJp = { NORTH: '北', EAST: '東', SOUTH: '南', WEST: '西' }[a.side];
    const bd = Math.floor(a.block / 10);
    const rd = Math.floor(a.row / 10);
    return {
      LEVEL: a.level,
      LEVEL_JP: a.tier === 1 ? '上の段' : '下の段',
      COLOR: a.tier === 1 ? '青' : '赤',
      SIDE: a.side,
      SIDE_JP: sideJp,
      BD: String(bd),
      RD: rd === 0 ? '?' : `${rd}?`,
      ROW_JP: rd === 0 ? '1 桁' : `${rd}0 番台`,
    };
  }

  fill(text) {
    const v = this.hintVars();
    return text.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
  }

  ticketFields() {
    const a = this.address;
    const k = this.known;
    const bd = Math.floor(a.block / 10);
    const rd = Math.floor(a.row / 10);
    return {
      level: k.level ? a.level : '?????',
      side: k.side ? a.side : '?????',
      block: k.block ? `${bd}?` : '??',
      row: k.row ? (rd ? `${rd}?` : '?') : '??',
      seat: '?',
    };
  }

  update(dt) {
    this.time += dt;
    for (let i = this.returns.length - 1; i >= 0; i--) {
      const r = this.returns[i];
      if (this.time >= r.at) {
        this.returns.splice(i, 1);
        this.plan.kind[r.id] = KIND.PERSON;
        this.field.setKind(r.id, KIND.PERSON);
        this.near?.setKind(r.id, KIND.PERSON);
      }
    }
    // 光らせる席 → シェーダー
    this.marks = this.marks.filter((m) => m.until > this.time);
    const u = this.field.uniforms;
    const ids = [-1, -1, -1, -1];
    this.marks.forEach((m, i) => (ids[i] = m.id));
    for (const p of this.pins) if (!ids.includes(p.seat) && ids.includes(-1)) ids[ids.indexOf(-1)] = p.seat;
    u.uMark.value = ids;
    u.uMarkPulse.value = 0.55 + 0.45 * Math.sin(this.time * 7);
  }

  // 目標の席のワールド座標（案内・結果）
  targetWorld(out = new THREE.Vector3()) {
    return this.seatWorld(this.target, out);
  }

  tierName(id) {
    return TIERS[this.layout.tier[id]].name;
  }
}
