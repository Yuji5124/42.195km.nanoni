// 入力（PC 中心）。
//   マウス移動: カメラを振る（Pointer Lock。使えない環境ではドラッグ）
//   ホイール: ズーム / 左クリック: 対象をロック / 右クリック: ピントを合わせ直す
//   Space: SHOT / Shift: 高速パン / R（押している間）: 広角 / Q E: ズーム / 矢印・WASD: パン
//   M: 音 / P・ESC: 一時停止
//   ゲームパッド: 左スティック パン・右スティック上下 ズーム・A SHOT・X ロック・Y ピント・LB 高速・RB 広角・START 一時停止
//   タッチ: 1 本指ドラッグ パン・2 本指ピンチ ズーム・画面のボタン（SHOT / LOCK / FOCUS / WIDE）

export class PVInput {
  constructor(el, handlers) {
    this.el = el;
    this.h = handlers;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.lockWanted = false;
    this.enabled = false;
    this.ptrs = new Map();
    this.pinch = 0;
    this.pinchZoom = 1;
    this.dragMode = false;
    this.pad = null;
    this.padPrev = [];

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.enabled) this.wheel += e.deltaY * (e.deltaMode === 1 ? 33 : 1);
      },
      { passive: false }
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      this.h.lockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.dragMode = true;
      this.h.lockChange?.(false, true);
    });
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  releaseAll() {
    for (const k of this.keys) this.released.add(k);
    this.keys.clear();
    this.ptrs.clear();
  }

  requestLock() {
    if (this.dragMode || this.locked || !this.el.requestPointerLock) return;
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        try {
          this.el.requestPointerLock();
        } catch {
          this.dragMode = true;
        }
      });
    } catch {
      this.dragMode = true;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  down(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'touch') {
      this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.el.setPointerCapture?.(e.pointerId);
      if (this.ptrs.size === 2) this.pinch = this.pinchDist();
      return;
    }
    if (!this.locked && !this.dragMode) {
      // 最初のクリックはマウスを捕まえるだけ
      this.requestLock();
      if (e.button === 0) return;
    }
    if (e.button === 0) {
      if (this.dragMode) {
        this.dragging = { x: e.clientX, y: e.clientY, moved: 0 };
        this.el.setPointerCapture?.(e.pointerId);
      } else this.h.lock?.();
    } else if (e.button === 2) this.h.focus?.();
  }

  move(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'touch') {
      const p = this.ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.ptrs.size === 1) {
        // つかんで動かす（指の向きと逆に画面が回る = 見たい方へなぞる）
        this.dx -= dx;
        this.dy -= dy;
      } else if (this.ptrs.size === 2) {
        const d = this.pinchDist();
        if (this.pinch > 0) this.pinchZoom *= d / this.pinch;
        this.pinch = d;
      }
      return;
    }
    if (this.locked) {
      this.dx += e.movementX;
      this.dy += e.movementY;
    } else if (this.dragging) {
      const dx = e.clientX - this.dragging.x;
      const dy = e.clientY - this.dragging.y;
      this.dragging.x = e.clientX;
      this.dragging.y = e.clientY;
      this.dragging.moved += Math.abs(dx) + Math.abs(dy);
      this.dx -= dx;
      this.dy -= dy;
    }
  }

  up(e) {
    if (e.pointerType === 'touch') {
      this.ptrs.delete(e.pointerId);
      this.pinch = this.ptrs.size === 2 ? this.pinchDist() : 0;
      return;
    }
    if (this.dragging && e.button === 0) {
      // ドラッグ操作の時: 動かさずに離したらロック
      if (this.dragging.moved < 6) this.h.lock?.();
      this.dragging = null;
    }
  }

  pinchDist() {
    const [a, b] = [...this.ptrs.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // ゲームパッド（毎フレーム）
  pollPad() {
    const pads = navigator.getGamepads?.() ?? [];
    const p = [...pads].find((q) => q && q.connected);
    this.pad = null;
    if (!p) return;
    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
    const b = (i) => !!p.buttons[i]?.pressed;
    const now = p.buttons.map((x) => x.pressed);
    const edge = (i) => now[i] && !this.padPrev[i];
    this.pad = {
      lx: dz(p.axes[0] ?? 0),
      ly: dz(p.axes[1] ?? 0),
      rx: dz(p.axes[2] ?? 0),
      ry: dz(p.axes[3] ?? 0),
      lt: p.buttons[6]?.value ?? 0,
      rt: p.buttons[7]?.value ?? 0,
      fast: b(4),
      wide: b(5),
      shot: edge(0),
      lock: edge(2),
      focus: edge(3),
      start: edge(9),
    };
    this.padPrev = now;
  }

  down_(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  wasReleased(code) {
    return this.released.has(code);
  }

  // 画面のボタン・自動操縦から押す
  press(code) {
    this.pressed.add(code);
  }

  consumeMouse() {
    const r = { dx: this.dx, dy: this.dy, wheel: this.wheel, pinch: this.pinchZoom };
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.pinchZoom = 1;
    return r;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }
}
