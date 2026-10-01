// 観客席の物語（データ）。1 プレイで 8〜12 本を選ぶ（StoryDirector）。実際にしっかり撮れるのは 2〜5 本。
//
// 1 本の形:
//   id / cat（family romance comedy sad judge athlete staff bird nature random）/ weight（選ばれやすさ）
//   major: エピローグで場面を作る大きな物語 / label: 結果画面の BEST SHOT の名前（英語）
//   cast: [{ role, look（見た目）, seat（座る場所）| at（フィールドの場所）, label（画面の上の呼び方）}]
//   beats: [{ t, r（role）, a（行動）, v（テレビとしての面白さ 0〜1.5）, em（感情 0〜1）, dur, hint, say, cm, key, if }]
//     t: 秒（52）/ '+4'（物語の開始から）/ 'takane#2.run-1'（高嶺の 2 本目の助走の 1 秒前）
//        試技の時刻: ready（儀式）run（助走）to（踏み切り）cross（バー）land（着地）res（判定）end
//     a: { p 姿勢, e 表情, l 視線, prop 小物, stand 立つ }
//     hint: glint（反射光）/ stand（立つ）/ face（こちらを向く）/ voice（小さな声）/ marker（微弱な枠）/ mutter（主人公「ん？」）
//     say: 撮っている時だけ出る小さな字幕（中継の指向性マイク）/ cm: 撮った時の実況
//     if: 'clear' | 'fail'（その試技の結果で出し分け）
//   onAir: 撮った時の実況（説明しすぎない）/ ai: AI CAMERA JUDGE の追加の行
//   epilogue: { stage（場面）, lines }（撮った物語だけ、最後に意味が分かる）
//   win: [早い, 遅い]（小さな物語の開始時刻の範囲）/ conflicts / requires
//
// 座る場所（seat.zone）:
//   barLine … カメラから見てバーの向こう（東カーブの 1 階）。クライマックスにバー・月と同じ画面に入る
//   nearMain … 撮影台のすぐ後ろ（メインスタンド 1 階）。振り返ると見える
//   mainUpper … メインスタンド 2 階（後ろの上）/ back … バックスタンド 1 階（正面の向こう）/ backUpper … バックスタンド 2 階
//   curveE / curveW … カーブ / front … 前の数列（どこでも）/ any

import { SKINS, HAIRS } from '../people/Figure.js';

const S = SKINS;
const H = HAIRS;

// ---- 見た目
const LOOK = {
  mother: { female: true, build: 'adult', hair: 'bun', top: 'cardigan', color: 0x8b6f8f, pants: 0x3a3040, hairColor: 0x2a1c18, skin: S[1], extras: [], acc: 0xd8c8a8 },
  sister: { female: true, build: 'slim', hair: 'bob', top: 'blazer', color: 0x2a2e3a, pants: 0x2a2e3a, hairColor: H[0], skin: S[1], extras: ['lanyard'], acc: 0xf4f4f4, acc2: 0x2a62c9 },
  coach: { female: false, build: 'elder', hair: 'gray', top: 'jacket', color: 0x1f3d6e, pants: 0x2a2a30, hairColor: H[4], skin: S[2], extras: ['cap'], acc: 0xd0283c },
  friend: { female: false, build: 'adult', hair: 'short', top: 'hoodie', color: 0xe8a23a, pants: 0x2a3550, hairColor: H[0], skin: S[1], extras: [] },
  dad: { female: false, build: 'big', hair: 'short', top: 'tshirt', color: 0x2f6e4a, pants: 0x3a3a44, hairColor: H[0], skin: S[1], extras: ['glasses'] },
  kid: { female: false, build: 'kid', hair: 'short', top: 'tshirt', color: 0xffd23f, pants: 0x2a3a6a, hairColor: H[0], skin: S[0], extras: ['cap'], acc: 0xd0283c },
  exwife: { female: true, build: 'adult', hair: 'long', top: 'long', color: 0x6a2a3a, pants: 0x2a2a30, hairColor: H[1], skin: S[1], extras: [] },
  judge: { female: false, build: 'adult', hair: 'short', top: 'blazer', color: 0x1b2a5a, pants: 0x1b2a5a, hairColor: 0x3a3030, skin: S[1], extras: ['glasses'], acc: 0xf4f4f4 },
  judge2: { female: true, build: 'slim', hair: 'pony', top: 'blazer', color: 0x1b2a5a, pants: 0x1b2a5a, hairColor: H[0], skin: S[0], extras: [], acc: 0xf4f4f4 },
  official: { female: false, build: 'adult', hair: 'short', top: 'jacket', color: 0x1b2a5a, pants: 0x2a2a34, hairColor: H[0], skin: S[2], extras: ['cap'], acc: 0xf4f4f4 },
  crew: { female: false, build: 'adult', hair: 'short', top: 'long', color: 0xf2c12e, pants: 0x2a2a34, hairColor: H[0], skin: S[1], extras: ['cap'], acc: 0x1b2a5a },
  photog: { female: false, build: 'big', hair: 'short', top: 'jacket', color: 0x2a2a2e, pants: 0x2a2a30, hairColor: H[1], skin: S[1], extras: [], acc: 0xff6a1f },
  lover: { female: true, build: 'slim', hair: 'pony', top: 'jacket', color: 0xd0283c, pants: 0x1a1c24, hairColor: 0xc9a25a, skin: S[0], extras: [], acc: 0xffffff },
  holder: { female: false, build: 'elder', hair: 'bald', top: 'suit', color: 0x3a3a44, pants: 0x3a3a44, hairColor: H[4], skin: S[1], extras: ['glasses'], acc: 0xf4f4f4, acc2: 0xa8303e },
  suitM: { female: false, build: 'adult', hair: 'short', top: 'suit', color: 0x2a2e3a, pants: 0x2a2e3a, hairColor: H[0], skin: S[1], extras: [], acc: 0xf4f4f4, acc2: 0x2a62c9 },
  bigM: { female: false, build: 'big', hair: 'buzz', top: 'tshirt', color: 0x202127, pants: 0x3a3a44, hairColor: H[0], skin: S[2], extras: [] },
  grandma: { female: true, build: 'elder', hair: 'gray', top: 'cardigan', color: 0xb36a5a, pants: 0x4a4030, hairColor: H[5], skin: S[0], extras: ['glasses'] },
  student: { female: true, build: 'slim', hair: 'pony', top: 'jacket', color: 0x1d2436, pants: 0x1d2436, hairColor: H[0], skin: S[0], extras: [] },
  vendor: { female: false, build: 'adult', hair: 'short', top: 'long', color: 0xd0283c, pants: 0x2a2a34, hairColor: H[0], skin: S[1], extras: ['cap'], acc: 0xffffff },
  fanJP: { female: false, build: 'adult', hair: 'short', top: 'tshirt', color: 0xd0283c, pants: 0x3a3a44, hairColor: H[0], skin: S[1], extras: [] },
  fanIT: { female: false, build: 'adult', hair: 'short', top: 'tshirt', color: 0x2b62c9, pants: 0x3a3a44, hairColor: H[1], skin: S[1], extras: [] },
  tourist: { female: false, build: 'big', hair: 'short', top: 'tshirt', color: 0x1d7a4a, pants: 0x8a7a5a, hairColor: 0xb08850, skin: S[0], extras: ['cap'], acc: 0xffffff },
};

