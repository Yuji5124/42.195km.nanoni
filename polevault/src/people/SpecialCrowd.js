import * as THREE from 'three';
import { Figure, SKINS, HAIRS } from './Figure.js';
import { makePose, blendPose, applyPose, P, lookAtWorld } from './Poses.js';
import { glowTexture } from '../stadium/textures.js';

// 特殊 NPC（物語を持つ観客・審判・スタッフ・ベンチの外の選手）。50〜150 人。
//   1 人 = Figure（SkinnedMesh 1 つ = 1 draw call）。座席の人はその席のビルボードを空席（kind 2）にして上に座る。
//   「いまの行動（act）」: 姿勢・表情・視線・小物・立つ/座る。物語（StoryDirector）が時刻で書き換える。
//   画面の外の人は数フレームに 1 回だけ姿勢を更新する（JS を軽く）。
//   ヒント: 光る（スマホ・双眼鏡の反射）/ 立つ / こちらを向く。巨大な矢印は出さない。

const SHIRT_POOL = [0x2a3d6e, 0xd9dde4, 0x6f747e, 0x202127, 0xb3a07c, 0xa8303e, 0x7ea9d6, 0xc47394, 0xc9702f, 0x5f5e3f, 0x1d2436, 0x2f6e4a, 0xe8d8b0];
const PANTS_POOL = [0x23263a, 0x3a3a44, 0x2a2a30, 0x4a4030, 0x1c2a4a, 0x6a6a72];

let _signCache = new Map();
function signTexture(text, { bg = '#ffffff', fg = '#c3122f', w = 256, h = 160 } = {}) {
  const key = `${text}|${bg}|${fg}`;
  if (_signCache.has(key)) return _signCache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = text.split('\n');
  const size = Math.min(64, Math.floor((h - 30) / lines.length), Math.floor((w * 1.7) / Math.max(...lines.map((l) => l.length))));
  g.font = `bold ${size}px "Dela Gothic One", "Hiragino Kaku Gothic ProN", sans-serif`;
  lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.1));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _signCache.set(key, t);
  return t;
}

