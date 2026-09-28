import { Game } from './core/Game.js';

// 42.195km、なのに。
// 走るだけ。なのに、ゲームが全然落ち着かない。

const game = new Game(document.getElementById('game'));
game.init().catch((err) => {
  console.error(err);
  const el = document.getElementById('debug');
  el.classList.remove('hidden');
  el.textContent = `起動に失敗しました: ${err.message}`;
});
