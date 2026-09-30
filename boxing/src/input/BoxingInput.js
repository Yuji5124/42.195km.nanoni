// 入力: キーボード（PC）+ 画面のボタン（タッチ）。操作はどのゲームシステムでも同じ:
//   A / D（← / →）= よける・動く / J = 左パンチ / K = 右パンチ / L = ガード（押している間）/ Space = アッパー（特殊）
// 押した瞬間（wasPressed）と押している間（isDown）を分けて持つ。1 フレームに間に合わなかった押下も落とさない。

const ALIAS = { ArrowLeft: 'KeyA', ArrowRight: 'KeyD', KeyZ: 'KeyJ', KeyX: 'KeyK' };

export class BoxingInput {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.log = []; // 直近の押下（リズム判定用）: { code, t }
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const code = ALIAS[e.code] ?? e.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.press(code);
    });
    addEventListener('keyup', (e) => this.release(ALIAS[e.code] ?? e.code));
    addEventListener('blur', () => this.releaseAll());
    // 画面のボタン
    document.querySelectorAll('#pad [data-key]').forEach((b) => {
      const code = b.dataset.key;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.setPointerCapture?.(e.pointerId);
        b.classList.add('on');
        this.press(code);
      });
      const up = () => {
        b.classList.remove('on');
        this.release(code);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
  }

  press(code) {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
    this.log.push({ code, t: performance.now() / 1000 });
    if (this.log.length > 16) this.log.shift();
  }

  release(code) {
    this.down.delete(code);
  }

  releaseAll() {
    this.down.clear();
  }

  isDown(code) {
    return this.down.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  anyPressed() {
    return this.pressed.size > 0;
  }

  // FightCore の入力の形（ゲームシステムが読み替える前の生の値）
  fight() {
    const left = this.wasPressed('KeyA');
    const right = this.wasPressed('KeyD');
    return {
      slip: left ? -1 : right ? 1 : 0,
      moveAxis: (this.isDown('KeyD') ? 1 : 0) - (this.isDown('KeyA') ? 1 : 0),
      jab: this.wasPressed('KeyJ'),
      straight: this.wasPressed('KeyK'),
      guard: this.isDown('KeyL'),
      special: this.wasPressed('Space'),
    };
  }

  endFrame() {
    this.pressed.clear();
  }
}
