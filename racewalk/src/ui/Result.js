// RESULT（配信終了）: 競歩の順位と配信の数字を並べる。「正解」は出さない。

import { clockStr } from './StreamHUD.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// 最後のひとこと（どれが正解とも言わない。結果の組み合わせで変わる）
export function lastLine(r) {
  if (r.dq) return '……配信的には、たぶん伝説。';
  if (r.place === 1 && r.peak < 150000) return 'ちゃんと歩いたら、勝てた。';
  if (r.place === 1) return '勝って、伸びた。今日だけは全部うまくいった。';
  if (r.peak > 1500000) return '順位は覚えていない。同接は一生忘れない。';
  if (r.place <= 3) return 'メダルも、数字も、ちょっとずつ。';
  if (r.peak > 300000) return '負けた。でも、なぜか登録者が増えている。';
  return '全然疲れてません。（疲れました）';
}

function graph(history, peak) {
  if (!history.length) return '';
  const W = 600;
  const H = 90;
  const tMax = history[history.length - 1][0] || 1;
  const lg = (v) => Math.log10(Math.max(1000, v));
  const lo = lg(15000);
  const hi = Math.max(lg(peak) + 0.05, lo + 0.5);
  const pts = history.map(([t, v]) => `${((t / tMax) * W).toFixed(1)},${(H - ((lg(v) - lo) / (hi - lo)) * (H - 6) - 3).toFixed(1)}`).join(' ');
  return `<svg class="r-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#ffd23f" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
}

export function buildResult(r, { fromMain }) {
  const placeTxt = r.dq ? '失格' : `${r.place}位`;
  const timeTxt = r.time ? clockStr(r.time, 2) : r.dq ? 'DQ' : '—';
  const rows = [
    ['競歩の順位', `${placeTxt}（${timeTxt}）`],
    ['最大同接', `${fmt(r.peak)} 人`],
    ['登録者', `150,000 → ${fmt(r.subs)}（+${fmt(r.subsGain)}）`],
    ['スパチャ総額', `¥${fmt(r.sc)}（${fmt(r.scCount)} 件）`],
    ['高評価', fmt(r.likes)],
    ['低評価', fmt(r.dislikes)],
    ['炎上回数', `${r.flames} 回`],
    ['審判の警告', `黄 ${r.yellows} ・ 赤 ${r.reds}`],
    ['転倒 / つまずき', `${r.falls} 回 / ${r.trips} 回`],
    ['コメント総数', fmt(r.comments)],
    ['推定切り抜き再生数', `${fmt(r.clipViews)} 回`],
  ];
  const standings = r.standings
    .map((a, i) => `<tr class="${a.player ? 'me' : ''}"><td>${a.dq ? 'DQ' : i + 1}. ${esc(a.name)} <small>${a.nat}</small></td><td>${a.time ? clockStr(a.time, 2) : a.dq ? '失格' : '—'}</td></tr>`)
    .join('');
  const moments = r.moments.length
    ? `<ol class="r-moments">${r.moments.map((m) => `<li><b>「${esc(m.label)}」</b><br /><span>${clockStr(41 * 60 + 22 + m.t, 0)} ・ 同接 ${fmt(m.ccu)} ・ 推定 ${fmt(m.views)} 回再生</span></li>`).join('')}</ol>`
    : '<p class="r-note">切り抜かれそうな場面は、なかった。（真面目だった）</p>';
  const stories = r.stories.length
    ? r.stories.map((s) => `<div class="c"><span class="nm" style="color:${s.color}">${esc(s.name)}</span><span class="tx">${esc(s.text)}</span>${s.note ? `<span class="note">${esc(s.note)}</span>` : ''}</div>`).join('')
    : '';
  return `<div class="r-wrap">
    <div class="r-head">
      <h2 class="r-title">RESULT<small>配信終了 ・ 男子 10000m 競歩 決勝</small></h2>
    </div>
    <div class="r-records">
      <div class="r-rec walk"><small>RACE WALK</small><b>${placeTxt}</b><span>${timeTxt}</span></div>
      <div class="r-rec ccu"><small>PEAK VIEWERS</small><b>${fmt(r.peak)}</b><span>最大同接</span></div>
      <div class="r-rec subs"><small>SUBSCRIBERS</small><b>+${fmt(r.subsGain)}</b><span>150,000 → ${fmt(r.subs)}</span></div>
    </div>
    <div class="r-grid">
      <div class="r-box">
        <h3>STREAM</h3>
        <table class="r-table">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
        <h3 style="margin-top:14px">同接の推移</h3>
        ${graph(r.history, r.peak)}
      </div>
      <div class="r-box">
        <h3>MEN’S 10000m RACE WALK</h3>
        <table class="r-table">${standings}</table>
        <h3 style="margin-top:14px">切り抜かれそうな場面</h3>
        ${moments}
      </div>
    </div>
    ${stories ? `<div class="r-box r-stories" style="margin-top:12px"><h3>コメント欄の、最後のひとこと</h3>${stories}</div>` : ''}
    <p class="r-last">「${lastLine(r)}」</p>
    <p class="r-note">ACTION ${r.actions} 回 ・ 離れたファン ${r.left} 人 ・ ファンになった初見 ${r.converted} 人</p>
    <div class="r-btns">
      <button type="button" data-action="retry">もう一度配信する</button>
      <button type="button" class="title" data-action="back">${fromMain ? '← タイトルへ戻る' : '← タイトルへ戻る（42.195km、なのに。）'}</button>
    </div>
  </div>`;
}
