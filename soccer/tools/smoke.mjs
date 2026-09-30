// npm run soccer:smoke: 自動プレイで前半の最後（結果画面）まで → エラー・NaN・席探しのルールを確認 → PASS / FAIL
//   --seed=3（別の席）--width --height --warp=100（そこまで一気に進める）
import { loadPlaywright, startServer, launch, args } from '../../800m/tools/harness.mjs';

const a = args();
const pw = await loadPlaywright();
const server = await startServer();
const { browser, page, errors } = await launch(pw, { width: +(a.width ?? 640), height: +(a.height ?? 360) });
const log = (...m) => console.log('[soccer-smoke]', ...m);
let ok = true;
const fail = (...m) => {
  ok = false;
  log('FAIL:', ...m);
};
try {
  const seed = a.seed ? `&seed=${a.seed}` : '';
  const warp = +(a.warp ?? 100);
  await page.goto(`${server.base}/soccer/?auto&mute&fast=8&quality=verylow&warp=${warp}&findAt=${warp + 2}${seed}`);
  await page.waitForFunction(() => window.__soccer?.phase === 'search', null, { timeout: 90000 });

  // ---- 座席表と探索のルール
  const rules = await page.evaluate(() => {
    const s = window.__soccer;
    const L = s.layout;
    const S = s.search;
    const out = { count: L.count, target: L.label(S.target), kind: s.plan.kind[S.target], decoys: s.plan.decoyCount };
    // 解析的ピック: 目標へ向けたレイが目標の席に当たるか
    const c = s.camera.position;
    const p = S.seatWorld(S.target).clone();
    p.y = L.y[S.target] + 0.85;
    const d = p.clone().sub(c).normalize();
    out.pickHit = L.pick(c.x, c.y, c.z, d.x, d.y, d.z) === S.target;
    // ランダムな席 200 個: 席の中心へ向けたレイがその席（か隣）に当たるか
    let good = 0;
    for (let k = 0; k < 200; k++) {
      const id = Math.floor(Math.random() * L.count);
      const q = S.seatWorld(id).clone();
      q.y = L.y[id] + 0.85;
      const v = q.clone().sub(c).normalize();
      const h = L.pick(c.x, c.y, c.z, v.x, v.y, v.z);
      if (h === id || (h >= 0 && Math.abs(L.row[h] - L.row[id]) <= 1 && L.tier[h] === L.tier[id])) good++;
    }
    out.pickRate = good / 200;
    // 1 つだけの本物
    let targets = 0;
    for (let i = 0; i < L.count; i++) if (s.plan.kind[i] === 1) targets++;
    out.targets = targets;
    return out;
  });
  log('rules', JSON.stringify(rules));
  if (rules.count !== 100000) fail('seat count', rules.count);
  if (rules.targets !== 1) fail('targets', rules.targets);
  if (!rules.pickHit) fail('pick did not hit the target');
  if (rules.pickRate < 0.9) fail('pick rate', rules.pickRate);

  // ---- 最後まで
  const t0 = Date.now();
  let st;
  let lastPhase = '';
  while (Date.now() - t0 < +(a.seconds ?? 420) * 1000) {
    await page.waitForTimeout(1500);
    st = await page.evaluate(() => window.__soccer.state());
    if (st.phase !== lastPhase) {
      lastPhase = st.phase;
      log(`t=${((Date.now() - t0) / 1000).toFixed(0)}s phase ${st.phase} match ${st.clock} JPN ${st.score.home}-${st.score.away} BRA checked ${st.checked} calls ${st.calls} tris ${st.tris}`);
    }
    if (!Number.isFinite(st.t) || !Number.isFinite(st.watched)) {
      fail('NaN', JSON.stringify(st));
      break;
    }
    if (st.phase === 'result') break;
  }
  if (st?.phase !== 'result') fail('did not reach the result', st?.phase, st?.clock);
  if (!st?.found) fail('seat not found');
  if ((st?.goals ?? 0) < 1) fail('no goals');
  const resultText = await page.textContent('#result');
  if (!/サッカー/.test(resultText) || !/GOALS ACTUALLY SEEN/.test(resultText)) fail('result screen text');
  log('final', JSON.stringify(st));
} catch (e) {
  fail(e.message);
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
