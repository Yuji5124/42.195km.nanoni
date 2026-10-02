// 中央（配信の映像）の上に重ねる表示。
//   左上: ● LIVE・同接・配信時間 / 右上: レースの情報（周回・順位・先頭との差・残り・時計）
//   上の帯: 前後の選手との差 / 下: 配信タイトル・登録者・高評価 / 字幕（配信者のセリフ）/ ペース・カメラ
//   事件: 小さな通知（審判・追い越し）・大きな文字（同接の爆発・炎上・ペナルティ・フィニッシュ）・つまずきの SPACE

import { PACES } from '../race/athletes.js';
import { RACE, LAP } from '../race/track.js';
import { man } from '../chat/LiveChatSystem.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function clockStr(sec, dec = 1) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(dec).padStart(dec ? 3 + dec : 2, '0')}`;
}

export class StreamHUD {
  constructor() {
    this.el = {
      viewers: $('hViewers'),
      elapsed: $('hElapsed'),
      lap: $('hLap'),
      rank: $('hRank'),
      gap: $('hGap'),
      rem: $('hRem'),
      clock: $('hClock'),
      strip: $('hStrip'),
      cards: $('hCards'),
      toasts: $('hToasts'),
      big: $('hBig'),
      qte: $('hQte'),
      prompt: $('hPrompt'),
      sub: $('hSub'),
      paceName: $('hPaceName'),
      pace: $('hPace'),
      cam: $('hCam'),
      subs: $('hSubs'),
      likes: $('hLikes'),
      dis: $('hDis'),
      flame: $('hFlame'),
    };
    this.t = 0;
    this.slow = 0;
    this.subT = 0;
    this.bigT = 0;
    this.lastCcu = 0;
    this.stripEls = null;
    this.cardKey = '';
  }

  reset() {
    this.el.toasts.innerHTML = '';
    this.el.big.innerHTML = '';
    this.el.cards.innerHTML = '';
    this.cardKey = '';
    this.subT = 0;
    this.el.sub.classList.remove('on');
    this.el.qte.classList.add('hidden');
  }

