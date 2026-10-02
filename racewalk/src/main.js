import { RaceWalkGame } from './RaceWalkGame.js';

// 『競歩、なのに。』— 42.195km、なのに。のタイトル画面から選ぶ競技（別ページ）。
const game = new RaceWalkGame();
game.init().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;left:8px;bottom:8px;color:#f88;z-index:99">${String(e?.stack ?? e)}</pre>`);
});
