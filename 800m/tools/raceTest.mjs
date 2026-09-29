// npm run race-test: 複数の seed で最後まで自動プレイし、結果を記録する
//   node 800m/tools/raceTest.mjs --seeds=1,2,3 --fast=6
//   --determinism  … 同じ seed を速さを変えてもう一度走らせ、結果と演出の順番が同じか確かめる
// 記録: finish / time / winner / player rank / average FPS / errors / modifier count / 節目（80〜120・400・600・720・760m）
import { writeFileSync } from 'node:fs';
import { loadPlaywright, startServer, launch, outDir, args } from './harness.mjs';

const a = args();
const seeds = String(a.seeds ?? '5124,7,2027').split(',').map(Number);
const fast = a.fast ?? 6;
const pw = await loadPlaywright();
const server = await startServer();
const rows = [];
const runs = seeds.map((seed) => ({ seed, fast }));
if (a.determinism) for (const seed of seeds) runs.push({ seed, fast: Math.max(1, Math.round(fast / 2)), again: true });
for (const { seed, fast, again } of runs) {
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
      // 演出の記録: いつ・何が・どこから（director / beat:first / beat:bell / beat:peak / beat:climax / legendary）
      const ev = n.events;
      const starts = n.modifiers.history();
      const seq = ev.filter((e) => e.type === 'MODIFIER_START').map((e) => `${e.id}@${e.d}${e.source && e.source !== 'director' ? `(${e.source.replace('beat:', '')})` : ''}`);
      const calm = ev.find((e) => e.type === 'CHAOS_CALM');
      const endAfterCalm = ev.filter((e) => e.type === 'MODIFIER_START' && calm && e.t > calm.t).length;
      const maxStack = Math.max(0, ...ev.filter((e) => e.type === 'MODIFIER_START').map((e) => e.count));
      return {
        playerRank: me.place,
        results: r.results.map((x) => `${x.index}:${x.time.toFixed(2)}`).join(','),
        seq,
        beats: ['first', 'bell', 'peak', 'climax', 'legendary'].filter((b) => ev.some((e) => e.type === 'MODIFIER_START' && e.source === (b === 'legendary' ? 'legendary' : `beat:${b}`))),
        calmAt: calm?.d ?? null,
        startsAfterCalm: endAfterCalm,
        maxStack,
        combos: ev.filter((e) => e.type === 'NANONI_COMBO').length,
        legend: n.modifiers.legend(),
        uniqueMods: starts.length,
        playerTime: +me.time.toFixed(2),
        winner: n.game.core.runners[win.index].id,
        winTime: +win.time.toFixed(2),
        modifierCount: r.had.length,
        had: r.had.map((h) => h.id),
        fps: +n.fpsAverage().toFixed(1),
      };
    });
    row = { seed, fast, again: !!again, finish: true, ...res };
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
console.table(rows.map(({ seed, fast, finish, playerRank, playerTime, winner, winTime, modifierCount, maxStack, combos, calmAt, startsAfterCalm, fps, errors, wall }) => ({ seed, fast, finish, playerRank, playerTime, winner, winTime, mods: modifierCount, maxStack, combos, calmAt, afterCalm: startsAfterCalm, fps, errors, wall })));
for (const r of rows) if (r.seq) console.log(`seed ${r.seed}${r.again ? ' (again)' : ''} beats=[${r.beats}] legend=${r.legend}\n  ${r.seq.join(' ')}`);
let ok = rows.every((r) => r.finish && r.errors === 0 && !r.startsAfterCalm);
if (a.determinism) {
  for (const r of rows.filter((x) => x.again)) {
    const base = rows.find((x) => x.seed === r.seed && !x.again);
    const same = base && base.results === r.results && base.seq.join() === r.seq.join();
    console.log(`determinism seed ${r.seed}: ${same ? 'SAME' : 'DIFFERENT'}`);
    if (!same) ok = false;
  }
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
