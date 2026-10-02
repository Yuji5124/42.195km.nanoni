// 数字の確認（描画なし・Node）: 3 つの遊び方 × 数シードで、配信を最後まで回して結果を並べる。
//   node racewalk/tools/balance.mjs [--seeds=6] [--chat=balance] [--seed=1]
//   --chat=<style> … その遊び方の 1 回分のコメント欄を時系列で出す
import { Session } from '../src/Session.js';
import { Autopilot } from '../src/Autopilot.js';
import { createRng } from '../../src/core/math.js';

const a = Object.fromEntries(process.argv.slice(2).map((s) => s.replace(/^--/, '').split('=')));
const seeds = +(a.seeds ?? 6);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

function run(style, seed, log = null) {
  const s = new Session({ seed });
  const ap = new Autopilot(s, style, createRng(seed + 99));
  const dt = 1 / 30;
  let guard = 0;
  while (!s.ended && guard++ < 30 * 900) {
    ap.step();
    s.step(dt);
    const out = s.chat.drain();
    if (log) {
      for (const c of out) log.push(`${s.t.toFixed(1).padStart(6)} ${c.kind === 'sc' ? `[¥${fmt(c.amount)}] ` : c.kind === 'system' ? '[SYS] ' : ''}${c.name ? c.name + ': ' : ''}${c.text}`);
      for (const n of s.drainNotices()) if (n.type === 'action') log.push(`${s.t.toFixed(1).padStart(6)} >>> ACTION ${n.id}「${n.say}」`);
    } else s.drainNotices();
  }
  return { s, r: s.result() };
}

const rows = [];
for (const style of ['serious', 'balance', 'flame']) {
  for (let seed = 1; seed <= seeds; seed++) {
    const { s, r } = run(style, seed);
    rows.push({ style, seed, place: r.dq ? 'DQ' : r.place, time: r.time ? (r.time / 60).toFixed(0) + ':' + (r.time % 60).toFixed(1) : '-', peak: fmt(r.peak), subs: '+' + fmt(r.subsGain), sc: '¥' + fmt(r.sc), likes: fmt(r.likes), dis: fmt(r.dislikes), flames: r.flames, warn: `${r.yellows}/${r.reds}`, falls: `${r.falls}/${r.trips}`, comments: fmt(r.comments), clips: fmt(r.clipViews), acts: r.actions, shown: s.chat.shown, dropped: s.chat.dropped, left: r.left });
  }
}
console.table(rows);

if (a.chat) {
  const log = [];
  run(a.chat, +(a.seed ?? 1), log);
  console.log(log.slice(0, +(a.lines ?? 400)).join('\n'));
}
