// 中継の画面（DOM）。演出が狂うほど、ここは真面目に。
//   左上: LIVE と競技名 / 右上: PLAYER・ATTEMPT・TOTAL / 左下: HEIGHT・ROTATION・LANDING・SCORE
//   中央: 空中タイピングの単語 / 右: 得点の内訳が流れる / 下: 実況（字幕）
// 宇宙まで飛んでも ATTEMPT 9/10 は出たまま。

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

const CAT_JP = {
  TECHNIQUE: '技',
  TYPING: '入力',
  LANDING: '着地',
  AUDIENCE: '観客',
  CAMERA: 'カメラ',
  BACKGROUND: '背景',
  ACCIDENT: '事故',
  NANONI: 'なのに',
};

export class TrampolineHUD {
  constructor() {
    this.el = {
      hud: $('hud'),
      attempt: $('attempt'),
      total: $('total'),
      height: $('height'),
      rotation: $('rotation'),
      landing: $('landing'),
      score: $('score'),
      word: $('word'),
      wordText: $('wordText'),
      wordName: $('wordName'),
      chain: $('chain'),
      feed: $('feed'),
      nanoni: $('nanoni'),
      commentary: $('commentary'),
      result: $('result'),
      meter: $('meter'),
      meterFill: $('meterFill'),
      meterLabel: $('meterLabel'),
      keys: $('keys'),
      steer: $('steer'),
      caption: $('caption'),
      zone: $('zone'),
      final: $('final'),
      intro: $('intro'),
      pause: $('pause'),
      radar: $('radar'),
      radarDot: $('radarDot'),
      muteBtn: $('muteBtn'),
    };
    this.commentT = 0;
    this.nanoniT = 0;
    this.captionT = 0;
    this.lastKeys = '';
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  setAttempt(n, of) {
    this.el.attempt.textContent = `${n}/${of}`;
  }

  setTotal(v) {
    this.el.total.textContent = fmt(v);
  }

  // 数字は毎フレーム（文字列が変わった時だけ DOM を触る）
  setStats({ height, rotation, landing, score }) {
    const h = height >= 1000 ? `${(height / 1000).toFixed(2)}km` : `${height.toFixed(2)}m`;
    this.text(this.el.height, h);
    this.text(this.el.rotation, rotation.toFixed(2));
    this.text(this.el.landing, landing);
    this.text(this.el.score, fmt(score));
  }

  text(el, v) {
    if (el._v !== v) {
      el._v = v;
      el.textContent = v;
    }
  }

  // ---- 空中タイピング
  showWord(typing, { touch = false } = {}) {
    const w = typing.word;
    if (!w) return this.hideWord();
    this.el.word.classList.remove('hidden');
    const key = `${w}:${typing.typed}:${typing.done.length}`;
    if (key !== this.wordKey) {
      this.wordKey = key;
      const done = w.slice(0, typing.typed);
      const next = w[typing.typed] ?? '';
      const rest = w.slice(typing.typed + 1);
      this.el.wordText.innerHTML = `<b>${done}</b><u>${next}</u><i>${rest}</i>`;
      this.el.wordName.textContent = typing.def?.name ?? '';
      const chain = typing.done.map((d) => d.word);
      // 長くなったら最後の 8 語だけ
      this.el.chain.textContent = chain.length > 8 ? `… ${chain.slice(-8).join(' · ')}  ×${chain.length}` : chain.join(' · ');
      if (touch) this.showKeys(typing.choices());
    }
    if (typing.missFlash > 0) {
      this.el.word.classList.add('miss');
      clearTimeout(this.missTimer);
      this.missTimer = setTimeout(() => this.el.word.classList.remove('miss'), 160);
      typing.missFlash = 0;
    }
  }

  hideWord() {
    this.wordKey = '';
    this.el.word.classList.add('hidden');
    this.showKeys(null);
  }

  showKeys(letters) {
    const s = letters ? letters.join('') : '';
    if (s === this.lastKeys) return;
    this.lastKeys = s;
    this.el.keys.classList.toggle('hidden', !letters);
    this.el.keys.innerHTML = letters ? letters.map((c) => `<button data-key="${c}">${c}</button>`).join('') : '';
  }

  showSteer(on) {
    this.el.steer.classList.toggle('hidden', !on);
  }

  // 空から帰る時のずれ（x: -1〜1）
  radar(on, x = 0) {
    this.el.radar.classList.toggle('hidden', !on);
    if (on) this.el.radarDot.style.transform = `translateX(${(x * 110).toFixed(1)}px)`;
  }

  // ---- 得点の内訳（右に流れる）
  feed(item) {
    const d = document.createElement('div');
    d.className = `feed-item cat-${item.cat.toLowerCase()}${item.big ? ' big' : ''}${item.points < 0 ? ' minus' : ''}`;
    d.innerHTML = `<span class="cat">${CAT_JP[item.cat] ?? ''}</span><span class="lbl">${item.label}</span><b>${item.points >= 0 ? '+' : ''}${fmt(item.points)}</b>`;
    this.el.feed.appendChild(d);
    while (this.el.feed.children.length > 7) this.el.feed.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 4200);
    setTimeout(() => d.remove(), 4800);
  }

