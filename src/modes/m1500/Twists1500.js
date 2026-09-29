import { clamp, createRng, lerp } from '../../core/math.js';

// 「800m、なのに。」の Modifier の考え方を 1500m に少しだけ持ち込む。
//   1500m の骨組み（150m ごとに区間 = ジャンルが変わる）はそのまま。
//   その上に、数秒だけの小さな「なのに。」（ツイスト）が重なる。重なると「なのにCOMBO」の文になる。
// 決まりごと:
//   - ツイストは見た目の上書き（this.P）に書くだけ。距離・速さ・順位・当たり判定には触れない
//   - 区間ごとに同時にいくつまでか（mode-1500m.json の "twists"）。横スクロール・見下ろし回避・最後の直線は 0
//   - 区間が変わった直後（キャプションが出ている間）は新しく始めない
//   - 同じものは続けて出さない（直近 4 つ）
//
// 新しいツイストを足す = TWISTS に 1 つ書くだけ。apply(P, k, inst) の k は強さ（フェード込み 0〜1）。

const on = (inst) => !inst.stopping;

export function createOverlay() {
  return {
    fx: { fisheye: 0, pixel: 0, posterize: 0, mono: 0, noise: 0, scan: 0, aberr: 0, vignette: 0, hue: 0, invert: 0, tall: 0, glitch: 0 },
    lowFps: 0,
    roll: 0, // 度
    playerScale: 1,
    headScale: 1,
    crowdGrow: 1,
    crowdFreeze: 0,
    sunset: 0,
    weather: null,
    weatherAmt: 0,
    timeScale: 1,
    liar: 0, // 距離表示のうそ（m）
    fakeBug: false,
  };
}

function resetOverlay(P) {
  for (const k of Object.keys(P.fx)) P.fx[k] = 0;
  P.lowFps = 0;
  P.roll = 0;
  P.playerScale = 1;
  P.headScale = 1;
  P.crowdGrow = 1;
  P.crowdFreeze = 0;
  P.sunset = 0;
  P.weather = null;
  P.weatherAmt = 0;
  P.timeScale = 1;
  P.liar = 0;
  P.fakeBug = false;
}

