// 視聴者（ViewerNPC）の人格の種類と、名前のある常連たち。残りは種類ごとに名前を作って足す（合計 約 220 人）。
//   fan … ファン度 / anti … 敵意 / know … 競歩の知識 / spend … お金を使う / arg … 言い返す / humor … ふざける / concern … 心配する
//   stance … 「疲れてる？」の立場（+ = 疲れてると言う側 / - = 疲れてないと言う側）
//   rate … 何もない時にしゃべる頻度（相対）

export const ARCH = {
  kosan: { label: '古参', fan: [0.85, 1], anti: [0, 0.05], know: [0.3, 0.7], spend: [0.3, 0.8], arg: [0.4, 0.8], humor: [0.2, 0.6], concern: [0.5, 0.9], stance: -0.75, rate: 1.2, color: '#ffd23f', badge: 'member', n: 18 },
  shinki: { label: '新規', fan: [0.45, 0.8], anti: [0, 0.1], know: [0, 0.3], spend: [0.1, 0.5], arg: [0.2, 0.7], humor: [0.4, 0.9], concern: [0.3, 0.6], stance: -0.25, rate: 1.1, color: '#8fd3ff', n: 26 },
  yogo: { label: '擁護', fan: [0.7, 0.95], anti: [0, 0.05], know: [0.2, 0.6], spend: [0.2, 0.6], arg: [0.75, 1], humor: [0.1, 0.4], concern: [0.4, 0.7], stance: -0.9, rate: 0.9, color: '#b6f09c', n: 14 },
  anti: { label: 'アンチ', fan: [0, 0.1], anti: [0.7, 1], know: [0.1, 0.5], spend: [0, 0.3], arg: [0.6, 1], humor: [0.3, 0.7], concern: [0, 0.1], stance: 0.85, rate: 1.0, color: '#ff7a7a', n: 12 },
  gachi: { label: '競歩ガチ勢', fan: [0.3, 0.6], anti: [0, 0.2], know: [0.9, 1], spend: [0.1, 0.4], arg: [0.3, 0.6], humor: [0, 0.2], concern: [0.2, 0.4], stance: 0.1, rate: 0.8, color: '#9fe8ff', n: 6 },
  kids: { label: '小学生', fan: [0.6, 0.9], anti: [0, 0.1], know: [0, 0.1], spend: [0, 0.05], arg: [0.1, 0.4], humor: [0.6, 1], concern: [0.3, 0.6], stance: -0.2, rate: 1.0, color: '#ffb3e6', n: 8 },
  worry: { label: '心配性', fan: [0.6, 0.9], anti: [0, 0.05], know: [0.1, 0.4], spend: [0.2, 0.5], arg: [0.1, 0.3], humor: [0, 0.2], concern: [0.9, 1], stance: 0.3, rate: 0.7, color: '#e6c7ff', n: 9 },
  scjoren: { label: 'スパチャ常連', fan: [0.7, 1], anti: [0, 0.1], know: [0.2, 0.5], spend: [0.85, 1], arg: [0.1, 0.4], humor: [0.3, 0.7], concern: [0.4, 0.7], stance: -0.4, rate: 0.5, color: '#ffcf70', badge: 'member', n: 5 },
  calm: { label: '冷静', fan: [0.3, 0.6], anti: [0, 0.2], know: [0.5, 0.8], spend: [0.1, 0.3], arg: [0, 0.2], humor: [0, 0.2], concern: [0.2, 0.4], stance: 0, rate: 0.7, color: '#d6dbe6', n: 7 },
  fighter: { label: '喧嘩', fan: [0.2, 0.6], anti: [0.2, 0.6], know: [0.1, 0.4], spend: [0, 0.2], arg: [0.95, 1], humor: [0.2, 0.5], concern: [0, 0.2], stance: 0.4, rate: 0.9, color: '#ff9f5a', n: 9 },
  shoken: { label: '初見', fan: [0.1, 0.4], anti: [0, 0.2], know: [0, 0.15], spend: [0, 0.2], arg: [0, 0.3], humor: [0.3, 0.8], concern: [0.2, 0.5], stance: 0, rate: 0.9, color: '#c9e4ff', badge: 'new', n: 26 },
  kirinuki: { label: '切り抜き', fan: [0.3, 0.6], anti: [0, 0.2], know: [0.1, 0.3], spend: [0, 0.3], arg: [0, 0.2], humor: [0.6, 0.9], concern: [0, 0.2], stance: 0, rate: 0.5, color: '#a7ffeb', n: 4 },
  kaigai: { label: '海外', fan: [0.5, 0.9], anti: [0, 0.1], know: [0.1, 0.5], spend: [0.1, 0.5], arg: [0, 0.3], humor: [0.4, 0.8], concern: [0.2, 0.5], stance: -0.1, rate: 0.7, color: '#ffe08a', n: 12 },
  rules: { label: 'ルール警察', fan: [0.2, 0.5], anti: [0.1, 0.4], know: [0.8, 1], spend: [0, 0.2], arg: [0.6, 0.9], humor: [0, 0.2], concern: [0.1, 0.3], stance: 0.5, rate: 0.6, color: '#7fb2ff', n: 6 },
  rom: { label: 'ROM専', fan: [0.4, 0.8], anti: [0, 0.1], know: [0.1, 0.5], spend: [0, 0.3], arg: [0, 0.1], humor: [0.1, 0.4], concern: [0.3, 0.6], stance: 0, rate: 0.12, color: '#c8c8d0', n: 22 },
  watcher: { label: 'コメ欄観察', fan: [0.2, 0.5], anti: [0, 0.3], know: [0.1, 0.4], spend: [0, 0.2], arg: [0.1, 0.3], humor: [0.8, 1], concern: [0, 0.2], stance: 0, rate: 0.7, color: '#b0f0d0', n: 7 },
  warai: { label: '草', fan: [0.3, 0.7], anti: [0, 0.3], know: [0, 0.3], spend: [0, 0.3], arg: [0.1, 0.3], humor: [0.9, 1], concern: [0, 0.2], stance: 0.2, rate: 1.1, color: '#d7f7a0', n: 12 },
};

