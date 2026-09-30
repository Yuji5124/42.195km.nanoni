import { SoccerMode } from './SoccerMode.js';

// 『サッカー、なのに。』の入口。1500m / 42.195km のコード（../../src）の部品を読み込んで使うが、
// 向こうからは何も読み込まない（このページを消しても他のモードは変わらない）。
const mode = new SoccerMode(document.getElementById('game'));
mode.init().catch((err) => {
  console.error(err);
  document.getElementById('ui').textContent = `起動に失敗しました: ${err.message}`;
});