function flagTexture(kind) {
  const key = `flag:${kind}`;
  if (_signCache.has(key)) return _signCache.get(key);
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const g = c.getContext('2d');
  if (kind === 'jp') {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 96, 64);
    g.fillStyle = '#c3122f';
    g.beginPath();
    g.arc(48, 32, 19, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'it') {
    ['#1a9a4a', '#ffffff', '#d0283c'].forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(i * 32, 0, 32, 64);
    });
  } else if (kind === 'bd') {
    // 間違った国旗（緑に赤い丸）
    g.fillStyle = '#0a6a42';
    g.fillRect(0, 0, 96, 64);
    g.fillStyle = '#d0283c';
    g.beginPath();
    g.arc(42, 32, 18, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'white' || kind === 'red') {
    g.fillStyle = kind === 'white' ? '#f6f6f6' : '#e0263e';
    g.fillRect(0, 0, 96, 64);
  } else {
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, 96, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _signCache.set(key, t);
  return t;
}

const MAT = {};
function mat(key, make) {
  if (!MAT[key]) MAT[key] = make();
  return MAT[key];
}

// 小物（骨にぶら下げる）
function makeProp(kind, fig) {
  const B = fig.bones;
  const g = new THREE.Group();
  let bone = B.handR;
  const s = fig.B.upper / 0.26;
  if (kind.startsWith('sign:') || kind.startsWith('board:')) {
    const text = kind.slice(kind.indexOf(':') + 1).replace(/\\n/g, '\n');
    const yellow = kind.startsWith('board:');
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4), new THREE.MeshBasicMaterial({ map: signTexture(text, yellow ? { bg: '#ffd23f', fg: '#05060f' } : {}), side: THREE.DoubleSide, toneMapped: true }));
    m.material.color.setScalar(0.85);
    g.add(m);
    bone = B.chest;
    g.position.set(0, 0.44 * s, 0.36 * s);
    g.rotation.x = -0.15;
  } else if (kind.startsWith('flag:')) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 4), mat('stick', () => new THREE.MeshLambertMaterial({ color: 0xdddddd })));
    stick.position.y = -0.12;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.16), new THREE.MeshLambertMaterial({ map: flagTexture(kind.slice(5)), side: THREE.DoubleSide }));
    cloth.position.set(0.12, -0.26, 0);
    g.add(stick, cloth);
    g.rotation.x = Math.PI;
    g.userData.cloth = cloth;
  } else if (kind === 'officialWhite' || kind === 'officialRed') {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.55, 4), mat('stick', () => new THREE.MeshLambertMaterial({ color: 0xdddddd })));
    stick.position.y = -0.18;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.32), new THREE.MeshLambertMaterial({ map: flagTexture(kind === 'officialWhite' ? 'white' : 'red'), side: THREE.DoubleSide }));
    cloth.position.set(0.21, -0.35, 0);
    g.add(stick, cloth);
    g.rotation.x = Math.PI;
  } else if (kind === 'popcorn') {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.065, 0.18, 10), mat('popcup', () => new THREE.MeshLambertMaterial({ color: 0xd0283c })));
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.088, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('popcorn', () => new THREE.MeshLambertMaterial({ color: 0xfff3c4 })));
    top.position.y = 0.09;
    g.add(cup, top);
    bone = B.handL;
    g.position.set(0, -0.1, 0.06);
    g.userData.top = top;
  } else if (kind === 'binoculars') {
    for (const x of [-0.035, 0.035]) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.12, 8), mat('bino', () => new THREE.MeshLambertMaterial({ color: 0x1c1d22 })));
      tube.rotation.x = Math.PI / 2;
      tube.position.set(x, 0, 0);
      g.add(tube);
    }
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 10), mat('lens', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2.2) })));
    lens.position.set(0.035, 0, 0.062);
    g.add(lens);
    bone = B.head;
    g.position.set(0, fig.B.headR * 0.95, fig.B.headR * 1.25);
  } else if (kind === 'phone') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.01), mat('phone', () => new THREE.MeshLambertMaterial({ color: 0x15161a })));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.065, 0.135), mat('phoneScr', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.9, 2.3) })));
    scr.position.z = -0.006;
    scr.rotation.y = Math.PI;
    g.add(body, scr);
    g.position.set(0, -0.09, 0.02);
  } else if (kind === 'handkerchief') {
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mat('hanky', () => new THREE.MeshLambertMaterial({ color: 0xf2eef8, side: THREE.DoubleSide })));
    cloth.position.set(0, -0.08, 0.03);
    cloth.rotation.z = 0.4;
    g.add(cloth);
  } else if (kind === 'clipboard') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.012), mat('clip', () => new THREE.MeshLambertMaterial({ color: 0x7a5a38 })));
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.27), mat('paper', () => new THREE.MeshLambertMaterial({ color: 0xf8f8f2 })));
    paper.position.z = 0.008;
    g.add(b, paper);
    bone = B.chest;
    g.position.set(0.02, 0.02 * s, 0.3 * s);
    g.rotation.x = -0.9;
  } else if (kind === 'coffee') {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.11, 8), mat('cup', () => new THREE.MeshLambertMaterial({ color: 0xf2f2ee })));
    c.position.set(0, -0.08, 0.03);
    g.add(c);
    bone = B.handL;
  } else if (kind === 'towel') {
    const t = new THREE.Mesh(new THREE.SphereGeometry(fig.B.headR * 1.25, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), mat('towel', () => new THREE.MeshLambertMaterial({ color: 0xf2f2f6 })));
    bone = B.head;
    t.position.set(0, fig.B.headR, -0.01);
    g.add(t);
  } else if (kind === 'camera') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.08), mat('camb', () => new THREE.MeshLambertMaterial({ color: 0x1b1c20 })));
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.32, 10), mat('caml', () => new THREE.MeshLambertMaterial({ color: 0xe8e8e2 })));
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.2;
    g.add(body, lens);
    bone = B.head;
    g.position.set(-0.03, fig.B.headR * 0.9, fig.B.headR * 1.25);
  } else if (kind === 'balloon') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshLambertMaterial({ color: 0xff3d7f }));
    b.position.y = 0.75;
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.65, 3), mat('stick', () => new THREE.MeshLambertMaterial({ color: 0xdddddd })));
    str.position.y = 0.33;
    g.add(b, str);
    g.rotation.x = Math.PI;
  } else if (kind === 'uchiwa') {
    const f = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), new THREE.MeshLambertMaterial({ map: signTexture('ソラ', { bg: '#ffd23f', fg: '#c3122f', w: 128, h: 128 }), side: THREE.DoubleSide }));
    f.position.y = -0.2;
    f.rotation.x = Math.PI;
    g.add(f);
  } else if (kind === 'bento') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.14), mat('bento', () => new THREE.MeshLambertMaterial({ color: 0x1a1a1a })));
    g.add(b);
    bone = B.handL;
    g.position.set(0.05, -0.08, 0.05);
  } else return null;
  bone.add(g);
  g.userData.bone = bone;
  return g;
}

