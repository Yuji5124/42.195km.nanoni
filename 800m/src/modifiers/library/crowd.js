import { defineModifiers } from '../registry.js';
import { lerp } from '../../core/mathx.js';

// CROWD: 観客（背景ではなく、レースと一緒に変になる）。stadium/crowd.js と stands.js のシェーダーが読む

const on = (inst) => !inst.stopping;
// 観客が見えないと意味がない → カメラの Modifier がなければ、追従カメラを「観客も映る位置」へ
export const crowdCam = (P, inst) => {
  if (on(inst) && P.camera.mode === 'FOLLOW') P.camera.mode = 'FOLLOW_CROWD';
};

defineModifiers([
  {
    id: 'giantOne',
    aliases: ['onegiant'],
    category: 'CROWD',
    slots: ['giantOne'],
    minDistance: 80,
    duration: [7, 10],
    intensity: [0.8, 1],
    weight: 0.8,
    synergy: ['tvBroadcast', 'wrongCam'],
    nn: { name: '一人だけ巨大な観客', end: '一人だけ大きい観客がいるのに。', te: '大きい観客に見られて', subj: '大きな観客が', adv: '大きな観客の前を', pred: '大きな観客に見られている' },
    apply: (P, k, inst) => {
      crowdCam(P, inst);
      P.crowd.giantOne = Math.max(P.crowd.giantOne, k);
    },
  },
  {
    id: 'giantCrowd',
    aliases: ['giantcrowd', 'giants'],
    category: 'CROWD',
    slots: ['crowdSize'],
    minDistance: 150,
    duration: [6, 10],
    weight: 1.3,
    synergy: ['giantPlayer', 'firstPerson', 'fisheye', 'tinyAll'],
    nn: { name: '巨人の観客', end: '観客が巨人なのに。', te: '観客が巨人になって', subj: '巨人の観客が', adv: '巨人たちの前を', pred: '巨人に見下ろされている' },
    apply: (P, k, inst) => {
      crowdCam(P, inst);
      P.crowd.giant *= lerp(1, 3.3, k);
    },
  },
  {
    id: 'crowdRunning',
    aliases: ['crowdrun', 'crowdrunning'],
    category: 'CROWD',
    slots: ['crowdMove'],
    incompatible: ['crowdFreeze', 'crowdVanish'],
    minDistance: 200,
    duration: [6, 10],
    weight: 1.4,
    synergy: ['topDown', 'tvBroadcast', 'worldTilt'],
    nn: { name: '観客も走る', end: '観客まで走っているのに。', te: '観客も走り出して', subj: '走る観客が', adv: '観客と一緒に', pred: '観客と走っている' },
    apply: (P, k, inst) => {
      crowdCam(P, inst);
      if (on(inst) && inst.env > 0.3) P.crowd.run = 1;
    },
  },
  {
    id: 'crowdWave',
    aliases: ['wave2', 'thewave'],
    category: 'CROWD',
    minDistance: 120,
    duration: [7, 11],
    weight: 1.1,
    synergy: ['drone', 'topDown', 'directorCam'],
    nn: { name: 'ウェーブ', end: 'ウェーブが止まらないのに。', te: 'ウェーブが起きて', adv: 'ウェーブの中を', pred: 'ウェーブに包まれている' },
    apply: (P, k, inst) => {
      crowdCam(P, inst);
      P.crowd.wave = Math.max(P.crowd.wave, k);
    },
  },
  {
    id: 'crowdFreeze',
    aliases: ['freeze'],
    category: 'CROWD',
    slots: ['crowdMove'],
    incompatible: ['crowdRunning'],
    minDistance: 150,
    duration: [5, 8],
    synergy: ['cctvCam', 'oldFilm', 'dawn'],
    nn: { name: '固まる観客', end: '観客が止まっているのに。', te: '観客が固まって', subj: '固まった観客が', adv: '止まった観客の前を', pred: '観客に無視されている' },
    apply: (P, k, inst) => {
      crowdCam(P, inst);
      P.crowd.freeze = Math.max(P.crowd.freeze, k > 0.4 ? 1 : 0);
    },
  },
  {
    id: 'crowdVanish',
    aliases: ['vanish', 'nocrowd', 'empty'],
    category: 'CROWD',
    slots: ['crowdMove'],
    incompatible: ['crowdRunning', 'giantCrowd', 'giantOne', 'crowdWave'],
    minDistance: 200,
    duration: [5, 8],
    synergy: ['blackout', 'oldFilm', 'ghostPack'],
    nn: { name: '無観客', end: 'さっきまで満員だったのに。', te: '観客が消えて', subj: '誰もいない競技場で', adv: '無観客で', pred: '誰にも見られていない' },
    apply: (P, k, inst) => {
      crowdCam(P, inst);
      P.crowd.vanish = Math.max(P.crowd.vanish, k);
      P.crowd.energyMul *= 1 - k;
    },
  },
  {
    id: 'crowdReverse',
    aliases: ['backwards'],
    category: 'CROWD',
    slots: ['crowdFacing'],
    minDistance: 120,
    duration: [5, 9],
    synergy: ['mirrorView', 'skyFlip'],
    nn: { name: '後ろを向く観客', end: '観客が後ろを向いているのに。', te: '観客が後ろを向いて', subj: '後ろ向きの観客が', adv: '背中を向けられながら', pred: '背中を向けられている' },
    apply: (P, k, inst) => {
      crowdCam(P, inst);
      if (on(inst) && inst.env > 0.5) P.crowd.reverse = 1;
    },
  },
  {
    id: 'crowdSync',
    aliases: ['sync'],
    category: 'CROWD',
    minDistance: 150,
    duration: [6, 9],
    synergy: ['rhythmHud', 'rainbow'],
    nn: { name: '揃いすぎる観客', end: '観客の動きが揃いすぎなのに。', te: '観客がぴったり揃って', subj: '揃いすぎた観客が', adv: '揃った拍手の中を', pred: '揃った拍手を浴びている' },
    apply: (P, k, inst) => {
      crowdCam(P, inst);
      P.crowd.sync = Math.max(P.crowd.sync, k);
      P.crowd.energyMul *= 1 + 0.6 * k;
    },
  },
]);