// 名前のある常連（物語を持つ人）。arc で台本どおりにも動き、ふだんは人格どおりにしゃべる。
export const NAMED = [
  { id: 'mochi', name: 'もち', arch: 'kosan', months: 38, note: '15 万人になる前から見ている（本人談）' },
  { id: 'piyo', name: 'ぴよ@新規', arch: 'shinki', note: '古参が嫌い' },
  { id: 'taro', name: 'アンチ太郎', arch: 'anti', note: '毎回来る' },
  { id: 'kuma', name: 'くま', arch: 'yogo', months: 14 },
  { id: 'gachi', name: '競歩ガチ勢', arch: 'gachi', note: '競歩の話しかしない' },
  { id: 'oji', name: 'がんばれおじさん', arch: 'kosan', months: 24, rate: 0, note: '「がんばれ」しか言わない' },
  { id: 'rom', name: 'ROM専の佐藤', arch: 'rom', months: 41, rate: 0, note: '一度もコメントしたことがない' },
  { id: 'ryo', name: 'りょう', arch: 'shoken', note: '初見' },
  { id: 'oil', name: '石油王', arch: 'scjoren', months: 30, rate: 0.05, joinTime: 150 },
  { id: 'jyuman', name: '十万円の男', arch: 'scjoren', rate: 0, joinTime: 330, spend: 1, anti: 0.6, note: '転んでほしい' },
  { id: 'police', name: 'ルール警察', arch: 'rules' },
  { id: 'kiri', name: '切り抜きのK', arch: 'kirinuki' },
  { id: 'mike', name: 'Mike_from_Ohio', arch: 'kaigai' },
  { id: 'kid', name: 'しょうがくせい', arch: 'kids' },
  { id: 'reisei', name: '冷静な人', arch: 'calm' },
  { id: 'watch', name: 'コメ欄観察員', arch: 'watcher' },
  { id: 'jikkyo', name: '実況ニキ', arch: 'watcher', note: 'コメ欄の喧嘩を実況する' },
  { id: 'mika', name: '心配性のみか', arch: 'worry', months: 9 },
  { id: 'haha', name: 'アユムの母', arch: 'worry', rate: 0, joinTime: 9999, note: '本物' },
  { id: 'makafan', name: '真壁さん推し', arch: 'calm', fan: 0.2, note: '真壁のファン' },
  { id: 'mod', name: 'モデレーター猫', arch: 'calm', badge: 'mod', rate: 0 },
  { id: 'kenka', name: '喧嘩上等', arch: 'fighter' },
  { id: 'kusa', name: '草生える', arch: 'warai' },
  { id: 'yu', name: '同業配信者ユウ', arch: 'watcher', rate: 0.05, joinTime: 9999, note: 'ほかの配信者' },
  { id: 'jiro', name: 'アンチ次郎', arch: 'anti', joinTime: 9999, note: '炎上を聞いて来た' },
  { id: 'q', name: '質問マン', arch: 'shoken' },
];

