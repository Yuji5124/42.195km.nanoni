// スモークテスト: 自動操縦で タイトル → 3 分の中継 → エピローグ → 結果 まで通す（描画なし・8 倍速）
//   node polevault/tools/smoke.mjs [--render] [--fast=8] [--seed=N]
import { loadPlaywright, startServer, launch, args } from '../../800m/tools/harness.mjs';
const a = args();
const pw = await loadPlaywright();
const server = await startServer();
const { browser, page, errors } = await launch(pw, { width: 1280, height: 720 });
await page.goto(`${server.base}/polevault/?mute&auto&fast=${a.fast ?? 8}${a.render ? '' : '&norender'}${a.seed ? `&seed=${a.seed}` : ''}&${a.q ?? ''}`);
const t0 = Date.now();
const log = [];
let lastBucket = -1;
let s = null;
while (Date.now() - t0 < +(a.timeout ?? 300000)) {
  await page.waitForTimeout(1000);
  s = await page.evaluate(() => window.__pv?.state());
  if (!s) continue;
  const bucket = Math.floor(s.t / 20);
  if (bucket !== lastBucket || s.phase !== 'live') {
    lastBucket = bucket;
    log.push(`${((Date.now() - t0) / 1000).toFixed(0)}s ${s.phase} t=${s.t.toFixed(1)} v=${s.v.toFixed(1)} peak=${s.peak.toFixed(1)} shots=${s.shots} pts=${Math.round(s.points)} cheers=${s.cheers} missed=${s.missed} captured=${s.captured.join(',')}`);
  }
  if (s.phase === 'result') break;
}
console.log(log.join('\n'));
console.log('STORIES', s?.stories.join(','));
console.log('EPILOGUE', s?.epilogue?.join(','), 'winner', s?.winner, 'record', s?.record);
console.log('STATS', JSON.stringify(s?.stats), 'avg', s?.avg?.toFixed(1), 'pay', s?.pay, 'last', JSON.stringify(s?.lastShot));
const res = await page.evaluate(() => document.getElementById('result')?.innerText?.slice(0, 600));
console.log('RESULT TEXT:\n' + res);
if (errors.length) console.log('ERRORS', errors.slice(0, 10));
else console.log('no errors');
await browser.close();
await server.close();
