// 結果: 同じ大会の 2 つの記録を並べる（選手: 6.05m / カメラマン: 41,820 Cheers）+ CAMERA RESULT + 撮影の履歴 + 今日の給料。

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function lastWords(avg) {
  if (avg >= 24) return '……今日は飯食えるな。';
  if (avg >= 17) return 'まあ、なんとか。';
  return '来月どうしよう。';
}

export function buildResult(m) {
  const j = m.judge;
  const comp = m.comp;
  const pay = j.pay(true);
  const st = comp.standings();
  const fin = comp.attempts[comp.attempts.length - 1];
  const winH = st[0].best.toFixed(2);
  const best = [...j.shots].sort((a, b) => b.points - a.points)[0];
  const avg = j.average;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const rec = fin.clear ? (fin.wr ? '世界新記録' : '大会新記録') : '優勝';
  const rows = [
    ['Average Viewership', `${avg.toFixed(1)}%`],
    ['Peak Viewership', `${j.peak.toFixed(1)}%`],
    ['Sports Shots', j.stats.sports],
    ['Story Shots', j.stats.story],
    ['Beautiful Shots', j.stats.beauty],
    ['Master Shots', j.stats.master],
    ['Missed Moments', j.missed],
    ['Camera Score', fmt(j.points)],
  ];
  const payRows = [
    ['基本給', pay.base],
    ['平均視聴率ボーナス', pay.avg],
    ['最高視聴率ボーナス', pay.peak],
    ['物語ボーナス', pay.story],
    ['競技ボーナス', pay.sports],
    ['MASTER SHOT ボーナス', pay.master],
  ];
  const strip = j.shots
    .slice(-24)
    .filter((s) => s.thumb)
    .map((s) => `<figure><img src="${s.thumb}" alt="" /><b>${s.ai}</b><figcaption>${Math.floor(s.t / 60)}:${String(Math.floor(s.t % 60)).padStart(2, '0')} ${esc(s.label)}</figcaption></figure>`)
    .join('');
  const standings = st
    .map((a, i) => `<tr><td>${i + 1}. ${esc(a.name)} <small>${a.nat}</small></td><td>${a.best ? a.best.toFixed(2) + 'm' : 'NM'}</td></tr>`)
    .join('');
  const unknown = m.stories.unknownCount(m.seed);
  return `<div class="r-wrap">
    <h2 class="r-title">CAMERA RESULT</h2>
    <p class="r-lead">同じ大会の、二つの記録。</p>
    <div class="r-records">
      <div class="r-rec"><small>POLE VAULT · 1st 高嶺 ソラ</small><b>${winH}m</b><span>${rec}</span></div>
      <div class="r-rec me"><small>CAMERAMAN · あなた</small><b>${fmt(j.cheers)} Cheers</b><span>視聴率が、あなたの記録になる。</span></div>
    </div>
    <div class="r-grid">
      <div class="r-box">
        <h3>POLE VAULT RESULT</h3>
        <table class="r-table">${standings}</table>
        <h3 style="margin-top:14px">CAMERA RESULT</h3>
        <table class="r-table">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
          <tr class="big"><td>TOTAL CHEERS</td><td>${fmt(j.cheers)}</td></tr></table>
      </div>
      <div class="r-box">
        <h3>BEST SHOT</h3>
        ${best ? `<div class="r-best">${best.thumb ? `<img src="${best.thumb}" alt="" />` : ''}<div><b>${esc(best.story?.story ? m.stories.storyById(best.story.story)?.label ?? best.en : best.en)}</b>${esc(best.label)}<br />AI SCORE ${best.ai} · +${fmt(best.points)}</div></div>` : '<p class="r-unknown">SHOT は 1 枚もなかった。</p>'}
        <h3>TODAY'S PAY</h3>
        <table class="r-table">${payRows.map(([k, v]) => `<tr><td>${k}</td><td>¥${fmt(v)}</td></tr>`).join('')}
          <tr class="big"><td>TODAY'S PAY</td><td>¥${fmt(pay.total)}</td></tr></table>
      </div>
    </div>
    ${strip ? `<div class="r-box" style="margin-top:12px"><h3>撮影の履歴（${j.shots.length} SHOT）</h3><div class="r-strip">${strip}</div></div>` : ''}
    <p class="r-last">「${lastWords(avg)}」</p>
    <p class="r-unknown">この日、あなたが知らない物語も、まだ ${unknown.toLocaleString('en-US')} 人分あった。（物語の候補 ${m.stories.total} 本 / 今夜 ${m.stories.active.length} 本）</p>
    <div class="r-btns">
      <button type="button" data-action="retry">もう一度オンエア</button>
      ${location.hash === '#from-main' ? '<button type="button" class="sub2" data-action="back">← タイトルへ</button>' : ''}
    </div>
  </div>`;
}
