import { Game } from './core/game.js';

// 800m、なのに。
// 2周だけなのに、何回ゲーム変わるの？

const game = new Game(document.getElementById('game'));
game.init().catch((err) => {
  console.error(err);
  const el = document.getElementById('devpanel');
  el.classList.remove('hidden');
  el.querySelector('pre').textContent = `起動に失敗しました: ${err.message}\n${err.stack}`;
});
