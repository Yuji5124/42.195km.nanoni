import { formatTime, clamp } from '../core/mathx.js';
import { TRACK, trackPoint } from '../race/trackLogic.js';

// HUD（HTML/CSS）。スキン（normal / broadcast / rpg / fighting / racing / rhythm / minimal）が変わっても
// 中身は同じ RaceCore の値。data-v="名前" / data-bar="名前" の要素に値を流すだけ。

const $ = (s, r = document) => r.querySelector(s);

export class Hud {
  constructor() {
    this.root = $('#hud');
    this.values = {};
    this.valueEls = {};
    for (const el of this.root.querySelectorAll('[data-v]')) (this.valueEls[el.dataset.v] ??= []).push(el);
    this.barEls = {};
    for (const el of this.root.querySelectorAll('[data-bar]')) (this.barEls[el.dataset.bar] ??= []).push(el);
    this.map = $('[data-map]');
    this.notes = $('[data-notes]');
    this.timers = {};
    this.skin = 'normal';
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  setSkin(skin) {
    if (skin === this.skin) return;
    this.skin = skin;
    document.body.dataset.skin = skin;
  }

  setV(name, value) {
    if (this.values[name] === value) return;
    this.values[name] = value;
    for (const el of this.valueEls[name] ?? []) el.textContent = value;
  }

  setBar(name, frac) {
    const w = `${(clamp(frac, 0, 1) * 100).toFixed(1)}%`;
    if (this.values[`bar:${name}`] === w) return;
    this.values[`bar:${name}`] = w;
    for (const el of this.barEls[name] ?? []) el.firstElementChild ? (el.firstElementChild.style.width = w) : (el.style.width = w);
  }

  // s: { rank, d, time, stamina, cheer, lap, kmh, leaderName, leaderStamina, board, ui (P.ui), runners }
  update(s, ui) {
    const shownD = ui.liar ? Math.max(0, s.d + ui.liar) : s.d;
    const dist = ui.fake > 0.5 && Math.floor(s.time * 3) % 2 ? '???' : String(Math.floor(clamp(shownD, 0, 800))).padStart(3, '0');
    const lapNum = ui.lapBug ? 3 + Math.floor(s.time * 5) % 7 : s.d >= TRACK.lap ? 2 : 1;
    this.setV('rank', ui.fake > 0.5 && Math.floor(s.time * 2) % 3 === 0 ? 'NaN' : String(s.rank));
    this.setV('dist', dist);
    this.setV('lap', `LAP ${lapNum}/2`);
    this.setV('lapNum', String(lapNum));
    this.setV('time', formatTime(s.time));
    this.setV('remain', `${Math.max(0, Math.ceil(800 - shownD))}m`);
    this.setV('kmh', String(Math.round(s.kmh)));
    this.setV('gear', String(clamp(Math.floor(s.kmh / 7) + 1, 1, 6)));
    this.setV('ftTimer', String(Math.max(0, 99 - Math.floor(s.time))).padStart(2, '0'));
    this.setV('leaderName', s.leaderName);
    this.setV('board', s.board);
    this.setV('rpgline', s.rpgLine);
    this.setBar('stamina', s.stamina / 100);
    this.setBar('cheer', s.cheer / 100);
    this.setBar('leader', s.leaderStamina / 100);
    document.body.classList.toggle('stamina-low', s.stamina < 20);
    if (this.skin === 'racing') this.drawMap(s.runners, s.playerIndex);
    if (this.skin === 'rhythm') this.drawNotes(s.phase, s.stepFreq);
  }

  drawMap(runners, pi) {
    const c = this.map;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const sx = c.width / 190;
    const sz = c.height / 110;
    const tx = (x) => c.width / 2 + x * sx;
    const tz = (z) => c.height / 2 + z * sz;
    g.strokeStyle = 'rgba(255,255,255,.6)';
    g.lineWidth = 3;
    g.beginPath();
    const pt = {};
    for (let p = 0; p <= 400; p += 8) {
      trackPoint(p, 2, pt);
      if (p === 0) g.moveTo(tx(pt.x), tz(pt.z));
      else g.lineTo(tx(pt.x), tz(pt.z));
    }
    g.stroke();
    runners.forEach((r, i) => {
      trackPoint(r.d, r.off, pt);
      g.fillStyle = i === pi ? '#39e6ff' : '#ff3d7f';
      g.beginPath();
      g.arc(tx(pt.x), tz(pt.z), i === pi ? 5 : 3, 0, Math.PI * 2);
      g.fill();
    });
  }

  // 音ゲー UI: 次の接地がノーツとして流れてくる（本当にリズム判定と同じタイミング）
  drawNotes(phase, freq) {
    const lane = this.notes;
    if (!lane) return;
    const w = lane.parentElement.clientWidth;
    let html = '';
    const f = phase - Math.floor(phase);
    for (let k = 0; k < 6; k++) {
      const t = (k + 1 - f) / Math.max(0.5, freq); // 次の接地まで何秒
      const x = w * 0.16 + t * w * 0.55;
      if (x > w) break;
      html += `<i class="${(Math.floor(phase) + k + 1) % 2 ? 'r' : ''}" style="left:${x.toFixed(0)}px"></i>`;
    }
    lane.innerHTML = html;
  }

  flash(id, text, cls = 'show', ms = 2300) {
    const el = $(`#${id}`);
    el.textContent = text;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    clearTimeout(this.timers[id]);
    this.timers[id] = setTimeout(() => el.classList.remove(cls), ms);
  }

  nanoni(text) {
    this.flash('nanoni', text);
  }

  combo(text) {
    this.flash('combo', text, 'show', 3200);
  }

  call(text, ms = 1300) {
    this.flash('call', text, 'show', ms);
  }

  camLabel(text, ms = 1600) {
    this.flash('camlabel', text, 'show', ms);
  }

  announce(text, ms = 3200) {
    this.flash('announcer', text, 'show', ms);
  }

  step(grade) {
    const el = $('#stepfx');
    el.className = 'stepfx';
    void el.offsetWidth;
    if (grade === 'PERFECT') el.classList.add('perfect');
    else if (grade === 'GOOD') el.classList.add('good');
    this.setV('judge', grade === 'MISS' ? '' : grade);
  }

  fakeBug(on, t) {
    const el = $('#fakebug');
    el.classList.toggle('hidden', !on);
    if (!on) return;
    const lines = ['FPS 3', `PING ${9000 + Math.floor((t * 37) % 999)}`, 'POSITION NaN', 'DISTANCE ???', 'MEMORY ERROR 0x800M', 'TRACK NOT FOUND'];
    el.textContent = lines.slice(0, 3 + (Math.floor(t * 2) % 4)).join('\n');
  }
}
