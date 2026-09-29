import { defineModifiers } from '../registry.js';

// AUDIO: 音だけが変になる（audio/audioEngine.js が P.audio を読む）。
// 音を消している人にも分かるよう、始まる時に右上へ小さく表示する。

const on = (inst) => !inst.stopping;
const label = (text) => (inst, ctx) => ctx.hud?.camLabel(text, 2800);

defineModifiers([
  {
    id: 'reverseCheer',
    aliases: ['reversecrowd', 'reverseaudio'],
    category: 'AUDIO',
    minDistance: 150,
    duration: [7, 10],
    synergy: ['crowdReverse', 'mirrorView'],
    start: label('♪ 歓声 ◀◀ 逆再生'),
    nn: { name: '逆再生の歓声', end: '歓声が逆再生なのに。', te: '歓声が逆再生されて', adv: '逆回しの歓声の中で', pred: '逆回しの歓声を浴びている' },
    apply: (P, k, inst) => {
      if (on(inst)) P.audio.reverseCrowd = 1;
    },
  },
  {
    id: 'chiptune',
    aliases: ['8bit', 'chip'],
    category: 'AUDIO',
    minDistance: 150,
    duration: [8, 12],
    synergy: ['pc98', 'gameboy', 'rpgHud', 'lowRes'],
    start: label('♪ 8bit'),
    nn: { name: '8bitの音楽', end: '音楽がピコピコなのに。', te: '音楽がピコピコになって', adv: 'ピコピコの音楽で', pred: 'ピコピコ鳴っている' },
    apply: (P, k, inst) => {
      if (on(inst)) P.audio.chip = 1;
    },
  },
  {
    id: 'announcerDelay',
    aliases: ['delay', 'lag'],
    category: 'AUDIO',
    minDistance: 150,
    maxDistance: 700,
    duration: [8, 12],
    synergy: ['lowFps', 'tvBroadcast'],
    start: label('実況 +3.0s'),
    nn: { name: '遅れる実況', end: '実況が3秒遅れているのに。', te: '実況が遅れて', adv: '遅れた実況のまま', pred: '3秒前の話をされている' },
    apply: (P, k, inst) => {
      if (on(inst)) P.audio.announcerDelay = 3;
    },
  },
  {
    id: 'announcerFuture',
    aliases: ['future', 'prophecy'],
    category: 'AUDIO',
    minDistance: 200,
    maxDistance: 700,
    duration: [7, 10],
    synergy: ['fastForward', 'tvBroadcast'],
    start: label('実況 ▶▶ 未来'),
    nn: { name: '未来の実況', end: '実況が未来の話をしているのに。', te: '実況が未来を話して', adv: '未来の実況を聞きながら', pred: '未来を実況されている' },
    apply: (P, k, inst) => {
      if (on(inst)) P.audio.announcerFuture = 1;
    },
  },
  {
    id: 'silence',
    aliases: ['mute', 'quiet'],
    category: 'AUDIO',
    minDistance: 250,
    duration: [4, 6],
    weight: 0.8,
    synergy: ['crowdFreeze', 'oldFilm', 'blackout'],
    start: label('音量 0'),
    nn: { name: '無音', end: '何も聞こえないのに。', te: '音が消えて', adv: '無音の中で', pred: '無音の中を走っている' },
    apply: (P, k) => {
      P.audio.silence = Math.max(P.audio.silence, k);
    },
  },
  {
    id: 'muffled',
    aliases: ['underwater', 'lowpass'],
    category: 'AUDIO',
    minDistance: 150,
    duration: [5, 8],
    synergy: ['sea', 'clouds', 'slowWorld'],
    start: label('♪ こもった音'),
    nn: { name: 'こもった音', end: '音が水の中みたいなのに。', te: '音がこもって', adv: '水の中みたいな音で', pred: '水の中にいるみたいになっている' },
    apply: (P, k) => {
      P.audio.lowpass = Math.max(P.audio.lowpass, 0.85 * k);
    },
  },
]);
