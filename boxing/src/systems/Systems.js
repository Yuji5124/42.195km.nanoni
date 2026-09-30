import * as THREE from 'three';
import { RING } from '../arena/BoxingArena.js';

// ボクシングの「ゲームシステム」。試合（FightCore の HP・ラウンド・相手）はそのまま、ここだけが入れ替わる。
// 1 つのシステム = カメラ + 見た目（ポストエフェクト）+ 画面（DOM）+ 操作の読み替え + ルールの一部。
//
//   id        名前（CURRENT BOXING SYSTEM に出す）
//   3d        普通の 3D（肩越し）
//   counter   正面固定 · よけてから打て（相手は常にガード。カウンターだけ通る）
//   side      横スクロール（平行投影）· A D で前後に動く。間合いでよける
//   top       真上から（作戦盤）· A D で相手の周りを回り込む。赤い円から出ればよけられる
//   fps       一人称 · 自分の拳しか見えない
//   rhythm    リズムゲーム · 拍に合わせて打つと 2 倍 / 相手も拍で打ってくる
//   slow      スーパースロー · 全部 0.35 倍
//   8bit      ファミコン風 · 画素・減色・音も 8bit
//   tv        テレビ中継 · カメラが勝手に切り替わる
//   cctv      監視カメラ · 天井の隅の 4 台
//   phone     観客のスマホの縦動画
//   qte       クイックタイムイベント · 出たボタンを押せば必ずよける
//   tele      超望遠 · 一番上の席から ×400
//
// 重ね（FINAL）: 1 つ目がカメラと操作、2 つ目以降は見た目・画面・ルールを足す。
// 操作はどれでも A/D（←/→）・J・K・L・Space のまま。意味が少し変わるだけ（横スクロールでは A D が前後 など）。

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const Y = RING.y;

// 2 人の位置と向き（ワールド）
export function fightGeo(m, out = {}) {
  const P = m.core.player;
  const E = m.core.enemy;
  out.p = (out.p ?? new THREE.Vector3()).set(P.x, Y, P.z);
  out.e = (out.e ?? new THREE.Vector3()).set(E.x, Y, E.z);
  out.dir = (out.dir ?? new THREE.Vector3()).subVectors(out.e, out.p).setY(0);
  if (out.dir.lengthSq() < 1e-6) out.dir.set(1, 0, 0);
  out.dir.normalize();
  out.right = (out.right ?? new THREE.Vector3()).set(-out.dir.z, 0, out.dir.x);
  out.mid = (out.mid ?? new THREE.Vector3()).addVectors(out.p, out.e).multiplyScalar(0.5);
  return out;
}
const G = {};

const KEYS_BASE = [
  ['A D', 'よける'],
  ['J', '左'],
  ['K', '右'],
  ['L', 'ガード'],
  ['SPACE', 'アッパー'],
];

export class BoxSystem {
  constructor(m) {
    this.m = m;
    this.t = 0;
    this.el = null;
    this.acts = 0; // このシステムで成功した行動（慣れの目安）
  }

  get keys() {
    return KEYS_BASE;
  }

  enter() {
    if (this.html) {
      this.el = document.createElement('div');
      this.el.className = `ov-${this.id}`;
      this.el.innerHTML = this.html;
      this.m.layer.appendChild(this.el);
    }
  }

  exit() {
    this.el?.remove();
    this.el = null;
  }

  input(raw) {
    return raw;
  }

  camera(rig, dt) {
    chase(this.m, rig, dt);
  }

  update(dt) {
    this.t += dt;
  }

  onFight() {}

  $(sel) {
    return this.el?.querySelector(sel);
  }
}

