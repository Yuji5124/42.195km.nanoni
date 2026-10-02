// 男子 10000m 競歩 決勝のスタートリスト（全員架空）。8000m 通過の時点の並び（gap: 先頭からの m）。
//   vSus  … 残りの 2000m を押し切れる速さ（m/s）
//   kick  … ラストの速さ（m/s）・kickAt … 残り何 m で仕掛けるか
//   e0    … 8000m 時点の余力（0〜1・見えない）
//   style … lead（引っぱる）/ sit（後ろにつく）/ kick（最後に出る）/ surge（揺さぶる → 落ちる）/ steady
//   form  … フォームの崩れやすさ（審判の注意を受けやすい）

export const PLAYER_ID = 'ayumu';

export const ATHLETES = [
  {
    id: 'ayumu',
    name: '早瀬 歩',
    short: 'ハヤセ',
    nat: 'JPN',
    bib: 15,
    gap: -2.6,
    vSus: 4.62,
    kick: 5.2,
    e0: 0.8,
    form: 1,
    color: 0xff3d7f,
    shorts: 0x14141c,
    hair: 'short',
    hairColor: 0x2a1a12,
    skin: 1,
    extras: ['cap', 'headset'],
    acc: 0x39e6ff,
    player: true,
  },
  { id: 'makabe', name: '真壁 修', short: 'マカベ', nat: 'JPN', bib: 1, gap: 0, vSus: 4.57, kick: 4.98, kickAt: 620, e0: 0.78, style: 'lead', form: 0.7, color: 0xf2f2f2, shorts: 0xd0213a, hair: 'buzz', hairColor: 0x161212, skin: 1, extras: [] },
  { id: 'li', name: 'リー・ハオラン', short: 'リー', nat: 'CHN', bib: 9, gap: -0.9, vSus: 4.55, kick: 4.95, kickAt: 420, e0: 0.74, style: 'steady', form: 1.25, color: 0xd8262e, shorts: 0xd8262e, hair: 'short', hairColor: 0x121010, skin: 0, extras: [] },
  { id: 'alvarez', name: 'マテオ・アルバレス', short: 'アルバレス', nat: 'ESP', bib: 4, gap: -1.7, vSus: 4.52, kick: 5.08, kickAt: 260, e0: 0.8, style: 'kick', form: 0.9, color: 0xf6c400, shorts: 0xc0182c, hair: 'short', hairColor: 0x3a2618, skin: 2, extras: [] },
  { id: 'benedetti', name: 'ルカ・ベネデッティ', short: 'ベネデッティ', nat: 'ITA', bib: 7, gap: -3.5, vSus: 4.47, kick: 4.86, kickAt: 330, e0: 0.72, style: 'sit', form: 0.9, color: 0x2a6ad8, shorts: 0x1a2c6a, hair: 'pony', hairColor: 0x2a1a12, skin: 2, extras: [] },
  { id: 'pincha', name: 'ブライアン・ピンチャ', short: 'ピンチャ', nat: 'ECU', bib: 12, gap: -4.4, vSus: 4.42, kick: 4.8, kickAt: 1300, e0: 0.7, style: 'surge', form: 1.6, color: 0xffd23f, shorts: 0x1b3c8c, hair: 'short', hairColor: 0x121010, skin: 3, extras: [] },
  { id: 'lindqvist', name: 'ヨハン・リンドクヴィスト', short: 'リンドクヴィスト', nat: 'SWE', bib: 18, gap: -12.5, vSus: 4.43, kick: 4.8, kickAt: 300, e0: 0.7, style: 'steady', form: 0.8, color: 0x1f5fa8, shorts: 0xf2c400, hair: 'short', hairColor: 0xc8a060, skin: 0, extras: [] },
  { id: 'saeki', name: '佐伯 大地', short: 'サエキ', nat: 'JPN', bib: 22, gap: -15.8, vSus: 4.38, kick: 4.82, kickAt: 350, e0: 0.66, style: 'steady', form: 1.05, color: 0xffffff, shorts: 0x1a1a24, hair: 'short', hairColor: 0x161212, skin: 1, extras: [] },
  { id: 'souza', name: 'カイオ・ソウザ', short: 'ソウザ', nat: 'BRA', bib: 30, gap: -46, vSus: 4.3, kick: 4.7, kickAt: 300, e0: 0.62, style: 'steady', form: 1.1, color: 0x1f9a4a, shorts: 0xf4d000, hair: 'buzz', hairColor: 0x161212, skin: 3, extras: [] },
  { id: 'ruiz', name: 'エミリアーノ・ルイス', short: 'ルイス', nat: 'MEX', bib: 25, gap: -61, vSus: 4.25, kick: 4.65, kickAt: 300, e0: 0.6, style: 'steady', form: 1.15, color: 0x116a3a, shorts: 0xffffff, hair: 'short', hairColor: 0x2a1a12, skin: 2, extras: [] },
];

// プレイヤーのペース（↑↓ で 5 段）
export const PACES = [
  { name: 'ゆっくり', v: 4.15 },
  { name: '巡航', v: 4.38 },
  { name: '集団', v: 4.52 },
  { name: '攻め', v: 4.7 },
  { name: 'スパート', v: 5.08 },
];