export class SpecialCrowd {
  constructor(scene, layout, field) {
    this.scene = scene;
    this.layout = layout;
    this.field = field;
    this.list = [];
    this.byRole = new Map();
    this.frame = 0;
    // ヒントの光（スマホ・双眼鏡・涙の反射）: スプライトの使い回し
    const glow = glowTexture();
    this.glints = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(3, 3, 2.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      s.renderOrder = 6;
      scene.add(s);
      this.glints.push({ s, t: 0, life: 0, npc: null, size: 0.5 });
    }
    this._v = new THREE.Vector3();
  }

  // 見た目の指定 → Figure の spec
  static look(rng, o = {}) {
    const female = o.female ?? rng.next() < 0.5;
    const build = o.build ?? (rng.next() < 0.15 ? 'big' : rng.next() < 0.3 ? 'slim' : 'adult');
    const hair = o.hair ?? (female ? ['long', 'bob', 'bun', 'pony'][Math.floor(rng.next() * 4)] : ['short', 'short', 'buzz', 'short', 'bald'][Math.floor(rng.next() * 5)]);
    const top = o.top ?? ['tshirt', 'long', 'jacket', 'hoodie', 'tshirt', 'cardigan'][Math.floor(rng.next() * 6)];
    const extras = o.extras ?? (rng.next() < 0.15 ? ['cap'] : rng.next() < 0.12 ? ['glasses'] : []);
    return {
      build,
      hair,
      top,
      bottom: o.bottom ?? (female && rng.next() < 0.3 ? 'skirt' : 'pants'),
      extras,
      colors: {
        skin: o.skin ?? SKINS[Math.floor(rng.next() * 3)],
        hair: o.hairColor ?? (build === 'elder' ? HAIRS[4] : HAIRS[rng.next() < 0.75 ? 0 : 1 + Math.floor(rng.next() * 3)]),
        top: o.color ?? SHIRT_POOL[Math.floor(rng.next() * SHIRT_POOL.length)],
        bottom: o.pants ?? PANTS_POOL[Math.floor(rng.next() * PANTS_POOL.length)],
        shoe: 0x2a2a30,
        acc: o.acc ?? 0xf4f4f4,
        acc2: o.acc2 ?? 0x2a2a36,
      },
      scale: o.scale ?? (build === 'kid' ? 1 : 0.97 + rng.next() * 0.08),
    };
  }

  // 座席に座る人
  addSeated(spec, seatId, meta = {}) {
    const L = this.layout;
    const fig = new Figure(spec);
    const npc = this.wrap(fig, meta);
    npc.seatId = seatId;
    npc.seated = true;
    npc.seatPos = new THREE.Vector3(L.x[seatId], L.y[seatId], L.z[seatId]);
    npc.yaw = L.facingYaw(seatId);
    npc.home = npc.seatPos.clone();
    fig.root.position.copy(npc.seatPos);
    fig.root.rotation.y = npc.yaw;
    // 観客席はビルボード（自分で光る）と並ぶので、少しだけ明るく
    fig.u.uGlow.value = 0.32;
    this.scene.add(fig.root);
    return npc;
  }

