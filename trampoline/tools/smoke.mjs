// npm run tramp:smoke: 自動プレイで 10 試技を最後まで → エラー・表の食い違い・見せ場が起きたかを確認 → PASS / FAIL
//   --fast=2（早送り）--seed=3 --width --height
import { loadPlaywright, startServer, launch, args } from '../../800m/tools/harness.mjs';

const a = args();
const pw = await loadPlaywright();
const server = await startServer();
const { browser, page, errors } = await launch(pw, { width: +(a.width ?? 960), height: +(a.height ?? 540) });
const log = (...m) => console.log('[tramp-smoke]', ...m);
let ok = true;
// 普通に遊べば一度は見られるはずの見せ場
const MUST = ['FACE_LOCK', 'BALLERINA', 'FIREWORK_SYNC', 'CAMERA_LOST', 'AUDIENCE_DRAMA', 'AUDIENCE_JUMP', 'ROOF_OPEN', 'SKY_JUMP', 'ZONE_SPACE'];
try {
  await page.goto(`${server.base}/trampoline/?auto&mute&seed=${a.seed ?? 3}&fast=${a.fast ?? 2}`);
  await page.waitForFunction(() => window.__tramp?.phase && window.__tramp.phase !== 'intro', null, { timeout: 30000 });
  const problems = await page.evaluate(() => window.__tramp.director.problems());
  log(`events: ${await page.evaluate(() => window.__tramp.director.events.length)}`);
  if (problems.length) {
    ok = false;
    log('FAIL: event table', problems);
  }
  const t0 = Date.now();
  let st;
  let lastAttempt = 0;
  while (Date.now() - t0 < +(a.seconds ?? 420) * 1000) {
    await page.waitForTimeout(1000);
    st = await page.evaluate(() => window.__tramp.state());
    if (st.attempt !== lastAttempt) {
      lastAttempt = st.attempt;
      log(`t=${((Date.now() - t0) / 1000).toFixed(0)}s attempt ${st.attempt} level ${st.level} total ${st.total} fps ${st.fps} calls ${st.calls}`);
    }
    if (!Number.isFinite(st.height) || !Number.isFinite(st.total)) {
      ok = false;
      log('FAIL: NaN', st);
      break;
    }
    if (st.phase === 'final') break;
  }
  if (st?.phase !== 'final') {
    ok = false;
    log('FAIL: did not reach the final result', st?.phase, st?.attempt);
  }
  const seen = new Set(st?.seen ?? []);
  const missing = MUST.filter((id) => !seen.has(id));
  log(`seen: ${[...seen].join(', ')}`);
  if (missing.length) {
    ok = false;
    log('FAIL: never happened:', missing.join(', '));
  }
  log(`final total ${st?.total}`);
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