// nn: なのに文の部品（end = 1 つの時 / subj + adv + pred = 組み合わせ / te = つなぎ）
//   who: pred（述語）が誰のことか。'samurai' の述語は侍が主語の時だけ使う（「巨人の観客が頭だけ大きい」を防ぐ）
// slot: 同じスロットは同時に 1 つ / notIn: その区間では起こさない
export const TWISTS = [
  {
    id: 'fisheye',
    dur: [5, 8],
    slot: 'lens',
    nn: { name: '魚眼', end: '魚眼なのに。', te: '魚眼で', adv: '魚眼で', pred: '魚眼で映っている' },
    apply: (P, k) => (P.fx.fisheye = Math.max(P.fx.fisheye, 0.75 * k)),
  },
  {
    id: 'ps1',
    dur: [5, 8],
    slot: 'pixel',
    notIn: ['racing', 'mix_race'],
    nn: { name: 'PS1', end: 'ポリゴンがカクカクなのに。', te: 'PS1になって', adv: 'PS1画質で', pred: 'PS1になっている' },
    apply: (P, k) => {
      if (k < 0.05) return;
      P.fx.pixel = Math.max(P.fx.pixel, Math.round(2 + 3 * k));
      P.fx.posterize = P.fx.posterize || 18;
      P.lowFps = P.lowFps || 30;
    },
  },
  {
    id: 'oldFilm',
    dur: [5, 7],
    slot: 'grade',
    nn: { name: '白黒映画', end: '白黒映画なのに。', te: '白黒になって', adv: '白黒で', pred: '昔の映画になっている' },
    apply: (P, k, inst) => {
      P.fx.mono = Math.max(P.fx.mono, k);
      P.fx.noise = Math.max(P.fx.noise, 0.12 * k);
      P.fx.vignette = Math.max(P.fx.vignette, 0.8 * k);
      P.fx.scan = Math.max(P.fx.scan, 0.12 * k);
      if (on(inst) && k > 0.3) P.lowFps = P.lowFps ? Math.min(P.lowFps, 18) : 18;
    },
  },
  {
    id: 'negative',
    dur: [3, 4],
    slot: 'grade',
    notIn: ['mirror', 'mix_mirror'],
    nn: { name: 'ネガ反転', end: '色が反転しているのに。', te: '色が反転して', adv: 'ネガで', pred: '色が反転している' },
    apply: (P, k, inst) => {
      if (on(inst) && k > 0.3) P.fx.invert = 1;
    },
  },
  {
    id: 'rainbow',
    dur: [4, 6],
    slot: 'grade',
    nn: { name: '虹色', end: '色が止まらないのに。', te: '虹色に光って', adv: '虹色に', pred: '虹色に光っている' },
    apply: (P, k, inst) => (P.fx.hue += inst.t * 2.6 * k),
  },
  {
    id: 'lowFps',
    dur: [3.5, 5],
    slot: 'fps',
    nn: { name: '低フレームレート', end: 'カクカクなのに。', te: 'カクカクで', adv: 'カクカクと', pred: 'カクカク動いている' },
    start: (inst) => (inst.data.fps = inst.rng.next() < 0.6 ? 12 : 8),
    endText: (inst) => `${inst.data.fps}fpsなのに。`,
    apply: (P, k, inst) => {
      if (on(inst) && k > 0.3) P.lowFps = P.lowFps ? Math.min(P.lowFps, inst.data.fps) : inst.data.fps;
    },
  },
  {
    id: 'tallVideo',
    dur: [5, 8],
    slot: 'frame',
    nn: { name: '縦動画', end: '縦動画なのに。', te: '縦動画になって', adv: '縦動画で', pred: '縦動画で撮られている' },
    apply: (P, k) => (P.fx.tall = Math.max(P.fx.tall, k)),
  },
  {
    id: 'dutch',
    dur: [4, 6],
    slot: 'roll',
    notIn: ['gravity', 'side_scroll'],
    nn: { name: '斜めのカメラ', end: 'カメラが傾いているのに。', te: 'カメラが傾いて', adv: '斜めに', pred: '斜めに映っている' },
    start: (inst) => (inst.data.dir = inst.rng.next() < 0.5 ? -1 : 1),
    apply: (P, k, inst) => (P.roll += inst.data.dir * 20 * k),
  },
  {
    id: 'giantSamurai',
    dur: [5, 8],
    slot: 'size',
    notIn: ['racing', 'mix_race', 'mix_top'],
    nn: { name: '巨大な侍', end: '侍だけ巨人なのに。', te: '侍が巨人になって', subj: '巨人の侍が', adv: '巨人のまま', pred: '巨人になっている', who: 'samurai' },
    apply: (P, k) => (P.playerScale *= lerp(1, 2.4, k)),
  },
  {
    id: 'bigHead',
    dur: [5, 8],
    slot: 'head',
    nn: { name: '頭だけ巨大', end: '頭だけ大きいのに。', te: '頭が大きくなって', subj: '頭の大きい侍が', adv: '大きな頭で', pred: '頭だけ大きい', who: 'samurai' },
    apply: (P, k) => (P.headScale *= lerp(1, 2.6, k)),
  },
  {
    id: 'giantCrowd',
    dur: [6, 9],
    slot: 'crowd',
    notIn: ['racing', 'mix_race'],
    nn: { name: '巨人の観客', end: '観客が巨人なのに。', te: '観客が巨人になって', subj: '巨人の観客が', subjWho: 'crowd', adv: '巨人たちの前で', pred: '巨人に見下ろされている', who: 'samurai' },
    apply: (P, k) => (P.crowdGrow *= lerp(1, 2.4, k)),
  },
  {
    id: 'crowdFreeze',
    dur: [5, 7],
    slot: 'crowd',
    nn: { name: '固まる観客', end: '観客が止まっているのに。', te: '観客が固まって', subj: '固まった観客が', subjWho: 'crowd', adv: '止まった観客の前で', pred: '観客に無視されている', who: 'samurai' },
    apply: (P, k, inst) => {
      if (on(inst) && k > 0.4) P.crowdFreeze = 1;
    },
  },
  {
    id: 'sunset',
    dur: [8, 11],
    slot: 'sky',
    nn: { name: '夕焼け', end: 'さっきまで夜だったのに。', te: '夕焼けになって', adv: '夕焼けの中で', pred: '夕焼けに染まっている' },
    apply: (P, k) => (P.sunset = Math.max(P.sunset, k)),
  },
  {
    id: 'snow',
    dur: [8, 11],
    slot: 'weather',
    nn: { name: '雪', end: '真夏なのに。', te: '雪が降って', adv: '雪の中で', pred: '雪に埋もれている' },
    apply: (P, k) => {
      P.weather = 'snow';
      P.weatherAmt = Math.max(P.weatherAmt, k);
    },
  },
  {
    id: 'slowWorld',
    dur: [2.5, 3.5],
    slot: 'time',
    notIn: ['tv', 'mix_tv'],
    nn: { name: 'スローモーション', end: '世界がスローなのに。', te: 'スローになって', adv: 'スローで', pred: 'スローになっている' },
    // 全員に等しく効く（プレイヤーだけ遅くなるわけではない）
    apply: (P, k) => (P.timeScale *= lerp(1, 0.5, k)),
  },
  {
    id: 'fakeBug',
    dur: [2.5, 3.5],
    slot: 'fps',
    nn: { name: '偽のバグ', end: 'バグっていないのに。', te: 'バグったふりをして', adv: 'バグったまま', pred: 'バグったふりをしている' },
    apply: (P, k, inst) => {
      if (on(inst)) P.fakeBug = true;
      P.fx.glitch = Math.max(P.fx.glitch, 0.7 * k);
    },
  },
  {
    id: 'liar',
    dur: [4, 6],
    slot: 'hud',
    nn: { name: '嘘の距離表示', end: '表示がでたらめなのに。', te: '距離表示が嘘をついて', adv: 'でたらめな表示のまま', pred: '距離をごまかされている' },
    start: (inst) => {
      const r = inst.rng.next();
      inst.data.off = Math.round((r < 0.5 ? -1 : 1) * (80 + r * 160));
    },
    endText: (inst, km) => `表示は${Math.max(0, Math.floor(km * 1000 + inst.data.off))}mなのに。`,
    apply: (P, k, inst) => {
      if (on(inst)) P.liar = inst.data.off;
    },
  },
];