// ---- カメラの部品
function chase(m, rig, dt, { back = 2.3, side = 0.95, up = 1.95, fov = 48, rate = 5 } = {}) {
  fightGeo(m, G);
  _a.copy(G.p).addScaledVector(G.dir, -back).addScaledVector(G.right, side);
  _a.y = Y + up;
  _b.copy(G.e).multiplyScalar(0.7).addScaledVector(G.p, 0.3);
  _b.y = Y + 1.3;
  rig.aim(_a, _b, fov, rate, dt);
}

// ==================================================================
class ThreeD extends BoxSystem {
  id = '3d';
  name = '3D';
  sub = '普通の 3D ボクシング';
  look = 'clean';
  rules = { mode: 'fixed' };
}

// 正面固定 · よけてカウンター（Punch-Out!! の文法）。自分は半透明
class Counter extends BoxSystem {
  id = 'counter';
  name = 'COUNTER';
  sub = '正面固定 · よけてから打て';
  look = 'clean';
  rules = { mode: 'fixed', still: true, tellScale: 1.2, counterMul: 3, enemyGuardAlways: true };
  html = `<div class="ring"></div><div class="ov-hint">相手はずっとガード。<b>よけた直後</b>だけパンチが通る</div><div class="cc-banner">COUNTER CHANCE!</div>`;
  get keys() {
    return [
      ['A D', 'よける'],
      ['J K', 'カウンター'],
      ['L', 'ガード'],
    ];
  }
  enter() {
    super.enter();
    this.m.setGhost(true);
  }
  exit() {
    super.exit();
    this.m.setGhost(false);
  }
  camera(rig, dt) {
    fightGeo(this.m, G);
    _a.copy(G.p).addScaledVector(G.dir, -1.7);
    _a.y = Y + 2.05;
    _b.copy(G.e);
    _b.y = Y + 1.28;
    rig.aim(_a, _b, 46, 10, dt);
  }
  update(dt) {
    super.update(dt);
    this.$('.cc-banner')?.classList.toggle('on', this.m.core.counterWindow > 0);
  }
}

// 横スクロール（平行投影）
class Side extends BoxSystem {
  id = 'side';
  name = 'SIDE VIEW';
  sub = '横スクロール · A D で前後';
  look = 'clean';
  rules = { mode: 'axis' };
  html = `<div class="side-floor"></div><div class="side-top">1P ─ VS ─ CPU</div><div class="ov-hint">A D で<b>前後</b>に動く · 下がれば よけられる</div>`;
  get keys() {
    return [
      ['A', 'さがる'],
      ['D', 'すすむ'],
      ['J K', 'パンチ'],
      ['L', 'ガード'],
    ];
  }
  enter() {
    super.enter();
    const c = this.m.core;
    const cx = Math.max(-1.2, Math.min(1.2, (c.player.x + c.enemy.x) / 2));
    c.player.x = cx - 0.65;
    c.enemy.x = cx + 0.65;
    c.player.z = c.enemy.z = 0;
    c.axis = 0;
    this.m.rig.ortho.near = 8.2; // 手前の客席・エプロンを切る（z > 3.8m は写らない）
    this.m.arena.setNearRopes(false); // 手前のロープは消す（2D の格闘ゲームにロープは無い）
    this.m.rig.cut();
  }
  exit() {
    super.exit();
    this.m.rig.ortho.near = 0.05;
    this.m.arena.setNearRopes(true);
    this.m.rig.cut();
  }
  input(raw) {
    return { ...raw, slip: 0 };
  }
  camera(rig, dt) {
    fightGeo(this.m, G);
    _a.set(G.mid.x, Y + 1.05, 12);
    _b.set(G.mid.x, Y + 1.05, 0);
    rig.aimOrtho(_a, _b, 1.5, null, 6, dt);
  }
}

