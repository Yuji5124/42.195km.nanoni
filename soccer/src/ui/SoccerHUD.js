// HUD（DOM）: 中継の帯（LIVE・スコア・時計）/ コンパス / 残り席数（チケット）/ 道具 / 候補 A B C /
// 会話の字幕 / 調べた結果 / 巨大な文字 / WATCH MATCH / 双眼鏡の視界 / タイトル・移動・結果。
// 表示しすぎない: 常に出ているのは 時計・スコア・残り席数・道具・候補 だけ。

const $ = (id) => document.getElementById(id);
const WHO = { me: 'あなた', neighbor: '隣の客', pa: '場内放送', staff: '係員', vision: 'ビジョン', ticket: 'チケット', fan: '観客' };
const COMPASS = [
  ['N', 0],
  ['NE', 45],
  ['E', 90],
  ['SE', 135],
  ['S', 180],
  ['SW', 225],
  ['W', 270],
  ['NW', 315],
];

export class SoccerHUD {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'score', 'clock', 'toast', 'compassStrip', 'seatsLeft', 'pins', 'toolBtn', 'toolName', 'zoomBar', 'zoomFill', 'markers', 'card', 'talk', 'big', 'watchBtn', 'ticket', 'scope', 'scopeZoom', 'blinds', 'intro', 'opening', 'travel', 'result', 'pause', 'dev', 'skipBtn']) this.el[id] = $(id);
    this.lines = [];
    this.cache = {};
    this.pinEls = new Map();
    this.buildCompass();
    this.buildScope();
    addEventListener('resize', () => this.layoutScope());
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  set(key, el, text) {
    if (this.cache[key] === text) return;
    this.cache[key] = text;
    el.textContent = text;
  }

  setScore(h, a) {
    this.set('score', this.el.score, `${h} - ${a}`);
  }

  setClock(text) {
    this.set('clock', this.el.clock, text);
  }

  toast(text, seconds = 4) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), seconds * 1000);
  }

  // ---- コンパス（yaw: 0 = 北、右回り）
  buildCompass() {
    const s = this.el.compassStrip;
    s.innerHTML = '';
    this.compassPx = 1.6; // 1° あたり px
    for (let rep = -1; rep <= 1; rep++) {
      for (const [label, deg] of COMPASS) {
        const e = document.createElement('span');
        e.textContent = label;
        if (label.length === 1) e.classList.add('main');
        if (label === 'N') e.classList.add('n');
        e.style.left = `${(deg + rep * 360) * this.compassPx}px`;
        s.appendChild(e);
      }
    }
  }

  setCompass(yawRad) {
    let deg = ((yawRad * 180) / Math.PI) % 360;
    if (deg < 0) deg += 360;
    const x = Math.round(-deg * this.compassPx);
    if (this.cache.compass === x) return;
    this.cache.compass = x;
    this.el.compassStrip.style.transform = `translateX(${x}px)`;
  }

  setSeatsLeft(n, drop = false) {
    const b = this.el.seatsLeft;
    this.set('seats', b, n.toLocaleString('en-US'));
    if (drop) {
      b.classList.add('drop');
      setTimeout(() => b.classList.remove('drop'), 2500);
    }
  }

  // ---- 道具
  setTool(tool, has, zoom) {
    const b = this.el.toolBtn;
    b.classList.toggle('locked', !has);
    b.classList.toggle('has', has && tool !== 'binoculars');
    b.classList.toggle('on', tool === 'binoculars');
    this.set('toolName', this.el.toolName, tool === 'binoculars' ? `${zoom.toFixed(1)}×` : has ? '双眼鏡' : '肉眼');
    this.el.zoomBar.classList.toggle('hidden', tool !== 'binoculars');
    this.el.zoomFill.style.height = `${((zoom - 4) / 4) * 100}%`;
    this.el.scope.classList.toggle('hidden', tool !== 'binoculars');
    this.set('scopeZoom', this.el.scopeZoom, `${zoom.toFixed(1)}×`);
  }

  newTool(on) {
    this.el.toolBtn.classList.toggle('new', on);
  }

  buildScope() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.innerHTML = `
      <defs>
        <filter id="scopeBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10" /></filter>
        <mask id="scopeMask">
          <rect width="100%" height="100%" fill="white" />
          <g filter="url(#scopeBlur)"><circle id="scopeL" fill="black" /><circle id="scopeR" fill="black" /></g>
        </mask>
        <radialGradient id="scopeVig"><stop offset="0.7" stop-color="black" stop-opacity="0" /><stop offset="1" stop-color="black" stop-opacity="0.6" /></radialGradient>
      </defs>
      <ellipse id="scopeV" fill="url(#scopeVig)" />
      <rect width="100%" height="100%" fill="#000" mask="url(#scopeMask)" />`;
    this.el.scope.prepend(svg);
    this.layoutScope();
  }

  layoutScope() {
    const w = innerWidth;
    const h = innerHeight;
    const portrait = h > w;
    const r = portrait ? Math.min(w * 0.47, h * 0.3) : Math.min(h * 0.46, w * 0.3);
    const off = r * 0.55;
    for (const [id, dx] of [
      ['scopeL', -off],
      ['scopeR', off],
    ]) {
      const c = document.getElementById(id);
      if (!c) continue;
      c.setAttribute('cx', w / 2 + dx);
      c.setAttribute('cy', h / 2);
      c.setAttribute('r', r);
    }
    const v = document.getElementById('scopeV');
    if (v) {
      v.setAttribute('cx', w / 2);
      v.setAttribute('cy', h / 2);
      v.setAttribute('rx', r + off);
      v.setAttribute('ry', r);
    }
  }

  // ---- 候補
  setPins(pins, onTap) {
    const box = this.el.pins;
    const key = pins.map((p) => `${p.letter}${p.seat}`).join(',');
    if (this.cache.pins === key) return;
    this.cache.pins = key;
    box.innerHTML = '';
    if (!pins.length) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = '長押しで候補に登録';
      box.appendChild(h);
    }
    for (const p of pins) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${p.letter}<small>候補</small>`;
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        onTap(p);
      });
      box.appendChild(b);
    }
  }

  // 候補の印（画面の上に。画面外なら端に矢印）
  updateMarkers(pins, screenOf) {
    const seen = new Set();
    for (const p of pins) {
      seen.add(p.letter);
      let e = this.pinEls.get(p.letter);
      if (!e) {
        e = document.createElement('div');
        e.className = 'pin-mark';
        e.textContent = p.letter;
        this.el.markers.appendChild(e);
        this.pinEls.set(p.letter, e);
      }
      const s = screenOf(p.seat);
      if (s.visible) {
        e.className = 'pin-mark';
        e.textContent = p.letter;
        e.style.left = `${s.x}px`;
        e.style.top = `${s.y - 10}px`;
      } else {
        e.className = 'pin-edge';
        e.textContent = s.x < innerWidth / 2 ? `◀${p.letter}` : `${p.letter}▶`;
        e.style.left = `${Math.min(innerWidth - 24, Math.max(24, s.x))}px`;
        e.style.top = `${Math.min(innerHeight - 140, Math.max(90, s.y))}px`;
      }
    }
    for (const [k, e] of this.pinEls) {
      if (!seen.has(k)) {
        e.remove();
        this.pinEls.delete(k);
      }
    }
  }

  reticle(x, y) {
    const r = document.createElement('div');
    r.className = 'reticle';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    this.el.markers.appendChild(r);
    setTimeout(() => r.remove(), 1400);
    return r;
  }

  // ---- 調べた結果
  card(res) {
    const c = this.el.card;
    const cls = res.kind === 'target' ? 'target' : res.kind === 'person' ? 'person' : res.kind === 'far' || res.kind === 'none' ? 'far' : 'decoy';
    c.className = `card ${cls}`;
    c.innerHTML = `<div class="c-text"></div>${res.label ? `<div class="c-seat">${res.label}</div>` : ''}`;
    c.querySelector('.c-text').textContent = res.text;
    clearTimeout(this.cardTimer);
    this.cardTimer = setTimeout(() => c.classList.add('hidden'), res.kind === 'target' ? 6000 : 2600);
  }

  hideCard() {
    this.el.card.classList.add('hidden');
  }

  // ---- 会話
  say(who, text, seconds = 3.6) {
    const box = this.el.talk;
    const line = document.createElement('div');
    line.className = `line ${who}`;
    const w = document.createElement('span');
    w.className = 'who';
    w.textContent = WHO[who] ?? who;
    const t = document.createElement('span');
    t.textContent = text;
    line.append(w, t);
    box.appendChild(line);
    while (box.children.length > 2) box.firstChild.remove();
    setTimeout(() => {
      line.classList.add('out');
      setTimeout(() => line.remove(), 450);
    }, seconds * 1000);
  }

  clearTalk() {
    this.el.talk.innerHTML = '';
  }

  // ---- 巨大な文字
  big(main, { sub = '', seat = '', cls = '', seconds = 3 } = {}) {
    const b = this.el.big;
    b.className = `big ${cls}`;
    b.innerHTML = `<div><div class="b-main"></div>${sub ? '<div class="b-sub"></div>' : ''}${seat ? '<div class="b-seat"></div>' : ''}</div>`;
    b.querySelector('.b-main').textContent = main;
    if (sub) b.querySelector('.b-sub').textContent = sub;
    if (seat) b.querySelector('.b-seat').textContent = seat;
    clearTimeout(this.bigTimer);
    if (seconds > 0) this.bigTimer = setTimeout(() => (b.innerHTML = ''), seconds * 1000);
  }

  clearBig() {
    this.el.big.innerHTML = '';
  }

  watch(on) {
    this.el.watchBtn.classList.toggle('hidden', !on);
  }

  // ---- チケット
  ticket(show, fields, left) {
    this.el.ticket.classList.toggle('hidden', !show);
    if (!fields) return;
    for (const [k, id] of [
      ['level', 'tLevel'],
      ['side', 'tSide'],
      ['block', 'tBlock'],
      ['row', 'tRow'],
      ['seat', 'tSeat'],
    ]) {
      const e = $(id);
      e.textContent = fields[k];
      e.classList.toggle('known', !/^\?+$/.test(fields[k]));
    }
    $('tLeft').textContent = left.toLocaleString('en-US');
  }

  blinds(on, fast = false) {
    this.el.blinds.classList.toggle('fast', fast);
    this.el.blinds.classList.toggle('on', on);
  }

  dev(text) {
    const d = this.el.dev;
    d.classList.remove('hidden');
    d.textContent = text;
  }
}
