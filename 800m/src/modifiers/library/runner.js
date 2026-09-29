import { defineModifiers } from '../registry.js';
import { lerp } from '../../core/mathx.js';

// RUNNER: 選手の見た目（大きさ・頭・足・棒人間・透明・刀）。当たり判定や速さは RaceCore のまま

const on = (inst) => !inst.stopping;

defineModifiers([
  {
    id: 'giantPlayer',
    aliases: ['giant', 'giantsamurai'],
    category: 'RUNNER',
    slots: ['playerSize'],
    minDistance: 150,
    duration: [6, 10],
    weight: 1.4,
    synergy: ['tvBroadcast', 'giantCrowd', 'orbit', 'ps1', 'tallVideo'],
    nn: { name: '巨大な侍', end: '侍だけ巨人なのに。', te: '侍が巨人になって', subj: '巨人の侍が', adv: '巨人のまま', pred: '巨人になっている' },
    apply: (P, k) => {
      P.runner.playerScale *= lerp(1, 3.4, k);
    },
  },
  {
    id: 'tinyAll',
    aliases: ['tiny', 'tinyplayers', 'small'],
    category: 'RUNNER',
    slots: ['playerSize'],
    minDistance: 150,
    duration: [6, 10],
    weight: 1.2,
    synergy: ['topDown', 'giantCrowd', 'lowRes'],
    nn: { name: '小人の800m', end: 'みんな小さいのに。', te: 'みんな小さくなって', subj: '小人たちが', adv: '小さな体で', pred: '小さくなっている' },
    apply: (P, k) => {
      const s = lerp(1, 0.38, k);
      P.runner.playerScale *= s;
      P.runner.otherScale *= s;
    },
  },
  {
    id: 'bigHeads',
    aliases: ['bighead', 'heads'],
    category: 'RUNNER',
    slots: ['heads'],
    minDistance: 150,
    duration: [6, 9],
    weight: 1.2,
    synergy: ['tvBroadcast', 'rainbow', 'side2d'],
    nn: { name: '頭だけ巨大', end: '頭だけ大きいのに。', te: '頭が大きくなって', subj: '頭の大きい侍が', adv: '大きな頭で', pred: '頭だけ大きい' },
    apply: (P, k) => {
      P.runner.headScale *= lerp(1, 2.8, k);
    },
  },
  {
    id: 'bigFeet',
    aliases: ['feet'],
    category: 'RUNNER',
    slots: ['feet'],
    minDistance: 150,
    duration: [5, 8],
    weight: 0.9,
    synergy: ['side2d', 'heavyGravity'],
    nn: { name: '足だけ巨大', end: '足だけ大きいのに。', te: '足が大きくなって', subj: '大足の侍が', adv: '大きな足で', pred: '足だけ大きい' },
    apply: (P, k) => {
      P.runner.footScale *= lerp(1, 2.7, k);
    },
  },
  {
    id: 'stickmen',
    aliases: ['stick', 'stickfigure'],
    category: 'RUNNER',
    slots: ['stick'],
    minDistance: 200,
    duration: [5, 9],
    synergy: ['side2d', 'oldFilm', 'gameboy'],
    nn: { name: '棒人間', end: 'みんな棒人間なのに。', te: 'みんな棒人間になって', subj: '棒人間たちが', adv: '棒人間のまま', pred: '棒人間になっている' },
    apply: (P, k, inst) => {
      if (on(inst) && inst.env > 0.5) P.runner.stickOthers = true;
    },
  },
  {
    id: 'invisible',
    aliases: ['transparent', 'ghost'],
    category: 'RUNNER',
    slots: ['playerOpacity'],
    minDistance: 250,
    duration: [4, 7],
    synergy: ['blackout', 'cctvCam'],
    nn: { name: '透明な侍', end: '自分だけ透明なのに。', te: '透明になって', subj: '透明な侍が', adv: '透明なまま', pred: '透明になっている' },
    apply: (P, k) => {
      P.runner.playerOpacity *= lerp(1, 0.14, k);
      P.runner.playerRim = Math.max(P.runner.playerRim, 1.6 * k);
    },
  },
  {
    id: 'ghostPack',
    aliases: ['ghosts'],
    category: 'RUNNER',
    slots: ['otherOpacity'],
    minDistance: 200,
    duration: [5, 8],
    weight: 0.8,
    synergy: ['blackout', 'oldFilm', 'crowdVanish'],
    nn: { name: '幽霊の選手たち', end: 'みんな透けているのに。', te: 'みんな透けて', subj: '幽霊たちが', adv: '透けたまま', pred: '透けている' },
    apply: (P, k) => {
      P.runner.otherOpacity *= lerp(1, 0.28, k);
    },
  },
  {
    id: 'giantSword',
    aliases: ['sword', 'katana'],
    category: 'RUNNER',
    slots: ['sword'],
    minDistance: 150,
    duration: [5, 9],
    synergy: ['gale', 'giantPlayer', 'fightingHud'],
    nn: { name: '刀が巨大', end: '刀が大きすぎるのに。', te: '刀が大きくなって', subj: '大太刀の侍が', adv: '大太刀を差して', pred: '大太刀を差している' },
    apply: (P, k) => {
      P.runner.giantSword = Math.max(P.runner.giantSword, k);
    },
  },
  {
    id: 'slowLegs',
    aliases: ['slowmolegs'],
    category: 'RUNNER',
    slots: ['legSpeed'],
    minDistance: 200,
    duration: [4, 7],
    weight: 0.9,
    synergy: ['side2d', 'rhythmHud'],
    nn: { name: '脚だけスロー', end: '脚はゆっくりなのに。', te: '脚だけスローになって', subj: 'ゆっくり脚の侍が', adv: '脚だけスローで', pred: '脚だけスローになっている' },
    apply: (P, k) => {
      P.runner.playerLegSpeed *= lerp(1, 0.35, k);
    },
  },
  {
    id: 'fastLegs',
    aliases: ['cartoonlegs'],
    category: 'RUNNER',
    slots: ['legSpeed'],
    minDistance: 200,
    duration: [4, 7],
    weight: 0.9,
    synergy: ['side2d', 'fastForward'],
    nn: { name: '脚が高速回転', end: '脚が速すぎるのに。', te: '脚が高速回転して', subj: '脚だけ速い侍が', adv: '脚をぐるぐる回して', pred: '脚だけ速い' },
    apply: (P, k) => {
      P.runner.playerLegSpeed *= lerp(1, 2.6, k);
      P.runner.otherLegSpeed *= lerp(1, 2.6, k);
    },
  },
]);