  // フィールド・通路に立つ / 椅子に座る人
  addAt(spec, pos, yaw, meta = {}) {
    const fig = new Figure(spec);
    const npc = this.wrap(fig, meta);
    npc.seated = !!meta.chair;
    npc.seatPos = new THREE.Vector3(pos.x, pos.y ?? 0, pos.z);
    npc.home = npc.seatPos.clone();
    npc.yaw = yaw;
    fig.root.position.copy(npc.seatPos);
    fig.root.rotation.y = yaw;
    this.scene.add(fig.root);
    return npc;
  }

  wrap(fig, meta) {
    const npc = {
      id: this.list.length,
      fig,
      role: meta.role ?? `npc${this.list.length}`,
      story: meta.story ?? null,
      label: meta.label ?? '観客',
      kind: meta.kind ?? 'npc',
      chairY: meta.chairY ?? 0.5,
      act: { pose: meta.chair || meta.seated !== false ? 'sit' : 'stand', expr: 'neutral', look: 'field', prop: null, stand: false },
      base: null,
      pose: makePose(),
      tgt: makePose(),
      props: {},
      emotion: 0,
      interest: 0,
      beat: null,
      t0: Math.random() * 10,
      visible: true,
      height: fig.B.hipY * 1.95 * (fig.spec.scale ?? 1),
      offset: new THREE.Vector3(),
      walk: null,
    };
    npc.base = { ...npc.act };
    this.list.push(npc);
    this.byRole.set(npc.role, npc);
    return npc;
  }

  get(role) {
    return this.byRole.get(role);
  }

  // 行動を変える（StoryDirector から）。足りない項目は元の行動のまま
  setAct(npc, act) {
    const prev = npc.act;
    npc.act = { ...npc.base, ...act };
    if (prev.prop !== npc.act.prop) {
      for (const k in npc.props) npc.props[k].visible = false;
      if (npc.act.prop) {
        const keys = npc.act.prop.split('+');
        for (const key of keys) {
          if (!npc.props[key]) npc.props[key] = makeProp(key, npc.fig);
          if (npc.props[key]) npc.props[key].visible = true;
        }
      }
    }
  }

  resetAct(npc) {
    this.setAct(npc, {});
  }

  // ヒントの光
  glint(npc, { size = 0.5, life = 0.9, at = 'head' } = {}) {
    const g = this.glints.find((q) => q.life <= 0) ?? this.glints[0];
    g.npc = npc;
    g.t = 0;
    g.life = life;
    g.size = size;
    g.at = at;
    g.s.visible = true;
  }

  // 目標の点（視線）
  resolveLook(npc, ctx) {
    const a = npc.act.look;
    if (!a || a === 'none') return null;
    if (a === 'field') return ctx.focusPoint;
    if (a === 'bar') return ctx.barPoint;
    if (a === 'camera') return ctx.cameraPos;
    if (a === 'sky' || a === 'moon') return ctx.moonPoint;
    if (a === 'birds') return ctx.birdPoint ?? ctx.moonPoint;
    if (a === 'down') return this._v.copy(npc.fig.root.position).add(new THREE.Vector3(Math.sin(npc.yaw) * 1.2, -0.5, Math.cos(npc.yaw) * 1.2));
    if (a === 'board') return ctx.screenPoint;
    if (a.startsWith('npc:')) {
      const o = this.get(a.slice(4));
      if (o) return o.fig.headWorld(this._v);
    }
    if (a.startsWith('athlete:')) return ctx.athleteHead?.(a.slice(8)) ?? ctx.focusPoint;
    if (a === 'neighborL' || a === 'neighborR') {
      const s = a === 'neighborL' ? 1 : -1;
      return this._v.set(npc.fig.root.position.x + Math.cos(npc.yaw) * 0.6 * s, npc.fig.root.position.y + 1.0, npc.fig.root.position.z - Math.sin(npc.yaw) * 0.6 * s);
    }
    return ctx.focusPoint;
  }

