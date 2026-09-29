import { defineModifiers } from '../registry.js';
import { lerp } from '../../core/mathx.js';

// TIME: 世界の時間の速さ。全員に等しく効く（順位・タイムの公平さはそのまま）。
// 長さはレース内の秒なので、スローの間は現実の時間では少し長く感じる → 短めにしてある

defineModifiers([
  {
    id: 'slowWorld',
    aliases: ['slow', 'slowmotion', 'slowmo'],
    category: 'TIME',
    slots: ['time'],
    minDistance: 200,
    maxDistance: 730,
    duration: [2.5, 4],
    weight: 1.2,
    synergy: ['cinema', 'rain', 'oldFilm', 'giantPlayer'],
    nn: { name: 'スローモーション', end: '世界がスローなのに。', te: 'スローになって', adv: 'スローで', pred: 'スローになっている' },
    apply: (P, k) => {
      P.time.sim *= lerp(1, 0.42, k);
      P.audio.lowpass = Math.max(P.audio.lowpass, 0.35 * k);
      P.audio.detune -= 500 * k;
      P.audio.bpmMul *= lerp(1, 0.6, k);
    },
  },
  {
    id: 'fastForward',
    aliases: ['fast', 'ff'],
    category: 'TIME',
    slots: ['time'],
    minDistance: 200,
    maxDistance: 700,
    duration: [3, 5],
    weight: 0.9,
    synergy: ['fastLegs', 'racingHud', 'lowFps'],
    start: (inst, ctx) => ctx.hud?.camLabel('▶▶ ×1.5', 2400),
    nn: { name: '早送り', end: '早送りなのに。', te: '早送りになって', adv: '早送りで', pred: '早送りされている' },
    apply: (P, k) => {
      P.time.sim *= lerp(1, 1.5, k);
      P.audio.detune += 400 * k;
      P.audio.bpmMul *= lerp(1, 1.3, k);
    },
  },
]);
