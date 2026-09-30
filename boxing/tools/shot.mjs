// 開発用: 指定クエリで開いてスクリーンショット
//   node boxing/tools/shot.mjs --q="start&skip" --out=a.png --w=1280 --h=720 --wait=3000 [--times=5,20,40] [--eval="..."]
import { loadPlaywright, startServer, launch, args } from '../../800m/tools/harness.mjs';
const a = args();
const pw = await loadPlaywright();
const server = await startServer();
let browser, page, errors;
if (a.touch) {
  browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: +(a.w ?? 390), height: +(a.h ?? 844) }, deviceScaleFactor: +(a.dpr ?? 1), isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CERT|net::/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
} else ({ browser, page, errors } = await launch(pw, { width: +(a.w ?? 1280), height: +(a.h ?? 720) }));
await page.goto(`${server.base}/boxing/?mute&${a.q ?? ''}`);
const out = a.out ?? 'shot.png';
const times = (a.times ?? String(a.wait ?? 3000)).split(',').map(Number);
let last = 0;
for (let i = 0; i < times.length; i++) {
  await page.waitForTimeout(times[i] - last);
  last = times[i];
  if (a.eval) console.log('eval:', await page.evaluate(a.eval));
  const file = times.length > 1 ? out.replace(/\.png$/, `-${i}.png`) : out;
  await page.screenshot({ path: file, timeout: 120000 });
  console.log(file, JSON.stringify(await page.evaluate(() => window.__boxing?.state?.() ?? null)));
}
if (errors.length) console.log('ERRORS', errors.slice(0, 10));
await browser.close();
await server.close();
