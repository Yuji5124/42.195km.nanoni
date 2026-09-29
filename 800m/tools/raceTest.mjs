// npm run race-test: 複数の seed で最後まで自動プレイし、結果を記録する
//   node 800m/tools/raceTest.mjs --seeds=1,2,3 --fast=6
// 記録: finish / time / winner / player rank / average FPS / errors / modifier count
import { writeFileSync } from 'node:fs';
import { loadPlaywright, startServer, launch, outDir, args } from './harness.mjs';

const a = args();
const seeds = String(a.seeds ?? '5124,7,2027').split(',').map(Number);
const fast = a.fast ?? 6;
const pw = await loadPlaywright();
const server = await startServer();
const rows = [];
for (const seed of seeds) {
  const { browser, page, errors } = await launch(pw);
  const t0 = Date.now();
  let row = { seed, finish: false };
  try {
    await page.goto(`${server.url}?autopilot=${a.autopilot ?? 1}&seed=${seed}&mute=1&fast=${fast}${a.query ?? ''}`);
    await page.waitForFunction(() => window.__nanoni?.state().phase === 'race', null, { timeout: 30000 });
    await page.waitForFunction(() => window.__nanoni?.state().phase === 'result', null, { timeout: (+(a.timeout ?? 240)) * 1000, polling: 1000 });
    const res = await page.evaluate(() => {
      const n = window.__nanoni;
      const r = n.result();
      const me = r.results.find((x) => x.isPlayer);
      const win = r.results[0];
      return {
        playerRank: me.place,
        playerTime: +me.time.toFixed(2),
        winner: n.game.core.runners[win.index].id,
        winTime: +win.time.toFixed(2),
        modifierCount: r.had.length,
        had: r.had.map((h) => h.id),
        fps: +n.fpsAverage().toFixed(1),
      };
    });
    row = { seed, finish: true, ...res };
    await page.screenshot({ path: `${outDir('race-test')}/result-${seed}.png` });
  } catch (e) {
    row.error = e.message.split('\n')[0];
  }
  row.errors = errors.length;
  row.errorList = errors.slice(0, 5);
  row.wall = +((Date.now() - t0) / 1000).toFixed(0);
  rows.push(row);
  console.log(JSON.stringify(row));
  await browser.close();
}
await server.close();
writeFileSync(`${outDir('race-test')}/report.json`, JSON.stringify(rows, null, 2));
console.table(rows.map(({ seed, finish, playerRank, playerTime, winner, winTime, modifierCount, fps, errors, wall }) => ({ seed, finish, playerRank, playerTime, winner, winTime, modifierCount, fps, errors, wall })));
const ok = rows.every((r) => r.finish && r.errors === 0);
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