  update(dt, s) {
    this.t += dt;
    const sim = s.sim;
    const m = s.metrics;
    const P = sim.player;
    // 毎フレーム: つまずきの残り時間
    if (sim.qte) {
      this.el.qte.classList.remove('hidden');
      this.el.qte.querySelector('i').style.setProperty('--k', `${Math.max(0, (1 - sim.qte.t / sim.qte.window) * 100).toFixed(0)}%`);
    } else this.el.qte.classList.add('hidden');
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) this.el.sub.classList.remove('on');
    }
    if (this.bigT > 0) {
      this.bigT -= dt;
      if (this.bigT <= 0) {
        const b = this.el.big.firstElementChild;
        if (b) {
          b.classList.add('out');
          setTimeout(() => b.remove(), 450);
        }
      }
    }
    // 10 回 / 秒
    this.slow -= dt;
    if (this.slow > 0) return;
    this.slow = 0.1;
    const ccu = m.ccuShown;
    this.el.viewers.textContent = fmt(ccu);
    this.el.viewers.classList.toggle('up', ccu > this.lastCcu * 1.01);
    this.lastCcu = ccu;
    this.el.elapsed.textContent = clockStr(41 * 60 + 22 + sim.t, 0);
    const lapNo = Math.min(25, 21 + Math.floor(Math.max(0, P.d) / LAP));
    this.el.lap.textContent = P.finished ? 'FINISH' : `LAP ${lapNo}/25`;
    const rank = P.dq ? 'DQ' : P.finished ? P.place : sim.shownRank;
    this.el.rank.innerHTML = P.dq ? 'DQ' : `${rank}<small>位</small>`;
    this.el.rank.classList.toggle('lead', rank === 1);
    if (P.finished) this.el.gap.textContent = clockStr(RACE.clock0 + P.finishT, 2);
    else if (P.dq) this.el.gap.textContent = '失格';
    else if (P.inPenalty) this.el.gap.textContent = `ペナルティ ${Math.ceil(P.penaltyLeft)}秒`;
    else if (sim.shownRank === 1) {
      const b = sim.behind();
      this.el.gap.textContent = b ? `2位と +${Math.max(0, sim.gapTo(b, P)).toFixed(1)}秒` : 'トップ';
    } else this.el.gap.textContent = `先頭 +${Math.max(0, s.chatCtx().gap).toFixed(1)}秒`;
    this.el.rem.textContent = P.finished ? 'ゴール' : `残り ${fmt(Math.max(0, Math.ceil(P.rem / 10) * 10))}m`;
    this.el.clock.textContent = clockStr(sim.clock);
    const pace = sim.ctl.pace;
    this.el.paceName.textContent = PACES[pace].name;
    [...this.el.pace.children].forEach((e, i) => {
      e.classList.toggle('on', i <= pace);
      e.classList.toggle('hot', i === 4);
    });
    this.el.cam.textContent = s.faceCam ? '顔' : '背中';
    this.el.subs.textContent = man(m.subs);
    this.el.likes.textContent = man(m.likes);
    this.el.dis.textContent = man(m.dislikes);
    this.el.flame.className = `h-flame${m.heatLevel ? ` l${m.heatLevel}` : ''}`;
    this.strip(sim);
    this.cardsUpdate(P);
    // 給水
    const water = !P.finished && sim.nearWater() && !s.actionCtx().drinkLap;
    this.el.prompt.classList.toggle('on', water);
    if (water) this.el.prompt.textContent = sim.player.y >= 1.5 ? '💧 給水 — SPACE' : '💧 給水 — → でレーン 2 へ（または ACTION）';
  }

  // 前後の差（± 40m）
  strip(sim) {
    const P = sim.player;
    if (!this.stripEls) {
      this.stripEls = sim.walkers.map((w) => {
        const i = document.createElement('i');
        i.style.background = `#${w.a.color.toString(16).padStart(6, '0')}`;
        if (w.player) i.className = 'me';
        i.innerHTML = `<b>${w.player ? 'あなた' : w.a.short}</b>`;
        this.el.strip.appendChild(i);
        return { w, i };
      });
      const d = document.createElement('span');
      d.className = 'dir';
      d.textContent = '前 ▶';
      this.el.strip.appendChild(d);
    }
    const W = this.el.strip.clientWidth || 400;
    const ahead = sim.ahead();
    const behind = sim.behind();
    for (const { w, i } of this.stripEls) {
      const dd = w.d - P.d;
      const vis = !w.dq && Math.abs(dd) < 42 && (!w.finished || w === P);
      i.style.display = vis ? '' : 'none';
      if (!vis) continue;
      const x = 12 + ((dd + 40) / 80) * (W - 24);
      i.style.left = `${x.toFixed(1)}px`;
      // 名前は自分と前後の 2 人だけ（重なって読めなくなるので）
      const lb = i.firstElementChild;
      const show = w === P || w === ahead || w === behind;
      lb.style.display = show ? '' : 'none';
      // 前の人は上・自分は下・後ろの人はさらに下（近くても重ならない）
      lb.style.top = w === ahead ? '-13px' : w === behind ? '29px' : '';
    }
  }

  cardsUpdate(P) {
    const key = `${P.yellows}:${P.red}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    this.el.cards.innerHTML = `${'<i>!</i>'.repeat(P.red)}${'<i class="y">~</i>'.repeat(Math.min(4, P.yellows))}`;
  }

  toast(text, cls = '') {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.innerHTML = text;
    this.el.toasts.appendChild(el);
    while (this.el.toasts.childElementCount > 4) this.el.toasts.firstElementChild.remove();
    setTimeout(() => el.classList.add('out'), 3000);
    setTimeout(() => el.remove(), 3450);
  }

  big(html, cls = '', dur = 2.2) {
    this.el.big.innerHTML = `<div class="bigtxt ${cls}">${html}</div>`;
    this.bigT = dur;
  }

  say(text) {
    if (!text) return;
    this.el.sub.innerHTML = `<em>アユム</em>「${esc(text)}」`;
    this.el.sub.classList.add('on');
    this.subT = Math.min(5, 2 + text.length * 0.09);
  }
}
