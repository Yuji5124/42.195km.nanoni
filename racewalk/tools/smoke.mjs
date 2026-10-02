// スモークテスト: 自動操縦で 配信（約 7 分の決勝）→ 配信終了 → RESULT まで通す（描画なし・8 倍速）
//   node racewalk/tools/smoke.mjs [--auto=serious|balance|flame] [--seed=N] [--render] [--fast=8] [--back] [--retry] [--shot=result.png]
//   --back … RESULT の「タイトルへ戻る」を押して、42.195km、なのに。のタイトル画面に戻れるかも確かめる
//   先に npm run build（vite preview で dist を開く）
import { loadPlaywright, startServer, launch, args } from '../../800m/tools/harness.mjs';
const a = args();
const pw = await loadPlaywright();
const server = await startServer();
const { browser, page, errors } = await launch(pw, { width: 1280, height: 720 });
const style = a.auto ?? 'balance';
if (a.back) {
  // タイトル画面 → 競歩のカード → 競歩のページ（#from-main）
  await page.goto(`${server.base}/index.html?mute`);
  await page.waitForTimeout(2500);
  await page.click('[data-mode="racewalk"]');
  await page.waitForURL(/racewalk/, { timeout: 20000 });
  console.log('opened from title:', page.url());
  await page.waitForFunction(() => window.__rw?.phase === 'intro', null, { timeout: 60000 });
  // 同じページのまま自動操縦で始める（履歴を増やさない）
  await page.evaluate(([st, fast, render]) => {
    const g = window.__rw;
    g.autoStyle = st;
    g.fast = fast;
    g.noRender = !render;
    g.audioMgr.setMuted(true);
    g.start();
  }, [style, +(a.fast ?? 8), !!a.render]);
} else {
  await page.goto(`${server.base}/racewalk/?mute&auto=${style}&fast=${a.fast ?? 8}${a.render ? '' : '&norender'}${a.seed ? `&seed=${a.seed}` : ''}`);
}
const t0 = Date.now();
const log = [];
let lastBucket = -1;
let s = null;
while (Date.now() - t0 < +(a.timeout ?? 400000)) {
  await page.waitForTimeout(1000);
  s = await page.evaluate(() => window.__rw?.state());
  if (!s) continue;
  const bucket = Math.floor(s.t / 30);
  if (bucket !== lastBucket || s.phase !== 'live') {
    lastBucket = bucket;
    log.push(`${((Date.now() - t0) / 1000).toFixed(0)}s ${s.phase} t=${s.t.toFixed(1)} rem=${s.rem.toFixed(0)} rank=${s.rank} ccu=${s.ccu} peak=${s.peak} subs=${s.subs} sc=${s.sc} heat=${s.heat.toFixed(1)} chat=${s.shown} dom=${s.domChat} acts=${s.actions} mode=${s.mode} [${s.list.join(',')}]`);
  }
  if (s.phase === 'result') break;
}
console.log(log.join('\n'));
if (a.shot) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: a.shot });
  await page.evaluate(() => (document.getElementById('result').scrollTop = 99999));
  await page.waitForTimeout(400);
  await page.screenshot({ path: a.shot.replace(/\.png$/, '-2.png') });
}
const res = await page.evaluate(() => document.getElementById('result')?.innerText?.slice(0, 1400));
console.log('RESULT TEXT:\n' + res);
if (a.retry) {
  await page.click('[data-action="retry"]');
  await page.waitForTimeout(3000);
  console.log('after retry:', JSON.stringify(await page.evaluate(() => window.__rw.state())), page.url());
}
if (a.back) {
  const hasBack = await page.$('[data-action="back"]');
  console.log('back button:', !!hasBack);
  if (hasBack) {
    await page.click('[data-action="back"]');
    await page.waitForTimeout(3000);
    console.log('after back:', page.url());
    const title = await page.evaluate(() => ({ title: document.title, cards: [...document.querySelectorAll('[data-mode]')].map((c) => c.dataset.mode) }));
    console.log('title page:', JSON.stringify(title));
  }
}
if (errors.length) console.log('ERRORS', errors.slice(0, 10));
else console.log('no errors');
await browser.close();
await server.close();
