// 決定的な乱数。同じ seed なら同じレース（なのに。の順番・CPU の性格・観客）になる。
// システムごとに独立したストリームを持つ（片方で乱数を多く引いても、もう片方の結果は変わらない）。

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  int(a, b) {
    return Math.floor(a + (b - a + 1) * this.next());
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  // weights: [{ item, w }]
  weighted(list) {
    let total = 0;
    for (const e of list) total += e.w;
    let r = this.next() * total;
    for (const e of list) {
      r -= e.w;
      if (r <= 0) return e.item;
    }
    return list[list.length - 1]?.item;
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// seed + 名前 → 独立したストリーム
export class SeedBank {
  constructor(seed) {
    this.seed = seed >>> 0;
  }

  stream(name) {
    return new Rng((this.seed ^ hashString(name)) >>> 0);
  }
}

export function randomSeed() {
  return 1000 + Math.floor(Math.random() * 9000);
}
