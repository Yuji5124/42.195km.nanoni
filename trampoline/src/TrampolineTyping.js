import { createRng } from '../../src/core/math.js';

// 空中タイピング。
//   跳んだ瞬間に短い英単語が出る。打った文字の数・速さ・正確さで空中の技が決まる。
//   途中まででも効く（F = 少し回る / FL = 半回転 / FLI = 3/4 / FLIP = 1 回転）。
//   打ち終わると次の単語が出る → 速く打てば FLIP FLIP FLIP と技がつながる。
//   着地したら入力は終わり（空中にいる時間 = 入力できる時間）。
//
// WORDS: 単語 → 技。flip / twist / spin は回転数（1 = 1 回転）、trick は空中の姿勢（TrampolinePoser の POSES）

export const WORDS = {
  FLIP: { flip: 1, trick: 'tuck', name: '宙返り', tech: 800 },
  SPIN: { spin: 1, trick: 'layout', name: 'スピン', tech: 400 },
  TWIST: { twist: 1, trick: 'layout', name: 'ひねり', tech: 700 },
  POSE: { pose: 1, trick: 'star', name: 'ポーズ', tech: 500 },
  POWER: { flip: 2, trick: 'pike', name: '屈身 2 回宙返り', tech: 1500 },
  HIGH: { lift: 3.2, trick: 'layout', name: 'さらに上へ', tech: 400 },
  SLOW: { slow: 0.55, trick: 'air', name: 'スロー', tech: 300 },
  BALLERINA: { spin: 3, trick: 'ballerina', name: 'バレリーナ', tech: 1200 },
};

// テンポ（試技が進むほど出る単語が増える）
const POOLS = [
  ['FLIP', 'SPIN', 'TWIST', 'POSE'],
  ['FLIP', 'SPIN', 'TWIST', 'POSE', 'HIGH', 'SLOW'],
  ['FLIP', 'SPIN', 'TWIST', 'POSE', 'HIGH', 'SLOW', 'POWER', 'BALLERINA'],
];

export class TrampolineTyping {
  constructor(seed = 1) {
    this.rng = createRng(seed);
    this.active = false;
    this.reset();
  }

  reset() {
    this.active = false;
    this.word = null;
    this.typed = 0;
    this.done = [];
    this.correct = 0;
    this.miss = 0;
    this.firstAt = -1;
    this.lastAt = 0;
    this.wordStart = 0;
    this.fastWords = 0;
    this.base = { flip: 0, twist: 0, spin: 0 };
    this.missFlash = 0;
  }

  // 跳んだ瞬間: 最初の単語
  begin(level, now, first = null) {
    this.reset();
    this.level = Math.min(level, POOLS.length - 1);
    this.active = true;
    this.set(first ?? this.pick(), now);
  }

  pick(prev = null) {
    const pool = POOLS[this.level];
    // 同じ単語が続きやすい（FLIP FLIP FLIP）。BALLERINA は連続しない
    if (prev && prev !== 'BALLERINA' && prev !== 'SLOW' && prev !== 'HIGH' && this.rng.chance(0.45)) return prev;
    let w = this.rng.pick(pool);
    if (w === 'BALLERINA' && this.rng.chance(0.6)) w = this.rng.pick(POOLS[0]);
    return w;
  }

  set(word, now) {
    this.word = word;
    this.typed = 0;
    this.wordStart = now;
  }

  // 着地: 入力を締め切る
  end() {
    this.active = false;
  }

  get def() {
    return WORDS[this.word];
  }

  // 今の単語の進み具合（0〜1）
  get progress() {
    return this.word ? this.typed / this.word.length : 0;
  }

  // 1 文字。返り値: { ok, complete, word }
  key(ch, now) {
    if (!this.active || !this.word) return null;
    if (this.firstAt < 0) this.firstAt = now;
    this.lastAt = now;
    if (this.word[this.typed] !== ch) {
      this.miss++;
      this.missFlash = 1;
      return { ok: false };
    }
    this.correct++;
    this.typed++;
    if (this.typed < this.word.length) return { ok: true, word: this.word };
    // 打ち終わった → 技を確定して次の単語
    const word = this.word;
    const d = WORDS[word];
    this.base.flip += d.flip ?? 0;
    this.base.twist += d.twist ?? 0;
    this.base.spin += d.spin ?? 0;
    const perChar = (now - this.wordStart) / word.length;
    const fast = perChar < 0.26;
    if (fast) this.fastWords++;
    this.done.push({ word, time: now - this.wordStart, fast });
    this.set(this.pick(word), now);
    return { ok: true, complete: true, word, fast };
  }

  // 回転の目標（打ち終わった単語 + 今の単語の途中まで）
  targets() {
    const d = this.def ?? {};
    const p = this.progress;
    return {
      flip: this.base.flip + (d.flip ?? 0) * p,
      twist: this.base.twist + (d.twist ?? 0) * p,
      spin: this.base.spin + (d.spin ?? 0) * p,
    };
  }

  // 空中の姿勢: 打っている単語の技。打ち始めていなければ直前に決めた技
  trick() {
    if (this.word && this.typed > 0) return WORDS[this.word].trick;
    const last = this.done[this.done.length - 1];
    return last ? WORDS[last.word].trick : null;
  }

  // スマホ用: 次の文字 + まぎらわしい文字 3 つ
  choices() {
    if (!this.word) return [];
    const next = this.word[this.typed];
    const pool = 'FLIPSNTWOERABHGC'.split('').filter((c) => c !== next);
    const out = [next];
    while (out.length < 4) {
      const c = pool[Math.floor(this.rng.next() * pool.length)];
      if (!out.includes(c)) out.push(c);
    }
    // 並びは固定の乱数で混ぜる（押す場所を覚えられないように）
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // 1 回の跳躍のまとめ（採点用）
  summary() {
    const total = this.correct + this.miss;
    const dur = this.firstAt >= 0 ? Math.max(0.3, this.lastAt - this.firstAt) : 0;
    return {
      words: this.done.map((d) => d.word),
      partial: this.word && this.typed > 0 ? this.word.slice(0, this.typed) : '',
      correct: this.correct,
      miss: this.miss,
      accuracy: total ? this.correct / total : 0,
      cps: dur ? this.correct / dur : 0,
      fastWords: this.fastWords,
    };
  }
}
