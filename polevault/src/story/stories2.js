// 物語の追加（100 本を超えるための 2 冊目）。形は stories.js と同じ。
//   event: 人のいない出来事（流れ星・飛行機・ウェーブ・照明のちらつき・猫）。PoleVaultMode が予定に入れる。
//   シリーズの他の種目（42.195km・トランポリン・サッカー・ボクシング）から来た人も少し混ぜる。

import { SKINS, HAIRS } from '../people/Figure.js';

const S = SKINS;
const H = HAIRS;

function m(id, cat, look, zone, win, beats, onAir, epi, ai = [], extra = {}) {
  return {
    id,
    cat,
    weight: extra.weight ?? 2,
    title: extra.title ?? id,
    label: extra.label ?? id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
    cast: look ? [{ role: id, look, seat: { zone, rows: extra.rows ?? [0, 20], dx: extra.dx }, label: extra.who ?? '観客' }, ...(extra.cast ?? [])] : [],
    beats,
    win,
    onAir: onAir ? [onAir] : [],
    ai,
    epilogue: epi ? { stage: extra.stage ?? 'seat', lines: epi } : null,
    conflicts: extra.conflicts ?? [],
    event: extra.event ?? null,
    major: extra.major ?? false,
  };
}
const b = (t, r, a, v = 0.5, more = {}) => ({ t, r, a, v, em: more.em ?? v * 0.6, dur: more.dur ?? 5, ...more });

