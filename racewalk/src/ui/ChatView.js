// 右の LIVE CHAT の描画。DOM は増やし続けない（表示は最大 MAX 件・古いものは使い回す）。
//   スパチャ … 金額の色の箱（大きいほど目立つ）+ 上のピン（金額で残る時間が変わる）
//   ハイライト … 速すぎて読めない時、名前のある人・事件のコメントを上の「注目」欄にも出す

const MAX = 46;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// スパチャの色（金額の段）
export function scTier(a) {
  if (a >= 20000) return { bg: '#d00000', hd: '#a80000', pin: 60 };
  if (a >= 10000) return { bg: '#c2185b', hd: '#9c1047', pin: 40 };
  if (a >= 5000) return { bg: '#e65100', hd: '#bf4400', pin: 25 };
  if (a >= 2000) return { bg: '#ffb300', hd: '#e09d00', pin: 14, dark: true };
  if (a >= 1000) return { bg: '#00bfa5', hd: '#009e88', pin: 8, dark: true };
  if (a >= 500) return { bg: '#00b8d4', hd: '#0096ad', pin: 0, dark: true };
  return { bg: '#1e88e5', hd: '#1565c0', pin: 0 };
}

export class ChatView {
  constructor({ list, pins, spot, rate }) {
    this.list = list;
    this.pins = pins;
    this.spot = spot;
    this.rateEl = rate;
    this.pool = [];
    this.pinList = [];
    this.spotList = [];
    this.times = [];
  }

  clear() {
    this.list.innerHTML = '';
    this.pins.innerHTML = '';
    this.spot.innerHTML = '';
    this.pool = [];
    this.pinList = [];
    this.spotList = [];
    this.times = [];
  }

  html(c) {
    if (c.kind === 'system') return `<span class="tx">${esc(c.text)}</span>`;
    if (c.kind === 'sc') {
      return `<div class="sh" style="background:${scTier(c.amount).hd}"><span>${esc(c.name)}</span><span class="am">¥${c.amount.toLocaleString('en-US')}</span></div><div class="sb">${esc(c.text)}</div>`;
    }
    let bd = '';
    if (c.badge === 'member') bd = `<i class="bd">${c.months >= 12 ? `${Math.floor(c.months / 12)}年` : `${Math.max(1, c.months)}か月`}</i>`;
    else if (c.badge === 'mod') bd = '<i class="bd mod">🔧</i>';
    else if (c.badge === 'new') bd = '<i class="bd new">初見</i>';
    return `${bd}<span class="nm" style="color:${c.color}">${esc(c.name)}</span><span class="tx">${esc(c.text)}</span>`;
  }

  cls(c) {
    let k = 'c';
    if (c.kind === 'system') k += ' sys';
    if (c.kind === 'mod') k += ' mod';
    if (c.kind === 'sc') k += ` sc${c.amount >= 10000 ? ' big' : ''}${c.amount >= 50000 ? ' huge' : ''}`;
    if (c.hl && c.kind !== 'sc') k += ' hl';
    if (c.named) k += ' named';
    if (c.color === '#ff7a7a') k += ' anti';
    return k;
  }

  push(comments, now, rate) {
    if (!comments.length) return;
    // 1 フレームに大量に来たら、新しい方だけ（流れて見えない）
    const list = comments.length > 10 ? comments.slice(-10) : comments;
    const frag = document.createDocumentFragment();
    for (const c of list) {
      let el = this.list.childElementCount + frag.childElementCount >= MAX ? this.list.firstElementChild : null;
      if (el) el.remove();
      else el = document.createElement('div');
      el.className = this.cls(c);
      el.style.background = c.kind === 'sc' ? scTier(c.amount).bg : '';
      el.style.color = c.kind === 'sc' && scTier(c.amount).dark ? '#111' : '';
      el.innerHTML = this.html(c);
      frag.appendChild(el);
      if (c.kind === 'sc' && scTier(c.amount).pin) this.addPin(c, now);
      if (rate > 6 && (c.hl || (c.named && c.prio >= 3)) && c.kind !== 'sc') this.addSpot(c, now);
    }
    this.list.appendChild(frag);
    for (let i = 0; i < comments.length; i++) this.times.push(now);
  }

  addPin(c, now) {
    const t = scTier(c.amount);
    const el = document.createElement('div');
    el.className = 'pin';
    el.style.background = t.bg;
    el.style.color = t.dark ? '#111' : '#fff';
    el.innerHTML = `<span class="av">${esc([...c.name][0] ?? '?')}</span>¥${c.amount.toLocaleString('en-US')}`;
    this.pins.prepend(el);
    this.pinList.unshift({ el, until: now + t.pin, dur: t.pin });
    while (this.pinList.length > 6) this.pinList.pop().el.remove();
  }

  addSpot(c, now) {
    const el = document.createElement('div');
    el.className = this.cls(c);
    el.innerHTML = `<span class="lbl">注目 </span>${this.html(c)}`;
    this.spot.appendChild(el);
    this.spotList.push({ el, until: now + 4.5 });
    while (this.spotList.length > 2) this.spotList.shift().el.remove();
  }

  update(now) {
    for (let i = this.pinList.length - 1; i >= 0; i--) {
      const p = this.pinList[i];
      const k = (p.until - now) / p.dur;
      if (k <= 0) {
        p.el.remove();
        this.pinList.splice(i, 1);
      } else p.el.style.setProperty('--k', `${(k * 100).toFixed(1)}%`);
    }
    for (let i = this.spotList.length - 1; i >= 0; i--) {
      if (now > this.spotList[i].until) {
        this.spotList[i].el.remove();
        this.spotList.splice(i, 1);
      }
    }
    while (this.times.length && now - this.times[0] > 3) this.times.shift();
    const r = this.times.length / 3;
    this.rateEl.textContent = `${r.toFixed(1)}/秒`;
    this.rateEl.className = `rate${r > 14 ? ' fire' : r > 5 ? ' hot' : ''}`;
    return r;
  }
}
