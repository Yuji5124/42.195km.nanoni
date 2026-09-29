// npm run filmstrip: 自動プレイ中、0/100/.../700m とゴールでスクリーンショットを撮り、1 枚の一覧（index.html）にする
//   node 800m/tools/filmstrip.mjs --seed=5124 --query='&camera=SIDE' --marks=0,100,400,700,780
import { writeFileSync } from 'node:fs';
import { loadPlaywright, startServer, launch, outDir, args } from './harness.mjs';

const a = args();
const seed = a.seed ?? 5124;
const marks = String(a.marks ?? '0,100,200,300,400,500,600,700,760').split(',').map(Number);
const name = a.name ?? `seed-${seed}`;
const dir = outDir('filmstrip', name);
const pw = await loadPlaywright();
const server = await startServer();
const { browser, page, errors } = await launch(pw, { width: +(a.width ?? 960), height: +(a.height ?? 540) });
const shots = [];
try {
  await page.goto(`${server.url}?autopilot=${a.autopilot ?? 1}&seed=${seed}&mute=1&fast=${a.fast ?? 2}${a.query ?? ''}`);
  await page.waitForFunction(() => window.__nanoni?.state().phase === 'race', null, { timeout: 30000 });
  for (const m of marks) {
    await page.waitForFunction((mm) => { const s = window.__nanoni.state(); return s.d >= mm || s.finished; }, m, { timeout: 240000, polling: 100 });
    const st = await page.evaluate(() => window.__nanoni.state());
    const file = `${String(m).padStart(3, '0')}m.png`;
    await page.screenshot({ path: `${dir}/${file}` });
    shots.push({ file, label: `${m}m`, st });
    console.log(`[filmstrip] ${m}m d=${st.d} cam=${st.camera} skin=${st.skin} mods=[${st.modifiers.join(',')}]`);
  }
  if (!a.noFinish) {
    await page.waitForFunction(() => window.__nanoni.state().finished, null, { timeout: 240000, polling: 100 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${dir}/finish.png` });
    shots.push({ file: 'finish.png', label: 'FINISH', st: await page.evaluate(() => window.__nanoni.state()) });
  }
} catch (e) {
  console.log('[filmstrip] error', e.message);
}
const html = `<!doctype html><meta charset="utf-8"><title>filmstrip ${name}</title>
<style>body{background:#111;color:#eee;font:13px sans-serif;margin:12px}div{display:inline-block;margin:6px;vertical-align:top}img{width:420px;display:block}</style>
${shots.map((s) => `<div><img src="${s.file}"><b>${s.label}</b> ${s.st.camera} / ${s.st.skin}<br>${s.st.modifiers.join(', ')}</div>`).join('\n')}`;
writeFileSync(`${dir}/index.html`, html);
console.log(`[filmstrip] ${shots.length} shots → ${dir}/index.html  errors=${errors.length}`);
for (const e of errors) console.log('  ', e);
await browser.close();
await server.close();
