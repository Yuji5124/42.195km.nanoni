// ACTION / REACTION の定義（データ）。左の欄に、状況に合わせて 3〜6 個だけ出る。
//   押さなくてもいい。真面目に歩けば勝てる。ただ「押したら絶対面白くなる」ものが混ざっている。
//
//   ctx     … 出る状況: normal / fatigue / trip / anti / superchat / final / penalty / after / dq
//   when(c) … さらに条件（c = ActionSystem.ctx）
//   race    … レースへの効果（RaceSim.mods）: stop 秒 / speed [倍率, 秒] / form [浮き+, 膝+, 秒] / trip [加算, 秒] /
//             focus 秒 / run 秒 / lie 秒 / back 秒 / distract [強さ, 秒] / arm [種類, 秒] / energy / water
//   stream  … 配信への効果: buzz（同接の伸び）/ heat（炎上）/ trust（信頼）/ fun
//   say     … 配信者（アユム）のセリフ（{anti} {sc} {amount} {wrong} {rival} が入る）
//   event   … コメント欄へ送るイベント（LiveChatSystem が人格ごとに反応する）
//   tempt   … 誘惑（光る・コメント欄が「押せ」と騒ぐ）
//   max     … 1 回の配信で押せる回数（同じ事件を繰り返してもレースが終わらないように）

