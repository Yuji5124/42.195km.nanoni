// 左の ACTION / REACTION。並びが変わった時だけ作り直す（毎フレームは「押せ / 押すな」の数字だけ）。

import { CTX_LABEL, SERIOUS } from '../stream/actions.js';
import { man } from '../chat/LiveChatSystem.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class ActionPanel {
  constructor({ root, label, onPick }) {
    this.root = root;
    this.label = label;
    this.onPick = onPick;
    this.key = '';
    this.mode = '';
    this.els = new Map();
    root.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      this.onPick(b.dataset.act);
    });
  }

  clear() {
    this.key = '';
    this.root.innerHTML = '';
    this.els.clear();
  }

  render(list, mode, rem) {
    const key = list.map((a) => `${a.id}:${a.label}`).join('|');
    const m = mode === 'final' && rem < 135 ? 'last100' : mode;
    if (m !== this.mode) {
      this.mode = m;
      this.label.textContent = CTX_LABEL[m] ?? m;
      this.label.className = `ctx ${mode}`;
    }
    if (key !== this.key) {
      const prev = new Set(this.els.keys());
      this.key = key;
      this.els.clear();
      this.root.innerHTML = list
        .map((a, i) => {
          const cls = ['act'];
          if (a.id === SERIOUS[mode] || a.id === 'focus') cls.push('serious');
          if (a.tempt) cls.push('tempt');
          if (a.big) cls.push('xl');
          const isNew = a.tempt && !prev.has(a.id) && a.fresh;
          return `<button type="button" class="${cls.join(' ')}" data-act="${a.id}" style="animation-delay:${i * 0.04}s"><span class="k">${a.key}</span><span class="ic">${a.icon}</span><span class="lb">${esc(a.label)}</span>${isNew ? '<span class="new">NEW</span>' : ''}${a.tempt ? '<span class="pr"></span>' : ''}</button>`;
        })
        .join('');
      for (const el of this.root.querySelectorAll('[data-act]')) this.els.set(el.dataset.act, el);
    }
    // 押せ / 押すな
    for (const a of list) {
      if (!a.tempt || !a.pressure) continue;
      const el = this.els.get(a.id)?.querySelector('.pr');
      if (!el) continue;
      const { push, stop } = a.pressure;
      if (push + stop < 1) continue;
      const k = (push / (push + stop)) * 100;
      el.innerHTML = `押せ <b>${man(push)}</b><span class="bar"><i style="width:${k.toFixed(0)}%"></i></span>押すな ${man(stop)}`;
    }
  }

  hit(id) {
    const el = this.els.get(id);
    if (!el) return;
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), 160);
  }
}
