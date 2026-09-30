// スモークテスト: 自動操縦で タイトル → 入場 → 4 ラウンド → KO / 判定 → 結果 まで通す（描画なし・8 倍速）
//   node boxing/tools/smoke.mjs [--render] [--fast=8]
import { loadPlaywright, startServer, launch, args } from '../../800m/tools/harness.mjs';
const a = args();
const pw = await loadPlaywright();
const server = await startServer();
const { browser, page, errors } = await launch(pw, { width: 1280, height: 720 });
await page.goto(`${server.base}/boxing/?mute&auto&fast=${a.fast ?? 8}${a.render ? '' : '&norender'}&${a.q ?? ''}`);
const t0 = Date.now();
let last = '';
const log = [];
while (Date.now() - t0 < +(a.timeout ?? 240000)) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => window.__boxing?.state());
  if (!s) continue;
  const line = `${s.phase} R${s.round} ${s.clock} sys=${s.sys} P${Math.round(s.pHp)} E${Math.round(s.eHp)} downs ${s.pDowns}/${s.eDowns} hype ${s.hype.toFixed(2)} seen ${s.seen} ch ${s.changes}`;
  if (line.split(' sys=')[0] + s.sys !== last) {
    log.push(`${((Date.now() - t0) / 1000).toFixed(0)}s ${line}`);
    last = line.split(' sys=')[0] + s.sys;
  }
  if (s.phase === 'result') {
    log.push(`RESULT ${JSON.stringify(s.result)} landed ${s.landed}/${s.thrown} dodges ${s.dodges}`);
    break;
  }
}
console.log(log.join('\n'));
const panels = await page.evaluate(() => document.querySelectorAll('.pn').length);
console.log('panels', panels, 'replays', await page.evaluate(() => window.__boxing.show.replay.count));
if (errors.length) console.log('ERRORS', errors.slice(0, 10));
else console.log('no errors');
await browser.close();
await server.close();
