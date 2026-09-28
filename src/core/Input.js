// 入力の抽象化。ゲーム側は「キー」ではなく「意味（axis / jump / dash）」だけを見る。
// モードが変わっても入力は増やさず、同じ入力の意味をモード側で読み替える。

const KEYMAP = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  confirm: ['Space', 'Enter'],
  mute: ['KeyM'],
  pause: ['KeyP', 'Escape'],
  retry: ['KeyR'],
};

export class Input {
  constructor(root) {
    this.down = new Set();
    this.pressedThisFrame = new Set();
    this.touch = { left: false, right: false, up: false, dash: false };
    this.touchPressed = new Set();

    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    this.isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (root) this.bindTouch(root);
  }

  bindTouch(root) {
    const buttons = root.querySelectorAll('[data-touch]');
    buttons.forEach((btn) => {
      const key = btn.dataset.touch;
      const set = (v) => (e) => {
        e.preventDefault();
        if (v && !this.touch[key]) this.touchPressed.add(key);
        this.touch[key] = v;
        btn.classList.toggle('active', v);
      };
      btn.addEventListener('pointerdown', set(true));
      btn.addEventListener('pointerup', set(false));
      btn.addEventListener('pointercancel', set(false));
      btn.addEventListener('pointerleave', set(false));
    });
  }

  held(action) {
    if (action === 'left' && this.touch.left) return true;
    if (action === 'right' && this.touch.right) return true;
    if (action === 'dash' && this.touch.dash) return true;
    if (action === 'jump' && this.touch.up) return true;
    return KEYMAP[action].some((c) => this.down.has(c));
  }

  pressed(action) {
    if (action === 'jump' && this.touchPressed.has('up')) return true;
    if (action === 'confirm' && this.touchPressed.size > 0) return true;
    return KEYMAP[action].some((c) => this.pressedThisFrame.has(c));
  }

  get axisX() {
    return (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
  }

  get axisY() {
    return (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0);
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.touchPressed.clear();
  }
}
