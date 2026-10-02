// 視聴者 1 人。人格（数値）・記憶・関係・「疲れてる？」の立場を持つ。毎フレームは動かさない（イベントの時だけ）。
//   memory        … 最近の出来事と自分の発言（12 件まで）
//   counts        … 出来事を何回見たか（「ほら疲れてる」「何回目だよ」の判断）
//   relationships … 相手の id → 好き(+)/嫌い(-)（言い返す相手の選び方）
//   stance.fatigue… + = 疲れてると言う / - = 疲れてないと言う。証拠を見るほど否定派は揺れる（doubt）→ 折れる

const range = (rng, [a, b]) => a + (b - a) * rng.next();

export class ViewerNPC {
  constructor({ id, name, arch, A, rng, named = false, over = {} }) {
    this.id = id;
    this.displayName = name;
    this.personality = arch;
    this.named = named;
    this.fanLevel = over.fan ?? range(rng, A.fan);
    this.antagonism = over.anti ?? range(rng, A.anti);
    this.knowledgeOfRaceWalking = range(rng, A.know);
    this.spendingLevel = over.spend ?? range(rng, A.spend);
    this.argumentative = range(rng, A.arg);
    this.humorLevel = range(rng, A.humor);
    this.concernLevel = range(rng, A.concern);
    this.joinTime = over.joinTime ?? (rng.next() < 0.75 ? 0 : 20 + rng.next() * 380);
    this.rate = (over.rate ?? A.rate) * (0.6 + rng.next() * 0.8);
    this.memory = [];
    this.relationships = {};
    this.stance = { fatigue: A.stance + (rng.next() - 0.5) * 0.3 };
    this.doubt = 0;
    this.broke = false; // 古参が折れた
    this.counts = {};
    this.lastT = -99;
    this.said = new Set();
    this.left = false;
    this.mood = 0;
    this.comments = 0;
    this.color = A.color;
    this.badge = over.badge ?? A.badge ?? null;
    this.months = over.months ?? (this.badge === 'member' ? 1 + Math.floor(rng.next() * 30) : 0);
    this.note = over.note ?? '';
  }

  active(t) {
    return !this.left && t >= this.joinTime;
  }

  remember(t, type, data = null) {
    this.memory.push({ t, type, data });
    if (this.memory.length > 12) this.memory.shift();
    this.counts[type] = (this.counts[type] ?? 0) + 1;
  }

  count(type) {
    return this.counts[type] ?? 0;
  }

  // 自分が前にこう言った（最後の発言の種類）
  lastSaid(type) {
    for (let i = this.memory.length - 1; i >= 0; i--) if (this.memory[i].type === 'said' && this.memory[i].data?.topic === type) return this.memory[i];
    return null;
  }

  like(otherId, d) {
    this.relationships[otherId] = Math.max(-1, Math.min(1, (this.relationships[otherId] ?? 0) + d));
  }
}
