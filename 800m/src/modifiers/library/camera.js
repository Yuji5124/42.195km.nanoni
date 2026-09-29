import { defineModifiers } from '../registry.js';

// CAMERA: 何を・どこから映すか。スロット 'camera' は同時に 1 つ（新しい方が勝つ）。
// カメラが変わっても操作（ペース・レーン）はいつも同じ。わざと違う所を映すのは 3〜4 秒だけ。

const on = (inst) => !inst.stopping;
const cam = (P, inst, mode, extra = {}) => {
  if (!on(inst)) return;
  P.camera.mode = mode;
  Object.assign(P.camera, extra);
};

defineModifiers([
  {
    id: 'tvBroadcast',
    aliases: ['tv', 'broadcast'],
    category: 'CAMERA',
    slots: ['camera', 'skin'],
    minDistance: 150,
    duration: [7, 11],
    weight: 1.4,
    synergy: ['giantPlayer', 'crowdRunning', 'sunset', 'ps1', 'crt'],
    nn: { name: 'TV中継', end: 'TV中継なのに。', te: 'TV中継されて', adv: '全国中継で', pred: 'TV中継されている' },
    apply: (P, k, inst) => {
      cam(P, inst, 'TV', { target: 'player' });
      if (on(inst)) P.ui.skin = 'broadcast';
    },
  },
  {
    id: 'directorCam',
    aliases: ['director', 'tvdirector'],
    category: 'CAMERA',
    slots: ['camera', 'skin'],
    minDistance: 250,
    duration: [7, 10],
    synergy: ['tvBroadcast', 'crowdWave'],
    nn: { name: 'TVディレクター', end: 'ディレクターが別の選手を映すのに。', te: 'ディレクターが勝手にカメラを切り替えて', adv: 'ディレクターの気分で', pred: '中継車に選ばれている' },
    apply: (P, k, inst) => {
      cam(P, inst, 'TV', { target: 'director' });
      if (on(inst)) P.ui.skin = 'broadcast';
    },
  },
  {
    id: 'topDown',
    aliases: ['top', 'topdown', 'overhead'],
    category: 'CAMERA',
    slots: ['camera'],
    minDistance: 150,
    duration: [6, 10],
    weight: 1.3,
    synergy: ['fisheye', 'crowdRunning', 'pc98', 'tinyAll'],
    nn: { name: '真上カメラ', end: '真上からなのに。', te: '真上から見られて', adv: '真上から', pred: '真上から見られている' },
    apply: (P, k, inst) => cam(P, inst, 'TOP'),
  },
  {
    id: 'side2d',
    aliases: ['side', '2d', 'sidescroll'],
    category: 'CAMERA',
    slots: ['camera'],
    minDistance: 150,
    duration: [6, 10],
    weight: 1.3,
    synergy: ['lowRes', 'gameboy', 'oldFilm', 'fightingHud'],
    nn: { name: '横スクロール', end: '横スクロールなのに。', te: '横スクロールになって', adv: '横スクロールで', pred: '横スクロールになっている' },
    apply: (P, k, inst) => cam(P, inst, 'SIDE2D'),
  },
  {
    id: 'cctvCam',
    aliases: ['cctv', 'securitycam'],
    category: 'CAMERA',
    slots: ['camera', 'grade'],
    minDistance: 180,
    duration: [6, 9],
    weight: 1.2,
    synergy: ['lowFps', 'crowdFreeze', 'fisheye'],
    nn: { name: '防犯カメラ', end: '防犯カメラの映像なのに。', te: '防犯カメラに映って', adv: '防犯カメラ越しに', pred: '防犯カメラに映っている' },
    apply: (P, k, inst) => {
      cam(P, inst, 'CCTV');
      P.post.cctv = Math.max(P.post.cctv, k);
      P.post.scan = Math.max(P.post.scan, 0.25 * k);
      P.post.noise = Math.max(P.post.noise, 0.07 * k);
      P.post.fisheye = Math.max(P.post.fisheye, 0.25 * k);
      P.ui.rec = on(inst);
      P.audio.lowpass = Math.max(P.audio.lowpass, 0.3 * k);
    },
  },
  {
    id: 'firstPerson',
    aliases: ['fps', 'firstperson', 'pov'],
    category: 'CAMERA',
    slots: ['camera'],
    minDistance: 200,
    duration: [5, 8],
    synergy: ['fisheye', 'tallVideo', 'giantCrowd'],
    nn: { name: '一人称', end: '一人称なのに。', te: '侍の目になって', adv: '侍の目で', pred: '一人称になっている' },
    apply: (P, k, inst) => cam(P, inst, 'FIRST_PERSON'),
  },
  {
    id: 'drone',
    category: 'CAMERA',
    slots: ['camera'],
    minDistance: 150,
    duration: [6, 9],
    synergy: ['trackWave', 'crowdWave'],
    nn: { name: 'ドローン', end: 'ドローンが追ってくるのに。', te: 'ドローンに追われて', adv: 'ドローンから', pred: 'ドローンに追われている' },
    apply: (P, k, inst) => cam(P, inst, 'DRONE'),
  },
  {
    id: 'rearLong',
    aliases: ['rear', 'telephoto'],
    category: 'CAMERA',
    slots: ['camera'],
    minDistance: 150,
    duration: [5, 8],
    weight: 0.8,
    synergy: ['trackWave', 'cinema'],
    nn: { name: '超望遠', end: '遠くから撮っているのに。', te: '遠くから撮られて', adv: '遠くから', pred: '遠くから撮られている' },
    apply: (P, k, inst) => cam(P, inst, 'REAR'),
  },
  {
    id: 'orbit',
    aliases: ['spin'],
    category: 'CAMERA',
    slots: ['camera'],
    minDistance: 250,
    duration: [4, 6],
    weight: 0.7,
    synergy: ['giantPlayer', 'rainbow'],
    nn: { name: '回るカメラ', end: 'カメラが回っているのに。', te: 'カメラに回られて', adv: 'ぐるぐると', pred: 'カメラに回られている' },
    apply: (P, k, inst) => cam(P, inst, 'ORBIT'),
  },
  {
    id: 'dutchAngle',
    aliases: ['dutch', 'roll'],
    category: 'CAMERA',
    slots: ['roll'],
    minDistance: 150,
    duration: [4, 8],
    synergy: ['worldTilt', 'cinema'],
    nn: { name: '斜めのカメラ', end: 'カメラが傾いているのに。', te: 'カメラが傾いて', adv: '斜めに', pred: '斜めに映っている' },
    apply: (P, k, inst, ctx) => {
      P.camera.roll += (inst.data.dir ?? 1) * 0.38 * k + 0.03 * Math.sin(ctx.time * 1.7) * k;
    },
    start: (inst) => (inst.data.dir = inst.rng && inst.rng.next() < 0.5 ? -1 : 1),
  },
  {
    id: 'wrongCam',
    aliases: ['wrong', 'wrongcamera'],
    category: 'CAMERA',
    slots: ['camera'],
    minDistance: 220,
    maxDistance: 700,
    duration: [3, 4],
    intensity: [1, 1],
    synergy: ['tvBroadcast', 'crowdRunning', 'giantCrowd'],
    // わざと違うものを映す（最下位 / 先頭 / 誰もいないゴール / 観客 / 空）。3〜4 秒だけ
    start: (inst) => {
      const opts = ['last', 'leader', 'goal', 'crowd', 'sky'];
      inst.data.what = opts[Math.floor((inst.rng ? inst.rng.next() : 0) * opts.length)];
    },
    apply: (P, k, inst) => {
      if (!on(inst)) return;
      const w = inst.data.what;
      if (w === 'last') cam(P, inst, 'TV', { target: 'last', label: 'LAST PLACE' });
      else if (w === 'leader') cam(P, inst, 'FRONT', { target: 'leader', label: 'LEADER' });
      else if (w === 'goal') cam(P, inst, 'GOAL', { label: 'FINISH LINE' });
      else if (w === 'crowd') cam(P, inst, 'CROWD', { label: 'CROWD' });
      else cam(P, inst, 'SKY', { label: 'SKY' });
      P.ui.pip = 1; // 小窓で自分を映す（操作できなくならないように）
    },
    nn: { name: '違うカメラ', end: '違うところを映しているのに。', te: 'カメラがよそ見して', adv: 'よそ見のカメラで', pred: '映っていない' },
  },
]);

