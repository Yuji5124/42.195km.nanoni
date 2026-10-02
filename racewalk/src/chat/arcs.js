// コメント欄の小さな物語（同時にいくつも進む）。名前のある常連が、時間・レースの状況・今までの出来事で動く。
//   step: { if(x) → 進める条件, do(x) → 発言, gap → 前の段から最低何秒あける }
//   x = LiveChatSystem: x.t / x.ctx（レース: rem pos finished place dq heat ccu …）/ x.flags（出来事の記録）
//       x.say(id, text, opts) / x.antiSay(id, text) / x.superchat({...}) / x.join(id) / x.system(text) / x.anyOf(arch)

export const ARCS = [
  // ---- 古参もち vs 新規ぴよ（ずっと喧嘩 → 最後だけ休戦）
  {
    id: 'oldnew',
    steps: [
      {
        if: (x) => x.t > 9,
        do: (x) => {
          x.say('mochi', '15万人になる前から見てる。今日は本当に勝ってほしい', { hl: true });
          x.say('piyo', '↑絶対最近登録しただろ', { delay: 2.2, hl: true });
        },
      },
      {
        gap: 9,
        if: () => true,
        do: (x) => {
          x.say('mochi', '@ぴよ@新規 1000人の時からいるわ');
          x.say('piyo', '@もち 証拠は？', { delay: 2.4 });
          x.say('mochi', '@ぴよ@新規 伝説の寝たふり回リアタイしてる', { delay: 5.2 });
          x.say('piyo', '@もち それ切り抜きで見た', { delay: 7.8 });
          x.say('jikkyo', '古参と新規、第1ラウンド終了', { delay: 10 });
        },
      },
      {
        gap: 70,
        if: (x) => x.t > 150,
        do: (x) => {
          x.say('piyo', '古参ってだけで偉そう');
          x.say('mochi', '@ぴよ@新規 新規は黙って応援しろ', { delay: 2.5 });
          x.say('kenka', '@もち @ぴよ@新規 お前ら二人とも黙れ', { delay: 5 });
          x.say('jikkyo', '第2ラウンド、喧嘩上等が乱入', { delay: 7 });
        },
      },
      {
        if: (x) => x.ctx.rem < 175 && !x.ctx.finished && !x.ctx.dq,
        do: (x) => {
          x.say('mochi', '@ぴよ@新規 今日だけは休戦な', { hl: true });
          x.say('piyo', '@もち おう。いけえええ', { delay: 1.8, hl: true });
        },
      },
      {
        if: (x) => x.ctx.finished || x.ctx.dq,
        do: (x) => {
          x.say('piyo', '@もち 古参の人、おつかれ', { delay: 5 });
          x.say('mochi', '@ぴよ@新規 新規もな', { delay: 7.5, hl: true });
        },
      },
    ],
  },

  // ---- アンチ太郎（名指し → 最後だけ応援してしまう）
  {
    id: 'taro',
    steps: [
      { if: (x) => x.t > 16, do: (x) => x.antiSay('taro', 'こいつ競歩下手じゃね？') },
      { gap: 60, if: (x) => x.t > 105 && !x.flags.antiReplied, do: (x) => x.antiSay('taro', 'まだ歩いてんの？もうやめれば') },
      { gap: 40, if: (x) => x.ctx.rem < 900 && x.ctx.rem > 480, do: (x) => x.antiSay('taro', '{s}、どうせ最後抜かれる') },
      {
        if: (x) => x.ctx.rem < 112 && !x.ctx.dq,
        do: (x) => {
          if ((x.flags.talkBack ?? 0) >= 2) x.say('taro', '……走るなよ', { hl: true });
          else {
            x.say('taro', '……がんばれ', { hl: true });
            x.say('taro', 'いや今のは誤爆', { delay: 3 });
            x.say('watch', 'アンチ太郎が応援してて草', { delay: 4.4 });
          }
        },
      },
      {
        if: (x) => x.ctx.finished || x.ctx.dq,
        do: (x) => {
          const p = x.ctx.place;
          const s = x.ctx.dq ? 'ほらな（ちょっと泣いた）' : p === 1 ? '……普通にすごいじゃん' : p <= 3 ? 'まあ、悪くなかったんじゃね' : 'まあ、決勝出てるだけすごいけど';
          x.say('taro', s, { delay: 6, hl: true });
        },
      },
    ],
  },

  // ---- 初見のりょう（だんだんファンになる）
  {
    id: 'ryo',
    steps: [
      {
        if: (x) => x.t > 28,
        do: (x) => {
          x.say('ryo', '初見です。競歩ってなに？');
          x.say('gachi', '@りょう 走ったら失格の陸上。どちらかの足が常に地面についてないとダメ', { delay: 3.2 });
        },
      },
      { gap: 40, if: (x) => x.t > 82, do: (x) => x.say('ryo', '歩いてるのに速くて草') },
      { gap: 50, if: (x) => x.t > 170, do: (x) => x.say('ryo', 'なんか応援したくなってきた') },
      {
        gap: 30,
        if: (x) => x.t > 240 || (x.flags.funny ?? 0) >= 3,
        do: (x) => {
          x.say('ryo', 'チャンネル登録しました', { hl: true });
          x.system('りょう さんがチャンネル登録しました', { delay: 0.6 });
        },
      },
      { if: (x) => x.ctx.rem < 230 && !x.ctx.finished && !x.ctx.dq, do: (x) => x.say('ryo', 'がんばれええええ', { hl: true }) },
      {
        if: (x) => x.ctx.finished || x.ctx.dq,
        do: (x) => {
          x.system('🎉 りょう さんがメンバーになりました', { delay: 9 });
          x.say('ryo', '初見でメンバーになりました。最高でした', { delay: 10.5, hl: true });
        },
      },
    ],
  },

  // ---- お金（¥500 → ¥5,000 → 石油王 ¥10,000 → ¥50,000 → 十万円の男 ¥100,000）
  {
    id: 'money',
    steps: [
      { if: (x) => x.t > 38, do: (x) => x.superchat({ viewerId: x.anyOf('shinki'), amount: 500, msg: 'がんばれ！' }) },
      { gap: 30, if: (x) => x.t > 96, do: (x) => x.superchat({ viewerId: 'mika', amount: 5000, msg: '本当に疲れてないんですか？' }) },
      {
        gap: 30,
        if: (x) => x.t > 158,
        do: (x) => {
          x.join('oil');
          x.superchat({ viewerId: 'oil', amount: 10000, msg: '今日は真面目にやってください' });
          x.say(x.anyOf('kosan'), '石油王きた', { delay: 2 });
          x.say(x.anyOf('shoken'), '石油王！？', { delay: 3.2 });
        },
      },
      { if: (x) => x.ctx.rem < 390 && !x.ctx.dq, do: (x) => x.superchat({ viewerId: 'oil', amount: 50000, msg: '絶対優勝してください' }) },
      {
        gap: 7,
        if: (x) => x.ctx.rem < 300 && x.ctx.rem > 130 && !x.ctx.dq,
        do: (x) => {
          x.join('jyuman');
          x.superchat({ viewerId: 'jyuman', amount: 100000, msg: '転んでください', troll: true });
        },
      },
      {
        if: (x) => x.ctx.finished && x.ctx.place === 1,
        do: (x) => x.superchat({ viewerId: 'oil', amount: 50000, msg: '約束どおり、もう一回。おめでとう', delay: 8 }),
      },
    ],
  },

  // ---- ROM専の佐藤（41 か月、一度もコメントしなかった）
  {
    id: 'rom',
    steps: [
      {
        if: (x) => x.ctx.rem < 106 && x.ctx.rem > 12 && !x.ctx.dq,
        do: (x) => {
          x.say('rom', '初コメです。頑張って', { hl: true });
          x.say('watch', '初コメがここ', { delay: 2 });
          x.say('kusa', 'ROM専が喋った', { delay: 3 });
          x.say('mochi', '古参より古参かもしれん', { delay: 5 });
        },
      },
    ],
  },

  // ---- アユムの母（本物）
  {
    id: 'haha',
    steps: [
      {
        if: (x) => x.flags.fell || x.t > 215,
        do: (x) => {
          x.join('haha');
          x.say('haha', x.flags.fell ? '歩、ちゃんと前見なさい' : '歩、ちゃんと水飲みなさい', { hl: true });
          x.say(x.anyOf('shinki'), '母！？', { delay: 1.8 });
          x.say('kusa', 'お母さん来た', { delay: 2.6 });
          x.say('watch', '本物で草', { delay: 3.4 });
        },
      },
      { gap: 30, if: (x) => x.ctx.rem < 270 && !x.ctx.finished && !x.ctx.dq, do: (x) => x.say('haha', '歩、がんばれ。晩ごはんカレーよ', { hl: true }) },
      { if: (x) => x.ctx.finished || x.ctx.dq, do: (x) => x.say('haha', x.ctx.dq ? 'おつかれさま。カレーあるよ' : 'おつかれさま。よく歩いたね', { delay: 7.5, hl: true }) },
    ],
  },

  // ---- 質問マン（ガチ勢とルール警察が答える）
  {
    id: 'q',
    steps: [
      {
        if: (x) => x.t > 60,
        do: (x) => {
          x.say('q', '競歩ってなんで走っちゃダメなの？');
          x.say('gachi', '@質問マン 走ったら競歩じゃないから', { delay: 3 });
          x.say('kusa', '正論で草', { delay: 4.5 });
        },
      },
      {
        gap: 80,
        if: (x) => x.t > 200,
        do: (x) => {
          x.say('q', 'ペナルティゾーンってなに？');
          x.say('police', '@質問マン 赤カード3枚で入る。そこで決められた時間待つ', { delay: 3 });
          x.say('q', 'アユムは何枚？', { delay: 5 });
          x.say('police', '@質問マン {reds}枚', { delay: 7 });
        },
      },
    ],
  },

  // ---- 同業配信者（同接が大きくなると来る）
  {
    id: 'yu',
    steps: [
      {
        if: (x) => x.ctx.ccu > 280000,
        do: (x) => {
          x.join('yu');
          x.say('yu', '同接えぐ。コラボしよ', { hl: true });
          x.say('kusa', '同業来てて草', { delay: 2 });
        },
      },
      { if: (x) => x.ctx.finished || x.ctx.dq, do: (x) => x.say('yu', 'おつかれ。同接ちょっと分けて', { delay: 10, hl: true }) },
    ],
  },

  // ---- アンチ次郎（炎上を聞いて来る）
  {
    id: 'jiro',
    steps: [
      {
        if: (x) => x.ctx.heat > 6,
        do: (x) => {
          x.join('jiro');
          x.antiSay('jiro', '炎上してると聞いて');
        },
      },
      { gap: 25, if: (x) => x.ctx.heat > 7, do: (x) => x.antiSay('jiro', '競歩より炎上の方が速い') },
    ],
  },

  // ---- モデレーター猫
  {
    id: 'mod',
    steps: [
      { if: (x) => x.ctx.heat > 5.5, do: (x) => x.say('mod', '喧嘩はやめましょう', { kind: 'mod' }) },
      { gap: 15, if: (x) => (x.flags.talkBack ?? 0) >= 1, do: (x) => x.system('モデレーター猫 が アンチ太郎 をタイムアウトしました') },
      { gap: 30, if: (x) => x.ctx.heat > 8.5, do: (x) => x.say('mod', '低速モードにしたいけどできません', { kind: 'mod' }) },
    ],
  },

  // ---- 真壁さん推し
  {
    id: 'makafan',
    steps: [
      { if: (x) => x.t > 46, do: (x) => x.say('makafan', '真壁さん映して') },
      { gap: 60, if: (x) => x.t > 140, do: (x) => x.say('makafan', '真壁さんの方がフォームきれい') },
      { if: (x) => x.ctx.finished, do: (x) => x.say('makafan', x.ctx.place === 1 ? '真壁さんに勝つとは……おめでとう' : '真壁さん、そしてアユムもおつかれ', { delay: 9, hl: true }) },
    ],
  },

  // ---- しょうがくせい
  {
    id: 'kid',
    steps: [
      {
        if: (x) => x.t > 50,
        do: (x) => {
          x.say('kid', 'いま何位ー？');
          x.say('reisei', '@しょうがくせい {pos}位', { delay: 2.6 });
        },
      },
      { gap: 100, if: (x) => (x.flags.funny ?? 0) >= 2, do: (x) => x.say('kid', 'さっきのもう1回やって') },
      { if: (x) => x.ctx.finished || x.ctx.dq, do: (x) => x.say('kid', 'ぼくも競歩やる！', { delay: 8, hl: true }) },
    ],
  },

  // ---- Mike
  {
    id: 'mike',
    steps: [
      { if: (x) => x.t > 20, do: (x) => x.say('mike', 'GO AYUMU!! from Ohio') },
      { gap: 90, if: (x) => (x.flags.funny ?? 0) >= 1, do: (x) => x.say('mike', 'why is he like this lol') },
      { if: (x) => x.ctx.rem < 300 && !x.ctx.dq, do: (x) => x.say('mike', 'COME ON AYUMUUUU') },
      { if: (x) => x.ctx.finished || x.ctx.dq, do: (x) => x.say('mike', x.ctx.dq ? 'what happened??' : x.ctx.place === 1 ? 'CHAMPION!!!' : 'GG AYUMU', { delay: 5, hl: true }) },
    ],
  },

  // ---- 競歩ガチ勢の締め
  {
    id: 'gachiEnd',
    steps: [{ if: (x) => x.ctx.finished || x.ctx.dq, do: (x) => x.say('gachi', (x.flags.funny ?? 0) >= 4 ? 'いいレースだった（レースは）' : 'いいレースだった', { delay: 11, hl: true }) }],
  },
];
