// 開発用: 画像を格子に並べて 1 枚に（連続写真の確認）
//   node polevault/tools/sheet.mjs --out=sheet.png --cols=4 --w=1600 a.png b.png ...
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadPlaywright, args } from '../../800m/tools/harness.mjs';
const a = args();
const files = process.argv.slice(2).filter((s) => !s.startsWith('--'));
const cols = +(a.cols ?? 4);
const W = +(a.w ?? 1600);
const pw = await loadPlaywright();
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: 400 } });
const cells = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${basename(f)}</figcaption></figure>`).join('');
await page.setContent(`<style>body{margin:0;background:#111;color:#ddd;font:12px sans-serif}div{display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px;padding:4px}img{width:100%;display:block}figure{margin:0}figcaption{padding:2px}</style><div>${cells}</div>`);
await page.waitForTimeout(300);
await page.screenshot({ path: a.out ?? 'sheet.png', fullPage: true });
await browser.close();
console.log(a.out ?? 'sheet.png');
