// 軽いばね（二次モーション）。減衰を強めにして「少し遅れてついてくる」程度にする。

export class Spring {
  constructor(k, c, x0 = 0) {
    this.k = k;
    this.c = c;
    this.x0 = x0;
    this.reset();
  }

  reset() {
    this.x = this.x0;
    this.v = 0;
  }

  step(dt, target) {
    // 半陰的オイラー（dt ≦ 0.05 で安定）
    const a = this.k * (target - this.x) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

// 2 軸（pitch / roll）
export class Spring2 {
  constructor(k, c, x0 = 0, y0 = 0) {
    this.x = new Spring(k, c, x0);
    this.y = new Spring(k, c, y0);
  }

  reset() {
    this.x.reset();
    this.y.reset();
  }

  step(dt, tx, ty) {
    this.x.step(dt, tx);
    this.y.step(dt, ty);
  }
}
