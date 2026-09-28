import { formatRaceTime } from '../core/math.js';

// UIManager: DOM オーバーレイ。常に大量の情報は出さない。
// 常設: 左上 POSITION / 中央上 CHEER / 右上 DISTANCE / 下 STAMINA
// 一時: COMBO・OVERTAKE などのポップ、「なのに。」キャプション、実況、LIVE テロップ

const $ = (id) => document.getElementById(id);

export class UIManager {
  constructor() {
    this.el = {
      hud: $('hud'),
      pos: $('pos'),
      posTotal: $('posTotal'),
      cheer: $('cheer'),
      combo: $('combo'),
      dist: $('dist'),
      progMe: $('progMe'),
      progSlice: $('progSlice'),
      time: $('time'),
      stamina: $('stamina'),
      staminaWrap: $('staminaWrap'),
      speed: $('speed'),
      area: $('area'),
      camTag: $('camTag'),
      popups: $('popups'),
      caption: $('caption'),
      hint: $('hint'),
      commentary: $('commentary'),
      tv: $('tv'),
      tvPos: $('tvPos'),
      tvKm: $('tvKm'),
      countdown: $('countdown'),
      title: $('title'),
      result: $('result'),
      resultBody: $('resultBody'),
      touch: $('touch'),
      debug: $('debug'),
      fever: $('fever'),
    };
    this.cache = {};
    this.timers = {};
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  showTitle(show) {
    this.el.title.classList.toggle('hidden', !show);
  }

  showHUD(show) {
    this.el.hud.classList.toggle('hidden', !show);
  }

  showTouch(show) {
    this.el.touch.classList.toggle('hidden', !show);
  }

  setModeClass(mode) {
    document.body.dataset.mode = mode;
  }

  setSliceGoal(goalKm, fullKm) {
    this.el.progSlice.style.left = `${(goalKm / fullKm) * 100}%`;
  }

  // s: { position, total, cheer, combo, comboMul, km, fullKm, time, stamina, exhausted, kmh, area, tier }
  update(s) {
    this.set('pos', s.position, (v) => (this.el.pos.textContent = v));
    this.set('posTotal', s.total, (v) => (this.el.posTotal.textContent = v));
    this.set('leader', s.position === 1, (v) => this.el.hud.classList.toggle('leader', v));
    this.set('cheer', s.cheer, (v) => (this.el.cheer.textContent = v.toLocaleString('en-US')));
    this.set('combo', s.combo, (v) => {
      this.el.combo.textContent = v >= 2 ? `COMBO ×${v}` : '';
      this.el.combo.classList.toggle('show', v >= 2);
    });
    this.set('dist', s.km.toFixed(3), (v) => (this.el.dist.textContent = v));
    this.set('prog', Math.round(s.km * 400), () => (this.el.progMe.style.width = `${(s.km / s.fullKm) * 100}%`));
    this.set('time', formatRaceTime(s.time), (v) => (this.el.time.textContent = v));
    this.set('stamina', Math.round(s.stamina), (v) => (this.el.stamina.style.width = `${v}%`));
    this.set('exhausted', s.exhausted, (v) => this.el.staminaWrap.classList.toggle('exhausted', v));
    this.set('speed', s.kmh.toFixed(1), (v) => (this.el.speed.textContent = v));
    this.set('area', s.area, (v) => {
      this.el.area.textContent = v;
      this.el.area.classList.remove('flash');
      void this.el.area.offsetWidth;
      this.el.area.classList.add('flash');
    });
    this.set('tier', s.tier, (v) => (this.el.hud.dataset.tier = v));
    if (this.tvOn) {
      this.set('tvPos', s.position, (v) => (this.el.tvPos.textContent = `${v}位`));
      this.set('tvKm', s.km.toFixed(1), (v) => (this.el.tvKm.textContent = `${v}km`));
    }
  }

  popup(label, amount, { big = false, color = null } = {}) {
    const d = document.createElement('div');
    d.className = `popup${big ? ' big' : ''}`;
    if (color) d.style.color = color;
    d.innerHTML = `<span>${label}</span>${amount ? `<b>${amount > 0 ? '+' : ''}${amount}</b>` : ''}`;
    if (amount < 0) d.classList.add('minus');
    this.el.popups.appendChild(d);
    while (this.el.popups.children.length > 4) this.el.popups.firstChild.remove();
    setTimeout(() => d.remove(), 1300);
  }

  caption(main, sub = '', ms = 2800) {
    const c = this.el.caption;
    c.querySelector('.main').textContent = main;
    c.querySelector('.sub').textContent = sub;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
    clearTimeout(this.timers.caption);
    this.timers.caption = setTimeout(() => c.classList.remove('show'), ms);
  }

  hint(text, ms = 4000) {
    const h = this.el.hint;
    h.textContent = text;
    h.classList.add('show');
    clearTimeout(this.timers.hint);
    this.timers.hint = setTimeout(() => h.classList.remove('show'), ms);
  }

  say(text, ms = 3600) {
    const c = this.el.commentary;
    c.innerHTML = `<span class="mic">実況</span>${text}`;
    c.classList.add('show');
    clearTimeout(this.timers.say);
    this.timers.say = setTimeout(() => c.classList.remove('show'), ms);
  }

  setTV(on) {
    this.tvOn = on;
    this.el.tv.classList.toggle('hidden', !on);
    this.cache.tvPos = this.cache.tvKm = undefined;
  }

  // 監視カメラの REC 表示。タイムスタンプは東京マラソン当日の朝（スタート 9:10）+ レース時計
  setCCTV(on) {
    this.cctvOn = on;
    $('cctv').classList.toggle('hidden', !on);
  }

  cctvCam(label) {
    $('cctvCam').textContent = label;
  }

  cctvTime(raceTime) {
    if (!this.cctvOn) return;
    const t = 9 * 3600 + 10 * 60 + Math.floor(raceTime);
    const hh = String(Math.floor(t / 3600)).padStart(2, '0');
    const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    this.set('cctvStamp', `${hh}${mm}${ss}`, () => ($('cctvStamp').textContent = `2027.03.07 SUN ${hh}:${mm}:${ss}`));
  }

  camTag(text, ms = 1800) {
    const c = this.el.camTag;
    c.textContent = text;
    c.classList.add('show');
    clearTimeout(this.timers.cam);
    this.timers.cam = setTimeout(() => c.classList.remove('show'), ms);
  }

  fever(text, ms = 1600) {
    const f = this.el.fever;
    f.textContent = text;
    f.classList.remove('show');
    void f.offsetWidth;
    f.classList.add('show');
    clearTimeout(this.timers.fever);
    this.timers.fever = setTimeout(() => f.classList.remove('show'), ms);
  }

  countdown(text) {
    const c = this.el.countdown;
    c.textContent = text;
    c.classList.remove('show');
    void c.offsetWidth;
    if (text) c.classList.add('show');
  }

  showResult(stats) {
    const rank = stats.cheer >= 42000 ? 'S' : stats.cheer >= 28000 ? 'A' : stats.cheer >= 17000 ? 'B' : 'C';
    const titles = {
      S: '新宿を揺らした主役',
      A: '沿道のアイドル',
      B: '中継に映ったランナー',
      C: 'まじめに走った人',
    };
    const row = (k, v) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;
    this.el.resultBody.innerHTML = `
      <div class="complete">${stats.km.toFixed(3)} km COMPLETE</div>
      <div class="sub">VERTICAL SLICE ─ 残り ${(42.195 - stats.km).toFixed(3)} km は、また今度。</div>
      <div class="grid">
        ${row('TIME', formatRaceTime(stats.time))}
        ${row('POSITION', `${stats.position} / ${stats.total}`)}
        ${row('CHEER', stats.cheer.toLocaleString('en-US'))}
        ${row('MAX SPEED', `${stats.maxKmh.toFixed(1)} km/h`)}
        ${row('OVERTAKES', stats.overtakes)}
        ${row('FALLS', stats.falls)}
        ${row('CHEER COMBO', `×${stats.maxCombo}`)}
        ${row('CAMERA CHANGES', stats.cameraChanges)}
      </div>
      <div class="rank"><span class="grade g${rank}">${rank}</span><div><small>盛り上げ度</small><div>${titles[rank]}</div></div></div>
      <div class="again">SPACE / TAP でもう一度走る</div>
    `;
    this.el.result.classList.remove('hidden');
  }

  hideResult() {
    this.el.result.classList.add('hidden');
  }

  debug(text) {
    this.el.debug.classList.remove('hidden');
    this.el.debug.textContent = text;
  }
}