export const EXTRA_STORIES = [
  // ---- シリーズの他の種目から
  m('marathoner', 'random', { build: 'slim', top: 'singlet', bottom: 'shorts', color: 0xd0283c, hair: 'short', extras: ['cap'], acc: 0xffffff }, 'back', [20, 150], [
    b('+0', 'marathoner', { p: 'stretch', e: 'sigh', l: 'field' }, 0.45, { dur: 6, say: '……はあ、はあ。' }),
    b('+6', 'marathoner', { p: 'sit', e: 'smile', l: 'field' }, 0.4, { dur: 20 }),
  ], 'ランニングの格好の方も。', ['彼は、新宿からここまで走ってきた。', '42.195km だった。'], ['RUNNER DETECTED', 'FATIGUE: HIGH'], { weight: 3 }),
  m('trampoliner', 'comedy', { build: 'adult', top: 'tshirt', color: 0x39e6ff }, 'curveE', [20, 160], [
    b('+0', 'trampoliner', { p: 'fidget', e: 'laugh', l: 'field' }, 0.45, { dur: 18, say: '（座席で跳ねている）' }),
  ], '', ['彼は、トランポリンの選手だった。', '座席でも、少し跳ねてしまう。'], ['BOUNCE DETECTED']),
  m('seatSearch', 'comedy', { build: 'adult', top: 'jacket', color: 0x1c3f9e, extras: ['scarf'], acc2: 0x1c3f9e }, 'back', [30, 140], [
    b('+0', 'seatSearch', { p: 'phone', e: 'worried', stand: true, prop: 'phone', l: 'fixed' }, 0.5, { dur: 9, hint: 'stand', say: '……席、ここで合ってる？' }),
    b('+9', 'seatSearch', { p: 'sit', e: 'smile', l: 'field' }, 0.45, { dur: 6, say: '（合ってた）' }),
  ], '', ['席は、合っていた。', '前に一度、10 万人の中から自分の席を探したことがある。'], ['TICKET CHECK', 'CONFUSION (72%)']),
  m('shadowBoxer', 'comedy', { build: 'big', top: 'hoodie', color: 0xd0283c }, 'curveW', [30, 160], [
    b('+0', 'shadowBoxer', { p: 'fist', e: 'serious', l: 'field' }, 0.45, { dur: 14, say: 'シュッ、シュッ' }),
  ], '', ['彼は、来月タイトルマッチがある。', '応援の時も、ジャブが出る。'], ['FIGHTING STANCE?', 'THREAT: LOW']),
  // ---- 家族・人
  m('lateArrival', 'random', { build: 'adult', top: 'coat', color: 0x6f747e }, 'back', [90, 130], [
    b('+0', 'lateArrival', { p: 'sit', e: 'worried', stand: true, l: 'field' }, 0.5, { dur: 4, hint: 'stand', say: 'すみません、通ります……' }),
    b('+4', 'lateArrival', { p: 'sit', e: 'sigh', l: 'field' }, 0.45, { dur: 6, say: '間に合った……' }),
  ], '', ['最初の 2 時間、彼は渋滞の中にいた。'], ['LATE ARRIVAL']),
  m('birthday', 'random', { female: true, build: 'adult', top: 'tshirt', color: 0xffd23f, hair: 'long' }, 'back', [30, 160], [
    b('+0', 'birthday', { p: 'holdSign', e: 'laugh', stand: true, prop: 'sign:HAPPY\nBIRTHDAY', l: 'camera' }, 0.6, { dur: 10, hint: 'face' }),
  ], 'お誕生日の方がいるようです。', ['誕生日のサトシは、隣の席にいた。', 'ボードには、最後まで気づかなかった。'], ['TEXT: HAPPY BIRTHDAY', 'CAKE: NOT FOUND']),
  m('firstDate', 'romance', { female: false, build: 'slim', top: 'long', color: 0x7ea9d6 }, 'curveE', [20, 150], [
    b('+0', 'firstDate', { p: 'sit', e: 'worried', l: 'field' }, 0.35, { dur: 14 }),
    b('+0', 'firstDateB', { p: 'sit', e: 'neutral', l: 'field' }, 0.35, { dur: 14 }),
    b('+14', 'firstDate', { p: 'sit', e: 'love', l: 'npc:firstDateB' }, 0.6, { dur: 3, key: true }),
    b('+17', 'firstDateB', { p: 'sit', e: 'love', l: 'npc:firstDate' }, 0.6, { dur: 3, say: '（目が合った）' }),
  ], '', ['二回目のデートも、陸上の試合だった。'], ['TWO PERSONS', 'AWKWARD (88%)'], { cast: [{ role: 'firstDateB', look: { female: true, build: 'slim', top: 'cardigan', color: 0xf2d0d8, hair: 'bob' }, seat: { pairOf: 'firstDate' } }] }),
  m('visitDay', 'sad', { build: 'adult', top: 'jacket', color: 0x3a4a3a }, 'back', [30, 160], [
    b('+0', 'visitDay', { p: 'sit', e: 'smile', l: 'npc:visitKid' }, 0.45, { dur: 10, say: 'ジュース、いる？' }),
    b('+0', 'visitKid', { p: 'sit', e: 'neutral', l: 'field' }, 0.4, { dur: 10 }),
    b('+10', 'visitKid', { p: 'cheer', e: 'laugh', stand: true, l: 'field' }, 0.6, { dur: 4, key: true }),
  ], '', ['月に一度の、面会の日だった。', '来月も来る約束をした。'], ['ADULT + CHILD'], { cast: [{ role: 'visitKid', look: { build: 'kid', top: 'hoodie', color: 0x2f8f4f }, seat: { pairOf: 'visitDay' } }] }),
  m('nurse', 'random', { female: true, build: 'slim', top: 'cardigan', color: 0xa8d8e8, hair: 'bun' }, 'mainUpper', [60, 170], [
    b('+0', 'nurse', { p: 'sit', e: 'sigh', l: 'field', prop: 'coffee' }, 0.4, { dur: 20, say: '（夜勤まであと 1 時間）' }),
  ], '', ['彼女は、夜勤の前に少しだけ寄った。', '病院の休憩室でも、録画を見た。'], ['TIRED (67%)']),
  m('security', 'staff', { build: 'big', top: 'jacket', color: 0x2a2a30, extras: ['cap'], acc: 0xffd23f }, 'front', [0, 10], [
    b('+0', 'security', { p: 'behindBack', e: 'serious', stand: true, l: 'camera' }, 0.35, { dur: 170, say: '（観客の方を向いている）' }),
  ], '警備の方、ずっと客席の方を向いています。', ['彼は、試合を一度も見られなかった。', '歓声で、だいたい分かった。'], ['SECURITY STAFF', 'SPORT VISIBILITY: 0%'], { weight: 3, rows: [0, 0] }),
  m('cleaner', 'staff', { build: 'elder', top: 'long', color: 0x4a6a8a, extras: ['cap'] }, 'backUpper', [100, 170], [
    b('+0', 'cleaner', { p: 'stand', e: 'neutral', stand: true, l: 'field' }, 0.35, { dur: 30 }),
  ], '', ['彼は、明日の朝 5 時にここを掃除する。', '今日は、少し早く来て試合を見た。'], ['STAFF?']),
  m('statistician', 'random', { build: 'slim', top: 'long', color: 0x5a5a64, extras: ['glasses'] }, 'mainUpper', [40, 170], [
    b('+0', 'statistician', { p: 'write', e: 'thoughtful', prop: 'clipboard', l: 'down' }, 0.4, { dur: 25, say: '優勝確率 73.2%……' }),
  ], '', ['彼の計算は、だいたい外れた。'], ['CALCULATION DETECTED']),
  m('kidSign', 'family', { build: 'kid', top: 'tshirt', color: 0xff9ac8, hair: 'pony', female: true }, 'curveE', [20, 170], [
    b('+0', 'kidSign', { p: 'holdSign', e: 'laugh', stand: true, prop: 'sign:わたしも\nとぶ', l: 'athlete:takane' }, 0.55, { dur: 16 }),
  ], '', ['彼女は、20 年後、この競技場で跳んだ。'], ['TEXT DETECTED', 'FUTURE ATHLETE (31%)']),
  m('drunk', 'comedy', { build: 'big', top: 'tshirt', color: 0xc9702f }, 'curveW', [40, 170], [
    b('+0', 'drunk', { p: 'cheer', e: 'laugh', stand: true, l: 'sky' }, 0.5, { dur: 8, say: 'いけー！（何かに）' }),
    b('+8', 'drunk', { p: 'sleep', e: 'sleep', l: 'none' }, 0.45, { dur: 12 }),
  ], '', ['彼は、どの選手が勝ったか覚えていない。', 'とても楽しかったことだけ、覚えている。'], ['BALANCE: UNSTABLE']),
  m('boredTeen', 'random', { female: true, build: 'slim', top: 'hoodie', color: 0x202127, hair: 'long' }, 'back', [10, 30], [
    b('+0', 'boredTeen', { p: 'phone', e: 'sigh', prop: 'phone', l: 'fixed' }, 0.35, { dur: 140, hint: 'glint', say: '（動画を見ている）' }),
    b('takane#4.run-1', 'boredTeen', { p: 'coverMouth', e: 'surprised', stand: true, l: 'athlete:takane' }, 0.9, { dur: 10, key: true }),
  ], '', ['彼女は、次の春、陸上部に入った。'], ['PHONE DETECTED', 'ATTENTION SHIFT']),
  m('pamphletMic', 'comedy', { build: 'adult', top: 'tshirt', color: 0xd9dde4 }, 'nearMain', [20, 160], [
    b('+0', 'pamphletMic', { p: 'talk', e: 'shout', l: 'field' }, 0.5, { dur: 14, say: '助走に入りましたー！（実況のまね）' }),
  ], '', ['彼は、実況アナウンサー志望だった。', '今日の実況は、本物より少し上手かった。'], ['COMMENTARY DETECTED (?)']),
  m('luckyCharm', 'family', { female: true, build: 'elder', top: 'cardigan', color: 0x9a6a5a, hair: 'gray', hairColor: H[5] }, 'curveE', [10, 170], [
    b('+0', 'luckyCharm', { p: 'pray', e: 'pray', l: 'field' }, 0.5, { dur: 20, say: '（お守りを握っている）' }),
  ], '', ['お守りは、近所の神社のものだった。', '効いたのかどうかは、分からない。'], ['PRAYING (79%)']),
  m('anotherCam', 'comedy', { build: 'big', top: 'jacket', color: 0x2a2a2e, extras: ['headset'] }, 'backUpper', [10, 170], [
    b('+0', 'anotherCam', { p: 'binoculars', e: 'serious', prop: 'camera', l: 'camera' }, 0.55, { dur: 30, hint: 'glint', say: '（こっちを撮っている）' }),
  ], '……向こうのカメラ、こちらを撮っています。', ['彼は、別の局のカメラマンだった。', 'その日の視聴率は、3.2% だった。'], ['CAMERA DETECTED', 'RIVAL STATION (81%)'], { weight: 3 }),
  m('grandsonCall', 'family', { female: true, build: 'elder', top: 'cardigan', color: 0x7a5a8a, hair: 'gray', hairColor: H[5] }, 'back', [20, 160], [
    b('+0', 'grandsonCall', { p: 'phone', e: 'laugh', prop: 'phone', l: 'fixed' }, 0.45, { dur: 15, hint: 'glint', say: 'ほら、見える？ 競技場よ〜' }),
  ], '', ['孫は、画面の 9 割が彼女の顔だったと言った。'], ['VIDEO CALL']),
  m('loneMan', 'sad', { build: 'adult', top: 'suit', color: 0x2a2e3a, pants: 0x2a2e3a }, 'backUpper', [20, 120], [
    b('+0', 'loneMan', { p: 'sit', e: 'sigh', l: 'field', prop: 'coffee' }, 0.4, { dur: 30 }),
    b('takane#4.res', 'loneMan', { p: 'cheer', e: 'cry', stand: true, l: 'sky' }, 0.95, { dur: 6, key: true }),
  ], '', ['彼は、今日会社を辞めた。', '明日から何をするかは、まだ決めていない。', '少しだけ、跳べる気がした。'], ['SUIT DETECTED', 'EMOTION: COMPLEX']),
  m('doctorPager', 'random', { build: 'adult', top: 'coat', color: 0xe8e8e8, extras: ['glasses'] }, 'back', [20, 60], [
    b('+0', 'doctorPager', { p: 'sit', e: 'neutral', l: 'field' }, 0.3, { dur: 60 }),
    b('takane#4.ready-6', 'doctorPager', { p: 'phone', e: 'worried', stand: true, prop: 'phone', l: 'fixed' }, 0.7, { dur: 5, key: true, hint: 'glint', say: '……はい。すぐ行きます。' }),
  ], '', ['急患だった。', '彼は、大会新記録をラジオで聞きながら走った。'], ['PAGER EVENT']),
  m('bookReader', 'comedy', { female: true, build: 'slim', top: 'cardigan', color: 0x5f5e3f, hair: 'bob', extras: ['glasses'] }, 'backUpper', [10, 170], [
    b('+0', 'bookReader', { p: 'clipboard', e: 'thoughtful', l: 'down' }, 0.35, { dur: 60, say: '（ずっと本を読んでいる）' }),
  ], '', ['本は、とても面白かった。', '試合も、少しだけ見た。'], ['BOOK DETECTED']),
  m('tallGuess', 'comedy', { build: 'adult', top: 'tshirt', color: 0x2a62c9 }, 'curveE', [60, 170], [
    b('+0', 'tallGuess', { p: 'point', e: 'surprised', l: 'bar' }, 0.45, { dur: 6, say: '6 メートルって、電柱くらい？' }),
    b('+6', 'tallGuess', { p: 'chin', e: 'thoughtful', l: 'bar' }, 0.4, { dur: 8, say: '……キリン 1 頭ぶんくらい？' }),
  ], '', ['正解は、キリン 1 頭と少し、だった。'], ['QUESTION DETECTED']),
  m('groupSelfie', 'random', { female: true, build: 'slim', top: 'tshirt', color: 0xc47394, hair: 'long' }, 'curveW', [20, 170], [
    b('+0', 'groupSelfie', { p: 'phone', e: 'laugh', stand: true, prop: 'phone', l: 'fixed' }, 0.45, { dur: 8, hint: 'glint' }),
    b('+0', 'groupSelfieB', { p: 'wave', e: 'laugh', stand: true, l: 'npc:groupSelfie' }, 0.45, { dur: 8 }),
  ], '', ['写真は 14 枚撮った。', '全部、目をつぶっている人がいた。'], ['GROUP DETECTED'], { cast: [{ role: 'groupSelfieB', look: { female: true, build: 'adult', top: 'tshirt', color: 0xffd23f, hair: 'bob' }, seat: { pairOf: 'groupSelfie' } }] }),
  m('mexFamily', 'family', { build: 'big', top: 'tshirt', color: 0x1d7a4a }, 'back', [40, 80], [
    b('salas#1.run-1', 'mexFamily', { p: 'pray', e: 'pray', l: 'athlete:salas' }, 0.6, { dur: 7, key: true }),
    b('salas#1.res', 'mexFamily', { p: 'handsOnHead', e: 'sad', l: 'athlete:salas' }, 0.7, { dur: 6, key: true, say: 'Diego……' }),
    b('salas#1.res+6', 'mexFamily', { p: 'clap', e: 'smile', stand: true, l: 'athlete:salas' }, 0.7, { dur: 5, say: '¡Bravo!' }),
  ], '', ['サラスの家族は、メキシコから来た。', '来年も、来るつもりだ。'], ['FAMILY? (66%)']),
  m('gerFans', 'random', { build: 'big', top: 'tshirt', color: 0x24262e, hair: 'buzz', hairColor: 0xc9a25a, skin: S[0] }, 'curveE', [10, 100], [
    b('keller#2.run-1', 'gerFans', { p: 'lean', e: 'serious', l: 'athlete:keller' }, 0.5, { dur: 7 }),
    b('keller#2.res', 'gerFans', { p: 'handsOnHead', e: 'sad', l: 'athlete:keller' }, 0.6, { dur: 6, key: true, say: 'Nein……' }),
  ], '', ['彼らは、ケラーの大学の友人だった。', 'その夜、ケラーと焼き鳥を食べた。'], ['GROUP: GERMANY (58%)']),
  m('signSplit', 'comedy', { build: 'adult', top: 'tshirt', color: 0xd0283c }, 'back', [10, 20], [
    b('+0', 'signSplit', { p: 'sit', e: 'neutral', prop: 'board:大会', l: 'field' }, 0.3, { dur: 140 }),
    b('+0', 'signSplitB', { p: 'sit', e: 'neutral', prop: 'board:新記録', l: 'field' }, 0.3, { dur: 140 }),
    b('takane#4.res', 'signSplit', { p: 'holdSign', e: 'laugh', stand: true, prop: 'board:大会' }, 1.0, { dur: 8, key: true, if: 'clear' }),
    b('takane#4.res', 'signSplitB', { p: 'holdSign', e: 'laugh', stand: true, prop: 'board:新記録' }, 1.0, { dur: 8, if: 'clear' }),
    b('takane#4.res', 'signSplit', { p: 'sit', e: 'sad', prop: 'board:大会' }, 0.8, { dur: 8, key: true, if: 'fail' }),
  ], '', ['二人は、この日のために 2 枚のボードを作った。', '片方だと、ただの「大会」だった。'], ['TEXT: SPLIT', 'MEANING: INCOMPLETE'], { cast: [{ role: 'signSplitB', look: { build: 'adult', top: 'tshirt', color: 0xd0283c, female: true, hair: 'bob' }, seat: { pairOf: 'signSplit' } }] }),
  m('exVaulter', 'sad', { female: true, build: 'slim', top: 'jacket', color: 0x2b62c9, hair: 'pony' }, 'mainUpper', [30, 170], [
    b('+0', 'exVaulter', { p: 'armsCrossed', e: 'serious', l: 'bar' }, 0.45, { dur: 25 }),
    b('takane#4.cross', 'exVaulter', { p: 'coverMouth', e: 'cry', stand: true, l: 'bar' }, 0.9, { dur: 6, key: true }),
  ], '', ['彼女は、けがで競技をやめた棒高跳びの選手だった。', '今でも、助走の歩数を覚えている。'], ['FORMER ATHLETE (49%)']),
  m('studentsClub', 'athlete', LOOK_STUDENT(), 'curveW', [20, 170], [
    b('+0', 'studentsClub', { p: 'talk', e: 'serious', l: 'npc:studentsClubB' }, 0.45, { dur: 12, say: '踏み切り、ボックスから 4 メートル……' }),
    b('+0', 'studentsClubB', { p: 'chin', e: 'thoughtful', l: 'bar' }, 0.45, { dur: 12, say: '握りが高い……' }),
  ], '', ['陸上部の二人は、帰りの電車で棒高跳びの絵を描いた。'], ['STUDENTS (85%)', 'ANALYSIS DETECTED'], { cast: [{ role: 'studentsClubB', look: LOOK_STUDENT(), seat: { pairOf: 'studentsClub' } }] }),
  m('mascotHat', 'comedy', { build: 'adult', top: 'tshirt', color: 0xffd23f, extras: ['beanie'], acc2: 0xff3d7f }, 'curveE', [10, 170], [
    b('+0', 'mascotHat', { p: 'cheer', e: 'laugh', stand: true, l: 'camera' }, 0.5, { dur: 12, hint: 'face' }),
  ], '', ['帽子は、自分で編んだ。'], ['HAT: UNUSUAL']),
  m('coldHands', 'random', { female: true, build: 'adult', top: 'coat', color: 0x8a6a5a, hair: 'long', extras: ['scarf'], acc2: 0xd0283c }, 'backUpper', [30, 170], [
    b('+0', 'coldHands', { p: 'clap', e: 'sigh', l: 'field' }, 0.35, { dur: 14, say: '……寒い。' }),
  ], '', ['夜の競技場は、思ったより寒かった。'], ['TEMPERATURE: LOW (?)']),
  m('radioGrandpa', 'random', { build: 'elder', top: 'jacket', color: 0x5a6a4a, hair: 'gray', hairColor: H[4], extras: ['cap'] }, 'curveW', [10, 170], [
    b('+0', 'radioGrandpa', { p: 'phone', e: 'thoughtful', prop: 'phone', l: 'field' }, 0.4, { dur: 30, say: '（ラジオの実況を聞いている）' }),
  ], '', ['ラジオの方が、2 秒早かった。'], ['AUDIO DEVICE']),
  m('blanketPair', 'romance', { female: true, build: 'adult', top: 'coat', color: 0xd8c8a8, hair: 'long' }, 'back', [20, 170], [
    b('+0', 'blanketPair', { p: 'sit', e: 'love', l: 'field' }, 0.4, { dur: 30 }),
    b('+0', 'blanketPairB', { p: 'sit', e: 'smile', l: 'npc:blanketPair' }, 0.4, { dur: 30 }),
  ], '', ['ブランケットは、一枚しかなかった。'], ['TWO PERSONS', 'SHARED BLANKET (?)'], { cast: [{ role: 'blanketPairB', look: { build: 'adult', top: 'coat', color: 0x3a4a6a }, seat: { pairOf: 'blanketPair' } }] }),
  m('autograph', 'random', { build: 'kid', top: 'tshirt', color: 0xd0283c }, 'front', [140, 170], [
    b('+0', 'autograph', { p: 'reachUp', e: 'laugh', stand: true, prop: 'clipboard', l: 'athlete:takane' }, 0.55, { dur: 20, say: 'サインくださーい！' }),
  ], '', ['サインは、もらえた。', '「ソラ」の「ラ」が少しだけ曲がっていた。'], ['REQUEST DETECTED'], { rows: [0, 1] }),
  m('eyeMakeup', 'comedy', { female: true, build: 'adult', top: 'long', color: 0x202127, hair: 'long' }, 'mainUpper', [20, 170], [
    b('+0', 'eyeMakeup', { p: 'phone', e: 'neutral', prop: 'phone', l: 'fixed' }, 0.35, { dur: 10, hint: 'glint', say: '（スマホを鏡にしている）' }),
  ], '', ['化粧直しは、優勝の瞬間に終わった。'], ['MIRROR MODE']),
  m('bigFlag', 'random', { build: 'big', top: 'tshirt', color: 0xf4f4f4 }, 'curveW', [10, 170], [
    b('+0', 'bigFlag', { p: 'cheer', e: 'shout', stand: true, prop: 'flag:jp', l: 'field' }, 0.45, { dur: 20 }),
  ], '', ['旗の棒は、家の物干し竿だった。'], ['FLAG DETECTED']),
  m('noShow', 'sad', { build: 'adult', top: 'coat', color: 0x3a3a44 }, 'back', [10, 20], [
    b('+0', 'noShow', { p: 'sit', e: 'sigh', l: 'neighborL' }, 0.35, { dur: 150, say: '（隣の席は、空いている）' }),
  ], '', ['隣の席のチケットは、二枚目だった。', '来るはずの人は、来なかった。', 'それでも、最後まで見ていった。'], ['EMPTY SEAT NEXT TO PERSON']),
  m('heightKid', 'family', { build: 'kid', top: 'tshirt', color: 0x7ea9d6 }, 'back', [40, 160], [
    b('+0', 'heightKid', { p: 'stretch', e: 'laugh', stand: true, l: 'bar' }, 0.5, { dur: 6, say: 'バーまで届かない！' }),
  ], '', ['あと 4 メートル 92 センチだった。'], ['CHILD', 'REACH: INSUFFICIENT']),
  m('applause', 'random', { female: true, build: 'elder', top: 'cardigan', color: 0x5a7a8a, hair: 'bun', hairColor: H[4] }, 'curveE', [10, 170], [
    b('+0', 'applause', { p: 'clap', e: 'smile', l: 'field' }, 0.4, { dur: 40, say: '（失敗しても拍手している）' }),
  ], '', ['彼女は、全員に拍手した。', '失敗した選手には、少し長く。'], ['APPLAUSE: CONSTANT']),
  m('phoneLight', 'random', { build: 'adult', top: 'hoodie', color: 0x2a3d6e }, 'back', [150, 160], [
    b('takane#4.ready+3', 'phoneLight', { p: 'phone', e: 'serious', stand: true, prop: 'phone', l: 'field' }, 0.6, { dur: 12, hint: 'glint' }),
  ], '', ['彼の動画は、その夜 10 万回再生された。', 'ほとんど何も見えない動画だった。'], ['PHONE LIGHT']),
  // ---- フィールド（審判・スタッフ）
  { id: 'judgeYawn', cat: 'judge', weight: 3, title: 'あくびの審判', label: 'Thoughtful Judge', cast: [], beats: [
    { t: 85, r: 'judge2', a: { p: 'coverMouth', e: 'sigh' }, v: 0.55, em: 0.3, dur: 2.5, key: true, say: '（あくび）' },
  ], onAir: [], ai: ['JUDGE DETECTED', 'HE LOOKS THOUGHTFUL'], epilogue: { stage: 'seat', lines: ['審判は、前の晩ほとんど寝ていなかった。', '緊張して眠れなかったらしい。'] } },
  { id: 'timekeeperSync', cat: 'judge', weight: 3, title: '時計を合わせる計時員', label: 'The Timekeeper', cast: [], beats: [
    { t: 72, r: 'timekeeper', a: { p: 'clipboard', e: 'thoughtful', l: 'board' }, v: 0.5, dur: 4, say: '……1 秒ずれている。' },
    { t: 76, r: 'timekeeper', a: { p: 'fist', e: 'smile', l: 'board' }, v: 0.55, dur: 2, key: true },
  ], onAir: [], ai: ['OFFICIAL DETECTED', 'PRECISION: OBSESSIVE'], epilogue: { stage: 'seat', lines: ['計時員の腕時計は、0.01 秒もずれていない。', '30 年間、ずっと。'] } },
  { id: 'crewHigh', cat: 'staff', weight: 3, title: 'バーを上げるスタッフ', label: 'Bar Crew', cast: [], beats: [
    { t: 'takane#3.ready-1.5', r: 'crewB', a: { p: 'reachUp', e: 'serious', l: 'bar' }, v: 0.45, dur: 2.5 },
    { t: 'takane#4.ready-1', r: 'crewA', a: { p: 'reachUp', e: 'surprised', l: 'bar' }, v: 0.55, dur: 2.5, key: true, say: '……高っ。' },
  ], onAir: [], ai: ['STAFF DETECTED'], epilogue: { stage: 'seat', lines: ['バーを上げたスタッフは、6 メートル 05 を初めて間近で見た。', '首が痛くなった。'] } },
  // ---- 人のいない出来事
  m('shootingStar', 'nature', null, null, [70, 168], [], '……今、流れ星が？', ['流れ星は、0.7 秒だった。', 'あなたのカメラだけが、それを撮っていた。'], ['METEOR DETECTED', 'RARITY: EXTREME'], { event: { type: 'meteor' }, weight: 4, stage: 'sky' }),
  m('airplane', 'nature', null, null, [60, 140], [], '', ['飛行機は、羽田から札幌へ向かう最終便だった。'], ['AIRCRAFT DETECTED'], { event: { type: 'plane' }, weight: 3, stage: 'sky' }),
  m('wave', 'random', null, null, [64, 96], [], 'スタンドでウェーブが起きています。', ['ウェーブは、スタジアムを 1 周半した。', '始めたのは、小学生だった。'], ['CROWD MOTION', 'PATTERN: WAVE'], { event: { type: 'wave' }, weight: 3, stage: 'crowd' }),
  m('lightFlicker', 'random', null, null, [80, 120], [], '照明が……一瞬。', ['照明は、30 年前の電球だった。', '翌月、取り替えられた。'], ['LIGHT ANOMALY'], { event: { type: 'flicker' }, weight: 2, stage: 'sky' }),
  m('cat', 'comedy', null, null, [62, 92], [], '……猫です。', ['猫は、毎晩この競技場に来ている。', '名前は、まだない。'], ['CAT DETECTED', 'ATHLETE? (12%)'], { event: { type: 'cat' }, weight: 4, stage: 'field' }),
];

function LOOK_STUDENT() {
  return { female: false, build: 'slim', top: 'jacket', color: 0x1d2436, pants: 0x1d2436, hair: 'short', hairColor: H[0], skin: S[1] };
}
