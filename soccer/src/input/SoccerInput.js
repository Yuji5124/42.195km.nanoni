// 入力（iPhone Safari が正式ターゲット。Pointer Events で指もマウスも同じに扱う）
//   1 本指ドラッグ: 見回す / ピンチ: ズーム / タップ: 調べる / 長押し: 候補に登録 / ダブルタップ: 双眼鏡
//   マウス: ドラッグ / ホイール: ズーム / クリック: 調べる / 右クリック: 候補 / ダブルクリック: 双眼鏡
//   キー: ← → ↑ ↓ / WASD 見回す、Q E ズーム、B 双眼鏡、T チケット、SPACE 試合を見る、M 音、ESC 一時停止
//
// iOS の注意: touch-action: none（CSS）+ gesturestart の既定動作を止める（ページの拡大を防ぐ）。
// 指が画面外へ出ても pointer capture で追う。blur / 画面を隠す / pointercancel で全部の指を離したことにする。
// 時間の判定はイベントの timeStamp で行い、長押しはフレームの頭（update）で判定する:
// 入力イベントは requestAnimationFrame の前に処理されるので、重い端末でフレームが遅れても
// 「指を離したのに長押し扱い」「タップがドラッグ扱い」にならない。

const TAP_MOVE = 9;
const LONG_MS = 480;
const DOUBLE_MS = 320;

export class SoccerInput {
  constructor(target, handlers) {
    this.el = target;
    this.h = handlers;
    this.ptrs = new Map();
    this.keys = new Set();
    this.pressed = new Set();
    this.lastTap = null;
    this.enabled = true;
    this.pinchD = 0;

    const el = target;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.cancel(e));
    el.addEventListener('lostpointercapture', (e) => this.cancel(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.enabled) this.h.wheel?.(e.deltaY, e.clientX, e.clientY);
      },
      { passive: false }
    );
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  releaseAll() {
    for (const id of this.ptrs.keys()) {
      try {
        this.el.releasePointerCapture(id);
      } catch {
        /* もう離れている */
      }
    }
    this.ptrs.clear();
    this.keys.clear();
    this.h.release?.();
  }

  down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* 古いブラウザ */
    }
    const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: e.timeStamp, wall: performance.now(), moved: false, button: e.button, long: false };
    this.ptrs.set(e.pointerId, p);
    this.h.touchStart?.();
    if (this.ptrs.size === 1) {
      if (e.button === 2) {
        p.long = true;
        this.h.longPress?.(e.clientX, e.clientY);
      }
    } else if (this.ptrs.size === 2) {
      for (const q of this.ptrs.values()) q.moved = true;
      this.pinchD = this.pinchDist();
    }
  }

  pinchDist() {
    const [a, b] = [...this.ptrs.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  move(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p || !this.enabled) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.ptrs.size === 1) {
      if (!p.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > TAP_MOVE) p.moved = true;
      if (p.moved && !p.long) this.h.drag?.(dx, dy);
    } else if (this.ptrs.size === 2) {
      const d = this.pinchDist();
      if (this.pinchD > 0 && d > 0) this.h.pinch?.(d / this.pinchD);
      this.pinchD = d;
    }
  }

  up(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* 既に離れている */
    }
    if (!this.enabled) return;
    const dur = e.timeStamp - p.t0;
    if (!p.moved && !p.long && dur < LONG_MS && this.ptrs.size === 0) {
      const now = e.timeStamp;
      const lt = this.lastTap;
      if (lt && now - lt.t < DOUBLE_MS && Math.hypot(lt.x - p.x, lt.y - p.y) < 40) {
        this.lastTap = null;
        this.h.doubleTap?.(p.x, p.y);
      } else {
        this.lastTap = { t: now, x: p.x, y: p.y };
        this.h.tap?.(p.x, p.y);
      }
    }
    if (this.ptrs.size === 0) this.h.release?.();
    if (this.ptrs.size < 2) this.pinchD = 0;
  }

  cancel(e) {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size === 0) this.h.release?.();
  }

  // フレームの頭で呼ぶ: 動かさずに押し続けている指 → 長押し
  update() {
    if (this.ptrs.size !== 1 || !this.enabled) return;
    const p = this.ptrs.values().next().value;
    if (!p.moved && !p.long && performance.now() - p.wall >= LONG_MS) {
      p.long = true;
      this.h.longPress?.(p.x, p.y);
    }
  }

  // 押し続けているキーで見回す（px / 秒）
  lookAxis() {
    const k = this.keys;
    const x = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const y = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    const z = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    return { x, y, z };
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
  }
}