const BY_ID = Object.fromEntries(TWISTS.map((t) => [t.id, t]));

// 組み合わせの文: 主語 + 様子 + 述語 + 「のに。」 / 主語がなければ「〜て、〜で、〜なのに。」
export function comboSentence(list, km) {
  const xs = list.slice().sort((a, b) => a.serial - b.serial).slice(-3);
  const end = (i) => i.def.endText?.(i, km) ?? i.def.nn.end;
  if (xs.length === 1) return end(xs[0]);
  const subj = xs.find((i) => i.def.nn.subj);
  const subjWho = subj?.def.nn.subjWho ?? 'samurai';
  const pred = [...xs].reverse().find((i) => i !== subj && i.def.nn.pred && (!i.def.nn.who || i.def.nn.who === subjWho));
  const adv = xs.find((i) => i !== subj && i !== pred && i.def.nn.adv);
  if (subj && pred) return `${subj.def.nn.subj}${adv ? adv.def.nn.adv : ''}${pred.def.nn.pred}のに。`;
  return `${xs
    .slice(0, -1)
    .map((i) => i.def.nn.te)
    .join('、')}、${end(xs[xs.length - 1])}`;
}

export class Twists1500 {
  constructor(game) {
    this.g = game;
    this.P = createOverlay();
    this.active = [];
    this.history = [];
    this.recent = [];
    this.serial = 0;
    this.maxCombo = 0;
    this.reset();
  }