// ---- 大きな物語（エピローグの場面がある）
export const MAJOR = [
  {
    id: 'mother',
    cat: 'family',
    weight: 9,
    major: true,
    title: '母親',
    label: 'Mother Watching Final Attempt',
    cast: [{ role: 'mother', look: LOOK.mother, seat: { zone: 'barLine', rows: [2, 7] }, label: '客席の女性' }],
    beats: [
      { t: 0, r: 'mother', a: { p: 'sit', e: 'worried', l: 'athlete:takane' }, v: 0.2, em: 0.3 },
      { t: 'takane#1.run-1.5', r: 'mother', a: { p: 'pray', e: 'pray' }, v: 0.7, em: 0.7, dur: 8, hint: 'marker' },
      { t: 'takane#1.res', r: 'mother', a: { p: 'clap', e: 'smile' }, v: 0.6, em: 0.6, dur: 4 },
      { t: 60, r: 'mother', a: { p: 'sit', e: 'worried', l: 'board' }, v: 0.25, em: 0.3 },
      { t: 'takane#2.ready', r: 'mother', a: { p: 'lean', e: 'worried', l: 'athlete:takane' }, v: 0.5, em: 0.6, dur: 3.5 },
      { t: 'takane#2.run-1', r: 'mother', a: { p: 'pray', e: 'pray' }, v: 0.95, em: 0.85, dur: 8, hint: 'glint', key: true },
      { t: 'takane#2.res', r: 'mother', a: { p: 'coverMouth', e: 'smile' }, v: 0.8, em: 0.8, dur: 4 },
      { t: 'takane#3.run-1.5', r: 'mother', a: { p: 'pray', e: 'pray' }, v: 1.0, em: 0.9, dur: 9, key: true },
      { t: 'takane#3.res', r: 'mother', a: { p: 'wipeTears', e: 'cry', prop: 'handkerchief' }, v: 1.1, em: 1.0, dur: 6, hint: 'glint', key: true },
      { t: 'riva#3.res', r: 'mother', a: { p: 'coverMouth', e: 'cry', stand: true, prop: 'handkerchief' }, v: 1.2, em: 1.0, dur: 5, hint: 'stand', key: true },
      { t: 'takane#4.ready+2', r: 'mother', a: { p: 'pray', e: 'pray', stand: true, prop: 'handkerchief' }, v: 1.35, em: 1.0, dur: 14, key: true },
      { t: 'takane#4.res', r: 'mother', a: { p: 'wipeTears', e: 'cry', stand: true, prop: 'handkerchief' }, v: 1.5, em: 1.0, dur: 9, key: true, if: 'clear' },
      { t: 'takane#4.res', r: 'mother', a: { p: 'clap', e: 'cry', stand: true, prop: 'handkerchief' }, v: 1.3, em: 1.0, dur: 9, key: true, if: 'fail' },
    ],
    onAir: ['かなり緊張している様子です。', '客席の女性、手を合わせています。', '……祈っているのでしょうか。'],
    ai: ['EMOTION HIGH', 'PERSON: PRAYING (87%)'],
    epilogue: { stage: 'reunion', lines: ['彼女は、選手の母親だった。', '本人には、来ることを伝えていなかった。', '朝一番の電車で、会場へ来た。'] },
  },
  {
    id: 'lovers',
    cat: 'romance',
    weight: 8,
    major: true,
    title: '秘密の恋人',
    label: 'Two Athletes, One Glance',
    cast: [{ role: 'nord', look: LOOK.lover, at: 'athleteSeat', label: '女子の選手' }],
    beats: [
      { t: 0, r: 'nord', a: { p: 'sit', e: 'neutral', l: 'athlete:riva' }, v: 0.25, em: 0.2 },
      { t: 34, r: '@riva', look: 'nord', dur: 3.5, v: 0.6, em: 0.5 },
      { t: 'riva#1.ready-1', r: 'nord', a: { p: 'lean', e: 'worried', l: 'athlete:riva' }, v: 0.55, em: 0.5, dur: 6 },
      { t: 'riva#1.res', r: 'nord', a: { p: 'clap', e: 'love', l: 'athlete:riva' }, v: 0.6, em: 0.6, dur: 3 },
      { t: 100, r: '@riva', look: 'nord', dur: 4, v: 0.75, em: 0.6, key: true },
      { t: 100.6, r: 'nord', a: { p: 'wave', e: 'love', l: 'athlete:riva' }, v: 0.9, em: 0.7, dur: 2.2, key: true, hint: 'marker', say: '（小さく手を振る）' },
      { t: 'riva#2.run-1', r: 'nord', a: { p: 'pray', e: 'pray', l: 'athlete:riva' }, v: 0.8, em: 0.7, dur: 7 },
      { t: 'riva#2.res', r: 'nord', a: { p: 'coverMouth', e: 'love', l: 'athlete:riva' }, v: 0.85, em: 0.8, dur: 4, key: true },
      { t: 'takane#3.ready', r: 'nord', a: { p: 'sit', e: 'love', l: 'athlete:riva' }, v: 0.7, em: 0.5, dur: 12, cm: 'ほかの選手を見ている……？' },
      { t: 138, r: '@riva', look: 'nord', dur: 3, v: 0.7, em: 0.6 },
      { t: 'riva#3.run-1', r: 'nord', a: { p: 'pray', e: 'worried', stand: true, l: 'athlete:riva' }, v: 1.0, em: 0.9, dur: 8, key: true },
      { t: 'riva#3.res', r: 'nord', a: { p: 'coverMouth', e: 'sad', l: 'athlete:riva' }, v: 1.1, em: 1.0, dur: 6, key: true },
      { t: 160, r: '@riva', look: 'nord', dur: 5, v: 0.8, em: 0.8 },
      { t: 160.5, r: 'nord', a: { p: 'sit', e: 'smile', l: 'athlete:riva' }, v: 0.9, em: 0.8, dur: 6, key: true },
    ],
    onAir: ['隣の選手と……何か、目で合図を？', 'リヴァ、ベンチの方を見ています。'],
    ai: ['TWO ATHLETES', 'EYE CONTACT DETECTED', 'RELATIONSHIP: UNKNOWN'],
    epilogue: { stage: 'corridor', lines: ['二人は付き合っている。', 'まだ、誰にも話していない。', '試合のあと、人の少ない通路で、少しだけ話した。'] },
  },
  {
    id: 'judgeEx',
    cat: 'judge',
    weight: 8,
    major: true,
    title: '審判と元妻',
    label: 'The Judge Looks Up',
    cast: [{ role: 'exwife', look: LOOK.exwife, seat: { zone: 'nearMain', rows: [4, 10], dx: [-14, 14] }, label: '客席の女性' }],
    beats: [
      { t: 0, r: 'exwife', a: { p: 'sit', e: 'neutral', l: 'field' }, v: 0.1 },
      { t: 49, r: 'judgeChief', a: { l: 'npc:exwife', e: 'thoughtful' }, v: 0.55, em: 0.35, dur: 3.2, hint: 'face' },
      { t: 56, r: 'exwife', a: { l: 'npc:judgeChief', e: 'thoughtful' }, v: 0.6, em: 0.4, dur: 3.5 },
      { t: 88, r: 'judgeChief', a: { l: 'npc:exwife', e: 'thoughtful' }, v: 0.6, em: 0.4, dur: 3, hint: 'face' },
      { t: 92, r: 'judgeChief', a: { e: 'sigh', p: 'chin' }, v: 0.5, em: 0.4, dur: 3 },
      { t: 104, r: 'exwife', a: { l: 'npc:judgeChief', e: 'sad' }, v: 0.65, em: 0.5, dur: 4 },
      { t: 119.5, r: 'judgeChief', a: { l: 'npc:exwife', e: 'smile' }, v: 1.0, em: 0.8, dur: 2.6, key: true, hint: 'face' },
      { t: 119.5, r: 'exwife', a: { l: 'npc:judgeChief', e: 'surprised' }, v: 1.0, em: 0.8, dur: 1.4, key: true },
      { t: 120.9, r: 'exwife', a: { l: 'down', e: 'smile' }, v: 0.95, em: 0.8, dur: 3, key: true },
      { t: 150, r: 'judgeChief', a: { l: 'npc:exwife', e: 'neutral' }, v: 0.6, em: 0.5, dur: 2.5 },
      { t: 'takane#4.res+2', r: 'exwife', a: { p: 'clap', e: 'smile', l: 'npc:judgeChief' }, v: 0.8, em: 0.7, dur: 4, key: true },
    ],
    onAir: ['審判長、時計を確認……でしょうか。', '審判長、客席の方を見ています。'],
    ai: ['JUDGE DETECTED', 'FACE EXPRESSION: INTERESTING', 'STORY POTENTIAL: HIGH'],
    epilogue: { stage: 'talk', lines: ['客席にいたのは、数年前に別れた妻だった。', '試合のあと、二人は少しだけ話した。', 'どちらも、天気の話しかしなかった。'] },
  },
  {
    id: 'sister',
    cat: 'family',
    weight: 7,
    major: true,
    title: '姉',
    label: 'Sister From The Office',
    cast: [{ role: 'sister', look: LOOK.sister, seat: { zone: 'mainUpper', rows: [9, 16] }, label: 'スーツの女性' }],
    beats: [
      { t: 0, r: 'sister', a: { p: 'phone', e: 'sigh', prop: 'phone', l: 'fixed' }, v: 0.3, em: 0.2, dur: 26, hint: 'glint', say: '（仕事のメール）' },
      { t: 'takane#1.run-1', r: 'sister', a: { p: 'lean', e: 'worried', l: 'athlete:takane' }, v: 0.5, em: 0.5, dur: 6 },
      { t: 'takane#1.res', r: 'sister', a: { p: 'fist', e: 'smile', l: 'athlete:takane' }, v: 0.6, em: 0.6, dur: 3, say: '……よし。' },
      { t: 64, r: 'sister', a: { p: 'phone', e: 'sigh', prop: 'phone', l: 'fixed' }, v: 0.35, em: 0.2, dur: 12, hint: 'glint', say: '（明日の会議の資料）' },
      { t: 'takane#2.run-1', r: 'sister', a: { p: 'pray', e: 'pray', l: 'athlete:takane' }, v: 0.8, em: 0.7, dur: 7, key: true },
      { t: 'takane#2.res', r: 'sister', a: { p: 'clap', e: 'smile', stand: true }, v: 0.75, em: 0.7, dur: 3 },
      { t: 108, r: 'sister', a: { p: 'phone', e: 'neutral', prop: 'phone', l: 'fixed' }, v: 0.4, em: 0.3, dur: 6, hint: 'glint', say: '（上司から着信）', cm: 'ん？' },
      { t: 114, r: 'sister', a: { p: 'sit', e: 'serious', l: 'athlete:takane' }, v: 0.5, em: 0.6, dur: 12, say: '（電話を切った）', key: true },
      { t: 'takane#3.res', r: 'sister', a: { p: 'cheer', e: 'laugh', stand: true }, v: 0.95, em: 0.9, dur: 4, key: true },
      { t: 'riva#3.res', r: 'sister', a: { p: 'wipeTears', e: 'cry', stand: true }, v: 1.1, em: 1.0, dur: 5, key: true },
      { t: 'takane#4.run-1', r: 'sister', a: { p: 'pray', e: 'pray', stand: true }, v: 1.1, em: 0.9, dur: 8, key: true },
      { t: 'takane#4.res', r: 'sister', a: { p: 'cheer', e: 'cry', stand: true }, v: 1.2, em: 1.0, dur: 8, key: true },
    ],
    onAir: ['仕事帰りでしょうか、スーツ姿の方も。', 'うしろの方で、静かに見ています。'],
    ai: ['PERSON: OFFICE WORKER (91%)', 'PHONE DETECTED'],
    epilogue: { stage: 'leave', lines: ['彼女は、会社に無理を言って休みを取った。', '試合が終わると、すぐに駅へ向かった。', '翌朝は、普通に出勤した。'] },
  },
  {
    id: 'coach',
    cat: 'sad',
    weight: 6,
    major: true,
    title: '昔のコーチ',
    label: 'The Old Coach',
    cast: [{ role: 'coach', look: LOOK.coach, seat: { zone: 'backUpper', rows: [6, 15], dx: [-30, 10] }, label: '帽子の男性' }],
    beats: [
      { t: 0, r: 'coach', a: { p: 'armsCrossed', e: 'serious', l: 'athlete:takane' }, v: 0.3, em: 0.3 },
      { t: 'takane#1.run-0.5', r: 'coach', a: { p: 'lean', e: 'serious', l: 'athlete:takane' }, v: 0.6, em: 0.5, dur: 6 },
      { t: 'takane#1.res', r: 'coach', a: { p: 'fist', e: 'smile', l: 'athlete:takane' }, v: 0.75, em: 0.6, dur: 1.4, key: true },
      { t: 'takane#2.run-0.5', r: 'coach', a: { p: 'lean', e: 'serious', l: 'athlete:takane' }, v: 0.65, em: 0.6, dur: 6 },
      { t: 'takane#2.res', r: 'coach', a: { p: 'chin', e: 'smile', l: 'athlete:takane' }, v: 0.7, em: 0.6, dur: 2.5, say: '……踏み切り、早いな。' },
      { t: 'takane#3.res', r: 'coach', a: { p: 'fist', e: 'smile', l: 'athlete:takane' }, v: 0.9, em: 0.8, dur: 1.6, key: true },
      { t: 'riva#3.res+1', r: 'coach', a: { p: 'armsCrossed', e: 'cry', l: 'athlete:takane' }, v: 0.9, em: 0.9, dur: 6, key: true, hint: 'marker' },
      { t: 'takane#4.run-1', r: 'coach', a: { p: 'lean', e: 'serious', stand: true, l: 'athlete:takane' }, v: 1.1, em: 1.0, dur: 7, key: true },
      { t: 'takane#4.res', r: 'coach', a: { p: 'clap', e: 'cry', stand: true, l: 'athlete:takane' }, v: 1.2, em: 1.0, dur: 7, key: true, if: 'clear' },
      { t: 'takane#4.res', r: 'coach', a: { p: 'armsCrossed', e: 'sad', stand: true, l: 'athlete:takane' }, v: 1.0, em: 1.0, dur: 7, key: true, if: 'fail' },
    ],
    onAir: ['うしろの方の席、ずっと腕を組んで見ている方がいます。'],
    ai: ['PERSON: EXPERT (64%)', 'ARMS CROSSED'],
    epilogue: { stage: 'leaveCoach', lines: ['彼は、昔のコーチだった。', '今は、もう指導者ではない。', '選手は、最後まで気づかなかった。'] },
  },
  {
    id: 'friend',
    cat: 'family',
    weight: 5,
    major: true,
    title: '幼なじみ',
    label: 'Handmade Sign',
    cast: [{ role: 'friend', look: LOOK.friend, seat: { zone: 'curveW', rows: [1, 5] }, label: '看板の男性' }],
    beats: [
      { t: 0, r: 'friend', a: { p: 'sit', e: 'neutral', l: 'field', prop: 'sign:ソラ\nがんばれ' }, v: 0.25, em: 0.3 },
      { t: 'takane#1.ready', r: 'friend', a: { p: 'holdSign', e: 'shout', stand: true, prop: 'sign:ソラ\nがんばれ' }, v: 0.7, em: 0.6, dur: 9, hint: 'stand', key: true },
      { t: 'takane#2.ready', r: 'friend', a: { p: 'holdSign', e: 'shout', stand: true, prop: 'sign:ソラ\nがんばれ' }, v: 0.75, em: 0.6, dur: 9, key: true },
      { t: 'takane#2.res', r: 'friend', a: { p: 'cheer', e: 'laugh', stand: true }, v: 0.7, em: 0.7, dur: 3 },
      { t: 'takane#3.ready', r: 'friend', a: { p: 'holdSign', e: 'shout', stand: true, prop: 'sign:ソラ\nがんばれ' }, v: 0.8, em: 0.7, dur: 13, key: true },
      { t: 'takane#4.ready', r: 'friend', a: { p: 'holdSign', e: 'pray', stand: true, prop: 'sign:ソラ\nがんばれ' }, v: 1.0, em: 0.9, dur: 14, key: true },
      { t: 'takane#4.res', r: 'friend', a: { p: 'cheer', e: 'cry', stand: true, prop: 'sign:ソラ\nがんばれ' }, v: 1.1, em: 1.0, dur: 7, key: true },
    ],
    onAir: ['手作りの応援ボードも見えます。'],
    ai: ['TEXT DETECTED: "ソラ がんばれ"', 'HANDMADE: YES'],
    epilogue: { stage: 'sign', lines: ['テレビでしか見ないと思っていた幼なじみが、会場に来ていた。', '小学校の校庭で、物干し竿を使って跳んだことがある。', '二人とも、怒られた。'] },
  },
  {
    id: 'parentKid',
    cat: 'family',
    weight: 6,
    major: true,
    title: '親子',
    label: 'Will He Win?',
    cast: [
      { role: 'dad', look: LOOK.dad, seat: { zone: 'back', rows: [2, 9], pair: 'kid', dx: [-25, 30] }, label: '親子' },
      { role: 'kid', look: LOOK.kid, seat: { pairOf: 'dad' }, label: '子ども' },
    ],
    beats: [
      { t: 0, r: 'kid', a: { p: 'sit', e: 'neutral', l: 'field' }, v: 0.2 },
      { t: 38, r: 'kid', a: { p: 'point', e: 'surprised', stand: true, l: 'athlete:takane' }, v: 0.6, em: 0.5, dur: 3, hint: 'stand', say: 'ねえ、あの人勝てる？' },
      { t: 40.5, r: 'dad', a: { p: 'sit', e: 'smile', l: 'npc:kid' }, v: 0.65, em: 0.6, dur: 3, say: 'わからないけど、見よう。', key: true },
      { t: 'takane#2.res', r: 'kid', a: { p: 'cheer', e: 'laugh', stand: true }, v: 0.65, em: 0.6, dur: 3 },
      { t: 'takane#3.run-1', r: 'kid', a: { p: 'pray', e: 'pray', stand: true }, v: 0.8, em: 0.7, dur: 7, key: true, say: '（パパのまね）' },
      { t: 'takane#3.run-1', r: 'dad', a: { p: 'pray', e: 'pray' }, v: 0.8, em: 0.7, dur: 7 },
      { t: 'takane#4.ready+3', r: 'kid', a: { p: 'sit', e: 'serious', l: 'athlete:takane' }, v: 0.8, em: 0.8, dur: 10, say: '……しずかにする。' },
      { t: 'takane#4.res', r: 'kid', a: { p: 'cheer', e: 'laugh', stand: true }, v: 1.0, em: 0.9, dur: 6, key: true, say: '勝った！ ねえ勝った！' },
      { t: 'takane#4.res', r: 'dad', a: { p: 'clap', e: 'cry', stand: true }, v: 1.0, em: 0.9, dur: 6 },
    ],
    onAir: ['お子さんも見ています。'],
    ai: ['ADULT + CHILD', 'QUESTION DETECTED'],
    epilogue: { stage: 'seatPair', lines: ['帰り道、子どもは「棒高跳びの選手になる」と言った。', '3 日で飽きた。', 'でも、その夜のことは、ずっと覚えていた。'] },
  },
  {
    id: 'strangers',
    cat: 'random',
    weight: 5,
    major: true,
    title: '知らない観客同士',
    label: 'Strangers, Then Friends',
    cast: [
      { role: 'stA', look: LOOK.suitM, seat: { zone: 'back', rows: [3, 12], pair: 'stB', dx: [-35, 25] }, label: '隣どうしの二人' },
      { role: 'stB', look: LOOK.tourist, seat: { pairOf: 'stA' }, label: '隣の人' },
    ],
    beats: [
      { t: 0, r: 'stA', a: { p: 'armsCrossed', e: 'neutral', l: 'field' }, v: 0.1 },
      { t: 0, r: 'stB', a: { p: 'sit', e: 'neutral', l: 'field' }, v: 0.1 },
      { t: 'takane#1.res', r: 'stA', a: { p: 'clap', e: 'smile', l: 'npc:stB' }, v: 0.4, em: 0.3, dur: 2 },
      { t: 'takane#2.res', r: 'stB', a: { p: 'fist', e: 'laugh', l: 'npc:stA' }, v: 0.6, em: 0.5, dur: 3, say: 'Nice!' },
      { t: 'takane#2.res+0.4', r: 'stA', a: { p: 'fist', e: 'laugh', l: 'npc:stB' }, v: 0.7, em: 0.6, dur: 3, key: true, say: 'ナイス！' },
      { t: 'takane#3.res', r: 'stA', a: { p: 'hug', e: 'laugh', stand: true, l: 'npc:stB' }, v: 0.85, em: 0.7, dur: 3, key: true },
      { t: 'takane#3.res', r: 'stB', a: { p: 'hug', e: 'laugh', stand: true, l: 'npc:stA' }, v: 0.85, em: 0.7, dur: 3 },
      { t: 'takane#4.ready+2', r: 'stA', a: { p: 'pray', e: 'pray', stand: true }, v: 0.9, em: 0.8, dur: 12 },
      { t: 'takane#4.ready+2', r: 'stB', a: { p: 'pray', e: 'pray', stand: true }, v: 0.9, em: 0.8, dur: 12 },
      { t: 'takane#4.res', r: 'stA', a: { p: 'hug', e: 'cry', stand: true, l: 'npc:stB' }, v: 1.1, em: 1.0, dur: 6, key: true },
      { t: 'takane#4.res', r: 'stB', a: { p: 'hug', e: 'laugh', stand: true, l: 'npc:stA' }, v: 1.1, em: 1.0, dur: 6 },
    ],
    onAir: ['お隣どうしで、喜んでいます。'],
    ai: ['TWO PERSONS', 'HIGH FIVE (??%)'],
    epilogue: { stage: 'seatPair', lines: ['二人は、この日初めて会った。', '帰りの電車も、同じだった。', '降りる駅も、同じだった。'] },
  },
  {
    id: 'proposal',
    cat: 'romance',
    weight: 4,
    major: true,
    title: 'プロポーズ',
    label: 'Proposal Nobody Saw',
    conflicts: ['coupleIgnore'],
    cast: [
      { role: 'man', look: { female: false, build: 'adult', hair: 'short', top: 'jacket', color: 0x3a4a6a, pants: 0x2a2a30, skin: S[1] }, seat: { zone: 'back', rows: [1, 4], pair: 'woman', dx: [0, 40] }, label: '前の列の二人' },
      { role: 'woman', look: { female: true, build: 'adult', hair: 'long', top: 'long', color: 0xe8d8b0, pants: 0x2a2a30, skin: S[0] }, seat: { pairOf: 'man' }, label: '女性' },
    ],
    beats: [
      { t: 0, r: 'man', a: { p: 'fidget', e: 'worried', l: 'field' }, v: 0.25, em: 0.3 },
      { t: 70, r: 'man', a: { p: 'fidget', e: 'worried', l: 'npc:woman' }, v: 0.4, em: 0.4, dur: 5, say: '……今かな。いや、まだだ。' },
      { t: 128, r: 'man', a: { p: 'fidget', e: 'worried', l: 'npc:woman' }, v: 0.45, em: 0.5, dur: 5, say: '……優勝が決まったら、言う。' },
      { t: 'riva#3.res+2', r: 'man', a: { p: 'kneel', e: 'serious', stand: true, l: 'npc:woman' }, v: 1.1, em: 0.9, dur: 9, key: true, hint: 'stand', say: '結婚してください。' },
      { t: 'riva#3.res+2', r: 'woman', a: { p: 'sit', e: 'neutral', l: 'athlete:takane' }, v: 0.9, em: 0.6, dur: 4, say: '（試合を見ている）' },
      { t: 'riva#3.res+6', r: 'woman', a: { p: 'coverMouth', e: 'surprised', stand: true, l: 'npc:man' }, v: 1.3, em: 1.0, dur: 5, key: true },
      { t: 'takane#4.ready+4', r: 'woman', a: { p: 'hug', e: 'cry', stand: true, l: 'npc:man' }, v: 1.3, em: 1.0, dur: 9, key: true, say: 'はい。' },
      { t: 'takane#4.ready+4', r: 'man', a: { p: 'hug', e: 'cry', stand: true, l: 'npc:woman' }, v: 1.3, em: 1.0, dur: 9 },
      { t: 'takane#4.res', r: 'man', a: { p: 'cheer', e: 'laugh', stand: true }, v: 1.1, em: 1.0, dur: 6 },
    ],
    onAir: ['……前の列で、何か起きています。'],
    ai: ['KNEELING PERSON', 'RING? (52%)'],
    epilogue: { stage: 'seatPair', lines: ['彼女の返事は、「はい」だった。', 'その瞬間、3 万人は全員、バーを見ていた。'] },
  },
  {
    id: 'holder',
    cat: 'athlete',
    weight: 5,
    major: true,
    title: '大会記録保持者',
    label: 'The Old Record Holder',
    cast: [{ role: 'holder', look: LOOK.holder, seat: { zone: 'mainUpper', rows: [0, 3], dx: [-30, 30] }, label: 'スーツの老紳士' }],
    beats: [
      { t: 0, r: 'holder', a: { p: 'sit', e: 'neutral', l: 'board' }, v: 0.2 },
      { t: 'takane#3.res', r: 'holder', a: { p: 'chin', e: 'thoughtful', l: 'athlete:takane' }, v: 0.6, em: 0.5, dur: 6, say: '……6 メートル、か。' },
      { t: 'takane#4.ready', r: 'holder', a: { p: 'lean', e: 'serious', l: 'bar' }, v: 0.9, em: 0.7, dur: 12, key: true },
      { t: 'takane#4.res', r: 'holder', a: { p: 'clap', e: 'smile', stand: true, l: 'athlete:takane' }, v: 1.25, em: 1.0, dur: 8, key: true, if: 'clear' },
      { t: 'takane#4.res', r: 'holder', a: { p: 'sit', e: 'sigh', l: 'bar' }, v: 0.9, em: 0.8, dur: 6, key: true, if: 'fail' },
    ],
    onAir: ['……客席に、どこかで見たことのある方が。'],
    ai: ['PERSON: VIP? (40%)', 'SLOW CLAP DETECTED'],
    epilogue: { stage: 'seat', lines: ['彼の大会記録は、14 年間破られなかった。', 'その夜、彼は少しだけ泣いた。', '理由は、本人にもよくわからなかった。'] },
  },
  {
    id: 'birds',
    cat: 'bird',
    weight: 99,
    major: true,
    title: '鳥',
    label: 'Two Birds Detected',
    cast: [],
    beats: [],
    onAir: ['鳥ですね。', '鳥です。'],
    ai: ['TWO BIRDS DETECTED', 'RELATIONSHIP LIKELIHOOD 92%'],
    epilogue: { stage: 'birds', lines: ['二羽は、そのまま一緒に帰った。', 'どこへ帰ったのかは、誰も知らない。'] },
  },
  {
    id: 'sky',
    cat: 'nature',
    weight: 99,
    major: true,
    title: '夜空',
    label: 'Night Sky Over The Stadium',
    cast: [],
    beats: [],
    onAir: ['きれいな月が出ています。'],
    ai: ['MOON DETECTED', 'COMPOSITION EXCELLENT'],
    epilogue: { stage: 'sky', lines: ['あなたが撮った夜空の映像は、', 'その日の中継の、最後の映像として使われた。'] },
  },
];