// 真上（作戦盤）
class Top extends BoxSystem {
  id = 'top';
  name = 'TOP VIEW';
  sub = '真上から · A D で回り込む';
  look = 'clean';
  rules = { mode: 'circle', tellScale: 1.1 };
  html = `<div class="grid"></div><div class="ov-hint">赤い円が出たら <b>A D で回り込んで</b>円の外へ</div><div class="tac">TACTICAL BOARD · 1 : 40</div>`;
  get keys() {
    return [
      ['A D', '回り込む'],
      ['J K', 'パンチ'],
      ['L', 'ガード'],
    ];
  }
  enter() {
    super.enter();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0.8, depthWrite: false });
    this.mark = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.5, 40), mat);
    this.mark.rotation.x = -Math.PI / 2;
    this.mark.visible = false;
    this.m.scene.add(this.mark);
    this.m.rig.cut();
  }
  exit() {
    super.exit();
    this.m.scene.remove(this.mark);
    this.mark.geometry.dispose();
    this.mark.material.dispose();
    this.m.rig.cut();
  }
  input(raw) {
    return { ...raw, slip: 0 };
  }
  camera(rig, dt) {
    fightGeo(this.m, G);
    _a.set(G.mid.x * 0.6, Y + 6.2, G.mid.z * 0.6); // 吊り下げビジョン・トラスより下
    _b.set(G.mid.x * 0.6, Y, G.mid.z * 0.6);
    rig.aimOrtho(_a, _b, 2.5, _c.set(0, 0, -1), 5, dt);
  }
  update(dt) {
    super.update(dt);
    const a = this.m.core.enemyPlan.attack;
    this.mark.visible = !!a && this.m.core.enemy.action === 'tell';
    if (a) {
      this.mark.position.set(a.tellPos.x, Y + 0.03, a.tellPos.z);
      const k = a.t / a.tell;
      this.mark.scale.setScalar(1.6 - k * 0.6);
      this.mark.material.opacity = 0.4 + k * 0.5;
    }
  }
}

// 一人称
class Fps extends BoxSystem {
  id = 'fps';
  name = 'FIRST PERSON';
  sub = '一人称 · 自分の拳しか見えない';
  look = 'clean';
  rules = { mode: 'fixed' };
  html = `<div class="cross"></div><div class="radar"><i class="me"></i><i class="en"></i></div><div class="feed"></div><div class="ammo">∞<small>PUNCH</small></div>`;
  enter() {
    super.enter();
    this.m.P.bones.head.visible = false;
    this.m.rig.cut();
  }
  exit() {
    super.exit();
    this.m.P.bones.head.visible = true;
    this.m.rig.cut();
  }
  camera(rig, dt) {
    fightGeo(this.m, G);
    this.m.P.bones.head.getWorldPosition(_a);
    _a.addScaledVector(G.dir, 0.1);
    _a.y += 0.06;
    this.m.E.headWorld(_b);
    _b.y -= 0.12;
    rig.aim(_a, _b, 72, Infinity, dt);
  }
  onFight(ev) {
    const feed = this.$('.feed');
    if (!feed) return;
    let txt = null;
    if (ev.type === 'land' && ev.who === 'player') txt = `侍 ▸ ${ev.punch.toUpperCase()} ▸ 王者${ev.counter ? ' ✦' : ''}`;
    else if (ev.type === 'perfect') txt = '侍 ▸ DODGE ▸ PERFECT';
    else if (ev.type === 'hit') txt = `王者 ▸ ${ev.attack.toUpperCase()} ▸ 侍`;
    if (!txt) return;
    const d = document.createElement('div');
    d.textContent = txt;
    feed.prepend(d);
    while (feed.children.length > 4) feed.lastChild.remove();
  }
  update(dt) {
    super.update(dt);
    const c = this.m.core;
    const en = this.$('.radar .en');
    if (en) {
      // 自分から見た相手（いつも真上 = 正面）
      const d = c.dist;
      en.style.transform = `translate(0, ${-d * 26}px)`;
    }
  }
}

