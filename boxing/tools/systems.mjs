// 開発用: 全ゲームシステムを順に切り替えてスクリーンショット
//   node boxing/tools/systems.mjs [--ids=3d,side] [--out=dir] [--w=1280 --h=720]
import { loadPlaywright, startServer, launch, args } from '../../800m/tools/harness.mjs';
import { mkdirSync } from 'node:fs';
const a = args();
const pw = await loadPlaywright();
const server = await startServer();
const { browser, page, errors } = await launch(pw, { width: +(a.w ?? 1280), height: +(a.h ?? 720) });
await page.goto(`${server.base}/boxing/?mute&round=${a.round ?? 1}&auto&${a.q ?? ''}`);
const out = a.out ?? 'boxing-systems';
mkdirSync(out, { recursive: true });
await page.waitForFunction(() => window.__boxing?.phase === 'fight', null, { timeout: 120000 });
const ids = (a.ids ?? '3d,counter,side,top,fps,rhythm,slow,8bit,tv,cctv,phone,qte,tele').split(',');
for (const id of ids) {
  await page.evaluate((id) => window.__boxing.systems.set(id.split('+')), id);
  await page.waitForTimeout(+(a.wait ?? 3500));
  const file = `${out}/${id.replace('+', '_')}.png`;
  await page.screenshot({ path: file, timeout: 120000 });
  console.log(file, JSON.stringify(await page.evaluate(() => window.__boxing.state())));
}
if (errors.length) console.log('ERRORS', errors.slice(0, 10));
await browser.close();
await server.close();
