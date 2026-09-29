// ゲーム全体のチューニング値。
// 座標系: 前方 = -Z、横 = X、上 = Y。ワールド単位 ≒ メートル（見た目用）。
// raceDistance（公式距離）とワールド座標は分離し、DistanceManager で変換する。

export const CONFIG = {
  // 1 ワールド単位を走ると何「レース m」進むか。
  // 巡航 16u/s × 1.5 = 24m/s → 3km ≒ 125 秒、42.195km ≒ 29 分。
  raceMetersPerUnit: 1.5,
  fullMarathonKm: 42.195,

  road: {
    halfWidth: 7.0,        // 車道の半幅
    runnerLimit: 6.3,      // ランナーが走れる |x| の上限
    sidewalk: 4.5,         // 歩道の幅
  },

  player: {
    cruise: 16,            // 何もしない時の速度 (u/s)
    push: 18.5,            // W / ↑
    ease: 12,              // S / ↓
    dash: 24,              // Shift
    boost: 26,             // シューズ取得時
    accel: 9,
    dashAccel: 22,
    lateralSpeed: 9,
    jumpVelocity: 9.2,
    gravity: 25,
    // スタミナ: 普通に走るだけでは絶対に減らない
    staminaMax: 100,
    staminaRegen: 9,
    staminaRegenEase: 20,
    staminaPushDrain: 8,
    staminaDashDrain: 30,
    fallDuration: 1.05,
    invulnAfterFall: 1.3,
  },

  // 表示用の速度は「巡航 = 20km/h」になるよう正規化する
  displayCruiseKmh: 20,

  ai: {
    count: 255,            // + プレイヤー = 256
    gridColumns: 12,
    gridRowSpacing: 1.35,
    playerRow: 9,
  },

  chunk: {
    length: 120,
    ahead: 5,
    behind: 1,
  },

  crowd: {
    capacity: 1500,
    windowAhead: 330,
    windowBehind: 45,
    spacing: 1.05,
  },

  quality: {
    maxPixelRatio: 1.5,
  },
};

export const MODES = {
  NORMAL: 'NORMAL',
  TV_BROADCAST: 'TV_BROADCAST',
  SIDE_2D: 'SIDE_2D',
  TOP_DOWN: 'TOP_DOWN',
  RACING: 'RACING',
  CCTV: 'CCTV',
  START: 'START',
  GOAL: 'GOAL',
  PHOTO: 'PHOTO', // 1500m: 写真判定カメラ（フィニッシュラインの真横）
  TITLE: 'TITLE',
};