// リズムゲーム（120 BPM）
const BPM = 120;
const BEAT = 60 / BPM;
class Rhythm extends BoxSystem {
  id = 'rhythm';
  name = 'RHYTHM';
  sub = 'リズムに合わせて打つと 2 倍';
  look = 'neon';
  html = `<div class="lane"><div class="judge"></div></div><div class="rj"></div><div class="combo">0<small>COMBO</small></div>`;
  constructor(m) {
    super(m);
    this.rules = { onBeat: () => this.judgeOf(), aggression: 0 };
    this.notes = [];
    this.lastBeat = -1;
    this.combo = 0;
    this.judge = null;
  }
  get keys() {
    return [
      ['♪ J K', '拍に合わせて'],
      ['A D', 'よける'],
      ['L', 'ガード'],
    ];
  }
  enter() {
    super.enter();
    this.t0 = this.m.core.time;
    const lane = this.$('.lane');
    this.pool = [];
    for (let i = 0; i < 16; i++) {
      const n = document.createElement('div');
      n.className = 'note';
      lane.appendChild(n);
      this.pool.push(n);
    }
    this.m.audio.setBeat?.(true);
  }
  exit() {
    super.exit();
    this.m.audio.setBeat?.(false);
  }
  beatPos() {
    return (this.m.core.time - this.t0) / BEAT;
  }
  judgeOf() {
    return this.judge;
  }
  input(raw) {
    if (raw.jab || raw.straight || raw.special) {
      const b = this.beatPos();
      const off = Math.abs(b - Math.round(b)) * BEAT;
      this.judge = off < 0.075 ? 'perfect' : off < 0.14 ? 'good' : 'miss';
      const rj = this.$('.rj');
      if (rj) {
        rj.textContent = this.judge === 'perfect' ? 'PERFECT ×2' : this.judge === 'good' ? 'GOOD' : 'MISS ×0.5';
        rj.style.color = this.judge === 'perfect' ? '#ffd23f' : this.judge === 'good' ? '#39e6ff' : '#ff5a6e';
      }
      this.combo = this.judge === 'miss' ? 0 : this.combo + 1;
      const co = this.$('.combo');
      if (co) co.firstChild.textContent = String(this.combo);
      if (this.judge !== 'miss') this.acts += 0.5;
    }
    return raw;
  }
  update(dt) {
    super.update(dt);
    const b = this.beatPos();
    const bi = Math.floor(b);
    if (bi !== this.lastBeat) {
      this.lastBeat = bi;
      this.m.audio.beat?.(bi);
      // 相手は 4 拍ごとに、2 拍ためて拍の頭で打つ
      if (bi % 4 === 2) {
        const types = ['jab', 'straight', 'hook', 'upper'];
        this.m.core.forceTell(types[Math.floor(bi / 4) % 4], BEAT * 2);
      }
    }
    // レーン: これから 3 秒の拍
    const lane = this.$('.lane');
    if (!lane) return;
    const W = lane.clientWidth;
    const pxPerBeat = (W - 60) / 6;
    let k = 0;
    for (let j = Math.ceil(b - 0.5); j < b + 6 && k < this.pool.length; j++, k++) {
      const n = this.pool[k];
      const x = 60 + (j - b) * pxPerBeat;
      const enemy = j % 4 === 0 && j > 0;
      n.className = `note ${enemy ? 'e' : j % 2 ? 'k' : ''}`;
      n.textContent = enemy ? 'A/D' : j % 2 ? 'K' : 'J';
      n.style.left = `${x}px`;
      n.style.display = '';
    }
    for (; k < this.pool.length; k++) this.pool[k].style.display = 'none';
  }
  onFight(ev) {
    if (ev.type === 'perfect' || ev.type === 'dodge') this.acts++;
  }
  camera(rig, dt) {
    // 音楽番組のようにゆっくり回る
    fightGeo(this.m, G);
    const a = this.t * 0.35;
    _a.copy(G.mid).add(_c.set(Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2));
    _a.y = Y + 1.5 + Math.sin(this.t * 0.9) * 0.3;
    _b.copy(G.mid);
    _b.y = Y + 1.25;
    // 自分の背中側に寄せる（相手の予備動作が見えるように）
    _d.copy(G.p).addScaledVector(G.dir, -2.4).addScaledVector(G.right, 1.2);
    _d.y = Y + 1.8;
    _a.lerp(_d, 0.55);
    rig.aim(_a, _b, 46, 4, dt);
  }
}

