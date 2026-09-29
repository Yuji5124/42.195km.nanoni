// トランポリンの入力。
// 1500m の Input（src/core/Input.js）は A/D/W/S/P/R/T/M を移動・ポーズ等に使っているが、
// ここでは英単語をタイピングするので、文字キーはすべて「文字」として受け取る必要がある → 専用の小さな入力。
//   SPACE / 画面タップ: 踏み込み
//   A〜Z: タイピング（空中）
//   ← →: 空から戻る時の位置調整
//   ESC: ポーズ / M: ミュート（空中以外）
// スマホ: 画面タップ = 踏み込み、空中は「次の文字」ボタン（#keys）で入力。

export class TrampolineInput {
  constructor(root) {
    this.down = new Set();
    this.pressedSet = new Set();
    this.letters = [];
    this.touchSteer = 0;
    this.isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) {
        this.pressedSet.add(e.code);
        if (/^Key[A-Z]$/.test(e.code)) this.letters.push(e.code.slice(3));
      }
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    // 画面タップ = 踏み込み（ボタンの上は除く）
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, a, [data-key], [data-steer]')) return;
      this.pressedSet.add('Tap');
    });
    // スマホの文字ボタンと ← → ボタン
    root.addEventListener('pointerdown', (e) => {
      const k = e.target.closest('[data-key]');
      if (k) {
        e.preventDefault();
        this.letters.push(k.dataset.key);
        k.classList.add('hit');
        setTimeout(() => k.classList.remove('hit'), 120);
      }
      const s = e.target.closest('[data-steer]');
      if (s) {
        e.preventDefault();
        this.touchSteer = +s.dataset.steer;
      }
    });
    const release = () => (this.touchSteer = 0);
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
  }

  // 踏み込み（SPACE またはタップ）
  stomp() {
    return this.pressedSet.has('Space') || this.pressedSet.has('Tap');
  }

  stompHeld() {
    return this.down.has('Space');
  }

  confirm() {
    return this.pressedSet.has('Space') || this.pressedSet.has('Enter') || this.pressedSet.has('Tap');
  }

  pressed(code) {
    return this.pressedSet.has(code);
  }

  get steer() {
    const k = (this.down.has('ArrowRight') ? 1 : 0) - (this.down.has('ArrowLeft') ? 1 : 0);
    return k || this.touchSteer;
  }

  // このフレームに打たれた文字（大文字）
  takeLetters() {
    const l = this.letters;
    this.letters = [];
    return l;
  }

  endFrame() {
    this.pressedSet.clear();
  }
}
