// npm run mobile: スマホ（縦・横）でタイトル / レース中 / 結果を撮る。タッチ操作の表示と重なりを確かめる
//   node 800m/tools/mobile.mjs
import { loadPlaywright, startServer, outDir, args } from './harness.mjs';

const a = args();
const dir = outDir('mobile');
const pw = await loadPlaywright();
const server = await startServer();
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const devices = [
  { name: 'portrait', viewport: { width: 390, height: 844 } },
  { name: 'landscape', viewport: { width: 844, height: 390 } },
];
const errors = [];
for (const dev of devices) {
  const ctx = await browser.newContext({ viewport: dev.viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${dev.name}: ${e.message}`));
  await page.goto(`${server.url}?seed=${a.seed ?? 5124}&mute=1&fast=4${a.query ?? ''}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/${dev.name}-title.png` });
  await page.tap('.t-start');
  await page.waitForFunction(() => window.__nanoni?.state().phase === 'race');
  await page.evaluate(() => (window.__nanoni.game.autopilot = true));
  await page.waitForFunction(() => window.__nanoni.state().d > 250, null, { timeout: 120000, polling: 250 });
  await page.screenshot({ path: `${dir}/${dev.name}-race.png` });
  await page.evaluate(() => window.__nanoni.modifiers.start('rpgHud', { duration: 99 }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/${dev.name}-rpg.png` });
  await page.evaluate(() => { window.__nanoni.modifiers.clear(); window.__nanoni.modifiers.start('fightingHud', { duration: 99 }); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/${dev.name}-fighting.png` });
  await page.evaluate(() => window.__nanoni.modifiers.clear());
  await page.waitForFunction(() => window.__nanoni.state().phase === 'result', null, { timeout: 200000, polling: 500 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/${dev.name}-result.png` });
  console.log(`[mobile] ${dev.name} ok`);
  await ctx.close();
}
console.log(`[mobile] → ${dir}  errors=${errors.length}`, errors);
await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);
