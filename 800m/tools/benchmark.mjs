// npm run benchmark: 画質（low / medium / high）× 混沌（なし / 最大）で、FPS・draw call・三角形数を測る。
//   node 800m/tools/benchmark.mjs --seconds=12 --distance=500
// 注意: ヘッドレス（SwiftShader = CPU 描画）の FPS は実機よりずっと低い。比べるのは「相対値」と draw call / 三角形数。
import { writeFileSync } from 'node:fs';
import { loadPlaywright, startServer, launch, outDir, args } from './harness.mjs';

const a = args();
const seconds = +(a.seconds ?? 10);
const distance = +(a.distance ?? 500);
const qualities = String(a.qualities ?? 'low,medium,high').split(',');
const cases = [
  { name: 'calm', query: '&chaos=0' },
  { name: 'chaos', query: '&chaos=1' },
  { name: 'heavy', query: '&modifier=allRunners,split4,rain,giantCrowd' },
];
const pw = await loadPlaywright();
const server = await startServer();
const rows = [];
for (const q of qualities) {
  for (const c of cases) {
    const { browser, page, errors } = await launch(pw, { width: 1280, height: 720 });
    await page.goto(`${server.url}?autopilot=1&seed=5124&mute=1&quality=${q}&distance=${distance}${c.query}`);
    await page.waitForFunction(() => window.__nanoni?.state().phase === 'race', null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const samples = [];
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) {
      await page.waitForTimeout(1000);
      samples.push(await page.evaluate(() => window.__nanoni.state()));
    }
    const avg = (k) => samples.reduce((s, x) => s + x[k], 0) / samples.length;
    const row = {
      quality: q,
      case: c.name,
      fps: +avg('fps').toFixed(1),
      calls: Math.round(avg('calls')),
      maxCalls: Math.max(...samples.map((s) => s.calls)),
      ktris: Math.round(avg('tris') / 1000),
      mods: [...new Set(samples.flatMap((s) => s.modifiers))].length,
      errors: errors.length,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    await browser.close();
  }
}
await server.close();
writeFileSync(`${outDir('benchmark')}/report.json`, JSON.stringify(rows, null, 2));
console.table(rows);
const ok = rows.every((r) => r.errors === 0);
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
