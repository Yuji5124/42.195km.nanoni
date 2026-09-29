// Presentation（見た目の状態）: RaceCore 以外の「壊してよいもの」を 1 つのオブジェクトにまとめる。
// 毎フレーム defaults に戻してから、有効な Modifier が順番に書き込む（apply）。
// → Modifier を止めた瞬間に元へ戻る（片付け忘れが起きない）。組み合わせは書き込みの重ね合わせ。
//
// ここに無いものを Modifier が触らないこと（特に RaceCore の距離・速度）。

export const DEFAULTS = {
  camera: {
    mode: 'FOLLOW', // FOLLOW SIDE SIDE2D FRONT REAR TV DRONE TOP FIRST_PERSON CCTV FINISH_LINE ORBIT GOAL SKY CROWD
    target: 'player', // 'player' | 'leader' | 'last' | 'director' | 数値（選手の番号）
    priority: 0,
    fovMul: 1,
    roll: 0,
    shake: 0,
    label: '',
    split4: false,
    lowAngle: 0,
  },
  post: {
    fisheye: 0,
    pixel: 0, // 0 = なし / 横の解像度（例 320）
    posterize: 0, // 色の段階数（0 = なし）
    palette: 0, // 0 なし / 1 = 16 色 / 2 = 4 色（ゲームボーイ風）
    mono: 0,
    sepia: 0,
    crt: 0,
    scan: 0,
    vignette: 0.35,
    chroma: 0.0012,
    glitch: 0,
    flipX: 0,
    flipY: 0,
    tall: 0, // 縦画面（左右に黒帯）
    wide: 0, // 横長すぎ（上下に黒帯）
    frameHold: 1, // 何フレームに 1 回描くか（疑似 Low FPS）
    noise: 0.015,
    bloom: 1,
    snap: 0, // PS1 の頂点スナップ
    dither: 0,
    hue: 0,
    saturation: 1,
    contrast: 1,
    exposure: 1,
    invert: 0,
    tint: [1, 1, 1],
    cctv: 0,
  },
  world: {
    sky: { night: 1 },
    skyFlip: false,
    light: 1,
    gravity: 1,
    wave: 0,
    tilt: 0,
    twist: 0,
    fold: 0,
    weather: null, // 'rain' | 'snow' | 'typhoon'
    weatherAmt: 0,
    trackOpacity: 1,
    stadium: 1, // 0 = 競技場が消える（宇宙・雲の上・海の上）
    floor: null, // 'clouds' | 'sea' | 'city'
    infinite: 0,
    standsMove: 0,
    wind: 0,
  },
  runner: {
    playerScale: 1,
    otherScale: 1,
    headScale: 1,
    footScale: 1,
    stick: false,
    stickOthers: false,
    playerOpacity: 1,
    otherOpacity: 1,
    playerRim: 0.45,
    playerAnimSpeed: 1,
    otherAnimSpeed: 1,
    ghostTrail: 0,
    shadowRunner: 0,
    giantSword: 0,
    propeller: 0,
  },
  crowd: {
    energyMul: 1,
    wave: 0,
    freeze: 0,
    vanish: 0,
    sync: 0,
    giant: 1,
    giantOne: 0,
    run: 0,
    reverse: 0,
    clone: 0,
    runners: 0,
  },
  ui: {
    skin: 'normal', // normal broadcast rpg fighting racing rhythm minimal
    fake: 0, // 偽のバグ表示
    liar: 0, // 距離表示が嘘
    lapBug: 0,
    boardMirror: false,
    simplify: 0,
    hide: 0,
  },
  audio: {
    music: 1,
    reverseCrowd: 0,
    footsteps: 1,
    lowpass: 0,
    detune: 0,
    announcerDelay: 0,
    announcerFuture: 0,
    bpmMul: 1,
    silence: 0,
    chip: 0,
  },
  time: {
    sim: 1, // 世界の時間（全員に等しく）
  },
};

function copyInto(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
      // sky などの重みは中身を入れ替える
      if (k === 'sky') {
        for (const kk of Object.keys(dst[k])) delete dst[k][kk];
      }
      copyInto(dst[k], v);
    } else if (Array.isArray(v)) {
      dst[k] = v.slice();
    } else dst[k] = v;
  }
  return dst;
}

export function createPresentation() {
  return copyInto({}, DEFAULTS);
}

export function resetPresentation(P) {
  return copyInto(P, DEFAULTS);
}
