import { defineModifiers } from '../registry.js';

// UI: HUD の着せ替え・嘘の表示・偽のバグ。値は全部 RaceCore の本物から（嘘の表示は「見せ方」だけ）

const on = (inst) => !inst.stopping;
const skin = (P, inst, name) => {
  if (on(inst) && inst.env > 0.3) P.ui.skin = name;
};

defineModifiers([
  {
    id: 'rpgHud',
    aliases: ['rpg'],
    category: 'UI',
    slots: ['skin'],
    minDistance: 150,
    duration: [7, 10],
    weight: 1.3,
    synergy: ['pc98', 'topDown', 'gameboy'],
    nn: { name: 'RPGの画面', end: 'RPGの画面なのに。', te: 'RPGになって', adv: 'RPGの中で', pred: 'RPGになっている' },
    apply: (P, k, inst) => skin(P, inst, 'rpg'),
  },
  {
    id: 'fightingHud',
    aliases: ['fighting', 'fightinggame'],
    category: 'UI',
    slots: ['skin'],
    minDistance: 150,
    duration: [7, 10],
    synergy: ['side2d', 'crt', 'giantSword'],
    nn: { name: '格ゲーの画面', end: '格ゲーの画面なのに。', te: '格ゲーになって', adv: '格ゲーの中で', pred: '格ゲーになっている' },
    start: (inst, ctx) => ctx.hud?.call('ROUND 1', 1100),
    apply: (P, k, inst) => skin(P, inst, 'fighting'),
  },
  {
    id: 'racingHud',
    aliases: ['racing', 'racinggame'],
    category: 'UI',
    slots: ['skin'],
    minDistance: 150,
    duration: [7, 10],
    synergy: ['rearLong', 'fastForward', 'lowRes'],
    nn: { name: 'レースゲームの画面', end: 'レースゲームの画面なのに。', te: 'レースゲームになって', adv: 'レースゲームの中で', pred: 'レースゲームになっている' },
    apply: (P, k, inst) => skin(P, inst, 'racing'),
  },
  {
    id: 'rhythmHud',
    aliases: ['rhythm', 'rhythmgame'],
    category: 'UI',
    slots: ['skin'],
    minDistance: 150,
    duration: [7, 10],
    synergy: ['crowdSync', 'rainbow', 'side2d'],
    nn: { name: '音ゲーの画面', end: '音ゲーの画面なのに。', te: '音ゲーになって', adv: '音ゲーの中で', pred: '音ゲーになっている' },
    apply: (P, k, inst) => skin(P, inst, 'rhythm'),
  },
  {
    id: 'liarHud',
    aliases: ['liar', 'lie'],
    category: 'UI',
    slots: ['distanceText'],
    minDistance: 200,
    maxDistance: 700,
    duration: [4, 7],
    weight: 0.9,
    start: (inst) => {
      const r = inst.rng ? inst.rng.next() : 0.5;
      inst.data.off = Math.round((r < 0.5 ? -1 : 1) * (60 + r * 140));
    },
    nn: { name: '嘘の距離表示', end: '表示がでたらめなのに。', te: '距離表示が嘘をついて', adv: 'でたらめな表示のまま', pred: '距離をごまかされている' },
    nnEnd: (inst, ctx) => `表示は${Math.max(0, Math.floor((ctx.d ?? 0) + (inst.data.off ?? 0)))}mなのに。`,
    apply: (P, k, inst) => {
      if (on(inst)) P.ui.liar = inst.data.off;
    },
  },
  {
    id: 'lapBug',
    aliases: ['lap'],
    category: 'UI',
    minDistance: 120,
    duration: [5, 8],
    weight: 0.9,
    synergy: ['racingHud', 'fakeBug'],
    nn: { name: 'LAP 5/2', end: '2周しかないのに。', te: '周回数がバグって', adv: '5周目のつもりで', pred: '5周目になっている' },
    apply: (P, k, inst) => {
      if (on(inst)) P.ui.lapBug = 1;
    },
  },
  {
    id: 'boardMirror',
    aliases: ['scoreboard', 'mirrorboard'],
    category: 'UI',
    minDistance: 80,
    duration: [8, 12],
    intensity: [1, 1],
    weight: 0.7,
    synergy: ['mirrorView', 'tvBroadcast'],
    nn: { name: '鏡文字のスコアボード', end: 'スコアボードが鏡文字なのに。', te: 'スコアボードが鏡文字で', adv: '鏡文字の下で', pred: '鏡文字で表示されている' },
    apply: (P, k, inst) => {
      if (on(inst)) P.ui.boardMirror = true;
    },
  },
  {
    id: 'fakeBug',
    aliases: ['bug', 'glitch'],
    category: 'UI',
    slots: ['fps'],
    minDistance: 250,
    maxDistance: 720,
    duration: [3, 5],
    weight: 1,
    synergy: ['lapBug', 'lowRes', 'cctvCam'],
    nn: { name: '偽のバグ', end: 'バグっていないのに。', te: 'バグったふりをして', adv: 'バグったまま', pred: 'バグったふりをしている' },
    // 本物のエラー（console.error）は出さない。イベントとして流すだけ
    start: (inst, ctx) => ctx.bus?.emit('FAKE_BUG', { kind: 'overlay' }),
    apply: (P, k, inst) => {
      if (on(inst)) P.ui.fake = 1;
      P.post.glitch = Math.max(P.post.glitch, 0.8 * k);
      P.post.chroma = Math.max(P.post.chroma, 0.006 * k);
    },
  },
]);
