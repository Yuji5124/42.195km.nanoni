// 試合の HUD（DOM）: HP・時間・ラウンド・CURRENT BOXING SYSTEM・HYPE・大きな文字・テロップ・実況・予告マーク。
// 毎フレーム書き換えるのは値が変わった時だけ（DOM を触りすぎない）。

const $ = (id) => document.getElementById(id);

export class BoxingHUD {
  constructor() {
    this.el = $('hud');
    this.cache = {};
    this.tells = null;
    this.telops = $('telop');
    this.talkBox = $('talk');
    this.bigBox = $('big');
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
  }

  setHP(p, e) {
    const q = (v) => Math.round(Math.max(0, Math.min(1, v)) * 400) / 400;
    this.set('hpP', q(p), (v) => {
      $('hpP').style.transform = `scaleX(${v})`;
      $('hpPLag').style.transform = `scaleX(${v})`;
      $('hpP').parentElement.classList.toggle('low', v < 0.25);
    });
    this.set('hpE', q(e), (v) => {
      $('hpE').style.transform = `scaleX(${v})`;
      $('hpELag').style.transform = `scaleX(${v})`;
      $('hpE').parentElement.classList.toggle('low', v < 0.25);
    });
  }

  setClock(text, warn = false) {
    this.set('clock', text, (v) => ($('time').textContent = v));
    this.set('warn', warn, (v) => $('time').classList.toggle('warn', v));
  }

  setRound(text) {
    this.set('round', text, (v) => ($('round').textContent = v));
  }

  setSystem(name, sub, keys, animate = true) {
    const nameEl = $('sysName');
    nameEl.innerHTML = name.replace(/\?/g, '<span class="q">?</span>');
    $('sysSub').textContent = sub;
    const lab = $('sysLabel');
    if (animate) {
      lab.classList.remove('swap');
      void lab.offsetWidth;
      lab.classList.add('swap');
    }
    $('keys').innerHTML = keys.map(([k, v]) => `<span><b>${k}</b>${v}</span>`).join('');
  }

  setHype(h, lv) {
    this.set('hype', Math.round(h * 200) / 200, (v) => ($('hypeFill').style.transform = `scaleX(${v})`));
    this.set('hypeLv', lv, (v) => {
      $('hypeLv').textContent = ['LV 0 · ふつう', 'LV 1 · ざわざわ', 'LV 2 · 総立ち', 'LV 3 · 会場がおかしい', 'LV 4 · もう何が何だか', 'LV MAX · ???'][v] ?? `LV ${v}`;
      $('hypeLv').parentElement.classList.toggle('max', v >= 5);
    });
  }

  big(text, { cls = '', dur = 1.4, small = '' } = {}) {
    const box = this.bigBox;
    box.innerHTML = '';
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = `${text}${small ? `<small>${small}</small>` : ''}`;
    box.appendChild(d);
    clearTimeout(this.bigT);
    if (dur > 0) {
      this.bigT = setTimeout(() => {
        d.classList.add('out');
        setTimeout(() => d.remove(), 360);
      }, dur * 1000);
    }
  }

  clearBig() {
    this.bigBox.innerHTML = '';
  }

  telop(text, { cls = '', dur = 2.6 } = {}) {
    const d = document.createElement('div');
    d.className = `tl ${cls}`;
    d.innerHTML = text;
    this.telops.appendChild(d);
    while (this.telops.children.length > 3) this.telops.firstChild.remove();
    setTimeout(() => {
      d.classList.add('out');
      setTimeout(() => d.remove(), 320);
    }, dur * 1000);
  }

  talk(who, text, { dur = 3.2, b = false } = {}) {
    const d = document.createElement('div');
    d.className = `line${b ? ' b' : ''}`;
    d.innerHTML = `<i>${who}</i>${text}`;
    this.talkBox.appendChild(d);
    while (this.talkBox.children.length > 2) this.talkBox.firstChild.remove();
    setTimeout(() => d.remove(), dur * 1000);
  }

  clearText() {
    this.telops.innerHTML = '';
    this.talkBox.innerHTML = '';
  }

  // 相手のパンチの予告（画面上の位置）
  tellMark(x, y, k, on) {
    if (!this.tellEl) {
      this.tellEl = document.createElement('div');
      this.tellEl.className = 'tell-mark hidden';
      this.tellEl.innerHTML = '<b>!</b>';
      $('ui').insertBefore(this.tellEl, $('telop'));
    }
    const el = this.tellEl;
    if (!on) {
      if (!el.classList.contains('hidden')) el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.classList.toggle('late', k > 0.62);
    el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }

  flash() {
    const f = $('flashy');
    f.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
  }
}
