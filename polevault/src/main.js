import { PoleVaultMode } from './PoleVaultMode.js';

// 『棒高跳び、なのに。』の入口。42.195km / サッカーのコード（../../src, ../../soccer/src）の部品を読み込んで使うが、
// 向こうからは何も読み込まない（このページを消しても他のモードは変わらない）。
const mode = new PoleVaultMode(document.getElementById('game'));
mode.init().catch((err) => {
  console.error(err);
  document.getElementById('ui').textContent = `起動に失敗しました: ${err.message}`;
});
