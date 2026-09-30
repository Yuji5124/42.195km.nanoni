// Performance Governor: 端末の速さで重さを自動調整する。
// 変えるもの: pixelRatio / 近くの 3D 観客の人数 / 大型ビジョンの解像度と更新頻度 / alpha-to-coverage / 紙吹雪
// 変えないもの: 観客 100,000 人（LOW でも VERY LOW でも満員の 10 万人スタジアム）
//
// 1 秒ごとに FPS を測り、目標を 3 秒続けて下回ったら 1 段下げる。十分速ければ 10 秒後に 1 段上げる（上げるのは 1 回まで）。

export const QUALITY = [
  { name: 'HIGH', pixelRatio: 2, near: 1500, broadcast: 0, a2c: true, confetti: 1200 },
  { name: 'MEDIUM', pixelRatio: 1.5, near: 1000, broadcast: 1, a2c: true, confetti: 800 },
  { name: 'LOW', pixelRatio: 1.15, near: 600, broadcast: 2, a2c: true, confetti: 450 },
  { name: 'VERY LOW', pixelRatio: 0.85, near: 320, broadcast: 3, a2c: false, confetti: 200 },
];

export class PerformanceGovernor {
  constructor({ touch = false, forced = null, onChange = () => {} } = {}) {
    this.touch = touch;
    this.onChange = onChange;
    const names = { high: 0, medium: 1, low: 2, verylow: 3 };
    this.locked = forced !== null && forced in names;
    this.level = this.locked ? names[forced] : touch ? 1 : 0;
    this.target = touch ? 40 : 52;
    this.acc = 0;
    this.frames = 0;
    this.low = 0;
    this.high = 0;
    this.ups = 0;
    this.fps = 60;
    this.warm = 3; // 最初の数秒（シェーダーのコンパイル等）は数えない
  }

  get q() {
    return QUALITY[this.level];
  }

  sample(dt) {
    this.acc += dt;
    this.frames++;
    if (this.acc < 1) return;
    this.fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (this.warm > 0) {
      this.warm--;
      return;
    }
    if (this.locked) return;
    if (this.fps < this.target) {
      this.low++;
      this.high = 0;
    } else {
      this.low = Math.max(0, this.low - 1);
      if (this.fps > this.target + 14) this.high++;
    }
    if (this.low >= 3 && this.level < QUALITY.length - 1) {
      this.set(this.level + 1);
      this.low = 0;
      this.warm = 2;
    } else if (this.high >= 10 && this.level > 0 && this.ups < 1) {
      this.ups++;
      this.set(this.level - 1);
      this.high = 0;
      this.warm = 2;
    }
  }

  set(level) {
    if (level === this.level) return;
    this.level = level;
    console.info(`[soccer] quality -> ${this.q.name}`);
    this.onChange(this.q, level);
  }
}
