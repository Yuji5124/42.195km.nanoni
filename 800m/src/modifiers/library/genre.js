import { defineModifiers, put } from '../registry.js';
import { lerp } from '../../core/mathx.js';

// GENRE: ゲームのジャンルごと変わる（カメラ + HUD + 画面 + 音をまとめて書く）。
// 先に apply される（CATEGORY_ORDER）ので、個別の Modifier がさらに上から重なる。
// 操作はいつもと同じ（走るだけ）。ジャンルの「見た目のお約束」だけ借りてくる。

const on = (inst) => !inst.stopping;

defineModifiers([
  {
    id: 'genreRPG',
    aliases: ['rpggame', 'dq'],
    category: 'GENRE',
    slots: ['camera', 'skin', 'palette', 'pixel'],
    minDistance: 300,
    duration: [7, 10],
    big: true,
    synergy: ['crowdRunning', 'giantOne'],
    nn: { name: 'RPGになった', end: '陸上競技なのに。', te: 'RPGになって', adv: 'RPGの世界で', pred: 'RPGの勇者になっている' },
    start: (inst, ctx) => ctx.hud?.call('▼ 侍 が あらわれた！', 1500),
    apply: (P, k, inst) => {
      if (!on(inst)) return;
      P.camera.mode = 'TOP';
      P.camera.fovMul *= 0.8;
      P.ui.skin = 'rpg';
      put.minNonZero(P.post, 'pixel', lerp(900, 360, k));
      if (k > 0.4) P.post.palette = 1;
      P.audio.chip = 1;
    },
  },
  {
    id: 'genreFighting',
    aliases: ['fightinggenre', 'versus'],
    category: 'GENRE',
    slots: ['camera', 'skin', 'frame'],
    minDistance: 300,
    duration: [7, 10],
    big: true,
    synergy: ['giantSword', 'crt'],
    nn: { name: '格闘ゲームになった', end: '誰も殴らないのに。', te: '格ゲーになって', adv: '格ゲーの画面で', pred: '対戦している' },
    start: (inst, ctx) => ctx.hud?.call('ROUND 2 ─ FIGHT!', 1500),
    apply: (P, k, inst) => {
      if (!on(inst)) return;
      P.camera.mode = 'SIDE2D';
      P.ui.skin = 'fighting';
      put.max(P.post, 'wide', 0.35 * k);
      P.post.contrast *= 1 + 0.15 * k;
      P.post.saturation *= 1 + 0.3 * k;
    },
  },
  {
    id: 'genreRacing',
    aliases: ['racinggenre', 'kart'],
    category: 'GENRE',
    slots: ['camera', 'skin'],
    minDistance: 300,
    duration: [7, 10],
    big: true,
    synergy: ['fastForward', 'fastLegs'],
    nn: { name: 'レースゲームになった', end: 'ハンドルがないのに。', te: 'レースゲームになって', adv: 'レースゲームの中を', pred: 'レースゲームになっている' },
    start: (inst, ctx) => ctx.hud?.call('FINAL LAP', 1300),
    apply: (P, k, inst) => {
      if (!on(inst)) return;
      P.camera.mode = 'FOLLOW';
      P.camera.lowAngle = Math.max(P.camera.lowAngle, k);
      P.camera.fovMul *= 1 + 0.35 * k;
      P.ui.skin = 'racing';
      P.post.chroma = Math.max(P.post.chroma, 0.005 * k);
      P.post.bloom *= 1 + 0.6 * k;
    },
  },
  {
    id: 'genreRhythm',
    aliases: ['rhythmgenre'],
    category: 'GENRE',
    slots: ['camera', 'skin'],
    minDistance: 300,
    duration: [7, 10],
    big: true,
    synergy: ['crowdSync', 'rainbow'],
    nn: { name: '音ゲーになった', end: '陸上なのに。', te: '音ゲーになって', adv: '譜面に乗って', pred: '音ゲーになっている' },
    start: (inst, ctx) => ctx.hud?.call('READY?', 1100),
    apply: (P, k, inst, ctx) => {
      if (!on(inst)) return;
      P.camera.mode = 'SIDE';
      P.ui.skin = 'rhythm';
      // 足音（接地）に合わせて画面が脈打つ
      const f = ctx.playerPhase ?? 0;
      const beat = Math.pow(1 - (f - Math.floor(f)), 6);
      P.post.exposure *= 1 + 0.18 * beat * k;
      P.post.hue += 0.5 * k * Math.floor(f % 4);
      P.audio.bpmMul = 1.1;
    },
  },
  {
    id: 'genreHorror',
    aliases: ['horror'],
    category: 'GENRE',
    slots: ['camera', 'grade', 'light', 'fps'],
    incompatible: ['crowdRunning', 'rainbow'],
    minDistance: 350,
    duration: [6, 8],
    big: true,
    synergy: ['crowdVanish', 'ghostPack'],
    nn: { name: 'ホラーになった', end: 'ただの800mなのに。', te: 'ホラーになって', adv: '暗闇の中を', pred: '何かに追われている' },
    apply: (P, k, inst, ctx) => {
      if (!on(inst)) return;
      P.camera.mode = 'REAR';
      P.world.light *= 1 - 0.5 * k;
      P.post.mono = Math.max(P.post.mono, 0.75 * k);
      P.post.noise = Math.max(P.post.noise, 0.16 * k);
      P.post.vignette = Math.max(P.post.vignette, 1.4 * k);
      P.post.tint = [P.post.tint[0] * (1 + 0.25 * k), P.post.tint[1] * (1 - 0.1 * k), P.post.tint[2] * (1 - 0.1 * k)];
      P.post.lowFps = P.post.lowFps || 15;
      P.post.glitch = Math.max(P.post.glitch, 0.2 * k * (Math.sin(ctx.time * 3.1) > 0.92 ? 1 : 0));
      P.crowd.energyMul *= 1 - 0.8 * k;
      P.runner.playerRim = Math.max(P.runner.playerRim, 0.9 * k);
    },
  },
]);
