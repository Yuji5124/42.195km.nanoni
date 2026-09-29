// 入力は「意味」にまとめる。世界がどう壊れても、操作の意味は変わらない（左右反転の演出中も同じ）。
//   effort  … 上 = ペースを上げる / 下 = 抑える（-1〜1）
//   lateral … 左右 = レーン移動（-1〜1）
//   step    … リズム入力（足の接地に合わせて押すと PERFECT）: SPACE / RUN ボタン
//   burst   … スパート（スタミナを使う）: SHIFT / BURST ボタン
// スマホ: 左下のバーチャルスティック + RUN / BURST ボタン

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  step: ['Space'],
  burst: ['ShiftLeft', 'ShiftRight'],
  confirm: ['Space', 'Enter'],
  debug: ['F1', 'Backquote'],
  mute: ['KeyM'],
  pause: ['KeyP', 'Escape'],
  retry: ['KeyR'],
  newSeed: ['KeyN'],
};

export class Input {
  constructor(root) {
    this.down = new Set();
    this.pressedSet = new Set();
    this.stick = { x: 0, y: 0, active: false };
    this.touchBtn = { step: false, burst: false };
    this.touchPressed = new Set();
    this.isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;

    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'Backquote'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    if (root) this.bindTouch(root);
  }

  bindTouch(root) {
    const stick = root.querySelector('[data-stick]');
    const knob = stick?.querySelector('.knob');
    if (stick) {
      let id = null;
      const move = (e) => {
        const r = stick.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const rad = r.width / 2;
        let x = (e.clientX - cx) / rad;
        let y = (e.clientY - cy) / rad;
        const len = Math.hypot(x, y);
        if (len > 1) {
          x /= len;
          y /= len;
        }
        this.stick = { x, y: -y, active: true };
        if (knob) knob.style.transform = `translate(${x * rad * 0.55}px, ${y * rad * 0.55}px)`;
      };
      stick.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        id = e.pointerId;
        stick.setPointerCapture(id);
        move(e);
      });
      stick.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        this.stick = { x: 0, y: 0, active: false };
        if (knob) knob.style.transform = '';
      };
      stick.addEventListener('pointerup', end);
      stick.addEventListener('pointercancel', end);
    }
    root.querySelectorAll('[data-btn]').forEach((btn) => {
      const key = btn.dataset.btn;
      const set = (v) => (e) => {
        e.preventDefault();
        if (v && !this.touchBtn[key]) this.touchPressed.add(key);
        this.touchBtn[key] = v;
        btn.classList.toggle('active', v);
      };
      btn.addEventListener('pointerdown', set(true));
      btn.addEventListener('pointerup', set(false));
      btn.addEventListener('pointercancel', set(false));
      btn.addEventListener('pointerleave', set(false));
    });
  }

  held(action) {
    if (action === 'burst' && this.touchBtn.burst) return true;
    if (action === 'step' && this.touchBtn.step) return true;
    return (KEYS[action] ?? []).some((c) => this.down.has(c));
  }

  pressed(action) {
    if (action === 'step' && this.touchPressed.has('step')) return true;
    if (action === 'burst' && this.touchPressed.has('burst')) return true;
    return (KEYS[action] ?? []).some((c) => this.pressedSet.has(c));
  }

  get effortAxis() {
    const k = (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0);
    return k !== 0 ? k : Math.abs(this.stick.y) > 0.3 ? Math.sign(this.stick.y) * Math.min(1, (Math.abs(this.stick.y) - 0.3) / 0.5) : 0;
  }

  get lateralAxis() {
    const k = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    return k !== 0 ? k : Math.abs(this.stick.x) > 0.25 ? this.stick.x : 0;
  }

  endFrame() {
    this.pressedSet.clear();
    this.touchPressed.clear();
  }
}
