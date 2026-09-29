import { defineModifiers, put } from '../registry.js';
import { lerp } from '../../core/mathx.js';

// VISUAL: 画面の見え方だけを変える（ポストエフェクトの数値を書くだけ）
// k = 強さ × フェード（0〜1）。on(inst) = フェードアウト中でない

const on = (inst) => !inst.stopping;

defineModifiers([
  {
    id: 'fisheye',
    category: 'VISUAL',
    minDistance: 120,
    intensity: [0.55, 1],
    weight: 1.3,
    synergy: ['firstPerson', 'giantCrowd', 'topDown', 'cctvCam'],
    nn: { name: '魚眼', end: '魚眼なのに。', te: '魚眼で', adv: '魚眼で', pred: '魚眼で映っている' },
    apply: (P, k) => put.max(P.post, 'fisheye', 0.9 * k),
  },
  {
    id: 'lowRes',
    aliases: ['lowresolution', 'lowres', 'pixel'],
    category: 'VISUAL',
    slots: ['pixel'],
    minDistance: 150,
    intensity: [0.55, 1],
    weight: 1.2,
    synergy: ['side2d', 'tinyAll'],
    nn: { name: '低解像度', end: '画質が落ちたのに。', te: '画質が荒くて', adv: 'ガビガビに', pred: 'ガビガビに映っている' },
    apply: (P, k) => k > 0.03 && put.minNonZero(P.post, 'pixel', lerp(700, 140, k)),
  },
  {
    id: 'ps1',
    aliases: ['playstation'],
    category: 'VISUAL',
    slots: ['pixel', 'palette'],
    minDistance: 200,
    intensity: [0.7, 1],
    weight: 1.2,
    synergy: ['tvBroadcast', 'giantPlayer', 'drone'],
    nn: { name: 'PS1', end: 'ポリゴンがカクカクなのに。', te: 'PS1になって', adv: 'PS1画質で', pred: 'PS1になっている' },
    apply: (P, k) => {
      if (k < 0.03) return;
      put.minNonZero(P.post, 'pixel', lerp(640, 320, k));
      P.post.snap = lerp(360, 90, k);
      P.post.dither = Math.max(P.post.dither, k);
      P.post.posterize = P.post.posterize || 24;
      P.post.bloom *= 1 - 0.6 * k;
      P.post.lowFps = P.post.lowFps || 30;
    },
  },
  {
    id: 'gameboy',
    aliases: ['gb'],
    category: 'VISUAL',
    slots: ['palette', 'pixel', 'grade'],
    minDistance: 220,
    duration: [4, 7],
    synergy: ['side2d', 'rpgHud'],
    nn: { name: 'ゲームボーイ', end: '4色しかないのに。', te: '4色になって', adv: '4色で', pred: '4色で映っている' },
    apply: (P, k, inst) => {
      if (k < 0.03) return;
      put.minNonZero(P.post, 'pixel', lerp(480, 200, k));
      if (on(inst) && k > 0.35) P.post.palette = 2;
      P.post.vignette = Math.max(P.post.vignette, 0.6 * k);
    },
  },
  {
    id: 'pc98',
    aliases: ['16colors'],
    category: 'VISUAL',
    slots: ['palette'],
    minDistance: 200,
    duration: [4, 8],
    synergy: ['rpgHud', 'topDown'],
    nn: { name: '16色', end: '16色しかないのに。', te: '16色になって', adv: '16色で', pred: '16色で映っている' },
    apply: (P, k, inst) => {
      if (k < 0.03) return;
      put.minNonZero(P.post, 'pixel', lerp(900, 420, k));
      if (on(inst) && k > 0.35) {
        P.post.palette = 1;
        P.post.dither = Math.max(P.post.dither, 0.9);
      }
    },
  },
  {
    id: 'oldFilm',
    aliases: ['mono', 'film'],
    category: 'VISUAL',
    slots: ['grade', 'fps'],
    minDistance: 180,
    synergy: ['side2d', 'crowdFreeze', 'slowWorld'],
    nn: { name: '白黒映画', end: '白黒映画なのに。', te: '白黒になって', adv: '白黒で', pred: '昔の映画になっている' },
    apply: (P, k, inst, ctx) => {
      P.post.mono = Math.max(P.post.mono, k);
      P.post.sepia = Math.max(P.post.sepia, 0.55 * k);
      P.post.noise = Math.max(P.post.noise, 0.13 * k);
      P.post.vignette = Math.max(P.post.vignette, 0.75 * k);
      P.post.exposure *= 1 + 0.3 * k + 0.08 * k * Math.sin(ctx.time * 37) * Math.sin(ctx.time * 11);
      P.post.contrast *= 1 + 0.15 * k;
      if (on(inst) && k > 0.3) P.post.lowFps = P.post.lowFps ? Math.min(P.post.lowFps, 18) : 18;
    },
  },
  {
    id: 'crt',
    aliases: ['tube'],
    category: 'VISUAL',
    minDistance: 150,
    synergy: ['tvBroadcast', 'pc98', 'fightingHud'],
    nn: { name: 'ブラウン管', end: 'ブラウン管なのに。', te: 'ブラウン管に映って', adv: 'ブラウン管越しに', pred: 'ブラウン管に映っている' },
    apply: (P, k) => {
      P.post.crt = Math.max(P.post.crt, k);
      P.post.scan = Math.max(P.post.scan, 0.3 * k);
      P.post.chroma = Math.max(P.post.chroma, 0.0045 * k);
      P.post.vignette = Math.max(P.post.vignette, 0.6 * k);
      P.post.exposure *= 1 + 0.35 * k; // マスクと走査線で暗くなる分
    },
  },
  {
    id: 'negative',
    aliases: ['invert'],
    category: 'VISUAL',
    slots: ['grade'],
    minDistance: 250,
    duration: [3, 5],
    weight: 0.8,
    nn: { name: 'ネガ反転', end: '色が反転しているのに。', te: '色が反転して', adv: 'ネガで', pred: '色が反転している' },
    apply: (P, k, inst) => {
      if (on(inst) && k > 0.3) P.post.invert = 1;
    },
  },
  {
    id: 'rainbow',
    aliases: ['hue'],
    category: 'VISUAL',
    minDistance: 250,
    duration: [4, 7],
    synergy: ['crowdSync', 'rhythmHud', 'bigHeads'],
    nn: { name: '虹色', end: '色が止まらないのに。', te: '虹色に光って', adv: '虹色に', pred: '虹色に光っている' },
    apply: (P, k, inst, ctx) => {
      P.post.hue += ctx.time * 2.6 * k;
      P.post.saturation *= 1 + 0.7 * k;
      P.post.bloom *= 1 + 0.8 * k;
    },
  },
  {
    id: 'lowFps',
    aliases: ['fps', 'lowframerate'],
    category: 'VISUAL',
    slots: ['fps'],
    minDistance: 200,
    duration: [4, 7],
    weight: 1.1,
    synergy: ['cctvCam', 'ps1'],
    nn: { name: '低フレームレート', end: 'カクカクなのに。', te: 'カクカクで', adv: 'カクカクと', pred: 'カクカク動いている' },
    start: (inst) => {
      const r = inst.rng ? inst.rng.next() : 0.3;
      inst.data.fps = r < 0.45 ? 12 : r < 0.85 ? 8 : 4;
      if (inst.data.fps === 4) inst.dur = Math.min(inst.dur, 3.5);
      inst.data.label = `${inst.data.fps}fps`;
    },
    apply: (P, k, inst) => {
      if (on(inst) && k > 0.25) P.post.lowFps = P.post.lowFps ? Math.min(P.post.lowFps, inst.data.fps) : inst.data.fps;
    },
    nnEnd: (inst) => `${inst.data.fps}fpsなのに。`,
  },
  {
    id: 'mirrorView',
    aliases: ['mirror', 'reverseview', 'reverse'],
    category: 'VISUAL',
    slots: ['flip'],
    minDistance: 220,
    duration: [4, 7],
    synergy: ['boardMirror', 'crowdReverse'],
    nn: { name: '左右反転', end: '左右が逆なのに。', te: '左右が逆になって', adv: '鏡の中で', pred: '鏡に映っている' },
    // 操作も見た目に合わせて反転する（game.js）→ 右を押せば画面の右へ
    apply: (P, k, inst) => {
      if (on(inst) && inst.env > 0.4) P.post.flipX = 1;
    },
  },
  {
    id: 'tallVideo',
    aliases: ['tall', 'vertical', 'shorts'],
    category: 'VISUAL',
    slots: ['frame'],
    minDistance: 150,
    synergy: ['tvBroadcast', 'firstPerson', 'giantPlayer'],
    nn: { name: '縦動画', end: '縦動画なのに。', te: '縦動画になって', adv: '縦動画で', pred: '縦動画で撮られている' },
    apply: (P, k) => put.max(P.post, 'tall', k),
  },
  {
    id: 'cinema',
    aliases: ['wide', 'cinemascope'],
    category: 'VISUAL',
    slots: ['frame'],
    minDistance: 150,
    synergy: ['slowWorld', 'side2d', 'sunset'],
    nn: { name: 'シネマスコープ', end: '映画みたいなのに。', te: '映画みたいに横長で', adv: '映画みたいに', pred: '映画になっている' },
    apply: (P, k) => {
      put.max(P.post, 'wide', k);
      P.post.contrast *= 1 + 0.12 * k;
      P.post.saturation *= 1 - 0.2 * k;
      P.post.tint = [P.post.tint[0] * (1 + 0.06 * k), P.post.tint[1], P.post.tint[2] * (1 - 0.08 * k)];
    },
  },
  {
    id: 'dazzle',
    aliases: ['bright', 'bloom'],
    category: 'VISUAL',
    minDistance: 150,
    duration: [4, 7],
    weight: 0.8,
    synergy: ['clouds', 'dawn'],
    nn: { name: 'まぶしすぎる', end: 'まぶしすぎるのに。', te: 'まぶしすぎて', adv: 'まぶしく', pred: '光りすぎている' },
    apply: (P, k) => {
      P.post.exposure *= 1 + 0.55 * k;
      P.post.bloom *= 1 + 3 * k;
    },
  },
]);