// スーパースロー
class Slow extends BoxSystem {
  id = 'slow';
  name = 'SUPER SLOW';
  sub = '全部スローモーション（×0.35）';
  look = 'film';
  rules = { mode: 'fixed' };
  timeScale = 0.35;
  html = `<div class="bar t"></div><div class="bar b"></div><div class="sl">SUPER SLOW ×0.35</div><div class="tc"></div>`;
  enter() {
    super.enter();
    this.m.audio.setSlow?.(true);
  }
  exit() {
    super.exit();
    this.m.audio.setSlow?.(false);
  }
  camera(rig, dt) {
    fightGeo(this.m, G);
    const a = this.t * 0.22 + 2.2;
    _a.copy(G.mid).add(_c.set(Math.cos(a) * 2.9, 0, Math.sin(a) * 2.9));
    _a.y = Y + 0.8;
    // 自分の背中側から大きく外れない
    _d.copy(G.p).addScaledVector(G.dir, -2.2).addScaledVector(G.right, 1.4);
    _d.y = Y + 0.9;
    _a.lerp(_d, 0.5);
    _b.copy(G.mid);
    _b.y = Y + 1.4;
    rig.aim(_a, _b, 36, 3, dt);
  }
  update(dt) {
    super.update(dt);
    const tc = this.$('.tc');
    if (tc) {
      const f = Math.floor(this.t * 240);
      tc.textContent = `1000fps  ${String(Math.floor(f / 24 / 60)).padStart(2, '0')}:${String(Math.floor(f / 24) % 60).padStart(2, '0')}:${String(f % 24).padStart(2, '0')}`;
    }
  }
}

// 8bit
class Bit8 extends BoxSystem {
  id = '8bit';
  name = '8BIT';
  sub = 'ファミコン風 · 音も 8bit';
  look = 'bit8';
  rules = { mode: 'fixed', still: true };
  html = `<div class="up"><b>1UP</b><span class="sc">000000</span>　HI 042195</div><div class="push">PUSH  J  K</div>`;
  enter() {
    super.enter();
    this.m.audio.chip = true;
    this.score = 0;
  }
  exit() {
    super.exit();
    this.m.audio.chip = false;
  }
  camera(rig, dt) {
    fightGeo(this.m, G);
    _a.copy(G.p).addScaledVector(G.dir, -2.4);
    _a.y = Y + 2.35;
    _b.copy(G.e);
    _b.y = Y + 1.25;
    rig.aim(_a, _b, 40, 20, dt);
  }
  onFight(ev) {
    if (ev.type === 'land' && ev.who === 'player') {
      this.score += Math.round(ev.dmg * 100);
      const sc = this.$('.sc');
      if (sc) sc.textContent = String(this.score).padStart(6, '0');
    }
  }
}