// ---- 小さな物語（1〜2 人・数個の動き）。エピローグは 1〜2 行
// m(id, cat, 見た目, 場所, 窓, beats, 実況, エピローグ, AI)
function m(id, cat, look, zone, win, beats, onAir, epi, ai = [], extra = {}) {
  return { id, cat, weight: extra.weight ?? 2, title: extra.title ?? id, label: extra.label ?? id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), cast: [{ role: id, look, seat: { zone, rows: extra.rows ?? [0, 20], dx: extra.dx }, label: extra.who ?? '観客' }, ...(extra.cast ?? [])], beats, win, onAir: onAir ? [onAir] : [], ai, epilogue: epi ? { stage: extra.stage ?? 'seat', lines: epi } : null, conflicts: extra.conflicts ?? [] };
}
const b = (t, r, a, v = 0.5, more = {}) => ({ t, r, a, v, em: more.em ?? v * 0.6, dur: more.dur ?? 5, ...more });

export const MINOR = [
  m('popcorn', 'comedy', { build: 'adult', top: 'hoodie', color: 0x6a3a8a }, 'back', [40, 150], [
    b('+0', 'popcorn', { p: 'eat', e: 'eat', prop: 'popcorn', l: 'field' }, 0.3, { dur: 9 }),
    b('+9', 'popcorn', { p: 'drop', e: 'surprised', prop: null, l: 'down' }, 0.75, { dur: 3, key: true, hint: 'marker', say: 'あっ……' }),
    b('+12', 'popcorn', { p: 'sit', e: 'sad', l: 'down' }, 0.5, { dur: 6, say: '（全部落ちた）' }),
  ], 'ポップコーンが……。', ['彼は、二つ目のポップコーンを買った。', '二つ目も、少しこぼした。'], ['FOOD DETECTED', 'LOSS DETECTED']),
  m('toilet', 'comedy', { build: 'adult', top: 'tshirt', color: 0x2a6e9a }, 'nearMain', [30, 120], [
    b('+0', 'toilet', { p: 'fidget', e: 'worried', l: 'field' }, 0.35, { dur: 12, say: '……まだ跳ぶの？' }),
    b('+12', 'toilet', { p: 'fidget', e: 'sigh', l: 'board' }, 0.45, { dur: 10, say: 'あと何本……？' }),
    b('+22', 'toilet', { p: 'fidget', e: 'shout', stand: true, l: 'down' }, 0.7, { dur: 3, key: true, hint: 'stand', say: '今だ……！' }),
  ], '……落ち着かない様子の方も。', ['彼は、高嶺の大会新記録を、トイレの中で聞いた。'], ['MOVEMENT: URGENT']),
  m('bigGuy', 'comedy', LOOK.bigM, 'back', [30, 140], [
    b('+0', 'bigGuy', { p: 'sit', e: 'neutral', l: 'field' }, 0.2, { dur: 4 }),
    b('+4', 'bigGuy', { p: 'cheer', e: 'shout', stand: true, l: 'field' }, 0.55, { dur: 8, hint: 'stand' }),
    b('+12', 'bigGuy', { p: 'stretch', e: 'smile', stand: true, l: 'field' }, 0.5, { dur: 6, say: 'うしろ「……見えない」' }),
  ], '大きな方が立ち上がりました。', ['うしろの席の人は、その日、ほとんど何も見えなかった。', 'でも、テレビの録画で全部見た。'], ['LARGE PERSON', 'OCCLUSION RISK HIGH']),
  m('binoBack', 'comedy', { build: 'elder', top: 'cardigan', color: 0x7a6a5a, hair: 'gray', hairColor: H[4], extras: ['glasses'] }, 'backUpper', [20, 160], [
    b('+0', 'binoBack', { p: 'binoculars', e: 'thoughtful', prop: 'binoculars', l: 'field' }, 0.45, { dur: 8, hint: 'glint', say: '……遠い。すごく遠い。' }),
    b('+8', 'binoBack', { p: 'sit', e: 'surprised', l: 'field' }, 0.5, { dur: 3, say: '（逆だった）' }),
    b('+11', 'binoBack', { p: 'binoculars', e: 'smile', prop: 'binoculars', l: 'field' }, 0.55, { dur: 8, say: '近い！' }),
  ], '双眼鏡で見ている方も……。', ['彼女は、双眼鏡の使い方を最後に覚えた。', '覚えた時には、試合が終わっていた。'], ['OPTICS: REVERSED (73%)']),
  m('birdWatcher', 'comedy', { build: 'slim', top: 'jacket', color: 0x5f5e3f, extras: ['cap'] }, 'back', [50, 170], [
    b('+0', 'birdWatcher', { p: 'binoculars', e: 'surprised', prop: 'binoculars', l: 'birds' }, 0.55, { dur: 20, hint: 'glint', say: 'ゴイサギだ……！' }),
  ], '……鳥を見ている方がいますね。', ['彼は、選手より鳥を見ていた。', 'その日の記録は「ゴイサギ 2 羽」だった。'], ['BIRD WATCHER', 'ATTENTION: WRONG DIRECTION'], { weight: 3 }),
  m('sleeper', 'comedy', { build: 'big', top: 'jacket', color: 0x3a3a44 }, 'curveE', [20, 120], [
    b('+0', 'sleeper', { p: 'sleep', e: 'sleep', l: 'none' }, 0.45, { dur: 40, say: 'zzz……' }),
  ], '……お休みの方も。', ['彼は、優勝が決まった瞬間の歓声で起きた。', '「何が起きた？」と隣に聞いた。'], ['PERSON: SLEEPING (99%)', 'CALM'], { weight: 3 }),
  m('wrongFlag', 'comedy', { build: 'adult', top: 'tshirt', color: 0xd9dde4 }, 'back', [30, 140], [
    b('+0', 'wrongFlag', { p: 'cheer', e: 'laugh', prop: 'flag:bd', l: 'field' }, 0.55, { dur: 10, hint: 'stand', say: 'ニッポン！' }),
    b('+10', 'wrongFlag', { p: 'sit', e: 'neutral', prop: 'flag:bd', l: 'field' }, 0.4, { dur: 10 }),
  ], '国旗を振って応援しています。……日本の？', ['その旗は、バングラデシュの国旗だった。', '色はだいたい合っていた。'], ['FLAG DETECTED: BANGLADESH (88%)']),
  m('wrongFan', 'comedy', { build: 'adult', top: 'tshirt', color: 0x24262e }, 'curveW', [96, 170], [
    b('+0', 'wrongFan', { p: 'holdSign', e: 'shout', stand: true, prop: 'board:ケラー\n最高', l: 'field' }, 0.55, { dur: 14, say: 'ケラー！ ケラー！' }),
  ], 'ケラーの応援……ケラーはもう競技を終えていますが。', ['彼は、ケラーが敗退したことを知らなかった。', '最後まで、ケラーを応援していた。'], ['TEXT: "ケラー 最高"', 'TARGET ATHLETE: ELIMINATED']),
  m('coupleIgnore', 'comedy', { female: true, build: 'adult', top: 'long', color: 0xc47394 }, 'back', [20, 150], [
    b('+0', 'coupleIgnore', { p: 'talk', e: 'laugh', l: 'npc:coupleIgnoreB' }, 0.4, { dur: 40, say: '……でね、その店がさ' }),
    b('+0', 'coupleIgnoreB', { p: 'sit', e: 'smile', l: 'npc:coupleIgnore' }, 0.4, { dur: 40 }),
  ], 'カップル……競技は見ていませんね。', ['二人は、棒高跳びを一度も見なかった。', '楽しかったらしい。'], ['TWO PERSONS', 'SPORT ATTENTION: 0%'], { cast: [{ role: 'coupleIgnoreB', look: { female: false, build: 'adult', top: 'jacket', color: 0x2a3d6e }, seat: { pairOf: 'coupleIgnore' } }], conflicts: ['proposal'] }),
  m('selfie', 'comedy', { female: true, build: 'slim', top: 'tshirt', color: 0xff9ac8, hair: 'long' }, 'nearMain', [30, 160], [
    b('+0', 'selfie', { p: 'phone', e: 'love', prop: 'phone', l: 'fixed' }, 0.45, { dur: 8, hint: 'glint', say: '（自撮り・47 枚目）' }),
    b('+8', 'selfie', { p: 'phone', e: 'laugh', prop: 'phone', l: 'fixed', stand: true }, 0.5, { dur: 6 }),
  ], '', ['彼女のスマホには、自分と夜空が 112 枚写っていた。', '選手は、1 枚も写っていなかった。'], ['PHONE DETECTED', 'SELF-PORTRAIT MODE']),
  m('bento', 'comedy', { build: 'big', top: 'tshirt', color: 0xc9702f }, 'back', [20, 160], [
    b('+0', 'bento', { p: 'eat', e: 'eat', prop: 'bento', l: 'down' }, 0.35, { dur: 25, say: '（唐揚げ弁当）' }),
  ], '', ['彼は、試合中に弁当を 2 つ食べた。'], ['FOOD DETECTED: KARAAGE (91%)']),
  m('waveCam', 'comedy', { build: 'kid', top: 'tshirt', color: 0x2f8f4f, hair: 'short' }, 'nearMain', [20, 170], [
    b('+0', 'waveCam', { p: 'wave', e: 'laugh', stand: true, l: 'camera' }, 0.6, { dur: 10, hint: 'face', say: 'テレビ！ テレビ！' }),
  ], '……カメラに手を振っています。', ['その子は、家に帰ってから録画を 30 回見た。', '自分が映っていたのは、2 秒だった。'], ['CAMERA AWARENESS: HIGH', 'WAVE DETECTED']),
  m('phoneCall', 'random', LOOK.suitM, 'backUpper', [30, 150], [
    b('+0', 'phoneCall', { p: 'phone', e: 'worried', prop: 'phone', l: 'fixed' }, 0.35, { dur: 16, hint: 'glint', say: 'はい……はい……申し訳ありません……' }),
  ], '', ['電話は、競技が終わるまで切れなかった。'], ['PHONE CALL', 'STRESS: HIGH']),
  m('grandmaKnit', 'random', LOOK.grandma, 'curveE', [10, 160], [
    b('+0', 'grandmaKnit', { p: 'clipboard', e: 'smile', l: 'down' }, 0.35, { dur: 40, say: '（編み物）' }),
  ], '', ['おばあさんは、試合の間にマフラーを半分編んだ。', '高嶺の名前を、編み込んでいた。'], ['ELDERLY PERSON', 'HANDCRAFT DETECTED']),
  m('balloon', 'random', { build: 'kid', top: 'tshirt', color: 0xffd23f }, 'back', [40, 140], [
    b('+0', 'balloon', { p: 'reachUp', e: 'laugh', prop: 'balloon', l: 'field' }, 0.4, { dur: 7 }),
    b('+7', 'balloon', { p: 'reachUp', e: 'surprised', prop: null, l: 'sky' }, 0.75, { dur: 4, key: true, say: 'あ。' }),
    b('+11', 'balloon', { p: 'sit', e: 'sad', l: 'sky' }, 0.6, { dur: 8, say: '（風船が月の方へ）' }),
  ], '風船が……飛んでいきました。', ['風船は、その夜のうちに隣の県まで飛んだ。'], ['BALLOON: ESCAPED']),
  m('uchiwa', 'random', { female: true, build: 'adult', top: 'tshirt', color: 0xd0283c, hair: 'bob' }, 'curveW', [10, 170], [
    b('+0', 'uchiwa', { p: 'wave', e: 'laugh', prop: 'uchiwa', stand: true, l: 'athlete:takane' }, 0.5, { dur: 12, say: 'ソラくーん！' }),
  ], '', ['うちわは、徹夜で作った。'], ['FAN ITEM DETECTED']),
  m('itaFan', 'random', LOOK.fanIT, 'back', [40, 150], [
    b('+0', 'itaFan', { p: 'cheer', e: 'shout', prop: 'flag:it', stand: true, l: 'athlete:riva' }, 0.5, { dur: 12, say: 'Forza Matteo!' }),
  ], 'イタリアからの応援も。', ['彼は、リヴァの叔父だった。', 'ローマから、20 時間かけて来た。'], ['FLAG DETECTED: ITALY']),
  m('jpFlag', 'random', LOOK.fanJP, 'curveE', [10, 170], [
    b('+0', 'jpFlag', { p: 'cheer', e: 'shout', prop: 'flag:jp', stand: true, l: 'athlete:takane' }, 0.45, { dur: 14 }),
  ], '', ['彼の声は、翌日まで戻らなかった。'], ['FLAG DETECTED: JAPAN']),
  m('notebook', 'random', LOOK.student, 'mainUpper', [20, 160], [
    b('+0', 'notebook', { p: 'write', e: 'serious', prop: 'clipboard', l: 'down' }, 0.4, { dur: 24, say: '（試技の記録を全部つけている）' }),
  ], '', ['彼女は、陸上部のマネージャーだった。', 'ノートには、全員の試技が書いてあった。'], ['NOTE TAKING', 'DATA: COMPLETE']),
  m('coffee', 'random', { build: 'adult', top: 'coat', color: 0x6f747e, extras: ['glasses'] }, 'backUpper', [10, 170], [
    b('+0', 'coffee', { p: 'sit', e: 'neutral', prop: 'coffee', l: 'field' }, 0.25, { dur: 30 }),
  ], '', ['コーヒーは、最後まで熱かった。'], ['BEVERAGE DETECTED']),
  m('cheerGirl', 'random', { female: true, build: 'slim', top: 'tshirt', color: 0xffd23f, hair: 'pony' }, 'front', [10, 170], [
    b('+0', 'cheerGirl', { p: 'clap', e: 'laugh', stand: true, l: 'field' }, 0.4, { dur: 12 }),
  ], '', ['彼女は、隣の高校の棒高跳びの選手だった。'], []),
  m('worker', 'random', LOOK.suitM, 'back', [10, 160], [
    b('+0', 'worker', { p: 'clipboard', e: 'sigh', prop: 'clipboard', l: 'down' }, 0.3, { dur: 20, say: '（見積書）' }),
    b('+20', 'worker', { p: 'cheer', e: 'shout', stand: true, l: 'field' }, 0.6, { dur: 4, key: true, say: '……うおお！' }),
  ], '', ['見積書は、結局家で書いた。'], ['OFFICE WORK DETECTED']),
  m('sneeze', 'comedy', { build: 'adult', top: 'hoodie', color: 0x5f5e3f }, 'back', [20, 170], [
    b('+0', 'sneeze', { p: 'sit', e: 'worried', l: 'field' }, 0.3, { dur: 3 }),
    b('+3', 'sneeze', { p: 'coverMouth', e: 'shout', l: 'down' }, 0.55, { dur: 1.2, key: true, say: 'へっくし！' }),
    b('+4.5', 'sneeze', { p: 'sit', e: 'sigh', l: 'field' }, 0.35, { dur: 5 }),
  ], '', ['くしゃみは、ちょうど静まりかえった瞬間だった。'], ['SOUND EVENT']),
  m('lostKid', 'sad', { build: 'kid', top: 'tshirt', color: 0xc47394, hair: 'bob', female: true }, 'nearMain', [30, 120], [
    b('+0', 'lostKid', { p: 'sit', e: 'sad', stand: true, l: 'none' }, 0.55, { dur: 10, say: 'ママ……？' }),
    b('+10', 'lostKid', { p: 'cheer', e: 'laugh', stand: true, l: 'none' }, 0.8, { dur: 4, key: true, say: 'ママ！' }),
  ], '', ['ママは、トイレの列に並んでいた。'], ['CHILD ALONE', 'EMOTION: CHANGING']),
  m('ramen', 'comedy', LOOK.bigM, 'curveE', [30, 160], [
    b('+0', 'ramen', { p: 'eat', e: 'eat', prop: 'coffee', l: 'down' }, 0.35, { dur: 22, say: '（カップラーメン）' }),
  ], '', ['お湯は、売店で分けてもらった。'], ['FOOD: NOODLES (66%)']),
  m('rival', 'random', { build: 'adult', top: 'jacket', color: 0x1d7a4a }, 'curveW', [60, 170], [
    b('+0', 'rival', { p: 'armsCrossed', e: 'serious', l: 'field' }, 0.35, { dur: 30, say: '……来年は、俺が跳ぶ。' }),
  ], '', ['彼は、予選で落ちた選手だった。', '翌年、決勝に残った。'], ['ATHLETE? (58%)']),
  m('dance', 'comedy', { female: true, build: 'adult', top: 'tshirt', color: 0x39e6ff }, 'curveE', [30, 160], [
    b('+0', 'dance', { p: 'cheer', e: 'laugh', stand: true, l: 'field' }, 0.5, { dur: 12, say: '（ずっと踊っている）' }),
  ], '', ['彼女は、何の曲で踊っていたのか、最後まで分からなかった。'], ['MOTION: DANCE (81%)']),
  m('nap2', 'comedy', { build: 'kid', top: 'hoodie', color: 0x7ea9d6 }, 'back', [40, 170], [
    b('+0', 'nap2', { p: 'sleep', e: 'sleep', l: 'none' }, 0.4, { dur: 40 }),
  ], '', ['その子は、表彰式で起きた。'], ['CHILD: SLEEPING']),
  m('cameraDad', 'random', { build: 'big', top: 'jacket', color: 0x3a3a44, extras: ['cap'] }, 'front', [30, 170], [
    b('+0', 'cameraDad', { p: 'binoculars', e: 'serious', prop: 'camera', l: 'field' }, 0.45, { dur: 20, hint: 'glint', say: '（連写の音）' }),
  ], '', ['彼は、その日 2,400 枚撮った。', 'ピントが合っていたのは、3 枚だった。'], ['CAMERA DETECTED', 'COMPETITOR?']),
  m('earlyLeave', 'random', { build: 'adult', top: 'coat', color: 0x4a4030 }, 'backUpper', [120, 150], [
    b('+0', 'earlyLeave', { p: 'sit', e: 'sigh', stand: true, l: 'field' }, 0.4, { dur: 6, say: '終電が……' }),
  ], '', ['彼は、駅のテレビで大会新記録を見た。'], []),
  m('twins', 'random', { build: 'kid', top: 'tshirt', color: 0xff3d7f, hair: 'pony', female: true }, 'curveW', [20, 160], [
    b('+0', 'twins', { p: 'clap', e: 'laugh', l: 'field' }, 0.4, { dur: 20 }),
    b('+0', 'twinsB', { p: 'clap', e: 'laugh', l: 'field' }, 0.4, { dur: 20 }),
  ], '', ['双子は、同じタイミングで同じことを言った。'], ['DUPLICATE PERSON (??%)'], { cast: [{ role: 'twinsB', look: { build: 'kid', top: 'tshirt', color: 0xff3d7f, hair: 'pony', female: true }, seat: { pairOf: 'twins' } }] }),
  m('umbrella', 'comedy', { build: 'elder', top: 'cardigan', color: 0x5a6a7a, hair: 'bald' }, 'back', [40, 160], [
    b('+0', 'umbrella', { p: 'shadeEyes', e: 'thoughtful', l: 'sky' }, 0.4, { dur: 10, say: '……雨、降るかね。' }),
  ], '', ['その夜、雨は降らなかった。'], ['WEATHER CHECK']),
  m('moonLover', 'nature', { female: true, build: 'adult', top: 'long', color: 0xb8b0e0, hair: 'long' }, 'mainUpper', [60, 175], [
    b('+0', 'moonLover', { p: 'phone', e: 'love', prop: 'phone', l: 'moon' }, 0.5, { dur: 15, hint: 'glint', say: '（月を撮っている）' }),
  ], '', ['彼女のスマホの月は、白い点だった。'], ['MOON PHOTOGRAPHER']),
  m('hotdog', 'comedy', LOOK.tourist, 'nearMain', [30, 160], [
    b('+0', 'hotdog', { p: 'eat', e: 'eat', prop: 'bento', l: 'field' }, 0.35, { dur: 15 }),
    b('+15', 'hotdog', { p: 'cheer', e: 'shout', stand: true, l: 'field' }, 0.55, { dur: 4 }),
  ], '', ['彼は、観光で来ただけだった。', '棒高跳びのファンになって帰った。'], ['TOURIST (79%)']),
  m('scoreboardGuy', 'comedy', { build: 'adult', top: 'tshirt', color: 0x6f747e }, 'back', [30, 170], [
    b('+0', 'scoreboardGuy', { p: 'sit', e: 'thoughtful', l: 'board' }, 0.3, { dur: 30, say: '……リプレイ、まだかな。' }),
  ], '', ['彼は、大型ビジョンばかり見ていた。'], ['ATTENTION: SCREEN']),
  m('oldCouple', 'romance', LOOK.grandma, 'back', [20, 170], [
    b('+0', 'oldCouple', { p: 'sit', e: 'smile', l: 'field' }, 0.35, { dur: 20 }),
    b('+20', 'oldCouple', { p: 'sit', e: 'love', l: 'npc:oldCoupleB' }, 0.6, { dur: 5, key: true, say: '……あなたも昔、跳んだわね。' }),
    b('+20', 'oldCoupleB', { p: 'chin', e: 'smile', l: 'npc:oldCouple' }, 0.6, { dur: 5, say: '1 メートル 20 な。' }),
  ], '', ['二人は、高校の陸上部で出会った。', '50 年前のことだった。'], ['ELDERLY COUPLE', 'NOSTALGIA (77%)'], { cast: [{ role: 'oldCoupleB', look: { build: 'elder', hair: 'gray', hairColor: H[4], top: 'jacket', color: 0x5a5a64 }, seat: { pairOf: 'oldCouple' } }] }),
  m('fanDad', 'family', LOOK.dad, 'curveE', [60, 175], [
    b('+0', 'fanDad', { p: 'cheer', e: 'shout', stand: true, l: 'athlete:takane' }, 0.5, { dur: 10 }),
  ], '', ['彼は、高嶺と同じ町の出身だった。', '会ったことは、一度もない。'], []),
  m('typing', 'random', LOOK.student, 'backUpper', [20, 170], [
    b('+0', 'typing', { p: 'phone', e: 'serious', prop: 'phone', l: 'fixed' }, 0.35, { dur: 25, hint: 'glint', say: '（速報を書いている）' }),
  ], '', ['彼女の速報記事は、テレビより 4 秒早かった。'], ['JOURNALIST? (61%)']),
  m('silentFan', 'sad', { build: 'slim', top: 'coat', color: 0x202127 }, 'backUpper', [80, 170], [
    b('+0', 'silentFan', { p: 'sit', e: 'sad', l: 'athlete:salas' }, 0.45, { dur: 30, say: '……ディエゴ。' }),
  ], '', ['彼は、サラスの最初のコーチだった。'], ['SADNESS DETECTED']),
  m('bigWin', 'random', { build: 'adult', top: 'tshirt', color: 0x2a3d6e }, 'curveW', [150, 170], [
    b('+0', 'bigWin', { p: 'cheer', e: 'laugh', stand: true, l: 'field' }, 0.6, { dur: 12 }),
  ], '', ['彼は、自分が勝ったみたいに喜んでいた。'], []),
  m('vendor', 'staff', LOOK.vendor, 'nearMain', [20, 160], [
    b('+0', 'vendor', { p: 'talk', e: 'shout', stand: true, prop: 'coffee', l: 'camera' }, 0.45, { dur: 12, say: 'ビールいかがですかー' }),
  ], 'ビールの売り子さんも……。', ['売り子は、その夜 214 杯売った。'], ['VENDOR', 'BEER (??%)'], { rows: [3, 12] }),
];

