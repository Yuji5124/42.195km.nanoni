// 撮影つきの自動プレイ: npm run tramp:shots（?auto で踏み込みとタイピングを自動に）
//   --query=&attempt=5  … 途中の試技から / --seconds=40 / --width --height（スマホ縦: --width=390 --height=844）
import { loadPlaywright, startServer, launch, args } from '../../800m/tools/harness.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const a = args();
const seconds = +(a.seconds ?? 30);
const every = +(a.every ?? 1.5);
const out = resolve(import.meta.dirname, 'out', a.name ?? 'shots');
mkdirSync(out, { recursive: true });
const pw = await loadPlaywright();
const server = await startServer();
const { browser, page, errors } = await launch(pw, { width: +(a.width ?? 1280), height: +(a.height ?? 720) });
const log = (...m) => console.log('[tramp]', ...m);
let ok = true;
try {
  await page.goto(`${server.base}/trampoline/?auto&mute&seed=${a.seed ?? 3}${a.query ?? ''}`);
  await page.waitForFunction(() => window.__tramp?.phase && window.__tramp.phase !== 'intro', null, { timeout: 30000 });
  const t0 = Date.now();
  let i = 0;
  let last = null;
  while (Date.now() - t0 < seconds * 1000) {
    await page.waitForTimeout(every * 1000);
    last = await page.evaluate(() => window.__tramp.state());
    const name = `${String(i++).padStart(3, '0')}-a${last.attempt}-${last.phase}-${last.shot}.png`;
    await page.screenshot({ path: `${out}/${name}` });
    log(`t=${((Date.now() - t0) / 1000).toFixed(1)} ${JSON.stringify(last)}`);
    if (last.phase === 'final') break;
  }
} catch (e) {
  ok = false;
  log('FAIL:', e.message);
}
if (errors.length) {
  ok = false;
  for (const e of errors) log('  ', e);
}
await browser.close();
await server.close();
log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