// テレビ中継: カメラが勝手に切り替わる
const TV_SHOTS = ['wide', 'ringside', 'high', 'close', 'reverse', 'jib'];
const TV_LABEL = { wide: 'CAM 1 · HARD CAM', ringside: 'CAM 4 · RINGSIDE', high: 'CAM 7 · CORNER HIGH', close: 'CAM 2 · CLOSE UP', reverse: 'CAM 5 · REVERSE', jib: 'CAM 9 · JIB' };
const NEWS = [
  '【速報】売店の焼きそば、第 2 ラウンド開始前に完売',
  '明日の天気: 晴れ。洗濯日和',
  '会場の気温 24.5℃ · 湿度 58%',
  'この試合は 48 台のカメラでお送りしています',
  '駐車場は大変混雑しています',
  'ただいま会場の Wi-Fi が混み合っています',
  '次回の放送は来週の同じ時間です',
];
class Tv extends BoxSystem {
  id = 'tv';
  name = 'TV BROADCAST';
  sub = 'テレビ中継 · カメラが勝手に切り替わる';
  look = 'broadcast';
  rules = { mode: 'fixed' };
  html = `<div class="live">● LIVE</div><div class="ch">NNN</div><div class="cam"></div><div class="ticker"><span>${NEWS.join('　　◆　　')}</span></div>`;
  enter() {
    super.enter();
    this.shot = 'wide';
    this.next = 3;
    this.m.rig.cut();
    this.label();
  }
  label() {
    const c = this.$('.cam');
    if (c) c.textContent = TV_LABEL[this.shot];
  }
  cutTo(s) {
    this.shot = s;
    this.next = 2.6 + Math.random() * 1.8;
    this.m.rig.cut();
    this.label();
  }
  update(dt) {
    super.update(dt);
    this.next -= dt;
    if (this.next <= 0) {
      let s = this.shot;
      while (s === this.shot) s = TV_SHOTS[Math.floor(Math.random() * TV_SHOTS.length)];
      this.cutTo(s);
    }
  }
  onFight(ev) {
    if (ev.type === 'land' && ev.who === 'player' && ev.counter && this.shot !== 'close') this.cutTo('close');
    if (ev.type === 'down') this.cutTo('wide');
  }
  camera(rig, dt) {
    fightGeo(this.m, G);
    const t = this.t;
    let fov = 40;
    switch (this.shot) {
      case 'wide':
        _a.copy(G.mid).addScaledVector(G.right, 7.5);
        _a.y = Y + 2.7;
        fov = 26;
        break;
      case 'ringside':
        _a.copy(G.mid).addScaledVector(G.right, 3.6).addScaledVector(G.dir, 0.8);
        _a.y = Y + 0.35;
        fov = 44;
        break;
      case 'high':
        _a.set(5.2, Y + 6.2, -5.2);
        fov = 30;
        break;
      case 'close':
        _a.copy(G.p).addScaledVector(G.dir, -0.9).addScaledVector(G.right, 0.4);
        _a.y = Y + 1.62;
        fov = 24;
        break;
      case 'reverse':
        _a.copy(G.e).addScaledVector(G.dir, 2.4).addScaledVector(G.right, -0.7);
        _a.y = Y + 1.8;
        fov = 44;
        break;
      default:
        _a.copy(G.mid).add(_c.set(Math.sin(t * 0.3) * 4, 0, Math.cos(t * 0.3) * 4));
        _a.y = Y + 4.5;
        fov = 40;
    }
    _b.copy(this.shot === 'close' ? G.e : G.mid);
    _b.y = Y + (this.shot === 'close' ? 1.5 : 1.25);
    rig.aim(_a, _b, fov, 6, dt);
  }
}

// 監視カメラ
const CCTV_CAMS = [
  [4.7, -4.7, 'CAM 01 · RING NE'],
  [-4.7, -4.7, 'CAM 02 · RING NW'],
  [-4.7, 4.7, 'CAM 03 · RING SW'],
  [4.7, 4.7, 'CAM 04 · RING SE'],
];
class Cctv extends BoxSystem {
  id = 'cctv';
  name = 'SECURITY CAM';
  sub = '監視カメラ · 天井の隅から';
  look = 'cctv';
  rules = { mode: 'fixed' };
  html = `<div class="c-l"></div><div class="c-r">● REC</div><div class="c-t"></div>`;
  enter() {
    super.enter();
    this.cam = 0;
    this.next = 4.5;
    this.m.rig.cut();
  }
  update(dt) {
    super.update(dt);
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 4.5;
      this.cam = (this.cam + 1) % 4;
      this.m.rig.cut();
      this.m.fx.glitchBurst(0.5);
    }
    const l = this.$('.c-l');
    if (l) l.textContent = CCTV_CAMS[this.cam][2];
    const tt = this.$('.c-t');
    if (tt) {
      const d = new Date();
      tt.textContent = `2026-09-30  ${d.toTimeString().slice(0, 8)}`;
    }
  }
  camera(rig, dt) {
    fightGeo(this.m, G);
    const [x, z] = CCTV_CAMS[this.cam];
    _a.set(x, Y + 6.1, z);
    _b.copy(G.mid);
    _b.y = Y + 0.9;
    rig.aim(_a, _b, 76, 3, dt);
  }
}