export const ACTIONS = [
  // ---------------- 通常
  { id: 'serious', icon: '🏃', label: '真面目に歩く', ctx: ['normal', 'fatigue', 'anti', 'superchat'], cd: 10, race: { focus: 11 }, stream: { buzz: 0, trust: 0.03 }, say: ['……（集中）', '……よし。', '（無言でフォームを整える）'], event: 'FOCUS', expr: ['serious', 11] },
  { id: 'wave', icon: '👋', label: '手を振る', ctx: ['normal', 'fatigue'], cd: 7, race: { speed: [0.9, 2.4], arm: ['wave', 2.4], form: [0, 0.05, 2.4] }, stream: { buzz: 0.06, fun: 0.12, trust: 0.01 }, say: ['はーい！見えてますかー！', 'みんなー！', '手、振っときます！'], event: 'WAVE', expr: ['smile', 2.6] },
  { id: 'thumb', icon: '👍', label: 'カメラにグッド', ctx: ['normal'], cd: 7, race: { speed: [0.92, 1.8], arm: ['thumb', 1.8] }, stream: { buzz: 0.05, fun: 0.1 }, say: ['いい感じです！', 'グッドです！', '今日、調子いいです。'], event: 'THUMB', expr: ['smile', 2] },
  { id: 'yoyu', icon: '😎', label: '「余裕です」', ctx: ['normal', 'fatigue'], cd: 9, stream: { buzz: 0.08, fun: 0.15 }, say: ['余裕です。', 'まだ余裕あります。', '正直、余裕ですね。'], event: 'YOYU', expr: ['smile', 2.4], lie: true },
  { id: 'look', icon: '📱', label: 'コメントを見る', ctx: ['normal', 'trip', 'fatigue', 'penalty', 'dq'], cd: 6, race: { speed: [0.9, 3], arm: ['phone', 3], distract: [1, 3.2] }, stream: { buzz: 0.04, fun: 0.06 }, say: ['えーと、コメント…', 'ちょっとコメント見ます', '{read}'], event: 'READ_CHAT', expr: ['neutral', 3] },
  { id: 'weird', max: 5, icon: '🐧', label: '変な歩き方をする', ctx: ['normal', 'fatigue'], cd: 18, tempt: true, race: { speed: [0.93, 4], form: [0.22, 0.42, 4], trip: [0.06, 4], arm: ['flap', 4] }, stream: { buzz: 0.34, heat: 0.5, fun: 0.45, trust: -0.04 }, say: ['ペンギン歩き！', 'はい、モデル歩き！', '新フォーム、見てください！'], event: 'TROLL_ACTION', expr: ['laugh', 4], clip: '決勝で変な歩き方' },

  // ---------------- 疲労（コメント欄が「疲れてる？」と言い出したら）
  { id: 'deny', icon: '🙂', label: '「全然疲れてません」', ctx: ['fatigue', 'final', 'after'], cd: 8, stream: { buzz: 0.12, fun: 0.2 }, say: ['全然疲れてません！', '疲れ？なんですかそれ。', '全然疲れてないですよ？'], event: 'DENY_FATIGUE', expr: ['smile', 3], lie: true, clip: '全然疲れてない男' },
  { id: 'smile', icon: '😁', label: '笑顔を作る', ctx: ['fatigue'], cd: 9, stream: { buzz: 0.09, fun: 0.12 }, say: ['（ニッコリ）', '（満面の笑み）'], event: 'FORCED_SMILE', expr: ['smile', 5] },
  { id: 'genki', max: 4, icon: '💪', label: '急に元気アピール', ctx: ['fatigue'], cd: 14, tempt: true, race: { speed: [1.04, 3], energy: -0.03, form: [0.22, 0, 3], arm: ['flex', 1.8] }, stream: { buzz: 0.24, fun: 0.3, heat: 0.2 }, say: ['まだまだいけます！！', 'はい元気ー！！', 'ここからが本番です！！'], event: 'GENKI', expr: ['shout', 2.4], clip: '急に元気になる男' },
  { id: 'silent', icon: '😐', label: '無言で歩く', ctx: ['fatigue'], cd: 12, race: { focus: 7 }, stream: { buzz: -0.02, trust: 0.03 }, say: ['……', '…………'], event: 'SILENT', expr: ['sigh', 7] },
  { id: 'water', icon: '💧', label: '水を飲む', ctx: ['*'], when: (c) => c.nearWater && !c.drinkLap, cd: 3, race: { water: true }, stream: { buzz: 0.02 }, say: ['水、もらいます', 'ちょっと水を'], event: 'WATER_ACTION', expr: ['neutral', 2] },

  // ---------------- つまずいた
  { id: 'poker', icon: '😶', label: '何事もなかった顔', ctx: ['trip'], cd: 4, stream: { buzz: 0.15, fun: 0.2 }, say: ['（何事もなかった顔）', '……はい。'], event: 'POKER_FACE', expr: ['neutral', 4] },
  { id: 'lol', icon: '🤣', label: '自分で爆笑', ctx: ['trip'], cd: 4, race: { speed: [0.9, 2.5] }, stream: { buzz: 0.28, fun: 0.4, trust: 0.03 }, say: ['あはははは！！今の見た！？', 'やばいやばいやばい（笑）', 'ふふっ…あはははは！'], event: 'SELF_LAUGH', expr: ['laugh', 3] },
  { id: 'enshutsu', max: 4, icon: '🎬', label: '「今のは演出です」', ctx: ['trip'], cd: 4, tempt: true, stream: { buzz: 0.4, heat: 0.8, fun: 0.4 }, say: ['今のは演出です。', 'はい、今のは演出でーす。', '台本通りです。'], event: 'ENSHUTSU', expr: ['smile', 2.5], clip: '「今のは演出です」' },
  { id: 'kire', icon: '😠', label: '地面にキレる', ctx: ['trip'], cd: 4, race: { speed: [0.88, 2], arm: ['point', 1.6] }, stream: { buzz: 0.34, heat: 0.6, fun: 0.3, trust: -0.05 }, say: ['なんだこの地面！！', 'おい地面！！', 'トラックが悪い！トラックが！'], event: 'ANGRY_GROUND', expr: ['shout', 2.2], clip: '地面にキレる競歩選手' },
  { id: 'back2', icon: '🏃', label: '真面目に戻る', ctx: ['trip'], cd: 4, race: { focus: 9 }, stream: { buzz: 0, trust: 0.04 }, say: ['……集中します。', 'よし、戻ります。'], event: 'FOCUS', expr: ['serious', 9] },

  // ---------------- アンチ（{anti} が名指しで書いてきた）
  { id: 'ignore', icon: '🙉', label: '無視', ctx: ['anti'], cd: 3, stream: { buzz: 0, heat: -0.6, trust: 0.04 }, say: [], event: 'IGNORE_ANTI', expr: ['serious', 2] },
  { id: 'laughoff', icon: '😄', label: '笑って流す', ctx: ['anti'], cd: 4, stream: { buzz: 0.12, heat: 0.2, fun: 0.15 }, say: ['効いてないです〜', 'はいはい、ありがとうございます〜', '{anti}さん今日も来てくれてありがとう！'], event: 'LAUGH_OFF', expr: ['smile', 2] },
  { id: 'reply', max: 5, icon: '🗣', label: (c) => `${c.anti?.name ?? 'アンチ'}に反応する`, ctx: ['anti'], when: (c) => !!c.anti, cd: 6, tempt: true, race: { distract: [1, 2.6], speed: [0.9, 2.6] }, stream: { buzz: 0.55, heat: 2.2, fun: 0.4, trust: -0.03 }, say: ['{anti}さん、じゃああなた決勝来れます？', '{anti}さん、見てるならチャンネル登録して？', '{anti}さん、今どこにいます？僕は決勝です。'], event: 'ANTI_REPLY', expr: ['smile', 2.5], clip: 'アンチに反応してしまう' },
  { id: 'talkback', max: 4, icon: '😤', label: '言い返す', ctx: ['anti'], when: (c) => !!c.anti, cd: 8, tempt: true, race: { distract: [1.2, 3], speed: [0.86, 3], form: [0.08, 0.12, 3] }, stream: { buzz: 0.65, heat: 3.0, fun: 0.4, trust: -0.08 }, say: ['{anti}さん、競歩なめないでもらえます！？', 'うるさいな！今忙しいんだよ！', '{anti}さん！ゴールしたら話しましょう！'], event: 'TALK_BACK', expr: ['shout', 2.6], clip: 'アンチに言い返す（決勝中）' },
  { id: 'helpfans', icon: '🙏', label: 'ファンに助けを求める', ctx: ['anti'], cd: 10, stream: { buzz: 0.38, heat: 1.4, fun: 0.25 }, say: ['みんな、なんか言ってやって！', 'ファンのみんな、頼む！', '誰か{anti}さんに説明してあげて！'], event: 'CALL_FANS', expr: ['worried', 2] },

  // ---------------- スパチャ（{sc} さんから {amount}）
  { id: 'readsc', icon: '📖', label: (c) => (c.sc ? `スパチャを読む（¥${c.sc.amount.toLocaleString('en-US')}）` : 'スパチャを読む'), ctx: ['superchat', 'final', 'penalty'], when: (c) => !!c.sc, cd: 4, race: { arm: ['phone', 2.2], distract: [0.8, 2.4], speed: [0.9, 2.4] }, stream: { buzz: 0.14, trust: 0.03, fun: 0.1 }, say: ['{sc}さん、{amount}円ありがとうございます！「{msg}」', '{sc}さん！{amount}円！「{msg}」……ありがとうございます！'], event: 'READ_SC', expr: ['smile', 2.5] },
  { id: 'ignoresc', icon: '🙈', label: '無視する', ctx: ['superchat'], when: (c) => !!c.sc, cd: 3, stream: { buzz: 0.04, heat: 0.35 }, say: [], event: 'IGNORE_SC', expr: ['serious', 2] },
  { id: 'thanks', max: 5, icon: '🙇', label: '大げさに感謝', ctx: ['superchat'], when: (c) => !!c.sc, cd: 6, race: { speed: [0.84, 2.2], form: [0, 0.22, 2.2], arm: ['bow', 2.2] }, stream: { buzz: 0.3, fun: 0.35, trust: 0.02 }, say: ['{sc}さあああん！！ありがとうございまああああす！！', '一生ついていきます{sc}さん！！'], event: 'THANKS_BIG', expr: ['laugh', 2.4] },
  { id: 'wrongname', max: 5, icon: '🤔', label: '名前を間違える', ctx: ['superchat'], when: (c) => !!c.sc, cd: 6, tempt: true, stream: { buzz: 0.44, heat: 0.9, fun: 0.45 }, say: ['{wrong}さん、ありがとうございます！', 'あっ{wrong}さん！いつもありがとう！'], event: 'WRONG_NAME', expr: ['smile', 2], clip: 'スパチャの名前を間違える' },
  { id: 'stopread', max: 3, icon: '🛑', label: '立ち止まって読む', ctx: ['superchat'], when: (c) => !!c.sc, cd: 12, tempt: true, race: { stop: 4.2, arm: ['phone', 4.2] }, stream: { buzz: 0.85, heat: 1.2, fun: 0.6, trust: -0.04 }, say: ['えー……{sc}さん、{amount}円。「{msg}」。……ありがとうございます。', '（立ち止まって）{sc}さん、ちゃんと読ませてください。'], event: 'STOP_READ', expr: ['neutral', 4], clip: '決勝中に立ち止まってスパチャを読む' },

  // ---------------- ラスト 1 周
  { id: 'focus', icon: '🔥', label: '競技に集中', ctx: ['final'], cd: 6, race: { focus: 14 }, stream: { buzz: 0.02, trust: 0.06 }, say: ['……行きます。', '（無言）', 'ここからは、真面目にやります。'], event: 'FOCUS_FINAL', expr: ['serious', 14] },
  { id: 'wave2', icon: '👋', label: 'カメラに手を振る', ctx: ['final'], cd: 6, race: { speed: [0.9, 2.2], arm: ['wave', 2.2] }, stream: { buzz: 0.1, fun: 0.18 }, say: ['見ててくださいね！', 'みんな見てるー！？'], event: 'WAVE', expr: ['smile', 2.2] },
  { id: 'reply2', max: 3, icon: '🗣', label: 'アンチに反応する', ctx: ['final'], when: (c) => !!c.anti, cd: 6, tempt: true, race: { distract: [1, 2.4], speed: [0.88, 2.4] }, stream: { buzz: 0.6, heat: 2.4, fun: 0.4, trust: -0.05 }, say: ['{anti}さん、見てて！今から勝つから！', '{anti}さん、ゴールで待ってて！'], event: 'ANTI_REPLY', expr: ['smile', 2.2], clip: 'ラスト 1 周でアンチに反応' },
  { id: 'sleep', icon: '😴', label: 'ここで寝たふりをする', ctx: ['final'], when: (c) => c.rem < 135 && c.rem > 20, once: true, cd: 99, tempt: true, big: true, race: { lie: 5.6 }, stream: { buzz: 1.7, heat: 4.2, fun: 1.2, trust: -0.1 }, say: ['……（寝たふり）', 'すやぁ……'], event: 'SLEEP_FAKE', expr: ['sleep', 5.6], clip: '残り 100m で寝たふり' },
  { id: 'run', icon: '💨', label: '走る', ctx: ['final'], when: (c) => c.rem < 260 && c.rem > 25 && c.rank > 1, once: true, cd: 99, tempt: true, race: { run: 3.2 }, stream: { buzz: 1.1, heat: 3.2, fun: 0.6, trust: -0.12 }, say: ['うおおおおおお！！', '走ります！！！'], event: 'RUN', expr: ['shout', 3.2], clip: '競歩なのに走った' },

  // ---------------- 途中の誘惑（条件つき・1 回だけ）
  { id: 'peace', icon: '✌️', label: '審判にピース', ctx: ['*'], when: (c) => c.nearJudge && c.rem > 200, once: true, cd: 30, tempt: true, race: { arm: ['peace', 1.8], speed: [0.9, 1.8], attention: 0.35 }, stream: { buzz: 0.34, heat: 0.6, fun: 0.4 }, say: ['審判さーん！ピース！', '（審判にピース）'], event: 'PEACE_JUDGE', expr: ['smile', 2], clip: '審判にピースする男' },
  { id: 'rival', icon: '📸', label: '真壁を映す', ctx: ['*'], when: (c) => c.nearMakabe && c.rem > 300, once: true, cd: 30, race: { arm: ['point', 1.6], speed: [0.92, 1.6] }, stream: { buzz: 0.18, fun: 0.2 }, say: ['はい、日本記録保持者の真壁さんです！', '真壁さーん！カメラ見てくださーい！'], event: 'FILM_RIVAL', expr: ['smile', 2], rivalCam: 3.4 },
  { id: 'backward', icon: '🔙', label: '後ろ向きで歩く', ctx: ['normal'], when: (c) => c.rem < 1700 && c.rem > 500, once: true, cd: 40, tempt: true, race: { back: 4.5, trip: [0.08, 4.5] }, stream: { buzz: 0.75, heat: 1.4, fun: 0.6, trust: -0.05 }, say: ['ここで後ろ向き歩き！', 'うしろ、見えてます！'], event: 'BACKWARD', expr: ['laugh', 4.5], clip: '決勝で後ろ向きに歩く' },
  { id: 'hype', icon: '📣', label: '観客をあおる', ctx: ['normal', 'fatigue'], when: (c) => c.homeStraight && c.rem > 400, cd: 30, race: { arm: ['hype', 2], speed: [0.88, 2] }, stream: { buzz: 0.2, fun: 0.3 }, say: ['もっと声くださーい！！', 'スタンドのみなさーん！！'], event: 'HYPE_CROWD', expr: ['shout', 2], crowd: true },

  // ---------------- ペナルティゾーン（30 秒止まる。配信的には雑談タイム）
  { id: 'chatter', icon: '💬', label: '雑談する', ctx: ['penalty'], cd: 6, stream: { buzz: 0.22, fun: 0.3 }, say: ['えー、今ペナルティゾーンです。初めて入りました。', 'ここ、意外と居心地いいですね。', '今日の晩ごはん、何にしようかな。'], event: 'PENALTY_TALK', expr: ['smile', 3] },
  { id: 'stretch', icon: '🧘', label: 'ストレッチ', ctx: ['penalty'], cd: 8, race: { energy: 0.03, arm: ['stretch', 3] }, stream: { buzz: 0.06, trust: 0.02 }, say: ['今のうちに伸ばしておきます', '……（ストレッチ）'], event: 'STRETCH', expr: ['neutral', 3] },
  { id: 'protest', max: 3, icon: '📢', label: '審判に抗議する', ctx: ['penalty', 'dq'], cd: 10, race: { attention: 0.3, arm: ['point', 2] }, stream: { buzz: 0.5, heat: 2.2, fun: 0.3, trust: -0.06 }, say: ['今の浮いてないですって！！', '審判さん！ちゃんと見てました！？'], event: 'PROTEST', expr: ['shout', 2.4], clip: '審判に抗議' },
  { id: 'readall', icon: '📜', label: 'コメントを全部読む', ctx: ['penalty'], cd: 8, race: { arm: ['phone', 4] }, stream: { buzz: 0.3, fun: 0.35 }, say: ['えー、コメント読みます。「{read}」', '全部読みます。「{read}」'], event: 'READ_CHAT', expr: ['neutral', 4] },

  // ---------------- フィニッシュの後 / 失格
  { id: 'collapse', icon: '🫠', label: '倒れ込む', ctx: ['after'], once: true, cd: 99, race: { lie: 6 }, stream: { buzz: 0.25, fun: 0.3 }, say: ['……（倒れ込む）', 'はぁ……はぁ……'], event: 'COLLAPSE', expr: ['sigh', 6] },
  { id: 'shout', icon: '📣', label: 'カメラに叫ぶ', ctx: ['after'], cd: 6, stream: { buzz: 0.2, fun: 0.3 }, say: ['見たかああああ！！', 'ありがとうございましたああ！！'], event: 'FINISH_SHOUT', expr: ['shout', 2.5] },
  { id: 'subscribe', icon: '🔔', label: '「チャンネル登録お願いします」', ctx: ['after', 'dq'], once: true, cd: 99, stream: { buzz: 0.18, fun: 0.1, trust: -0.01 }, say: ['チャンネル登録、お願いします！！', '高評価とチャンネル登録、よろしくお願いします！'], event: 'ASK_SUB', expr: ['smile', 2.5], subs: true },
  { id: 'handshake', icon: '🤝', label: '真壁と握手', ctx: ['after'], when: (c) => c.nearMakabe, once: true, cd: 99, race: { arm: ['shake', 2.5] }, stream: { buzz: 0.2, trust: 0.08, fun: 0.15 }, say: ['真壁さん、ありがとうございました！', '真壁さん、また一緒に歩きましょう。'], event: 'HANDSHAKE', expr: ['smile', 3] },
  { id: 'cry', icon: '😭', label: '泣く', ctx: ['after', 'dq'], once: true, cd: 99, stream: { buzz: 0.22, trust: 0.06, fun: 0.1 }, say: ['……（泣いている）', 'すみません……ちょっと……'], event: 'CRY', expr: ['cry', 6] },
  { id: 'enshutsu2', icon: '🎬', label: '「今のは演出です」', ctx: ['dq'], once: true, cd: 99, stream: { buzz: 0.45, heat: 1.2, fun: 0.5 }, say: ['今のは演出です。', '失格まで、全部台本です。'], event: 'ENSHUTSU', expr: ['smile', 2.5], clip: '失格も演出' },
];

export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

// 状況の名前（欄の見出し）
export const CTX_LABEL = {
  normal: '通常',
  fatigue: '疲れてる？',
  trip: 'つまずいた！',
  anti: 'アンチ',
  superchat: 'スパチャ',
  final: 'ラスト 1 周',
  last100: 'ラスト 100m',
  penalty: 'ペナルティゾーン',
  after: 'フィニッシュ後',
  dq: '失格',
};

// 各状況で「真面目」な選択肢（いつも上に出す）
export const SERIOUS = { normal: 'serious', fatigue: 'serious', trip: 'back2', anti: 'ignore', superchat: 'serious', final: 'focus' };