  update(t, dt, ctx) {
    this.frame++;
    const cam = ctx.camera;
    const fwd = ctx.camForward;
    const cosHalf = Math.cos(Math.min(1.4, ctx.fovRad * 0.9 + 0.12));
    for (const npc of this.list) {
      const fig = npc.fig;
      const root = fig.root;
      // 画面の中？（だいたい）
      const dx = root.position.x - cam.position.x;
      const dy = root.position.y + 1 - cam.position.y;
      const dz = root.position.z - cam.position.z;
      const d = Math.hypot(dx, dy, dz);
      const inView = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d > cosHalf;
      npc.inView = inView;
      npc.dist = d;
      const every = inView ? 1 : 8;
      if ((this.frame + npc.id) % every !== 0) continue;
      const step = dt * every;
      this.updateOne(npc, t, step, ctx);
    }
    // ヒントの光
    for (const g of this.glints) {
      if (g.life <= 0) continue;
      g.t += dt;
      if (g.t >= g.life) {
        g.life = 0;
        g.s.visible = false;
        continue;
      }
      const k = g.t / g.life;
      const p = g.at === 'hand' && g.npc.props.phone ? g.npc.props.phone.getWorldPosition(this._v) : g.npc.fig.headWorld(this._v);
      g.s.position.copy(p);
      const a = Math.sin(k * Math.PI);
      g.s.material.opacity = a;
      const sz = g.size * (0.6 + 0.6 * a) * Math.max(1, g.npc.dist / 40);
      g.s.scale.setScalar(sz);
    }
  }

  updateOne(npc, t, dt, ctx) {
    const fig = npc.fig;
    const o = npc.tgt;
    const a = npc.act;
    const tt = t + npc.t0;
    const stand = !!a.stand;
    // 歩く（エピローグ・退場）
    if (npc.walk) {
      const w = npc.walk;
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      fig.root.position.lerpVectors(w.from, w.to, k);
      if (k < 1) {
        npc.yaw = Math.atan2(w.to.x - w.from.x, w.to.z - w.from.z);
        P.walk(o, w.t * 6.5, 1, fig.B.hipY);
      } else {
        npc.walk = null;
        if (w.yaw !== undefined) npc.yaw = w.yaw;
      }
      fig.root.rotation.y = npc.yaw;
    }
    if (!npc.walk) {
      if (npc.seated && !stand) P.sitBase(o, { seatY: fig.B.hipY * 0.58 + (npc.kind === 'field' ? 0 : 0.0) });
      else P.standBase(o, fig.B.hipY);
      // 座席で立つ時は少し前へ
      const fwd = stand && npc.seated ? 0.16 : 0;
      fig.root.position.set(npc.seatPos.x + Math.sin(npc.yaw) * fwd + npc.offset.x, npc.seatPos.y + npc.offset.y, npc.seatPos.z + Math.cos(npc.yaw) * fwd + npc.offset.z);
      fig.root.rotation.y = npc.yaw;
      o.spineY = 0;
      o.headY = 0;
      o.headX = 0;
      o.headZ = 0;
      o.spineX = npc.seated && !stand ? 0.05 : 0;
      o.spineZ = 0;
      if (npc.seated && !stand) P.lap(o);
      else P.armsDown(o);
      this.applyAct(npc, a.pose, o, tt, stand);
    }
    // 視線
    const look = a.look === 'fixed' ? null : this.resolveLook(npc, ctx);
    if (look && !['sleep', 'pray', 'wipeTears', 'handsOnHead', 'eat'].includes(a.pose)) {
      const headX = o.headX;
      lookAtWorld(fig, o, look, { headY: npc.seated && !stand ? fig.B.hipY * 0.58 + 0.75 : fig.B.hipY * 1.75, maxYaw: 1.3, torso: 0.3 });
      if (a.pose === 'binoculars' || a.pose === 'phone') o.headX = Math.min(o.headX, headX + 0.2);
      // 小さなゆらぎ（静止画に見せない）
      o.headY += Math.sin(tt * 0.7) * 0.05;
    }
    fig.setExpr(a.expr);
    const k = 1 - Math.exp(-dt * (a.snap ? 30 : 6));
    blendPose(npc.pose, o, k);
    applyPose(fig, npc.pose);
    fig.updateFace(dt);
    // 小物の動き（旗のはためき・ポップコーン）
    const flag = Object.values(npc.props).find((p) => p.visible && p.userData.cloth);
    if (flag) flag.userData.cloth.rotation.y = Math.sin(tt * 9) * 0.35;
  }

