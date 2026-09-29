// npm run smoke: ブラウザ起動 → ゲーム開始 → 自動操縦 → 30〜60 秒 → console error 確認 → PASS / FAIL
import { loadPlaywright, startServer, launch, state, outDir, args } from './harness.mjs';

const a = args();
const seconds = +(a.seconds ?? 40);
const seed = a.seed ?? 5124;
const pw = await loadPlaywright();
const server = await startServer();
const { browser, page, errors } = await launch(pw);
let ok = true;
const log = (...m) => console.log('[smoke]', ...m);
try {
  await page.goto(`${server.url}?autopilot=1&seed=${seed}&mute=1&fast=${a.fast ?? 2}${a.query ?? ''}`);
  await page.waitForFunction(() => window.__nanoni?.state().phase === 'race', null, { timeout: 30000 });
  // Modifier の定義に食い違いがないか（存在しない相手・文末が「のに。」でない など）
  const problems = await page.evaluate(() => window.__nanoni.modifiers.problems());
  const count = await page.evaluate(() => window.__nanoni.modifiers.list().length);
  log(`modifiers registered: ${count}`);
  if (problems.length) {
    ok = false;
    log('FAIL: modifier registry', problems);
  }
  const first = await state(page);
  const t0 = Date.now();
  let last = first;
  while (Date.now() - t0 < seconds * 1000) {
    await page.waitForTimeout(3000);
    last = await state(page);
    log(`t=${((Date.now() - t0) / 1000).toFixed(0)}s d=${last.d}m rank=${last.rank} fps=${last.fps} chaos=${last.chaos} cam=${last.camera} mods=[${last.modifiers.join(',')}]`);
    if (last.phase === 'result') break;
    if (!Number.isFinite(last.d)) {
      ok = false;
      log('FAIL: distance is not finite');
      break;
    }
  }
  if (!(last.d > first.d + 20 || last.phase === 'result')) {
    ok = false;
    log('FAIL: the player did not advance');
  }
  await page.screenshot({ path: `${outDir('smoke')}/last.png` });
} catch (e) {
  ok = false;
  log('FAIL:', e.message);
}
if (errors.length) {
  ok = false;
  log('console errors:');
  for (const e of errors) log('  ', e);
}
await browser.close();
await server.close();
log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
