// npm run gallery: Modifier を 1 つずつ（または組み合わせで）かけて撮影し、一覧（contact sheet）を作る。
// AI が「全部の見た目」を一度に確かめるための道具。距離は毎回 300m 付近に戻して撮る。
//   node 800m/tools/gallery.mjs                      … 全部
//   node 800m/tools/gallery.mjs --only=fisheye,tv    … 指定だけ
//   node 800m/tools/gallery.mjs --combo=giant+tv+crowdRunning,ps1+side2d   … 組み合わせ
//   --at=300（撮る距離） --wait=1400（かけてから撮るまで ms） --cols=4
import { writeFileSync } from 'node:fs';
import { loadPlaywright, startServer, launch, outDir, args } from './harness.mjs';

const a = args();
const at = +(a.at ?? 300);
const wait = +(a.wait ?? 1400);
const cols = +(a.cols ?? 4);
const name = a.name ?? (a.combo ? 'combos' : a.only ? 'only' : 'all');
const dir = outDir('gallery', name);
const pw = await loadPlaywright();
const server = await startServer();
const { browser, page, errors } = await launch(pw, { width: 640, height: 360 });
const shots = [];
try {
  await page.goto(`${server.url}?autopilot=1&seed=${a.seed ?? 5124}&mute=1&chaos=0&distance=${at}${a.query ?? ''}`);
  await page.waitForFunction(() => window.__nanoni?.state().phase === 'race', null, { timeout: 30000 });
  const all = await page.evaluate(() => window.__nanoni.modifiers.list());
  let sets;
  if (a.combo) sets = String(a.combo).split(',').map((c) => c.split('+'));
  else if (a.only) sets = String(a.only).split(',').map((x) => [x]);
  else sets = all.map((m) => [m.id]);
  sets.unshift([]); // 何もなし（基準）
  for (const set of sets) {
    await page.evaluate((d) => {
      const g = window.__nanoni.game;
      window.__nanoni.modifiers.clear(true);
      g.core.shiftAll(d - g.core.player.d);
    }, at);
    await page.waitForTimeout(250);
    const ok = await page.evaluate((ids) => ids.map((id) => window.__nanoni.modifiers.start(id, { intensity: 1, duration: 999 })), set);
    await page.waitForTimeout(wait);
    const st = await page.evaluate(() => window.__nanoni.state());
    const label = set.length ? set.join(' + ') : '(none)';
    const file = `${String(shots.length).padStart(2, '0')}-${(set.join('+') || 'none').replace(/[^\w+]/g, '')}.png`;
    await page.screenshot({ path: `${dir}/${file}` });
    const meta = all.filter((m) => set.includes(m.id)).map((m) => `${m.category}:${m.name}`).join(' / ');
    shots.push({ file, label, meta, ok, st });
    console.log(`[gallery] ${label.padEnd(28)} ok=${ok.join(',')} cam=${st.camera} skin=${st.skin} active=[${st.modifiers.join(',')}]`);
  }
} catch (e) {
  console.log('[gallery] error', e.message);
}
// 一覧: 12 枚ずつの contact sheet（AI が画像として読める大きさ）
const per = cols * 3;
const sheets = [];
for (let i = 0; i < shots.length; i += per) {
  const part = shots.slice(i, i + per);
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0b0b12;color:#fff;font:12px sans-serif;width:${cols * 322}px}
    .g{display:grid;grid-template-columns:repeat(${cols},320px);gap:2px}
    figure{margin:0;position:relative}img{width:320px;height:180px;display:block}
    figcaption{position:absolute;left:0;bottom:0;right:0;background:rgba(0,0,0,.7);padding:2px 5px;font-weight:700}
    figcaption small{font-weight:400;opacity:.75}</style>
    <div class="g">${part.map((s) => `<figure><img src="${s.file}"><figcaption>${s.label} <small>${s.st.camera}/${s.st.skin}</small></figcaption></figure>`).join('')}</div>`;
  const f = `sheet-${sheets.length + 1}.html`;
  writeFileSync(`${dir}/${f}`, html);
  sheets.push(f);
}
const sheetPage = await browser.newPage({ viewport: { width: cols * 322, height: 560 } });
for (const f of sheets) {
  await sheetPage.goto(`file://${dir}/${f}`);
  await sheetPage.waitForTimeout(150);
  await sheetPage.screenshot({ path: `${dir}/${f.replace('.html', '.png')}`, fullPage: true });
}
writeFileSync(`${dir}/index.html`, `<!doctype html><meta charset="utf-8"><body style="background:#111;color:#eee;font:13px sans-serif">${shots.map((s) => `<div style="display:inline-block;margin:4px"><img src="${s.file}" width="480"><br>${s.label}<br><small>${s.meta}</small></div>`).join('')}`);
console.log(`[gallery] ${shots.length} shots, ${sheets.length} sheets → ${dir}  errors=${errors.length}`);
for (const e of errors) console.log('  ', e);
await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);
