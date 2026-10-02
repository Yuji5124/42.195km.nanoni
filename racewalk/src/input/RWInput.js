// キーボード・ゲームパッド・タッチ。
//   ↑↓ / W S … ペース（5 段）  ←→ / A D … 横（追い越し・給水）  SPACE … 立て直す / 給水
//   1〜6 … ACTION  C … カメラ（顔 ⇔ 背中）  P / ESC … 一時停止  M … 音
//   ゲームパッド: 十字・左スティック = ペース/横、A = SPACE、Y = カメラ、LB/RB = ACTION の選択、X = 決定

export class RWInput {
  constructor() {
    this.down = new Set();
    this.pressedSet = new Set();
    this.touchLat = 0;
    this.padPrev = {};
    this.padSel = 0;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.pressedSet.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  press(code) {
    this.pressedSet.add(code);
  }

  pressed(code) {
    return this.pressedSet.has(code);
  }

  any(...codes) {
    return codes.some((c) => this.pressedSet.has(c));
  }

  held(...codes) {
    return codes.some((c) => this.down.has(c));
  }

  lat() {
    let x = 0;
    if (this.held('ArrowLeft', 'KeyA')) x -= 1;
    if (this.held('ArrowRight', 'KeyD')) x += 1;
    if (this.touchLat) x = this.touchLat;
    if (this.pad?.lat) x = this.pad.lat;
    return x;
  }

  // ゲームパッド（あれば）
  pollPad() {
    const pads = navigator.getGamepads?.() ?? [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) {
      this.pad = null;
      return;
    }
    const b = (i) => !!gp.buttons[i]?.pressed;
    const edge = (i, code) => {
      const now = b(i);
      if (now && !this.padPrev[i]) this.press(code);
      this.padPrev[i] = now;
    };
    edge(12, 'ArrowUp');
    edge(13, 'ArrowDown');
    edge(0, 'Space');
    edge(3, 'KeyC');
    edge(9, 'KeyP');
    edge(4, 'PadPrev');
    edge(5, 'PadNext');
    edge(2, 'PadOk');
    const ax = gp.axes[0] ?? 0;
    const ay = gp.axes[1] ?? 0;
    let lat = Math.abs(ax) > 0.35 ? Math.sign(ax) : 0;
    if (b(14)) lat = -1;
    if (b(15)) lat = 1;
    if (ay < -0.7 && !this.padPrev.up) this.press('ArrowUp');
    if (ay > 0.7 && !this.padPrev.dn) this.press('ArrowDown');
    this.padPrev.up = ay < -0.7;
    this.padPrev.dn = ay > 0.7;
    this.pad = { lat };
  }

  endFrame() {
    this.pressedSet.clear();
  }
}