// 名前の部品（ハンドルネームっぽく）
const JA_A = ['ねこ', 'いぬ', 'たぬき', 'からあげ', 'ポテト', '社畜', '学生', '深夜', 'おにぎり', 'しらす', 'うめぼし', '朝', '夜勤', 'てつ', 'けん', 'ゆう', 'まる', 'ぽん', 'もぐ', 'ぴぴ', 'みー', 'すし', 'もやし', 'ちくわ', '大根', 'さば', 'こたつ', '布団', 'ふとん', 'ピザ', 'プリン', 'たまご', '餃子', 'きなこ', 'あんこ', '抹茶', 'ゆず', 'みかん', 'いちご', 'メロン', 'ぶどう', 'くり', 'たこ', 'いか', 'かに', 'ほたて'];
const JA_B = ['', '', '', '太郎', '丸', 'まん', '民', '好き', 'の人', '部長', '先輩', '係', '職人', '侍', '王子', '姫', '師匠', '見習い', '中毒', '研究所', '推し', 'ちゃん', 'くん', 'さん'];
const ROMA = ['kei', 'tomo', 'yuki', 'sho', 'haru', 'nao', 'riku', 'sora', 'mai', 'aoi', 'ren', 'hina', 'taku', 'kazu', 'shun', 'emi', 'jun', 'ryu', 'miku', 'kenta'];
const EN = ['Carlos_BR', 'Anna_IT', 'jp_walk_fan', 'Lukas_DE', 'Sofia.es', 'TomFromLeeds', 'walkingdead_lol', 'Pierre75', 'Ji-hoon', 'Wei_Walk', 'Mateo_EC', 'Olivia_AU', 'Noah_CA', 'Erik_SE', 'Diego_MX', 'Priya_IN'];

export function makeName(rng, arch, used) {
  for (let k = 0; k < 20; k++) {
    let n;
    const r = rng.next();
    if (arch === 'kaigai') n = EN[Math.floor(rng.next() * EN.length)] + (rng.next() < 0.4 ? String(Math.floor(rng.next() * 99)) : '');
    else if (arch === 'kids') n = ['ゆうと', 'はると', 'そうた', 'ひなた', 'りく', 'けんた', 'こうき', 'みずき'][Math.floor(rng.next() * 8)] + ['（10さい）', '（9さい）', '小4', 'くん', ''][Math.floor(rng.next() * 5)];
    else if (arch === 'shoken' && r < 0.35) n = ['通りすがり', '名無し', 'おすすめに出てきた', 'たまたま見た人', '陸上わからん'][Math.floor(rng.next() * 5)] + Math.floor(rng.next() * 900 + 100);
    else if (r < 0.32) n = ROMA[Math.floor(rng.next() * ROMA.length)] + (rng.next() < 0.5 ? '_' : '') + Math.floor(rng.next() * 9999);
    else n = JA_A[Math.floor(rng.next() * JA_A.length)] + JA_B[Math.floor(rng.next() * JA_B.length)];
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  return `viewer${Math.floor(rng.next() * 1e5)}`;
}
