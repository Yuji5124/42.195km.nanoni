// Modifier の登録簿。巨大な switch は使わない: library/*.js が defineModifier() で自分を登録する。
// 新しい Modifier を足す = 定義を 1 つ書くだけ（ModifierManager / ChaosDirector / 結果画面 / なのにCOMBO は自動で拾う）。
//
// 定義の形:
// {
//   id: 'fisheye',                 // URL（?modifier=fisheye）と結果画面の記録に使う
//   category: 'VISUAL',            // CATEGORY のどれか
//   minDistance: 150, maxDistance: 740,   // この範囲で起きる（プレイヤーの距離）
//   duration: [5, 9],              // 秒（レース内の時間）
//   intensity: [0.5, 1],           // 強さ。混沌度が高いほど上側が出やすい
//   weight: 1,                     // 出やすさ
//   slots: ['camera'],             // 同じスロットは同時に 1 つ（カメラ・HUD・減色・空・時間…）
//   incompatible: ['ps1'],         // 同時に起きない相手
//   synergy: ['giantPlayer'],      // 一緒だと面白い相手（出やすくなる）
//   aliases: ['tv'],               // URL 用の別名
//   big: true,                     // 720m の「最大イベント」の候補
//   legendary: false,              // 1〜3% のレア
//   nn: { name, end, te, subj?, adv?, pred? },   // 結果画面の名前 / なのに文の部品（nanoni.js）
//   start(inst, ctx) / update(inst, dt, ctx) / stop(inst, ctx)   // 任意
//   apply(P, k, inst, ctx)         // 毎フレーム Presentation に書く。k = 強さ × フェード（0〜1）
// }

export const CATEGORY = {
  VISUAL: 'VISUAL',
  CAMERA: 'CAMERA',
  WORLD: 'WORLD',
  PHYSICS: 'PHYSICS',
  AUDIO: 'AUDIO',
  UI: 'UI',
  RUNNER: 'RUNNER',
  CROWD: 'CROWD',
  TIME: 'TIME',
  GENRE: 'GENRE',
};

// apply の順番。ジャンル（まとめ役）を先に書き、個別の Modifier が後から上書き・重ね掛けする
export const CATEGORY_ORDER = ['GENRE', 'WORLD', 'PHYSICS', 'TIME', 'CAMERA', 'RUNNER', 'CROWD', 'UI', 'VISUAL', 'AUDIO'];

export const REGISTRY = new Map();
const ALIASES = new Map();

const BASE = {
  minDistance: 150,
  maxDistance: 745,
  duration: [5, 9],
  intensity: [0.6, 1],
  weight: 1,
  slots: [],
  incompatible: [],
  synergy: [],
  aliases: [],
  big: false,
  legendary: false,
  fadeIn: 0.5,
  fadeOut: 0.6,
};

export function defineModifier(def) {
  if (!def.id || !CATEGORY[def.category]) throw new Error(`modifier: bad definition ${def.id}`);
  if (REGISTRY.has(def.id)) throw new Error(`modifier: duplicate id ${def.id}`);
  const d = { ...BASE, ...def, nn: { name: def.id, end: `${def.id}なのに。`, te: `${def.id}で`, ...def.nn } };
  if (typeof d.apply !== 'function') d.apply = () => {};
  REGISTRY.set(d.id, d);
  for (const a of [d.id, ...d.aliases]) ALIASES.set(a.toLowerCase(), d.id);
  return d;
}

export function defineModifiers(list) {
  return list.map(defineModifier);
}

// URL の名前（大文字小文字・別名 OK）→ id
export function resolveModifier(name) {
  return ALIASES.get(String(name).toLowerCase().replace(/[-_\s]/g, '')) ?? ALIASES.get(String(name).toLowerCase()) ?? null;
}

// 2 つの Modifier が同時に動けるか
export function compatible(a, b) {
  if (a.id === b.id) return false;
  if (a.incompatible.includes(b.id) || b.incompatible.includes(a.id)) return false;
  for (const s of a.slots) if (b.slots.includes(s)) return false;
  return true;
}

// 便利関数（apply の中で使う）: 重ね掛けしても壊れない書き方
export const put = {
  max(obj, key, v) {
    obj[key] = Math.max(obj[key], v);
  },
  mul(obj, key, v) {
    obj[key] *= v;
  },
  add(obj, key, v) {
    obj[key] += v;
  },
  // 0 = なし の値（ピクセル数など）: 小さい方（強い方）を採る
  minNonZero(obj, key, v) {
    if (v <= 0) return;
    obj[key] = obj[key] > 0 ? Math.min(obj[key], v) : v;
  },
  // 空の重みを足す（夜 + 夕焼け…）
  sky(P, name, w) {
    const sky = P.world.sky;
    for (const k of Object.keys(sky)) sky[k] *= 1 - w;
    sky[name] = (sky[name] ?? 0) + w;
  },
};
