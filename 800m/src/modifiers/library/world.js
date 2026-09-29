import { defineModifiers, put } from '../registry.js';

// WORLD: 見た目の世界（空・光・天気・トラックの形）。論理トラックは変わらない（worldDeform.js）
// PHYSICS: 見た目の物理（体の弾み・風・重力）。RaceCore の速度には一切触れない

const on = (inst) => !inst.stopping;

defineModifiers([
  {
    id: 'trackWave',
    aliases: ['wave', 'trackwave'],
    category: 'WORLD',
    slots: ['deform'],
    minDistance: 150,
    duration: [6, 10],
    intensity: [0.5, 1],
    weight: 1.3,
    synergy: ['drone', 'topDown', 'rearLong', 'lowGravity'],
    nn: { name: 'トラックが波打つ', end: 'トラックが波打っているのに。', te: 'トラックが波打って', adv: '波の上で', pred: '波に乗っている' },
    apply: (P, k) => {
      P.world.wave += 2.4 * k;
    },
  },
  {
    id: 'worldTilt',
    aliases: ['tilt'],
    category: 'WORLD',
    slots: ['deform'],
    minDistance: 200,
    duration: [5, 8],
    synergy: ['dutchAngle', 'crowdRunning'],
    start: (inst) => (inst.data.dir = inst.rng && inst.rng.next() < 0.5 ? -1 : 1),
    nn: { name: '傾く世界', end: '世界が傾いているのに。', te: '世界が傾いて', adv: '斜めの世界で', pred: '傾いている' },
    apply: (P, k, inst) => {
      P.world.tilt += (inst.data.dir ?? 1) * 0.3 * k;
    },
  },
  {
    id: 'worldTwist',
    aliases: ['twist'],
    category: 'WORLD',
    slots: ['deform'],
    minDistance: 300,
    duration: [5, 8],
    weight: 0.9,
    big: true,
    synergy: ['drone', 'skyFlip'],
    nn: { name: 'ねじれた競技場', end: '競技場がねじれているのに。', te: '競技場がねじれて', adv: 'ねじれた世界で', pred: 'ねじれている' },
    apply: (P, k) => {
      P.world.twist += 1.3 * k;
    },
  },
  {
    id: 'worldFold',
    aliases: ['fold'],
    category: 'WORLD',
    slots: ['deform'],
    minDistance: 300,
    duration: [5, 8],
    weight: 0.8,
    big: true,
    synergy: ['rearLong', 'topDown'],
    nn: { name: '折れる世界', end: '世界が折れ曲がっているのに。', te: '世界が折れて', adv: '折れた世界で', pred: '折れ曲がっている' },
    apply: (P, k) => {
      P.world.fold += 0.55 * k;
    },
  },
  {
    id: 'sunset',
    category: 'WORLD',
    slots: ['sky'],
    minDistance: 100,
    duration: [8, 12],
    weight: 1.1,
    synergy: ['cinema', 'tvBroadcast', 'slowWorld'],
    nn: { name: '夕焼け', end: '夜だったのに。', te: '夕焼けになって', adv: '夕焼けの中で', pred: '夕焼けに染まっている' },
    apply: (P, k) => put.sky(P, 'sunset', k),
  },
  {
    id: 'dawn',
    category: 'WORLD',
    slots: ['sky'],
    minDistance: 150,
    duration: [8, 12],
    synergy: ['dazzle', 'crowdFreeze'],
    nn: { name: '朝焼け', end: 'まだ2分も走っていないのに。', te: '朝になって', adv: '朝焼けの中で', pred: '朝を迎えている' },
    apply: (P, k) => put.sky(P, 'dawn', k),
  },
  {
    id: 'clouds',
    aliases: ['sky', 'abovetheclouds'],
    category: 'WORLD',
    slots: ['sky', 'stadium'],
    minDistance: 300,
    duration: [7, 10],
    big: true,
    synergy: ['lowGravity', 'dazzle', 'crowdVanish'],
    nn: { name: '雲の上', end: '雲の上なのに。', te: '雲の上に出て', adv: '雲の上で', pred: '雲の上を走っている' },
    apply: (P, k, inst) => {
      put.sky(P, 'clouds', k);
      if (on(inst) && inst.env > 0.5) {
        P.world.stadium = 0;
        P.world.floor = 'clouds';
      }
    },
  },
  {
    id: 'sea',
    aliases: ['ocean'],
    category: 'WORLD',
    slots: ['sky', 'stadium'],
    minDistance: 300,
    duration: [7, 10],
    big: true,
    synergy: ['trackWave', 'sunset', 'crowdVanish'],
    nn: { name: '海の上', end: '海の上なのに。', te: '海の上に出て', adv: '海の上で', pred: '海の上を走っている' },
    apply: (P, k, inst) => {
      put.sky(P, 'sea', k);
      if (on(inst) && inst.env > 0.5) {
        P.world.stadium = 0;
        P.world.floor = 'sea';
      }
    },
  },
  {
    id: 'skyFlip',
    aliases: ['upsidedownsky'],
    category: 'WORLD',
    slots: ['skyFlip'],
    minDistance: 250,
    duration: [5, 8],
    synergy: ['worldTwist', 'crowdReverse'],
    nn: { name: '空が下', end: '空が下にあるのに。', te: '空が下になって', adv: '逆さまの空の下で', pred: '空を踏んでいる' },
    apply: (P, k, inst) => {
      if (on(inst) && inst.env > 0.5) P.world.skyFlip = true;
    },
  },
  {
    id: 'blackout',
    aliases: ['dark', 'poweroutage'],
    category: 'WORLD',
    slots: ['light'],
    minDistance: 250,
    duration: [4, 6],
    weight: 0.8,
    synergy: ['invisible', 'crowdVanish'],
    nn: { name: '停電', end: '停電したのに。', te: '停電して', adv: '暗闇で', pred: '暗闇を走っている' },
    apply: (P, k) => {
      P.world.light *= 1 - 0.8 * k;
      P.runner.playerRim = Math.max(P.runner.playerRim, 1.3 * k);
      P.post.bloom *= 1 + k;
    },
  },
  {
    id: 'rain',
    category: 'WORLD',
    slots: ['weather'],
    minDistance: 150,
    duration: [8, 12],
    synergy: ['oldFilm', 'cinema', 'slowWorld'],
    nn: { name: '豪雨', end: 'さっきまで晴れていたのに。', te: '雨が降って', adv: '雨の中で', pred: '雨に打たれている' },
    apply: (P, k) => {
      P.world.weather = 'rain';
      P.world.weatherAmt = Math.max(P.world.weatherAmt, k);
      P.world.light *= 1 - 0.25 * k;
    },
  },
  {
    id: 'snow',
    category: 'WORLD',
    slots: ['weather'],
    minDistance: 150,
    duration: [8, 12],
    synergy: ['crowdFreeze', 'dawn', 'slowWorld'],
    nn: { name: '雪', end: '真夏なのに。', te: '雪が降って', adv: '雪の中で', pred: '雪に埋もれている' },
    apply: (P, k) => {
      P.world.weather = 'snow';
      P.world.weatherAmt = Math.max(P.world.weatherAmt, k);
    },
  },
  // ---- PHYSICS（見た目だけ） ----
  {
    id: 'lowGravity',
    aliases: ['moon', 'lowgravity'],
    category: 'PHYSICS',
    slots: ['gravity'],
    minDistance: 200,
    duration: [5, 8],
    synergy: ['clouds', 'trackWave', 'giantPlayer'],
    nn: { name: '月面の重力', end: '重力が6分の1なのに。', te: 'ふわふわ浮いて', adv: 'ふわふわと', pred: '浮いている' },
    apply: (P, k) => {
      P.world.gravity *= 1 - 0.75 * k;
    },
  },
  {
    id: 'heavyGravity',
    aliases: ['heavy'],
    category: 'PHYSICS',
    slots: ['gravity'],
    minDistance: 250,
    duration: [4, 7],
    weight: 0.7,
    synergy: ['giantPlayer', 'slowWorld'],
    nn: { name: '重力3倍', end: '体が重そうなのに。', te: '重力に押されて', adv: 'ずっしりと', pred: 'つぶれそうになっている' },
    apply: (P, k) => {
      P.world.gravity *= 1 + 2 * k;
    },
  },
  {
    id: 'gale',
    aliases: ['wind'],
    category: 'PHYSICS',
    slots: ['wind'],
    minDistance: 150,
    duration: [6, 9],
    synergy: ['rain', 'snow', 'giantSword'],
    nn: { name: '強風', end: '風がすごいのに。', te: '風にあおられて', adv: '強風の中で', pred: '風にあおられている' },
    apply: (P, k) => {
      P.world.wind += k;
    },
  },
]);
