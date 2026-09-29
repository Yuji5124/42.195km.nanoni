import { defineModifiers, put } from '../registry.js';
import { lerp } from '../../core/mathx.js';
import { crowdCam } from './crowd.js';

// LEGENDARY: 1〜3% のレースでだけ起きる大事件。ChaosDirector が決まった距離で起こす（普段の抽選には出ない）。
// URL: ?legendary=1（どれか）/ ?legendary=space（指定）

const on = (inst) => !inst.stopping;

defineModifiers([
  {
    id: 'allRunners',
    aliases: ['everyonerun', 'crowdrace'],
    category: 'CROWD',
    slots: ['crowdMove', 'crowdSize'],
    legendary: true,
    weight: 0,
    at: 500,
    duration: [12, 12],
    intensity: [1, 1],
    nn: { name: '観客全員がランナーに', end: '観客だったのに。', te: '観客が全員走り出して', subj: '観客全員が', adv: '観客全員と', pred: '観客全員と走っている' },
    apply: (P, k, inst) => {
      crowdCam(P, inst);
      if (on(inst) && inst.env > 0.3) P.crowd.runners = 1;
    },
  },
  {
    id: 'spaceStadium',
    aliases: ['space', 'universe'],
    category: 'WORLD',
    slots: ['sky', 'stadium'],
    legendary: true,
    weight: 0,
    at: 700,
    duration: [9, 9],
    intensity: [1, 1],
    nn: { name: '競技場ごと宇宙へ', end: '陸上競技場なのに。', te: '宇宙に出て', adv: '宇宙で', pred: '宇宙を走っている' },
    apply: (P, k, inst) => {
      put.sky(P, 'space', k);
      if (on(inst) && inst.env > 0.4) {
        P.world.stadium = 0;
        P.world.floor = 'space';
      }
      P.world.gravity *= lerp(1, 0.5, k);
      P.post.bloom *= 1 + k;
    },
  },
  {
    id: 'split4',
    aliases: ['split', 'quad', 'multicam'],
    category: 'CAMERA',
    slots: ['camera'],
    legendary: true,
    weight: 0,
    at: 600,
    duration: [9, 9],
    intensity: [1, 1],
    nn: { name: '画面が4分割', end: '一人で走っているのに。', te: '画面が4つに割れて', adv: '4つの画面で', pred: '4台のカメラに映っている' },
    apply: (P, k, inst) => {
      if (on(inst)) P.camera.split4 = true;
    },
  },
  {
    id: 'ps1Final',
    aliases: ['ps1final', 'retrofinal'],
    category: 'VISUAL',
    slots: ['pixel', 'palette'],
    legendary: true,
    finale: true, // 760m の片付けでも消えない（ラスト 100m ずっと）
    weight: 0,
    at: 700,
    duration: [60, 60],
    intensity: [1, 1],
    nn: { name: '最後の100mだけPS1', end: 'ラスト100mなのに。', te: 'PS1になって', adv: 'PS1画質で', pred: 'PS1になっている' },
    apply: (P, k) => {
      if (k < 0.03) return;
      put.minNonZero(P.post, 'pixel', lerp(640, 320, k));
      P.post.snap = lerp(360, 110, k);
      P.post.dither = Math.max(P.post.dither, k);
      P.post.posterize = P.post.posterize || 28;
      P.post.bloom *= 1 - 0.5 * k;
    },
  },
]);