  clearFeed() {
    this.el.feed.innerHTML = '';
  }

  // 「〜なのに、〜！」（大きく）
  nanoni(text, points) {
    const el = this.el.nanoni;
    el.innerHTML = `${text}${points ? `<small>+${fmt(points)}</small>` : ''}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.nanoniT = 2.6;
  }

  // 実況（真面目）
  comment(text, sec = 3.2) {
    const el = this.el.commentary;
    el.innerHTML = `<span class="mic">実況</span>${text}`;
    el.classList.add('show');
    this.commentT = sec;
  }

  // 画面中央の小さな字幕（観客ドラマの台詞など）
  caption(text, sec = 2) {
    const el = this.el.caption;
    el.textContent = text;
    el.classList.toggle('show', !!text);
    this.captionT = text ? sec : 0;
  }

  // 高度のゾーン名（STADIUM / CITY / CLOUD / SKY / STRATOSPHERE / SPACE）
  zone(name) {
    const el = this.el.zone;
    if (el._v === name) return;
    el._v = name;
    el.textContent = name ?? '';
    el.classList.toggle('show', !!name);
  }

  // 踏み込みのタイミング表示: phase 0〜1（1 = ベッドの底 = 今！）
  meter(visible, phase = 0, label = '') {
    this.el.meter.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.el.meterFill.style.transform = `scaleX(${phase.toFixed(3)})`;
    this.el.meter.classList.toggle('now', phase > 0.82);
    this.text(this.el.meterLabel, label);
  }

  // ---- 試技の結果（内訳・審判・合計）
  showResult(rec, attempt, of, total) {
    const el = this.el.result;
    // 項目が多すぎる時（空の旅など）: 大きい順に 10 項目 + 「その他」
    let items = rec.items;
    // 画面の高さに入る行数（小さい画面ほど少なく）
    const rows = Math.max(4, Math.min(12, Math.floor((window.innerHeight - 330) / 24)));
    if (items.length > rows) {
      const keep = new Set([...items].sort((a, b) => b.points - a.points).slice(0, rows - 1));
      const rest = items.filter((i) => !keep.has(i));
      items = items.filter((i) => keep.has(i));
      items.push({ cat: 'TECHNIQUE', label: `その他 ${rest.length} 項目`, points: rest.reduce((s, i) => s + i.points, 0) });
    }
    const list = items
      .map((i) => `<li class="cat-${i.cat.toLowerCase()}"><span>${i.label}</span><b>${i.points >= 0 ? '+' : ''}${fmt(i.points)}</b></li>`)
      .join('');
    el.innerHTML = `
      <div class="r-head"><span>ATTEMPT ${attempt}/${of}</span><span>侍 SAMURAI · JPN</span></div>
      <div class="r-judges">${rec.cards.map((c) => `<i>${c.toFixed(1)}</i>`).join('')}<em>E ${rec.official.toFixed(2)}</em></div>
      <ul>${list}</ul>
      <div class="r-sum"><span>SCORE</span><b>${fmt(rec.sum)}</b></div>
      <div class="r-total"><span>TOTAL</span><b>${fmt(total)}</b></div>`;
    el.classList.remove('hidden');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  hideResult() {
    this.el.result.classList.add('hidden');
    this.el.result.classList.remove('show');
  }

  showFinal(scoring, extra = {}) {
    const el = this.el.final;
    const cats = Object.entries(scoring.byCat)
      .map(([k, v]) => `<li><span>${k}</span><small>${CAT_JP[k]}</small><b>${fmt(v)}</b></li>`)
      .join('');
    const best = scoring.history.reduce((a, r, i) => (r.sum > (a?.sum ?? -1) ? { sum: r.sum, i } : a), null);
    el.querySelector('.f-total').textContent = fmt(scoring.total);
    el.querySelector('.f-cats').innerHTML = cats;
    el.querySelector('.f-best').textContent = best ? `BEST ATTEMPT ${best.i + 1} · ${fmt(best.sum)}` : '';
    el.querySelector('.f-note').textContent = extra.note ?? '';
    el.classList.remove('hidden');
  }

  hideFinal() {
    this.el.final.classList.add('hidden');
  }

  update(realDt) {
    if (this.commentT > 0) {
      this.commentT -= realDt;
      if (this.commentT <= 0) this.el.commentary.classList.remove('show');
    }
    if (this.nanoniT > 0) {
      this.nanoniT -= realDt;
      if (this.nanoniT <= 0) this.el.nanoni.classList.remove('show');
    }
    if (this.captionT > 0) {
      this.captionT -= realDt;
      if (this.captionT <= 0) this.el.caption.classList.remove('show');
    }
  }
}
