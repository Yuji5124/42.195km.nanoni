// Vertical Slice（前半 45 分 ≒ 実時間 3 分 45 秒）の時系列。t = キックオフからの実時間（秒）。
//
// MOMENTS … 試合の見せ場（MatchDirector）。t はシュートの時刻。scorerIndex は MatchSim の背番号順（10 = SAMURAI / NANONI）
// STORY   … 席探しの出来事（SoccerMode）。試合と同じ時計で起きる。
//
// 感情の流れ: 0:00 肉眼「これ無理だろ」→ 0:50 双眼鏡「いけそう」→ 1:50 ゴール「見えない。」→ 2:30 失点
//            → 3:10 決定機（WATCH MATCH の誘惑）→ 3:30 追加点 → 45 分 → 見つけて座った瞬間に前半終了の笛。

export const HALF_SECONDS = 228;

export const MOMENTS = [
  { t: 16, team: 'home', outcome: 'wide', final: 'through' },
  { t: 40, team: 'away', outcome: 'save', final: 'cross' },
  { t: 72, team: 'home', outcome: 'over', final: 'long' },
  { t: 112, team: 'home', outcome: 'goal', final: 'cross', scorerIndex: 10 },
  { t: 158, team: 'away', outcome: 'goal', final: 'through', scorerIndex: 10 },
  { t: 190, team: 'home', outcome: 'post', final: 'corner', big: true, scorerIndex: 2 },
  { t: 214, team: 'home', outcome: 'goal', final: 'through', scorerIndex: 9, big: true },
  { t: 250, team: 'away', outcome: 'save', final: 'long' },
  { t: 275, team: 'home', outcome: 'wide', final: 'cross' },
  { t: 300, team: 'away', outcome: 'save', final: 'through' },
];

// ヒント: 100,000 → UPPER（約 7 万）→ NORTH（約 1.9 万）→ BLOCK 4?（約 1.1 万）→ ROW 1?（約 2 千）
// 文の {LEVEL} {SIDE} {BD}（ブロックの十の位）{RD}（列の十の位）などは、あなたの席から埋める（seed で席が変わっても正しい）
// who: neighbor（隣の客）/ pa（場内放送）/ vision（大型ビジョン）/ ticket（チケット）/ staff（係員）
export const STORY = [
  { t: 7, type: 'line', who: 'me', text: '（100,000 席……の中の 1 席？）' },
  { t: 26, type: 'hint', key: 'level', who: 'neighbor', text: 'そのチケット、{COLOR}の帯ですね。{COLOR}は{LEVEL_JP}（{LEVEL}）ですよ。' },
  { t: 46, type: 'binoculars', who: 'neighbor', text: '……使います？ 双眼鏡。' },
  { t: 64, type: 'wave' },
  { t: 92, type: 'hint', key: 'side', who: 'pa', text: '♪ ピンポンパーン　{SIDE_JP}ゲート（{SIDE}）からご入場のお客様へ、お席のご案内です……' },
  { t: 130, type: 'crowdcam' },
  { t: 138, type: 'hint', key: 'block', who: 'me', text: '今ビジョンに映ったの、「{BD}」から始まるブロックだった……？' },
  { t: 172, type: 'hint', key: 'row', who: 'neighbor', text: 'チケット、ちょっと見せて。……列は {ROW_JP}（ROW {RD}）ですね、にじんでるけど。' },
  { t: 182, type: 'wave', from: 0.9 },
  { t: 205, type: 'line', who: 'neighbor', text: '今日の試合、最高ですね。' },
  { t: 208, type: 'line', who: 'me', text: 'そうですね。' },
  { t: 262, type: 'staff' }, // まだ見つかっていなければ係員が案内（必ず終われる）
];

// 進展がない時のヒント（Adaptive Hint）: 同じものは 1 回だけ
export const NUDGES = [
  { who: 'neighbor', text: '双眼鏡、指で広げると（ピンチ）もっと寄れますよ。', need: 'binoculars' },
  { who: 'pa', text: '♪ {SIDE_JP}スタンド{LEVEL_JP}、ブロック {BD}0 番台のお客様へ……', need: 'block' },
  { who: 'neighbor', text: '列の番号は、通路の階段に書いてありますよ。', need: 'row' },
  { who: 'me', text: '（空いてる席は、背もたれの色が見えるはず……）', need: 'any' },
];

// 1 回目のプレイは必ずこの席（42.195）。2 回目からは seed で変わる
export const FIRST_SEAT = { block: 42, row: 19, seat: 5 };
