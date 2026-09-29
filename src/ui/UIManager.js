import { formatRaceTime, formatRaceTimeMs } from '../core/math.js';

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
      distTotal: $('distTotal'),
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

  // タイトルで 800m（別ページ）を選んでいる間の表示。on=false でいまのモードの表示に戻す
  select800(on, mode = this.mode) {
    document.querySelectorAll('[data-mode]').forEach((c) => c.classList.toggle('selected', on ? c.dataset.mode === '800m' : c.dataset.mode === mode?.id));
    if (on) {
      $('titleA').textContent = '800m、';
      $('titleB').textContent = 'なのに。';
      $('titleNote').innerHTML = '2周だけなのに、何回ゲーム変わるの？<br />12 人・400m トラック 2 周。SPACE / TAP で 800m のページへ移動します。';
    } else if (mode) {
      $('titleA').textContent = mode.title[0];
      $('titleB').textContent = mode.title[1];
      $('titleNote').innerHTML = mode.note;
    }
  }

  // タイトル・HUD・リザルトの表記をモードに合わせる
  setRaceMode(mode, total) {
    this.mode = mode;
    this.cache = {};
    this.setTVTitle(mode.tvTitle ?? 'TOKYO DIGITAL MARATHON<br /><small>生中継</small>');
    this.setTicker(false);
    this.setMirrorHUD(false);
    this.setCheerFocus(false);
    document.body.dataset.race = mode.id;
    $('titleA').textContent = mode.title[0];
    $('titleB').textContent = mode.title[1];
    $('titleNote').innerHTML = mode.note;
    document.querySelectorAll('[data-mode]').forEach((c) => c.classList.toggle('selected', c.dataset.mode === mode.id));
    this.el.posTotal.textContent = total;
    const meters = mode.distUnit === 'm';
    this.el.distTotal.textContent = meters ? ` / ${Math.round(mode.fullKm * 1000)}m` : ` / ${mode.fullKm} km`;
    this.el.dist.textContent = meters ? '0000' : '0.000';
    this.el.progSlice.classList.toggle('hidden', meters);
    if (!meters) this.setSliceGoal(mode.data.goalKm, mode.fullKm);
    this.el.progMe.style.width = '0%';
  }

  formatTime(t) {
    return this.mode?.timeFormat === 'ms' ? formatRaceTimeMs(t) : formatRaceTime(t);
  }

  formatDist(km) {
    return this.mode?.distUnit === 'm' ? String(Math.floor(km * 1000 + 1e-6)).padStart(4, '0') : km.toFixed(3);
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
    this.set('dist', this.formatDist(s.km), (v) => (this.el.dist.textContent = v));
    this.set('prog', Math.round(s.km * 400), () => (this.el.progMe.style.width = `${(s.km / s.fullKm) * 100}%`));
    this.set('time', this.formatTime(s.time), (v) => (this.el.time.textContent = v));
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
      if (this.mode?.distUnit === 'm') {
        this.set('tvKm', Math.max(0, Math.ceil((s.fullKm - s.km) * 100) * 10), (v) => (this.el.tvKm.textContent = `残り ${v}m`));
      } else {
        this.set('tvKm', s.km.toFixed(1), (v) => (this.el.tvKm.textContent = `${v}km`));
      }
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

  // 1500m のツイスト: 「なのに。」の一言と COMBO
  nanoni(text, combo = '') {
    const el = (this.el.nanoni ??= document.getElementById('nanoni'));
    const ce = (this.el.nanoniCombo ??= document.getElementById('nanoniCombo'));
    if (!el) return;
    el.textContent = text;
    ce.textContent = combo;
    for (const e of [el, ce]) {
      e.classList.remove('show');
      void e.offsetWidth;
    }
    el.classList.add('show');
    if (combo) ce.classList.add('show');
  }

  // 偽のバグ表示（本物のエラーではない）
  fakeBug(on, t) {
    const el = (this.el.fakebug ??= document.getElementById('fakebug'));
    if (!el) return;
    if (on !== this.fakeOn) {
      this.fakeOn = on;
      el.classList.toggle('hidden', !on);
    }
    if (!on) return;
    const lines = ['FPS 3', `PING ${9000 + Math.floor((t * 37) % 999)}`, 'POSITION NaN', 'DISTANCE ????m', 'MEMORY ERROR 0x1500', 'TOKYO NOT FOUND'];
    el.textContent = lines.slice(0, 3 + (Math.floor(t * 2) % 4)).join('\n');
  }

  // 横スクロールの跳ぶ合図: 近づくと「▼ SPACE」、越えられる瞬間に大きく「JUMP!」
  jumpCue(cue, touch) {
    const el = (this.el.jumpcue ??= document.getElementById('jumpcue'));
    if (!el) return;
    const state = !cue ? '' : cue.now ? 'now' : cue.t < 1.1 ? 'soon' : '';
    if (state === this.jumpState) return;
    this.jumpState = state;
    el.className = `jumpcue ${state}`;
    el.textContent = state === 'now' ? 'JUMP!' : state === 'soon' ? (touch ? '▼ JUMP ボタン' : '▼ SPACE') : '';
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

  // ---- 1500m の演出用
  bigDist(main, sub, ms = 2600) {
    const el = $('bigDist');
    el.querySelector('b').textContent = main;
    el.querySelector('small').textContent = sub;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.timers.big);
    this.timers.big = setTimeout(() => el.classList.remove('show'), ms);
  }

  setTicker(on) {
    $('ticker').classList.toggle('hidden', !on);
    this.cache.tkScroll = this.cache.tkLap = this.cache.tkLapTime = undefined;
  }

  // lap: 'LAP 3 / 4' / scroll: 流れる文字 / lastLap: 鐘が鳴った後
  ticker({ lap, lapTime, scroll, lastLap }) {
    this.set('tkLap', lap, (v) => ($('tkLap').textContent = v));
    this.set('tkLapTime', lapTime, (v) => ($('tkLapTime').textContent = v));
    this.set('tkScroll', scroll, (v) => ($('tkScroll').textContent = v));
    this.set('tkLast', lastLap, (v) => $('ticker').classList.toggle('last-lap', v));
  }

  // 写真判定の静止画に重ねる線とタイム
  photoFinish(time, position) {
    $('pfTime').textContent = time;
    $('pfPos').textContent = `${position} / 12 ─ ${position === 1 ? 'WINNER' : 'FINISH'}`;
    const el = $('photoFinish');
    el.classList.remove('hidden');
    clearTimeout(this.timers.pf);
    this.timers.pf = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  setTVTitle(html) {
    $('tvTitle').innerHTML = html;
  }

  setMirrorHUD(on) {
    this.el.hud.classList.toggle('mirrored', on);
  }

  setCheerFocus(on) {
    this.el.hud.classList.toggle('cheer-focus', on);
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
    c.classList.toggle('long', [...(text ?? '')].length >= 3);
    c.classList.remove('show');
    void c.offsetWidth;
    if (text) c.classList.add('show');
  }

  showResult(stats) {
    if (stats.mode?.id === '1500m') return this.showResult1500(stats);
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
      ${this.hadList(stats.twists)}
      <div class="again">SPACE / TAP でもう一度走る</div>
      <button class="to-title" data-action="title">T ─ タイトルへ（モード選択）</button>
    `;
    this.el.result.classList.remove('hidden');
  }

  // 1500m のリザルト: TIME / POSITION / CHEER / OVERTAKES / NEAR MISS / MAX SPEED
  showResult1500(stats) {
    const rank = stats.cheer >= 16000 ? 'S' : stats.cheer >= 10000 ? 'A' : stats.cheer >= 6000 ? 'B' : 'C';
    const titles = {
      S: 'ジャンルを全部走り抜けた人',
      A: '東京を沸かせた中距離ランナー',
      B: '中継に映ったランナー',
      C: 'まじめに 1500m を走った人',
    };
    const row = (k, v) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;
    const wr = stats.time < 206;
    const podium = stats.position === 1 ? '優勝' : stats.position <= 3 ? '表彰台' : `${stats.position}位`;
    this.el.resultBody.innerHTML = `
      <div class="complete">1500m ${podium}</div>
      <div class="sub">${wr ? '世界記録…!? ' : ''}1500mしか走っていません。</div>
      <div class="grid">
        ${row('TIME', formatRaceTimeMs(stats.time))}
        ${row('POSITION', `${stats.position} / ${stats.total}`)}
        ${row('CHEER', stats.cheer.toLocaleString('en-US'))}
        ${row('OVERTAKES', stats.overtakes)}
        ${row('NEAR MISS', stats.nearMiss ?? 0)}
        ${row('MAX SPEED', `${stats.maxKmh.toFixed(1)} km/h`)}
      </div>
      <div class="rank"><span class="grade g${rank}">${rank}</span><div><small>盛り上げ度</small><div>${titles[rank]}</div></div></div>
      ${this.hadList(stats.twists)}
      <div class="again">SPACE / TAP でもう一度走る</div>
      <button class="to-title" data-action="title">T ─ タイトルへ（モード選択）</button>
    `;
    this.el.result.classList.remove('hidden');
  }

  // 「THIS RACE HAD:」（1500m のツイストの記録。最大 COMBO も）
  hadList(tw) {
    if (!tw?.history?.length) return '';
    const chips = tw.history.map((h) => `<li>${h.name}<small>${h.m}m</small></li>`);
    if (tw.maxCombo >= 2) chips.push(`<li class="combo">最大なのにCOMBO ×${tw.maxCombo}</li>`);
    return `<div class="had"><div class="had-title">THIS RACE HAD:</div><ul>${chips.join('')}</ul></div>`;
  }

  hideResult() {
    this.el.result.classList.add('hidden');
  }

  debug(text) {
    this.el.debug.classList.remove('hidden');
    this.el.debug.textContent = text;
  }
}