  applyAct(npc, pose, o, t, stand) {
    switch (pose) {
      case 'sit':
      case 'stand':
        break;
      case 'lean':
        o.spineX = 0.35;
        P.lap(o);
        o.hL = [0.1, -0.08, 0.32];
        o.hR = [-0.1, -0.08, 0.32];
        break;
      case 'pray':
        P.pray(o);
        o.spineX = 0.18;
        break;
      case 'clap':
        P.clap(o, t);
        break;
      case 'cheer':
        P.cheer(o, t);
        break;
      case 'fist':
        P.fist(o, t);
        break;
      case 'coverMouth':
        P.coverMouth(o);
        break;
      case 'wipeTears':
        P.wipeTears(o, t);
        break;
      case 'holdSign':
        P.holdSign(o, t);
        break;
      case 'binoculars':
        P.binoculars(o);
        break;
      case 'phone':
        P.phone(o);
        break;
      case 'eat':
        P.eat(o, t);
        break;
      case 'armsCrossed':
        P.armsCrossed(o);
        break;
      case 'handsOnHead':
        P.handsOnHead(o);
        break;
      case 'chin':
        P.chin(o);
        break;
      case 'wave':
        P.wave(o, t);
        break;
      case 'stretch':
        P.stretch(o);
        break;
      case 'sleep':
        P.lap(o);
        o.headX = 0.45;
        o.headZ = 0.35;
        o.spineX = -0.05;
        break;
      case 'fidget':
        P.lap(o);
        o.kneeL += Math.sin(t * 14) * 0.08;
        o.kneeR += Math.sin(t * 14 + 1.5) * 0.08;
        o.thighLX += Math.sin(t * 14) * 0.05;
        o.spineX = 0.15;
        break;
      case 'talk':
        P.talkHands(o, t);
        break;
      case 'hug':
        P.hug(o);
        break;
      case 'reachUp':
        P.reachUp(o, 'R');
        break;
      case 'behindBack':
        P.behindBack(o);
        break;
      case 'clipboard':
        P.clipboard(o, t, false);
        break;
      case 'write':
        P.clipboard(o, t, true);
        o.headX = 0.45;
        break;
      case 'flagUp':
        P.flagUp(o, t);
        break;
      case 'shadeEyes':
        P.shadeEyes(o);
        break;
      case 'point':
        o.hR = [-0.24, 0.42, 0.4];
        o.pR = [-0.7, -0.1, 0];
        break;
      case 'kneel':
        o.hipsY = npc.fig.B.hipY * 0.62;
        o.thighLX = -1.4;
        o.kneeL = 1.5;
        o.thighRX = 0.1;
        o.kneeR = 1.6;
        break;
      case 'drop':
        // 手から落とした（両手を広げて固まる）
        o.hL = [0.3, 0.2, 0.25];
        o.hR = [-0.3, 0.2, 0.25];
        o.pL = [0.7, -0.3, 0];
        o.pR = [-0.7, -0.3, 0];
        break;
      default:
        break;
    }
    void stand;
  }

  // 撮影の判定用: 頭の位置
  headOf(npc, out) {
    return npc.fig.headWorld(out);
  }
}