// 観客のスマホ（縦動画の配信）
const COMMENTS = ['うおおお', '今のよけ方すご', '侍ーーー！', '音量上げて', 'どこの席？', '王者つよい', '手ブレ', 'ズームして', '8888888', 'いま何ラウンド？', '会場あつい', '神回', 'カメラ止めないで', 'スローで見たい'];
const NAMES = ['user_42', 'ringside_mi', 'boxing_nanoni', 'たこ焼き', 'GONG', 'koharu', 'sam_fan', '会場の人'];
class Phone extends BoxSystem {
  id = 'phone';
  name = 'SMARTPHONE LIVE';
  sub = '観客のスマホの縦動画';
  look = 'phone';
  rules = { mode: 'fixed' };
  html = `<div class="ph"><div class="ph-top"><span class="ph-live">LIVE</span><span class="ph-view">👁 1.2万</span><span>🔋 12%</span></div><div class="ph-com"></div></div>`;
  enter() {
    super.enter();
    this.next = 0.5;
    this.viewers = 12000;
    this.zoomT = 6;
    this.zoom = 0;
    this.m.rig.cut();
  }
  update(dt) {
    super.update(dt);
    this.m.rig.handheld = 1;
    this.next -= dt;
    this.viewers += dt * (40 + this.m.hype * 900);
    const v = this.$('.ph-view');
    if (v) v.textContent = `👁 ${(this.viewers / 10000).toFixed(1)}万`;
    if (this.next <= 0) {
      this.next = 0.6 + Math.random() * 1.1;
      const box = this.$('.ph-com');
      if (box) {
        const d = document.createElement('div');
        d.innerHTML = `<b>${NAMES[Math.floor(Math.random() * NAMES.length)]}</b>${COMMENTS[Math.floor(Math.random() * COMMENTS.length)]}`;
        box.appendChild(d);
        while (box.children.length > 6) box.firstChild.remove();
      }
      if (Math.random() < 0.5) this.heart();
    }
    // ときどき ズームしすぎる
    this.zoomT -= dt;
    if (this.zoomT <= 0) {
      this.zoom = this.zoom ? 0 : 1;
      this.zoomT = this.zoom ? 1.6 : 5 + Math.random() * 3;
    }
  }
  heart() {
    const ph = this.$('.ph');
    if (!ph) return;
    const h = document.createElement('div');
    h.className = 'ph-heart';
    h.textContent = '♥';
    ph.appendChild(h);
    setTimeout(() => h.remove(), 1700);
  }
  onFight(ev) {
    if (ev.type === 'land' || ev.type === 'perfect') this.heart();
  }
  exit() {
    super.exit();
    this.m.rig.handheld = 0;
  }
  camera(rig, dt) {
    fightGeo(this.m, G);
    _a.set(0.9, 1.45, 7.6);
    _b.copy(G.mid);
    _b.y = Y + 1.2;
    rig.aim(_a, _b, this.zoom ? 11 : 30, 3, dt);
  }
}

