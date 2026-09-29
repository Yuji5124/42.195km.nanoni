// 12 人の性格（データ駆動）。ランダムではなく、性格にもとづいて走る。
//   pace      … 距離ごとの努力度の曲線 [[m, effort], ...]（0.58 抑える / 0.78 普通 / 0.92 攻める）
//   kick      … スパート開始（m）と、スパートに必要なスタミナ
//   inside    … 内側（第 1 レーン）へ寄る強さ 0〜1
//   sense     … 周りの状況への反応（観客・カメラ・静けさ・混沌・追われる・前についていく）
//   draftBonus… 真後ろにいる時のスタミナ消費倍率（小さいほど得）
//
// 追加の性格は、この表に 1 行足すだけで動く（bot.js は共通）。

export const PERSONALITIES = {
  PLAYER: {
    label: 'バランス型',
    desc: 'あなた。',
    pace: [[0, 0.78]],
    kick: { at: 700, stamina: 10 },
    inside: 0.6,
    sense: {},
  },
  SPRINTER: {
    label: 'スプリンター',
    desc: '最初の 200m が異常に速い',
    pace: [[0, 1.0], [190, 1.0], [240, 0.79], [650, 0.8], [720, 0.86]],
    kick: { at: 740, stamina: 8 },
    inside: 0.9,
    sense: {},
  },
  PACER: {
    label: 'ペースメーカー',
    desc: '一定速度を崩さない',
    pace: [[0, 0.835]],
    kick: { at: 760, stamina: 6 },
    inside: 1,
    sense: {},
  },
  CHASER: {
    label: 'チェイサー',
    desc: '前の選手についていく',
    pace: [[0, 0.83], [650, 0.86]],
    kick: { at: 700, stamina: 10 },
    inside: 0.7,
    sense: { chase: 1 },
  },
  SHOWMAN: {
    label: 'ショーマン',
    desc: '観客が多いと速くなる',
    pace: [[0, 0.81], [600, 0.84]],
    kick: { at: 690, stamina: 12 },
    inside: 0.4,
    sense: { crowd: 0.16 },
  },
  PANIC: {
    label: 'パニック',
    desc: '後ろから追われると速くなる',
    pace: [[0, 0.815]],
    kick: { at: 710, stamina: 10 },
    inside: 0.8,
    sense: { panic: 0.16 },
  },
  LATE: {
    label: '追い込み',
    desc: '最後の 200m で急加速',
    pace: [[0, 0.79], [540, 0.81], [590, 0.9]],
    kick: { at: 640, stamina: 6 },
    inside: 0.5,
    sense: {},
  },
  CAMERA: {
    label: 'カメラ目線',
    desc: 'テレビに映ると速くなる',
    pace: [[0, 0.815]],
    kick: { at: 700, stamina: 10 },
    inside: 0.5,
    sense: { camera: 0.15 },
  },
  QUIET: {
    label: '静寂',
    desc: '歓声が少ないほど速い',
    pace: [[0, 0.825]],
    kick: { at: 700, stamina: 10 },
    inside: 0.9,
    sense: { quiet: 0.14 },
  },
  CHAOS: {
    label: 'カオス',
    desc: '異常イベント中に強くなる',
    pace: [[0, 0.805]],
    kick: { at: 720, stamina: 10 },
    inside: 0.3,
    sense: { chaos: 0.17 },
  },
  DRAFTER: {
    label: 'ドラフター',
    desc: '他選手の後ろでスタミナ回復',
    pace: [[0, 0.83], [640, 0.88]],
    kick: { at: 690, stamina: 8 },
    inside: 0.7,
    sense: { chase: 1 },
    draftBonus: 0.25,
  },
  MYSTERY: {
    label: '？？？',
    desc: '毎レース特性が変わる',
    mystery: true,
    pace: [[0, 0.79]],
    kick: { at: 700, stamina: 10 },
    inside: 0.6,
    sense: {},
  },
};