  reset() {
    this.active = [];
    this.history = [];
    this.recent = [];
    this.maxCombo = 0;
    this.cool = 2;
    this.section = null;
    // ?seed=N で毎回同じ順番（検証用）。普段は毎レース違う
    const seed = parseInt(this.g.params?.get('seed'), 10);
    this.rng = createRng(Number.isFinite(seed) ? seed : (Date.now() ^ 0x1500) >>> 0);
    resetOverlay(this.P);
  }

  get running() {
    return this.active.filter((i) => !i.stopping);
  }

  // 区間が変わった: キャプションの間は待つ。0 の区間に入ったら全部すぐ片付ける
  onSection(id, max) {
    this.section = id;
    this.cool = Math.max(this.cool, 3.2);
    if (!max) for (const i of this.active) i.stopping = true;
  }

  canStart(def) {
    if (this.recent.includes(def.id) || this.active.some((i) => i.id === def.id)) return false;
    if (def.notIn?.includes(this.section)) return false;
    return !this.running.some((i) => i.def.slot === def.slot);
  }

  start(id, { force = false, km = 0 } = {}) {
    const def = BY_ID[id];
    if (!def) return null;
    if (force) {
      for (const i of this.running) if (i.def.slot === def.slot || i.id === id) i.stopping = true;
    } else if (!this.canStart(def)) return null;
    const inst = { id, def, serial: ++this.serial, t: 0, env: 0, stopping: false, dur: lerp(def.dur[0], def.dur[1], this.rng.next()), data: {}, rng: this.rng };
    def.start?.(inst);
    this.active.push(inst);
    this.recent.push(id);
    if (this.recent.length > 4) this.recent.shift();
    if (!this.history.some((h) => h.id === id)) this.history.push({ id, name: def.nn.name, m: Math.round(km * 1000) });
    const n = this.running.length;
    this.maxCombo = Math.max(this.maxCombo, n);
    // 「なのに。」の一言（2 つ以上重なったら COMBO の文）
    const text = comboSentence(this.running, km);
    this.g.ui.nanoni(text, n >= 2 ? `なのにCOMBO ×${n}` : '');
    this.g.bus.emit('twist', { id, count: n, text });
    return inst;
  }

  clear() {
    for (const i of this.active) i.stopping = true;
  }

  // realDt: 実時間（スローモーション中も同じ長さ）/ km: 現在地 / max: この区間で同時にいくつまで / running: レース中
  update(realDt, { km, max, running }) {
    const P = this.P;
    resetOverlay(P);
    for (const inst of this.active.slice()) {
      inst.t += realDt;
      if (inst.t >= inst.dur) inst.stopping = true;
      inst.env = clamp(inst.env + (inst.stopping ? -realDt / 0.45 : realDt / 0.4), 0, 1);
      if (inst.stopping && inst.env <= 0) {
        this.active.splice(this.active.indexOf(inst), 1);
        continue;
      }
      const e = inst.env;
      inst.def.apply(P, e * e * (3 - 2 * e), inst);
    }
    if (!running) return;
    this.section ??= this.g.sections?.id ?? null;
    // 最初の 90m は普通の陸上（号砲・スタートの緊張）
    if (km < 0.09 || !max) return;
    this.cool -= realDt;
    if (this.cool > 0 || this.running.length >= max) return;
    const list = TWISTS.filter((d) => this.canStart(d));
    if (!list.length) return;
    this.start(list[Math.floor(this.rng.next() * list.length)].id, { km });
    // 1500m は区間そのものが 150m ごとに変わる → ツイストは「ときどき」。混む区間ほど少し短く
    this.cool = lerp(9, 4.5, clamp((max - 1) / 2, 0, 1)) + this.rng.next() * 3;
  }
}
