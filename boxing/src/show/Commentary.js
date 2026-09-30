// 実況（アナ）と解説。熱い実況から、だんだん どうでもいい話へ流れていく（drift 0 → 3）。
// tracery（ISC）の「#記号# を規則で展開する」考え方の最小版（コードは写していない）。
// 選手・レフェリー・勝敗は茶化さない。痛み・けが の冗談は言わない。

const G = {
  food: ['焼きそば', 'たこ焼き', 'おにぎり', 'からあげ', 'ソフトクリーム', 'カレー'],
  thing: ['照明', 'ロープ', 'ゴング', 'リングの角', 'カメラ', '吊り下げビジョン', 'マット'],
  num: ['38', '42', '195', '11', '1,024', '48'],
};

const LINES = {
  land: [
    ['#punch#が入った！', 'クリーンヒット！', '侍、前に出る！', 'いいパンチ！'],
    ['今の#punch#、時速 #num# km くらいですかね', 'グローブの赤がきれいに見えました', '音がいいですね、今のは'],
    ['ところで売店の#food#、美味しいらしいです', '今の#punch#、#thing#も見ていました', 'いいパンチでした。#food#が食べたいです'],
    ['会場の Wi-Fi、つながりました', '私の昼ごはんは#food#でした', '#thing#の数を数えていました'],
  ],
  counter: [
    ['カウンター！！', '合わせた！見事なカウンター！', '打ち終わりを狙った！'],
    ['カウンター！ いま画面がどうなっているかは分かりません', '見えていました！ …たぶん'],
    ['カウンター！ #food#の行列も動きました', 'カウンターです。#thing#がまぶしい'],
    ['カウンター。拍手の回数を数えています', 'すごい。#num# 点'],
  ],
  perfect: [
    ['よけた！見えている！', '紙一重！', '完璧なディフェンス！'],
    ['今のよけ方、教科書に載せたいですね', '見てから よけていますね、これは'],
    ['よけ方がきれいで、部屋を片付けたくなりました', '今のよけで #thing# が揺れました'],
    ['よけました。私も午後の会議をよけたいです', 'よけ方の角度、#num# 度'],
  ],
  hit: [
    ['王者の#attack#！侍、耐える！', 'もらった！しかし侍、下がらない！', '王者、さすがの一発！'],
    ['王者のパンチ、音が重いですね', 'ここは立て直したいところ'],
    ['王者の#attack#。#food#のように しっかりしています', '王者の好きな食べ物はオムライスだそうです'],
    ['いまのは #num# 点のパンチです（私の採点）', '王者のグローブ、青いですね'],
  ],
  system: [
    ['おっと、ゲームシステムが変わりました！', '#sys#！？ 試合はそのままです！', '画面が変わっても、試合は続いています'],
    ['今度は#sys#です。もう慣れてきました', '#sys#。私の席からは普通に見えています'],
    ['#sys#ですね。はい', '次は何になるんでしょう（小声）', '#sys#。ルールは同じです。たぶん'],
    ['#sys#。', 'はい #sys#。', 'もう何でも来てください'],
  ],
  used: [['慣れてきた、その瞬間に変わります！', '慣れた！と思ったら変わる！'], ['慣れたところで変わる。そういう放送です'], ['慣れたので変えます'], ['変えます']],
  down: [['ダウン！！', 'ダウンだ！カウントが入る！'], ['ダウン！ 会場が揺れています！'], ['ダウン！ 立てるか！'], ['ダウン！']],
  getup: [['立った！立ち上がった！', 'ファイティングポーズ！まだ終わらない！'], ['立った！ 拍手が鳴りやみません'], ['立ちました！ 会場の湿度も上がっています'], ['立った！']],
  idle: [
    ['両者、慎重な立ち上がり', '王者は防衛 11 回', '侍は今日が初挑戦', 'ジャブで距離を測っています'],
    ['ここまでのパンチ数、#thrown#', '会場の気温は 24.5 度', 'カメラは#cams# 台で撮っています', '観客は 19,868 人'],
    ['リングの角は 4 つあります', 'レフェリーの靴、よく磨かれています', '観客の平均年齢は 34.2 歳だそうです', '売店の#food#、残り 12 個'],
    ['ゴング係の方、少し緊張しているそうです', '会場の Wi-Fi のパスワードは… 言えません', '実況席の水、残り 4 割です', '私、実は#food#派です'],
  ],
};

const SPEAKER = [
  ['実況', false],
  ['解説', true],
];

export class Commentary {
  constructor(hud) {
    this.hud = hud;
    this.cool = 0;
    this.idleT = 5;
    this.turn = 0;
    this.last = '';
  }

  expand(s, vars) {
    return s.replace(/#(\w+)#/g, (_, k) => {
      if (vars[k] !== undefined) return vars[k];
      const a = G[k];
      return a ? a[Math.floor(Math.random() * a.length)] : k;
    });
  }

  // kind: LINES のキー / drift: 0〜3 / force: 間隔を無視
  say(kind, drift, vars = {}, force = false) {
    if (!force && this.cool > 0) return false;
    const set = LINES[kind];
    if (!set) return false;
    const d = Math.max(0, Math.min(3, Math.floor(drift)));
    // 同じ段か 1 つ前の段からランダム（急に全部どうでもよくならない）
    const tier = set[Math.random() < 0.7 ? d : Math.max(0, d - 1)];
    let line = tier[Math.floor(Math.random() * tier.length)];
    if (line === this.last && tier.length > 1) line = tier[(tier.indexOf(line) + 1) % tier.length];
    this.last = line;
    const text = this.expand(line, vars);
    const [who, b] = SPEAKER[kind === 'idle' || d >= 2 ? this.turn++ % 2 : 0];
    this.hud.talk(who, text, { b, dur: 3.2 });
    this.cool = 2.1;
    this.idleT = 6 + Math.random() * 3;
    return true;
  }

  update(dt, drift, vars, active) {
    this.cool -= dt;
    if (!active) return;
    this.idleT -= dt;
    if (this.idleT <= 0) this.say('idle', drift, vars);
  }
}