// ---- フィールドの小さな物語（審判・スタッフ）: 役はフィールドの人に付ける（cast は無し）
export const FIELD = [
  { id: 'judgeBirds', cat: 'judge', weight: 5, title: '鳥を見る審判', label: 'Judge Watching Birds', cast: [], beats: [
    { t: 101, r: 'officialL', a: { l: 'birds', e: 'surprised' }, v: 0.75, em: 0.5, dur: 6, key: true, hint: 'face' },
    { t: 107, r: 'officialL', a: { l: 'field', e: 'serious' }, v: 0.3, dur: 2 },
  ], onAir: ['審判も……鳥を見ていますね。'], ai: ['JUDGE DETECTED', 'ATTENTION: BIRDS'], epilogue: { stage: 'seat', lines: ['その審判は、実は日本野鳥の会の会員だった。'] } },
  { id: 'judgeSmile', cat: 'judge', weight: 4, title: '一瞬笑う審判', label: 'A Judge Smiles', cast: [], beats: [
    { t: 'takane#2.res+1', r: 'judge2', a: { e: 'smile', p: 'write' }, v: 0.65, em: 0.5, dur: 2.5, key: true },
    { t: 'takane#4.res+1', r: 'judge2', a: { e: 'cry', p: 'write' }, v: 0.9, em: 0.8, dur: 4, key: true },
  ], onAir: ['審判、少し笑った……？'], ai: ['JUDGE DETECTED', 'SMILE (63%)'], epilogue: { stage: 'seat', lines: ['審判も、ずっと高嶺を応援していた。', '顔には出さないように、している。'] } },
  { id: 'crewNap', cat: 'staff', weight: 3, title: '眠いスタッフ', label: 'Sleepy Bar Crew', cast: [], beats: [
    { t: 70, r: 'crewA', a: { p: 'sleep', e: 'sleep', l: 'none' }, v: 0.5, em: 0.2, dur: 6, say: '……' },
    { t: 76, r: 'crewA', a: { p: 'stand', e: 'surprised', l: 'field' }, v: 0.45, dur: 2 },
  ], onAir: [], ai: ['STAFF DETECTED', 'ALERTNESS: LOW'], epilogue: { stage: 'seat', lines: ['彼は、朝 5 時からバーを運んでいた。'] } },
  { id: 'photogFlash', cat: 'staff', weight: 3, title: 'カメラマン仲間', label: 'Fellow Photographer', cast: [], beats: [
    { t: 'takane#3.cross', r: 'photogA', a: { p: 'binoculars', e: 'serious', prop: 'camera', l: 'bar' }, v: 0.5, dur: 3, hint: 'glint' },
    { t: 'takane#4.cross', r: 'photogA', a: { p: 'binoculars', e: 'serious', prop: 'camera', l: 'bar' }, v: 0.6, dur: 3, hint: 'glint', key: true },
  ], onAir: [], ai: ['PHOTOGRAPHER', 'COMPETITOR DETECTED'], epilogue: { stage: 'seat', lines: ['写真部のカメラマンは、同じ瞬間を撮っていた。', '翌朝の新聞の一面は、彼の写真だった。'] } },
];

export const ALL_STORIES = [...MAJOR, ...MINOR, ...FIELD];
