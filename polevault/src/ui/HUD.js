// 画面の表示（DOM）。ファインダーの印・中継の数字・下の名前の帯・実況の字幕・独り言・合図・AI CAMERA JUDGE。
// 3D の中央（被写体）は隠さない: 情報は四隅に小さく。

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.cache = {};
    this.subs = $('subs');
    this.mono = $('mono');
    this.cueEl = $('cue');
    this.pops = $('pops');
    this.hints = $('hints');
    this.judgeT = 0;
    this.lineTimers = [];
    this.graph = $('vGraph').getContext('2d');
  }

  set(id, text) {
    if (this.cache[id] === text) return;
    this.cache[id] = text;
    $(id).textContent = text;
  }

  showLive(on) {
    $('hud').classList.toggle('hidden', !on);
  }

  showVF(on) {
    $('vf').classList.toggle('hidden', !on);
  }

  tally(state) {
    const el = $('tally');
    if (this.cache.tally === state) return;
    this.cache.tally = state;
    el.classList.toggle('on', state === 'onair');
    el.textContent = state === 'onair' ? '● ON AIR' : state === 'off' ? 'OFF AIR' : 'STANDBY';
  }

  viewfinder(cam, t, shots, af) {
    this.set('zoomVal', `${cam.zoom.toFixed(1)}x`);
    $('zoomFill').style.width = `${(Math.log(cam.zoom) / Math.log(50)) * 100}%`;
    this.set('focusVal', cam.focus > 400 ? '∞' : `${cam.focus.toFixed(1)}m`);
    this.set('focusMode', af);
    const fm = $('focusMode');
    fm.classList.toggle('mf', af !== 'AF');
    const tc = Math.max(0, t);
    const f = Math.floor((tc % 1) * 30);
    this.set('timecode', `00:${String(Math.floor(tc / 60)).padStart(2, '0')}:${String(Math.floor(tc % 60)).padStart(2, '0')}:${String(f).padStart(2, '0')}`);
    this.set('shotCount', `SHOT ${shots}`);
  }

  focusOk(ok) {
    $('focusBar').classList.toggle('off', !ok);
  }

  stats(judge, t, live) {
    const v = judge.v;
    this.set('vVal', v.toFixed(1));
    const d = v - (this._lastV ?? v);
    this._lastV = this._lastV === undefined ? v : this._lastV + (v - this._lastV) * 0.05;
    const tr = $('vTrend');
    const cls = d > 0.15 ? 'up' : d < -0.15 ? 'down' : '';
    if (tr.className !== cls) {
      tr.className = cls;
      tr.textContent = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '';
    }
    this.set('scoreVal', Math.round(judge.points).toLocaleString('en-US'));
    this.set('cheersVal', Math.round(judge.cheers).toLocaleString('en-US'));
    this.set('payVal', live ? `¥${judge.pay().total.toLocaleString('en-US')}` : '¥0');
    const m = Math.floor(t / 60);
    this.set('hClock', `${m}:${String(Math.floor(t % 60)).padStart(2, '0')} / 3:00`);
    $('spike').classList.toggle('on', judge.spike > 0);
    $('vVal').classList.toggle('bump', judge.spike > 1.6);
    // グラフ
    this._gT = (this._gT ?? 0) + 1;
    if (this._gT % 15 === 0) this.drawGraph(judge.history, v);
  }

  drawGraph(hist, v) {
    const g = this.graph;
    const W = 200;
    const H = 40;
    g.clearRect(0, 0, W, H);
    const data = [...hist.slice(-179), v];
    const lo = 8;
    const hi = Math.max(40, ...data);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(0, H - ((20 - lo) / (hi - lo)) * H);
    g.lineTo(W, H - ((20 - lo) / (hi - lo)) * H);
    g.stroke();
    g.strokeStyle = '#ffd23f';
    g.lineWidth = 2;
    g.beginPath();
    data.forEach((d, i) => {
      const x = (i / 180) * W;
      const y = H - ((d - lo) / (hi - lo)) * H;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  }

  lower(info) {
    const el = $('lower');
    if (!info) {
      el.classList.add('hidden');
      this.cache.lowerKey = null;
      return;
    }
    const key = JSON.stringify(info);
    if (this.cache.lowerKey === key) return;
    this.cache.lowerKey = key;
    el.classList.remove('hidden');
    $('lName').textContent = info.name;
    $('lNat').textContent = info.nat;
    $('lHeight').textContent = info.height;
    $('lMarks').textContent = info.marks;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  // 実況（A: 実況・B: 解説・voice: 客席の声・pa: 場内放送）
  sub(text, who = 'A', dur = 3.6) {
    const d = document.createElement('div');
    d.className = `sub ${who === 'B' ? 'b' : who === 'voice' ? 'voice' : who === 'D' ? 'd' : ''}`;
    const tag = { A: '実況', B: '解説', voice: '客席', pa: '場内', D: 'ディレクター' }[who] ?? who;
    d.innerHTML = `<small>${tag}</small>${text}`;
    this.subs.appendChild(d);
    while (this.subs.children.length > 3) this.subs.firstChild.remove();
    setTimeout(() => d.classList.add('out'), dur * 1000);
    setTimeout(() => d.remove(), dur * 1000 + 600);
  }

  say(text, dur = 4) {
    const p = document.createElement('p');
    p.textContent = `（${text}）`;
    this.mono.appendChild(p);
    while (this.mono.children.length > 3) this.mono.firstChild.remove();
    setTimeout(() => p.classList.add('out'), dur * 1000);
    setTimeout(() => p.remove(), dur * 1000 + 900);
  }

  cue(text, { cls = '', small = '', dur = 1.8 } = {}) {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = `${text}${small ? `<small>${small}</small>` : ''}`;
    this.cueEl.innerHTML = '';
    this.cueEl.appendChild(d);
    clearTimeout(this._cueT);
    this._cueT = setTimeout(() => d.classList.add('out'), dur * 1000);
  }

  pop(label, value) {
    const d = document.createElement('div');
    d.className = 'pop';
    d.innerHTML = `<b>+${Math.round(value).toLocaleString('en-US')}</b>${label}`;
    this.pops.appendChild(d);
    while (this.pops.children.length > 3) this.pops.firstChild.remove();
    setTimeout(() => d.remove(), 1500);
  }

  // ---- AI CAMERA JUDGE（サムネイル + 検出の枠 + 行を順に）
  judge(shot, thumb) {
    const el = $('judge');
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    $('jMode').textContent = shot.judgeBias ? 'JUDGE BIAS: ON' : shot.boring ? 'BORING' : '';
    const c = $('jThumb');
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (thumb) g.drawImage(thumb, 0, 0, c.width, c.height);
    // 検出の枠（それっぽく）
    g.lineWidth = 1.5;
    g.font = '10px monospace';
    for (const bx of shot.boxes.slice(0, 6)) {
      const it = bx.it;
      const x = ((it.ndc.x + 1) / 2) * c.width;
      const y = ((1 - it.ndc.y) / 2) * c.height;
      const h = Math.max(8, Math.min(c.height * 0.9, it.frac * c.height));
      const w = it.s.kind === 'moon' || it.s.kind === 'birds' ? h : h * 0.6;
      const col = it.s.kind === 'athlete' ? '#ffd23f' : it.s.kind === 'moon' ? '#9ad8ff' : it.s.kind === 'judge' ? '#ff3d7f' : '#39e6ff';
      g.strokeStyle = col;
      g.strokeRect(x - w / 2, y - h / 2, w, h);
      g.fillStyle = col;
      g.fillText(bx.text, x - w / 2, y - h / 2 - 2);
    }
    const ul = $('jLines');
    ul.innerHTML = '';
    for (const t of this.lineTimers) clearTimeout(t);
    this.lineTimers = [];
    shot.lines.forEach((line, i) => {
      this.lineTimers.push(
        setTimeout(() => {
          const li = document.createElement('li');
          li.textContent = line;
          if (/MASTER|MIRACLE|PERFECT|EXCELLENT|EXTREME|HIGH|THOUGHTFUL|BEAUTIFUL/.test(line)) li.className = 'hi';
          if (/BORING|OUT OF FOCUS|BLUR|NO SUBJECT|LOW/.test(line)) li.className = 'lo';
          ul.appendChild(li);
        }, 120 + i * 170)
      );
    });
    const sc = $('jScore');
    sc.textContent = '--';
    this.lineTimers.push(setTimeout(() => (sc.textContent = String(shot.ai)), 160 + shot.lines.length * 170));
    $('jPts').textContent = shot.points ? `+${shot.points.toLocaleString('en-US')} pts` : '';
    this.judgeT = 4.2;
  }

  update(dt) {
    if (this.judgeT > 0) {
      this.judgeT -= dt;
      if (this.judgeT <= 0) $('judge').classList.add('hidden');
    }
  }

  // ロックの枠
  lock(x, y, size, label, lost = false) {
    const el = $('lockBox');
    if (x === null) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.classList.toggle('lost', lost);
    const s = Math.max(40, Math.min(420, size));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${s * 0.75}px`;
    el.style.height = `${s}px`;
    this.set('lockLabel', label);
  }

  // 微弱な枠（ヒント）
  hint(x, y) {
    const d = document.createElement('div');
    d.className = 'vf-hint';
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    this.hints.appendChild(d);
    setTimeout(() => d.remove(), 1500);
  }

  fade(on) {
    $('fade').classList.toggle('on', on);
  }
}
