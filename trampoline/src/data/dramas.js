// 観客ドラマ（データ）。カメラが競技を無視して観客席の 2 人を映す。選手は背景で跳び続ける。
// 無声。字幕だけ。3〜8 秒。パターンはここに足すだけで増える。
//
//   steps: [{ t（秒）, caption（字幕）, act（2 人の動き） }]
//   act: 'idle' 何もしない / 'look' 目が合う / 'kneel' A がひざまずく / 'ring' 指輪が光る / 'surprise' B が驚く
//        'hug' 抱き合う / 'cheer' 2 人とも腕を上げる / 'apart' 少し離れる / 'handshake' 握手 / 'hat' 帽子が飛ぶ
//        'confetti' 紙吹雪 / 'turn' 2 人とも競技の方を向く
//   score: 最後に入る点（AUDIENCE）/ label: 内訳の文字 / message: 大きな文字

export const DRAMAS = [
  {
    id: 'PROPOSAL',
    duration: 6.6,
    steps: [
      { t: 0, caption: '', act: 'idle' },
      { t: 0.7, caption: '（目が合う）', act: 'look' },
      { t: 1.9, caption: '……', act: 'kneel' },
      { t: 2.9, caption: '（指輪）', act: 'ring' },
      { t: 3.9, caption: '「えっ」', act: 'surprise' },
      { t: 4.8, caption: '（抱き合う）', act: 'hug' },
      { t: 5.6, caption: 'おめでとう！', act: 'confetti' },
    ],
    score: 3000,
    label: '観客席でプロポーズ成功',
    message: 'おめでとう！',
  },
  {
    id: 'REUNION',
    duration: 5.4,
    steps: [
      { t: 0, caption: '', act: 'apart' },
      { t: 0.8, caption: '（あれ……？）', act: 'look' },
      { t: 2.0, caption: '「……先輩？」', act: 'surprise' },
      { t: 3.2, caption: '（20 年ぶりの再会）', act: 'hug' },
      { t: 4.4, caption: '「また会えたね」', act: 'cheer' },
    ],
    score: 2400,
    label: '観客席で 20 年ぶりの再会',
    message: '再会した！',
  },
  {
    id: 'RIVALS',
    duration: 4.8,
    steps: [
      { t: 0, caption: '（隣の席の人と、応援している国が違う）', act: 'idle' },
      { t: 1.4, caption: '……', act: 'look' },
      { t: 2.4, caption: '（握手）', act: 'handshake' },
      { t: 3.5, caption: 'スポーツマンシップ', act: 'cheer' },
    ],
    score: 1800,
    label: '観客席で友情が生まれた',
    message: '友情が生まれた！',
  },
  {
    id: 'HAT',
    duration: 4.2,
    steps: [
      { t: 0, caption: '', act: 'idle' },
      { t: 0.8, caption: '（風）', act: 'hat' },
      { t: 2.0, caption: '「あっ」', act: 'surprise' },
      { t: 3.0, caption: '（隣の人が拾った）', act: 'handshake' },
    ],
    score: 1200,
    label: '観客席で帽子が戻ってきた',
    message: '帽子が戻ってきた！',
  },
];
