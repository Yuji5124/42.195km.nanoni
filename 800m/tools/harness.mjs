// 自動テストの共通部品: Playwright の読み込み・プレビューサーバー・ブラウザ起動・ゲームの観察
// Playwright はリポジトリの依存に入れていない（入っていれば使う / 無ければ既知の場所 / PLAYWRIGHT_PATH）。
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    /* 次を試す */
  }
  const candidates = [process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return import(c);
  }
  console.error('Playwright が見つかりません: npm i -D playwright（または PLAYWRIGHT_PATH を指定）');
  process.exit(2);
}

export async function startServer(port = 4180) {
  const { preview } = await import('vite');
  const server = await preview({ root: resolve(import.meta.dirname, '../..'), preview: { port, strictPort: false, host: '127.0.0.1' }, logLevel: 'silent' });
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  return { base, url: `${base}/800m/`, close: () => new Promise((r) => server.httpServer.close(r)) };
}

export async function launch(pw, { width = 1280, height = 720 } = {}) {
  const browser = await pw.chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // フォントの証明書エラーなど、ゲーム外のネットワーク失敗は数えない
    if (m.type() === 'error' && !/Failed to load resource|ERR_CERT|net::/.test(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  return { browser, page, errors };
}

export function outDir(...parts) {
  const d = resolve(import.meta.dirname, 'out', ...parts);
  mkdirSync(d, { recursive: true });
  return d;
}

export const state = (page) => page.evaluate(() => window.__nanoni?.state() ?? null);

export function args() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    const t = s.replace(/^--/, '');
    const i = t.indexOf('=');
    if (i < 0) a[t] = true;
    else a[t.slice(0, i)] = t.slice(i + 1);
  }
  return a;
}