// QTE
const QTE_KEYS = [
  ['A', 'KeyA'],
  ['D', 'KeyD'],
  ['L', 'KeyL'],
];
class Qte extends BoxSystem {
  id = 'qte';
  name = 'QUICK TIME EVENT';
  sub = 'ボタンが出たら押す';
  look = 'film';
  html = `<div class="q"><span></span><i></i></div><div class="qh"></div>`;
  constructor(m) {
    super(m);
    this.rules = { mode: 'fixed', tellScale: 1.15, dodgeHook: () => (this.ok ? 'perfect' : null) };
    this.prompt = null;
    this.ok = false;
  }
  get keys() {
    return [
      ['出たボタン', '押す'],
      ['J K', 'パンチ'],
    ];
  }
  onFight(ev) {
    if (ev.type === 'tell') {
      const k = QTE_KEYS[Math.floor(Math.random() * QTE_KEYS.length)];
      this.prompt = { label: k[0], code: k[1], dur: ev.duration, t: 0 };
      this.ok = false;
      this.fail = false;
    }
    if (ev.type === 'perfect' || ev.type === 'dodge' || ev.type === 'hit' || ev.type === 'guardHit') {
      if (this.ok) this.acts++;
      this.prompt = null;
    }
  }
  input(raw) {
    const p = this.prompt;
    if (p && !this.ok && !this.fail) {
      const pressed = this.m.input.wasPressed(p.code);
      const other = QTE_KEYS.some(([, c]) => c !== p.code && this.m.input.wasPressed(c));
      if (pressed) {
        this.ok = true;
        this.m.audio.qte?.(true);
      } else if (other) {
        this.fail = true;
        this.m.audio.qte?.(false);
      }
    }
    return raw;
  }
  update(dt) {
    super.update(dt);
    const q = this.$('.q');
    if (!q) return;
    const p = this.prompt;
    q.classList.toggle('on', !!p);
    q.classList.toggle('ok', this.ok);
    if (p) {
      p.t += dt;
      q.firstChild.textContent = this.fail ? '×' : p.label;
      q.lastChild.style.setProperty('--s', String(Math.max(1, 1.9 - (p.t / p.dur) * 0.9)));
    }
    const h = this.$('.qh');
    if (h) h.textContent = p ? (this.ok ? 'SUCCESS — 自動でよける' : this.fail ? 'ちがうボタン' : `${p.label} を押せ`) : this.m.core.counterWindow > 0 ? 'J / K でカウンター' : '';
  }
  camera(rig, dt) {
    fightGeo(this.m, G);
    // 映画のような低めの斜め
    _a.copy(G.p).addScaledVector(G.dir, -2.0).addScaledVector(G.right, 1.3);
    _a.y = Y + 1.1;
    _b.copy(G.e);
    _b.y = Y + 1.45;
    rig.aim(_a, _b, 38, 4, dt);
  }
}

// 超望遠
class Tele extends BoxSystem {
  id = 'tele';
  name = 'TELEPHOTO ×400';
  sub = '一番上の席から超望遠';
  look = 'tele';
  rules = { mode: 'fixed', tellScale: 1.1 };
  html = `<div class="rt"></div><div class="zm">×400 · 距離 52m · AF</div>`;
  enter() {
    super.enter();
    this.m.rig.cut();
  }
  exit() {
    super.exit();
    this.m.rig.handheld = 0;
  }
  update(dt) {
    super.update(dt);
    this.m.rig.handheld = 0.7;
  }
  camera(rig, dt) {
    fightGeo(this.m, G);
    _a.set(-8, 25, -40);
    _b.copy(G.mid);
    _b.y = Y + 1.2;
    rig.aim(_a, _b, 4.2, 2.6, dt);
  }
}

export const SYSTEM_CLASSES = { '3d': ThreeD, counter: Counter, side: Side, top: Top, fps: Fps, rhythm: Rhythm, slow: Slow, '8bit': Bit8, tv: Tv, cctv: Cctv, phone: Phone, qte: Qte, tele: Tele };
export const SYSTEM_IDS = Object.keys(SYSTEM_CLASSES);
