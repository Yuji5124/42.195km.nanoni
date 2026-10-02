// LIVE CHAT（右の欄）の頭脳。DOM には触らない（ChatView が drain() で受け取って描く）。
//   視聴者 約 230 人（ViewerNPC）。全員を毎フレーム動かさない:
//     1) 出来事（レース・ACTION・数字の変化）→ 人格に合う人を数人選んで反応させる（遅れて書き込む）
//     2) 何もない時のおしゃべり（表示の速さに合わせて、ランダムに 1 人ずつ）
//     3) 小さな物語（arcs.js）・言い合い（2〜4 往復 → 誰かが止める）・「押せ / 押すな」
//   記憶: 同じ出来事の 2 回目は言い方が変わる（「今ふらついたぞ」→「ほら疲れてる」）。
//         「疲れてない」派は証拠を見るたびに揺れて、折れる（「今日はちょっと怪しい」→「古参折れてて草」）。
//   表示の速さ: 通常は読める速さ → 炎上で速く → 大炎上でほぼ読めない。スパチャ・名前のある人・事件のコメントは必ず出す。

import { ARCH, NAMED, makeName } from './viewers.js';
import { ViewerNPC } from './ViewerNPC.js';
import { IDLE, FINAL_BACK, FILLER, EVENTS, FATIGUE, ARGS, CLOSERS, CLOSERS2, JIKKYO, PRESS, SC_MSG, ANTI_TARGET, ANTI_ANSWER } from './lines.js';
import { ARCS } from './arcs.js';

const STREAMER = 'アユム';
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

export function man(n) {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}億`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}万`;
  return Math.round(n).toLocaleString('en-US');
}

export class LiveChatSystem {
  constructor({ rng, metrics }) {
    this.rng = rng;
    this.metrics = metrics;
    this.reset();
  }

  reset() {
    const rng = this.rng;
    this.t = 0;
    this.viewers = [];
    this.byId = {};
    this.byArch = {};
    const used = new Set();
    let n = 0;
    const add = (v) => {
      this.viewers.push(v);
      this.byId[v.id] = v;
      (this.byArch[v.personality] ??= []).push(v);
    };
    for (const s of NAMED) {
      used.add(s.name);
      const v = new ViewerNPC({ id: s.id, name: s.name, arch: s.arch, A: ARCH[s.arch], rng, named: true, over: { ...s, joinTime: s.joinTime ?? 0 } });
      // 台本だけで話す人（がんばれおじさん・ROM専・石油王・十万円の男・母・モデレーター）
      v.scripted = ['oji', 'rom', 'oil', 'jyuman', 'haha', 'mod'].includes(s.id);
      add(v);
    }
    for (const [arch, A] of Object.entries(ARCH)) {
      for (let i = 0; i < A.n; i++) add(new ViewerNPC({ id: `v${n++}`, name: makeName(rng, arch, used), arch, A, rng }));
    }
    // 関係（因縁・仲間）
    const rel = (a, b, d) => {
      this.byId[a]?.like(b, d);
      this.byId[b]?.like(a, d);
    };
    rel('mochi', 'piyo', -0.8);
    rel('taro', 'kuma', -0.9);
    rel('taro', 'mochi', -0.6);
    rel('gachi', 'police', 0.5);
    rel('kenka', 'piyo', -0.4);
    rel('kenka', 'mochi', -0.4);
    for (const a of this.byArch.anti ?? []) for (const y of this.byArch.yogo ?? []) rel(a.id, y.id, -0.5);
    this.queue = [];
    this.out = [];
    this.recent = [];
    this.usedText = new Map();
    this.args = [];
    this.argCount = 0;
    this.argT = -99;
    this.closerT = -99;
    this.arcs = ARCS.map((def) => ({ def, i: 0, lastT: -99 }));
    this.arcT = 0;
    this.flags = { funny: 0, antiReplied: false, talkBack: 0, fell: false, denyT: -99 };
    this.anti = null;
    this.antiT = 0;
    this.sc = null;
    this.pressure = new Map();
    this.tokens = 3;
    this.idleAcc = 0;
    this.shown = 0;
    this.dropped = 0;
    this.fatigueTalkT = -99;
    this.ojiT = 13;
    this.ojiN = 0;
    this.lastNamed = {};
    this.finalWords = {};
    this.seq = 0;
    this.readTarget = null;
    this.leaveT = 0;
    this.left = 0;
    this.converted = 0;
    this.ctx = { rem: 2000, pos: 4, gap: 1, gapAhead: 1, laps: 5, leader: 'マカベ', ahead: 'アルバレス', behind: 'ベネデッティ', ccu: 20300, heat: 0, finished: false, dq: false, place: 0, laptime: '1:31', reds: 0, fatigueLevel: 0, inPenalty: false };
  }

  // ---------------------------------------------------------------- 文字
  fill(s, extra = {}) {
    const c = this.ctx;
    return s.replace(/\{(\w+)\}/g, (m, k) => {
      if (k in extra) return extra[k];
      switch (k) {
        case 's':
          return STREAMER;
        case 'pos':
          return c.pos;
        case 'gap':
          return Math.max(0, c.gap).toFixed(1);
        case 'gapAhead':
          return c.gapAhead > 10 ? Math.round(c.gapAhead) : Math.max(0, c.gapAhead).toFixed(1);
        case 'rem':
          return Math.max(0, Math.round(c.rem / 10) * 10);
        case 'laps':
          return c.laps;
        case 'leader':
          return c.leader;
        case 'ahead':
          return c.ahead ?? '先頭';
        case 'behind':
          return c.behind ?? '後ろ';
        case 'ccu':
          return man(c.ccu);
        case 'anti':
          return this.anti?.name ?? 'アンチ';
        case 'laptime':
          return c.laptime;
        case 'reds':
          return c.reds;
        case 'place':
          return c.place;
        case 'lap2':
          return '1';
        default:
          return m;
      }
    });
  }

  pick(arr) {
    return arr[Math.floor(this.rng.next() * arr.length)];
  }

  // その人がまだ言っていない・最近だれも言っていない行を選ぶ
  pickFor(v, arr) {
    if (!arr || !arr.length) return null;
    let best = null;
    for (let k = 0; k < 6; k++) {
      const s = this.pick(arr);
      const fresh = this.t - (this.usedText.get(s) ?? -99) > 50;
      if (!v.said.has(s) && fresh) {
        best = s;
        break;
      }
      if (!best && fresh) best = s;
    }
    best ??= this.pick(arr);
    v.said.add(best);
    this.usedText.set(best, this.t);
    return best;
  }

  // ---------------------------------------------------------------- 人を選ぶ
  active(v) {
    return v.active(this.t);
  }

  pickViewer(weight, { notRecent = 2.5, exclude = null } = {}) {
    let sum = 0;
    const cand = [];
    for (const v of this.viewers) {
      if (!this.active(v) || v.scripted || (exclude && exclude.has(v))) continue;
      if (this.t - v.lastT < notRecent) continue;
      const w = weight(v);
      if (w <= 0) continue;
      sum += w;
      cand.push([v, w]);
    }
    if (!cand.length) return null;
    let r = this.rng.next() * sum;
    for (const [v, w] of cand) {
      r -= w;
      if (r <= 0) return v;
    }
    return cand[cand.length - 1][0];
  }

  anyOf(arch) {
    const list = (this.byArch[arch] ?? []).filter((v) => this.active(v) && !v.named);
    return list.length ? this.pick(list).id : null;
  }

  join(id) {
    const v = this.byId[id];
    if (v && v.joinTime > this.t) v.joinTime = this.t;
  }

  // ---------------------------------------------------------------- 書き込む（予約）
  say(id, text, opts = {}) {
    const v = typeof id === 'string' ? this.byId[id] : id;
    if (!v || !text) return;
    if (v.joinTime > this.t + (opts.delay ?? 0)) v.joinTime = this.t;
    this.enqueue({ v, text: this.fill(text, opts.extra), delay: opts.delay ?? 0, prio: opts.prio ?? (v.named ? 2 : 1), kind: opts.kind ?? 'chat', hl: !!opts.hl, amount: opts.amount ?? 0, topic: opts.topic ?? null, target: !!opts.target, troll: !!opts.troll });
  }

  antiSay(id, text) {
    this.join(id);
    this.say(id, text, { prio: 3, target: true, hl: true });
  }

  system(text, { delay = 0 } = {}) {
    this.enqueue({ v: null, text, delay, prio: 4, kind: 'system' });
  }

  enqueue(c) {
    c.at = this.t + (c.delay ?? 0);
    this.queue.push(c);
  }

  // 表示の速さ（1 秒あたり）: 炎上の段階・同接・ラスト
  displayRate() {
    const lv = this.metrics.heatLevel;
    const ccuF = Math.log10(Math.max(1, this.ctx.ccu / 20300));
    const base = [1.5, 4.2, 9.5, 21][lv] + ccuF * 3.2 + (this.ctx.rem < 400 && !this.ctx.finished ? 2.6 : 0);
    return Math.min(34, base);
  }

  emit(c) {
    const v = c.v;
    const out = {
      id: ++this.seq,
      t: this.t,
      viewerId: v?.id ?? null,
      name: v?.displayName ?? '',
      color: v?.color ?? '#aaa',
      badge: v?.badge ?? null,
      months: v?.months ?? 0,
      named: !!v?.named,
      text: c.text,
      kind: c.kind,
      amount: c.amount,
      hl: c.hl,
      prio: c.prio,
      troll: c.troll,
    };
    this.out.push(out);
    this.recent.push(out);
    if (this.recent.length > 40) this.recent.shift();
    this.shown++;
    if (v) {
      v.lastT = this.t;
      v.comments++;
      v.remember(this.t, 'said', { topic: c.topic, text: c.text });
      if (v.named) {
        this.lastNamed[v.id] = c.text;
        // 結果画面の「最後のひとこと」: ゴール後の台本の一言を残す
        if ((this.ctx.finished || this.ctx.dq) && c.kind !== 'sc' && c.hl && !this.finalWords[v.id]) this.finalWords[v.id] = c.text;
      }
    }
    if (c.target && v) this.anti = { name: v.displayName, id: v.id, text: c.text, t: this.t };
    if (c.topic === 'fatigueClaim') this.fatigueTalkT = this.t;
    if (c.kind === 'sc') this.onScShown(out, c);
    // アンチの名指しには、擁護が言い返すことがある
    if (c.target && v && this.rng.next() < 0.7) {
      const d = this.pickViewer((x) => (x.personality === 'yogo' || x.personality === 'kosan' ? x.argumentative : 0) * (x.id === 'kuma' ? 3 : 1));
      if (d) {
        this.say(d, `@${v.displayName} ${this.pick(ARGS.anti.b)}`, { delay: 2 + this.rng.next() * 1.5 });
        if (this.rng.next() < 0.45) this.startArg('anti', v, d);
      }
    }
  }

  // ---------------------------------------------------------------- 毎フレーム
  update(dt, ctx) {
    this.t += dt;
    Object.assign(this.ctx, ctx);
    const rate = this.displayRate();
    this.tokens = Math.min(5, this.tokens + rate * dt);
    // 何もない時のおしゃべり
    this.idleAcc += rate * 0.82 * dt;
    while (this.idleAcc >= 1) {
      this.idleAcc -= 1;
      this.idleOne();
    }
    this.oji(dt);
    this.arcT -= dt;
    if (this.arcT <= 0) {
      this.arcT = 0.3;
      this.runArcs();
      this.genericAnti();
      this.fanFlow();
    }
    this.updateArgs();
    if (this.anti && this.t - this.anti.t > 16) this.anti = null;
    if (this.sc && this.t - this.sc.t > 15) this.sc = null;
    // 予約を出す（優先度の低いものは速さの上限で間引く = 流れて見えなかったコメント）
    if (this.queue.length) {
      const due = [];
      const keep = [];
      for (const c of this.queue) (c.at <= this.t ? due : keep).push(c);
      this.queue = keep;
      due.sort((a, b) => b.prio - a.prio);
      for (const c of due) {
        if (c.prio >= 2) {
          this.tokens = Math.max(-3, this.tokens - 1);
          this.emit(c);
        } else if (this.tokens >= (c.prio === 0 ? 1.4 : 1)) {
          this.tokens -= 1;
          this.emit(c);
        } else this.dropped++;
      }
    }
  }

  drain() {
    const o = this.out;
    this.out = [];
    return o;
  }

  // ---------------------------------------------------------------- 何もない時
  idleOne() {
    const c = this.ctx;
    const lv = this.metrics.heatLevel;
    const over = c.finished || c.dq;
    const v = this.pickViewer((x) => x.rate * (x.named ? (over ? 0 : 0.6) : 1));
    if (!v) return;
    const r = this.rng.next();
    if (lv >= 2 && r < 0.5) {
      this.say(v, this.pick(FILLER[lv === 3 ? 'fire' : 'hot']), { prio: 0 });
      return;
    }
    if (c.rem < 400 && !c.finished && c.pos >= 6) {
      this.say(v, this.pickFor(v, FINAL_BACK[v.personality] ?? FINAL_BACK._), { prio: r < 0.5 ? 0 : 1 });
      return;
    }
    if (c.rem < 400 && !c.finished && r < 0.4) {
      this.say(v, this.pick(FILLER.final), { prio: 0 });
      return;
    }
    if (c.finished || c.dq) {
      const res = c.dq ? 'dq' : c.place === 1 ? 'win' : 'fin';
      const byArch = {
        anti: { dq: ['ほらな', '知ってた', 'ざまあ（ちょっと寂しい）'], win: ['……まあ', 'たまたまだろ', 'ふーん'], fin: ['こんなもん', '配信してるからだろ', 'まあまあ'] },
        gachi: { dq: ['判定は妥当', '最後の膝が…'], win: ['ラスト200のキレ', 'いいレースだった'], fin: ['ペース配分が課題', 'いいレースだった'] },
        rules: { dq: ['ルールはルール', '4枚目は仕方ない'], win: ['フォームは最後まで合法だった'], fin: ['反則なしでよかった'] },
        worry: { dq: ['ケガはない？', '泣かないで'], win: ['よかった……', '泣いた'], fin: ['無事でよかった', 'おつかれさま'] },
        kaigai: { dq: ['NOOO', 'what happened'], win: ['CHAMPION', 'GG!!!'], fin: ['GG', 'good race'] },
        _: { dq: ['失格……', 'おつかれ', '伝説', 'また見る', '😭'], win: ['おめでとう！！', '優勝！', '泣いた', '88888', 'おめ！', '最高'], fin: ['おつかれ！', 'よく頑張った', '88888', 'おつ', 'いいレースだった'] },
      };
      const tb = byArch[v.personality] ?? byArch._;
      this.say(v, this.pick(tb[res]), { prio: 0 });
      return;
    }
    const phase = c.rem > 1200 ? 'early' : c.rem > 400 ? 'mid' : 'final';
    const arr = IDLE[phase][v.personality] ?? IDLE.mid[v.personality] ?? FILLER.calm;
    const line = this.pickFor(v, arr);
    this.say(v, line, { prio: 1, topic: v.personality === 'anti' ? 'fatigueClaim' : null });
    // ときどき言い合いが始まる
    if (this.t - this.argT > 26 && this.rng.next() < 0.05 + lv * 0.03) {
      const topic = this.pick(['fatigue', 'oldnew', 'focus', 'anti']);
      this.argOn(topic);
    }
  }

  // がんばれおじさん（「がんばれ」しか言わない）
  oji(dt) {
    if (this.ctx.dq && this.ojiN > 99) return;
    this.ojiT -= dt;
    if (this.ojiT > 0) return;
    this.ojiT = 17 + this.rng.next() * 12;
    this.ojiN++;
    if (this.ctx.finished || this.ctx.dq) {
      if (this.ojiN < 100) {
        this.say('oji', this.ctx.dq ? 'がんばった！' : 'がんばった！！', { hl: true });
        this.ojiN = 100;
      }
      return;
    }
    this.say('oji', this.pick(['がんばれ！', 'がんばれ！！', 'がんばれ', 'がんばれー！', 'がんばれ！！！']), { prio: 2 });
    if (this.ojiN === 4) this.say(this.anyOf('kosan'), 'がんばれおじさん今日もいる', { delay: 1.6 });
    if (this.ojiN === 9) this.say('kusa', 'おじさん皆勤賞', { delay: 1.6 });
  }

  // ---------------------------------------------------------------- 小さな物語
  runArcs() {
    for (const a of this.arcs) {
      const st = a.def.steps[a.i];
      if (!st) continue;
      if (this.t - a.lastT < (st.gap ?? 0)) continue;
      if (!st.if(this)) continue;
      st.do(this);
      a.i++;
      a.lastT = this.t;
    }
  }

  // ふつうのアンチの名指し（太郎がいない時・炎上中は増える）
  genericAnti() {
    if (this.anti || this.ctx.finished || this.ctx.dq) return;
    const gap = this.metrics.heatLevel >= 2 ? 18 : this.metrics.heatLevel === 1 ? 32 : 55;
    if (this.t - this.antiT < gap || this.t < 40) return;
    this.antiT = this.t;
    const v = this.pickViewer((x) => (x.personality === 'anti' && !x.named ? 1 : 0), { notRecent: 1 });
    if (v) this.antiSay(v.id, this.pick(ANTI_TARGET));
  }

  // ファンが離れる（信頼が低い）/ 初見がファンになる（面白い）
  fanFlow() {
    if (this.t - this.leaveT < 6) return;
    this.leaveT = this.t;
    const m = this.metrics;
    if (m.trust < 0.3 && this.rng.next() < 0.3) {
      const v = this.pickViewer((x) => (['kosan', 'yogo', 'shinki'].includes(x.personality) && !x.named ? 1 - x.fanLevel + 0.2 : 0));
      if (v) {
        this.say(v, this.pick(['今日はもういいや', 'ちょっと冷めた', '真面目に見たかった', '決勝くらいちゃんとやって', 'おやすみ']), { prio: 2 });
        v.left = true;
        this.left++;
      }
    }
    if (m.fun > 0.5 && this.rng.next() < 0.35) {
      const v = this.pickViewer((x) => (x.personality === 'shoken' && !x.named && x.fanLevel < 0.6 ? 1 : 0));
      if (v) {
        v.fanLevel = 0.7;
        this.converted++;
        this.say(v, this.pick(['チャンネル登録しました', '初見だけど好きになった', '登録した', '通知オンにした']), { prio: 1 });
      }
    }
  }

  // ---------------------------------------------------------------- 言い合い
  argOn(topic) {
    const pairs = {
      fatigue: [(v) => (v.stance.fatigue > 0.3 ? v.argumentative : 0), (v) => (v.stance.fatigue < -0.3 ? v.argumentative : 0)],
      oldnew: [(v) => (v.personality === 'kosan' ? v.argumentative : 0), (v) => (v.personality === 'shinki' ? v.argumentative : 0)],
      focus: [(v) => (['kosan', 'gachi', 'yogo'].includes(v.personality) ? 0.6 + v.fanLevel : 0), (v) => (['warai', 'watcher', 'kirinuki', 'shinki'].includes(v.personality) ? v.humorLevel : 0)],
      anti: [(v) => (v.personality === 'anti' ? 1 : 0), (v) => (v.personality === 'yogo' ? 1 : 0)],
      sc: [(v) => (v.personality === 'warai' || v.personality === 'anti' ? 1 : 0), (v) => (v.personality === 'kosan' || v.personality === 'worry' ? 1 : 0)],
    }[topic];
    if (!pairs) return;
    const a = this.pickViewer(pairs[0], { notRecent: 1 });
    const b = a && this.pickViewer(pairs[1], { notRecent: 1, exclude: new Set([a]) });
    if (a && b) this.startArg(topic, a, b);
  }

  startArg(topic, a, b) {
    if (this.args.length >= 2 || a === b) return;
    if (this.args.some((g) => g.a === a || g.b === a || g.a === b || g.b === b)) return;
    this.argT = this.t;
    this.args.push({ topic, a, b, turn: 0, max: 1 + Math.floor(this.rng.next() * 2.6), next: this.t + 1.8 + this.rng.next() * 1.4, n: ++this.argCount });
  }

  updateArgs() {
    for (let i = this.args.length - 1; i >= 0; i--) {
      const g = this.args[i];
      if (this.t < g.next) continue;
      const aTurn = g.turn % 2 === 0;
      const sp = aTurn ? g.a : g.b;
      const other = aTurn ? g.b : g.a;
      const lines = ARGS[g.topic][aTurn ? 'a' : 'b'];
      this.say(sp, `@${other.displayName} ${this.pickFor(sp, lines)}`, { prio: 2 });
      sp.like(other.id, -0.1);
      g.turn++;
      g.next = this.t + 1.5 + this.rng.next() * 1.8;
      if (g.turn === 3 && this.rng.next() < 0.45) this.say('jikkyo', this.pick(JIKKYO), { delay: 0.8, extra: { a: g.a.displayName, b: g.b.displayName, n: g.n } });
      if (g.turn >= g.max * 2) {
        this.args.splice(i, 1);
        this.closeArg();
      }
    }
  }

  // 言い合いの止め方: 「どっちでもいいから競歩見ろ」→「そもそも今 6 位だぞ」→「6 位なの？」→「誰も競技見てなくて草」
  closeArg() {
    if (this.t - this.closerT < 45 || this.rng.next() > 0.7) {
      if (this.rng.next() < 0.4) this.say('jikkyo', this.pick(['この勝負、引き分け', 'ゴングが鳴った', 'お互いいいパンチだった']), { delay: 1.2 });
      return;
    }
    this.closerT = this.t;
    const chain = this.rng.next() < 0.7 ? CLOSERS : CLOSERS2;
    let d = 1.2;
    for (const [archs, text] of chain) {
      const v = this.pickViewer((x) => (archs.includes(x.personality) ? 1 : 0), { notRecent: 0.5 });
      if (v) this.say(v, text, { delay: d, prio: 2 });
      d += 1.5 + this.rng.next() * 0.8;
    }
  }

  // ---------------------------------------------------------------- 反応
  reactCount(big = false) {
    const c = Math.log10(this.ctx.ccu / 20300 + 1) * 3;
    return Math.round(clamp(2 + c + this.metrics.heatLevel * 0.8 + (big ? 3 : 0), 2, big ? 14 : 9));
  }

  lineFor(v, table, type) {
    const e = table[v.id] ?? table[v.personality] ?? table._;
    if (!e) return null;
    if (Array.isArray(e)) return this.pickFor(v, e);
    const n = v.count(type);
    return this.pickFor(v, n > 0 && e.again ? e.again : e.first);
  }

  react(type, extra = {}, { n = null, big = false, exclude = null, delay = 0.4 } = {}) {
    const table = EVENTS[type];
    if (!table) return;
    const count = n ?? this.reactCount(big);
    const picked = new Set();
    for (let i = 0; i < count; i++) {
      const v = this.pickViewer(
        (x) => {
          if (exclude && exclude.includes(x.personality)) return 0;
          const has = table[x.id] || table[x.personality];
          if (x.named && !has) return 0; // 名前のある人は、自分らしい反応がある時だけ
          return (has ? 1 : table._ ? 0.22 : 0) * (0.4 + x.rate) * (x.named ? 1.5 : 1);
        },
        { notRecent: 1.2, exclude: picked },
      );
      if (!v) break;
      picked.add(v);
      const line = this.lineFor(v, table, type);
      v.remember(this.t, type);
      if (!line) continue;
      this.say(v, line, { delay: delay + i * 0.3 + this.rng.next() * 1.5, prio: i < 2 ? 2 : 1, extra });
    }
  }

  // 「疲れてる？」の証拠（つまずき・転倒・見た目・膝）
  fatigueEvidence(strength = 1) {
    const late = this.ctx.fatigueLevel >= 3;
    // 疲れてると言う側（太郎を優先）
    const claimer = this.active(this.byId.taro) && this.rng.next() < 0.7 && this.t - this.byId.taro.lastT > 2 ? this.byId.taro : this.pickViewer((v) => (v.stance.fatigue > 0.3 ? 0.5 + v.antagonism : 0));
    if (claimer) {
      const k = claimer.count('fatigueEv');
      const arr = late && k > 0 ? FATIGUE.evidence.late : k > 0 ? FATIGUE.evidence.again : FATIGUE.evidence.first;
      this.say(claimer, this.pickFor(claimer, arr), { delay: 0.6 + this.rng.next(), prio: 2, topic: 'fatigueClaim' });
      claimer.remember(this.t, 'fatigueEv');
    }
    // 疲れてないと言う側（もちを優先）。証拠を見るたびに揺れる
    const mochi = this.byId.mochi;
    const denier = !mochi.broke && this.rng.next() < 0.75 ? mochi : this.pickViewer((v) => (v.stance.fatigue < -0.3 && !v.broke ? v.fanLevel : 0));
    if (denier) {
      denier.doubt += strength;
      const dl = 2 + this.rng.next() * 1.2;
      if (!denier.broke && denier.doubt >= 2.2 && denier.fanLevel > 0.6) {
        denier.broke = true;
        denier.stance.fatigue = 0.1;
        this.say(denier, this.pickFor(denier, FATIGUE.broke), { delay: dl, prio: 2, hl: denier.named });
        const mocker = this.active(this.byId.kusa) && this.rng.next() < 0.6 ? this.byId.kusa : this.pickViewer((v) => (v.personality === 'warai' || v.personality === 'watcher' ? 1 : 0));
        if (mocker) this.say(mocker, this.pick(FATIGUE.mockBroke), { delay: dl + 1.8, prio: 2 });
      } else if (!denier.broke) {
        const k = denier.count('denyEv');
        this.say(denier, this.pickFor(denier, k > 0 ? FATIGUE.deny.again : FATIGUE.deny.first), { delay: dl, prio: 2 });
        denier.remember(this.t, 'denyEv');
        if (this.rng.next() < 0.55) {
          const mocker = this.active(this.byId.kusa) && this.rng.next() < 0.5 ? this.byId.kusa : this.pickViewer((v) => (v.personality === 'warai' || v.personality === 'watcher' ? 1 : 0));
          if (mocker) this.say(mocker, this.pick(FATIGUE.mock), { delay: dl + 1.6, prio: 2 });
        }
      }
    }
    this.fatigueTalkT = this.t;
    if (claimer && denier && this.rng.next() < 0.3) this.startArg('fatigue', claimer, denier);
  }

  // 「全然疲れてません」「余裕です」と言った
  denyAction() {
    const late = this.ctx.fatigueLevel >= 3;
    const deniers = this.pickViewer((v) => (v.stance.fatigue < -0.3 ? 1 : 0));
    if (deniers) this.say(deniers, this.pick(FATIGUE.denyAction.deny), { delay: 0.8, prio: 2 });
    const claimer = this.pickViewer((v) => (v.stance.fatigue > 0.3 ? 1 + (v.id === 'taro' ? 2 : 0) : 0));
    if (claimer) this.say(claimer, this.pick(late ? FATIGUE.denyAction.late : FATIGUE.denyAction.claim), { delay: 1.6, prio: 2, topic: 'fatigueClaim' });
    if (this.ctx.fatigueLevel >= 2) {
      const w = this.pickViewer((v) => (v.personality === 'watcher' ? 1 : 0));
      if (w) this.say(w, this.pick(FATIGUE.denyAction.watcher), { delay: 3, prio: 2 });
    }
    if (claimer && deniers && this.rng.next() < 0.5) this.startArg('fatigue', claimer, deniers);
    this.flags.denyT = this.t;
  }

  // ---------------------------------------------------------------- スパチャ
  superchat({ viewerId = null, amount, msg = null, troll = false, delay = 0 }) {
    this.metrics.spawnSuperchat(amount, { viewerId, msg, troll, delay });
  }

  // metrics から呼ばれる（ランダムなスパチャも、台本のスパチャも）
  addSuperchat({ amount, viewerId = null, msg = null, troll = false, delay = 0 }) {
    const heat = this.metrics.heat;
    const isTroll = troll || (heat > 3 && this.rng.next() < heat * 0.05);
    const v = viewerId ? this.byId[viewerId] : this.pickViewer((x) => x.spendingLevel ** 2 * (isTroll ? 0.2 + x.antagonism + x.humorLevel * 0.5 : 0.4 + x.fanLevel) * (this.t - (x.scT ?? -99) < 25 ? 0.02 : 1), { notRecent: 1 });
    if (!v) return;
    let text = msg;
    if (!text) {
      const tiers = [200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
      const tier = tiers.filter((x) => x <= amount).pop() ?? 200;
      const arr = (isTroll ? SC_MSG.troll : SC_MSG[tier]).filter((x) => !(x === '初スパです！' && v.scN));
      text = this.pick(arr.length ? arr : SC_MSG[500]);
    }
    v.scN = (v.scN ?? 0) + 1;
    v.scT = this.t;
    this.say(v, text, { kind: 'sc', amount, prio: 4, delay, troll: isTroll, hl: amount >= 10000 });
  }

  onScShown(out, c) {
    const amount = out.amount;
    if (amount >= 2000 || c.troll) {
      if (!this.sc || this.t - this.sc.t > 5 || amount >= this.sc.amount) this.sc = { name: out.name, id: out.viewerId, amount, msg: out.text, t: this.t, troll: c.troll };
    }
    if (amount >= 100000 && c.troll) {
      this.react('SC_TROLL', {}, { big: true });
      this.argOn('sc');
    } else if (amount >= 50000) this.react('SC_BIG', { amount: amount.toLocaleString('en-US') }, { n: 4 });
  }

  // ---------------------------------------------------------------- 押せ / 押すな
  updatePressure(dt, tempts) {
    const m = this.metrics;
    const ccu = this.ctx.ccu;
    const offered = new Set(tempts);
    // 声に出して「押せ」と書くのは、いちばん新しい誘惑だけ（全部が騒ぐとうるさい）
    const loud = tempts.includes('sleep') ? 'sleep' : tempts.includes('run') ? 'run' : tempts[tempts.length - 1];
    for (const id of offered) {
      const def = PRESS[id];
      if (!def) continue;
      let p = this.pressure.get(id);
      if (!p) {
        p = { push: 0, stop: 0, postT: this.t + 0.8 };
        this.pressure.set(id, p);
      }
      const hype = 0.5 + m.fun * 0.35 + m.heat * 0.09 + (this.ctx.rem < 400 ? 0.6 : 0);
      p.push += dt * ccu * 0.00032 * hype * (id === 'sleep' ? 2.4 : 1);
      p.stop += dt * ccu * 0.00024 * (0.35 + m.trust) * (id === 'run' || id === 'sleep' ? 1.6 : 1);
      if (id === loud && this.t > p.postT && !this.ctx.finished) {
        p.postT = this.t + (this.ctx.rem < 400 ? 1.0 : 3.8) + this.rng.next() * (this.ctx.rem < 400 ? 1.4 : 3.5);
        const push = this.rng.next() < p.push / (p.push + p.stop + 1e-6);
        const lines = push ? def.push : def.stop;
        if (lines.length) {
          const v = this.pickViewer((x) => (push ? (['warai', 'watcher', 'anti', 'kirinuki', 'shinki', 'fighter'].includes(x.personality) ? x.humorLevel + 0.2 : 0) : ['kosan', 'yogo', 'worry', 'gachi', 'rules'].includes(x.personality) ? x.fanLevel + 0.2 : 0));
          if (v) this.say(v, this.pick(lines), { prio: id === 'sleep' || id === 'run' ? 2 : 1 });
        }
      }
    }
    for (const [id, p] of this.pressure) {
      if (!offered.has(id)) {
        p.push *= Math.exp(-dt * 0.5);
        p.stop *= Math.exp(-dt * 0.5);
      }
    }
  }

  // ---------------------------------------------------------------- 「コメントを見る」で読むコメント
  pickReadable() {
    const cand = this.recent.filter((c) => c.kind === 'chat' && c.text.length >= 2 && c.text.length <= 26 && !/^[w草！？!?🔥👏👋]+$/.test(c.text) && !c.text.startsWith('@'));
    if (!cand.length) return null;
    const c = cand[Math.floor(this.rng.next() * Math.min(cand.length, 12)) + Math.max(0, cand.length - 12)] ?? cand[cand.length - 1];
    this.readTarget = c;
    return c.text;
  }

  // ---------------------------------------------------------------- ゲームからの出来事
  event(type, d = {}) {
    const f = this.flags;
    switch (type) {
      // ---- レース
      case 'trip':
        this.fatigueEvidence(1);
        this.react('TRIP', {}, { n: 3, exclude: ['anti', 'kosan', 'warai'] });
        break;
      case 'fall':
        f.fell = true;
        this.fatigueEvidence(1.6);
        this.react('FALL', {}, { big: true, exclude: ['anti'] });
        break;
      case 'fatigue':
        if (d.level >= 1) this.fatigueEvidence(d.level >= 2 ? 1 : 0.6);
        if (d.level >= 1) this.say('gachi', this.pick(d.level >= 3 ? ['歩幅が縮んできた。きつい時間', '頭が揺れ始めた'] : ['腕振りが少し下がった', 'ここから我慢']), { delay: 3 });
        break;
      case 'formBad':
        this.react(d.type === '~' ? 'BAD_FORM_LC' : 'BAD_FORM_BK', {}, { n: 3 });
        if (d.type === '<') this.fatigueEvidence(0.5);
        break;
      case 'goodForm':
        this.react('GOOD_FORM', {}, { n: 2 });
        break;
      case 'overtake':
        this.react('OVERTAKE', {}, { n: 4 });
        if (d.rank === 1) this.react('LEAD', {}, { n: 4, delay: 1.5 });
        break;
      case 'overtaken':
        this.react('OVERTAKEN', {}, { n: 3 });
        if (d.from === 1) this.react('LOSE_LEAD', {}, { n: 2 });
        if (this.ctx.fatigueLevel >= 2 && this.rng.next() < 0.5) this.fatigueEvidence(0.5);
        break;
      case 'lap':
        this.react('LAP', { laps: d.left }, { n: 2 });
        break;
      case 'bell':
        this.react('BELL', {}, { big: true });
        break;
      case 'remain':
        if ([1000, 600, 200, 100].includes(d.m)) this.react('REMAIN', { rem: d.m }, { n: d.m <= 200 ? 4 : 2 });
        break;
      case 'paddle':
        if (d.player) this.react('PADDLE', {}, { n: 3 });
        else if (this.rng.next() < 0.4) this.react('OTHER_PADDLE', { name: d.name }, { n: 1 });
        break;
      case 'red':
        if (d.player) this.react('RED', { count: d.count, left: Math.max(0, 3 - d.count) }, { n: 5 });
        else this.react('OTHER_RED', { name: d.name }, { n: 1 });
        break;
      case 'penalty':
        if (d.player) this.react('PENALTY', {}, { big: true });
        break;
      case 'dq':
        if (d.player) this.react('DQ', {}, { big: true, n: 14 });
        else this.react('OTHER_DQ', { name: d.name }, { n: 3 });
        break;
      case 'finish':
        if (d.player) this.react(d.place === 1 ? 'WIN' : d.place <= 3 ? 'PODIUM' : 'FINISHED', { place: d.place }, { big: true, n: 14 });
        break;
      case 'kick':
        if (d.near) this.react('KICK', { name: d.name }, { n: 2 });
        break;
      case 'surge':
        this.react('SURGE', {}, { n: 3 });
        break;
      case 'water':
        this.react('WATER', {}, { n: 2 });
        if (this.t - f.denyT < 60) this.say(this.byId.taro, '水飲んでて草（疲れてない人）', { delay: 1.4, prio: 2, topic: 'fatigueClaim' });
        break;
      case 'waterMiss':
        if (d.want && !d.reach) this.react('WATER_MISS', {}, { n: 1 });
        break;
      case 'ccuSpike':
        this.react('CCU_SPIKE', { ccu: man(d.ccu) }, { n: 4 });
        break;
      case 'heat':
        if (d.up && d.level === 2) this.react('FLAME', {}, { n: 5 });
        if (d.up && d.level === 3) this.react('FLAME_BIG', {}, { n: 6 });
        break;
      case 'cam':
        this.react(d.face ? 'CAM_FACE' : 'CAM_BACK', {}, { n: d.face ? 2 : 4 });
        break;
      default:
        this.actionEvent(type, d);
    }
  }

  // ---- ACTION（配信者がやったこと）
  actionEvent(type, d) {
    const f = this.flags;
    const target = this.anti ? this.byId[this.anti.id] : null;
    if (d.buzz > 0.1) f.funny++;
    switch (type) {
      case 'ANTI_REPLY':
      case 'TALK_BACK':
      case 'IGNORE_ANTI':
      case 'LAUGH_OFF':
      case 'CALL_FANS': {
        if (type === 'ANTI_REPLY') f.antiReplied = true;
        if (type === 'TALK_BACK') f.talkBack = (f.talkBack ?? 0) + 1;
        if (target) {
          const ans = ANTI_ANSWER[type];
          if (ans && (type !== 'IGNORE_ANTI' || this.rng.next() < 0.6)) this.say(target, this.pick(ans), { delay: 1.8 + this.rng.next(), prio: 3, hl: true });
        }
        const big = type === 'ANTI_REPLY' || type === 'TALK_BACK' || type === 'CALL_FANS';
        this.react(type, {}, { big, n: big ? null : 3 });
        if (type === 'CALL_FANS' && target) {
          for (let i = 0; i < 2; i++) {
            const fan = this.pickViewer((v) => (['kosan', 'yogo', 'shinki'].includes(v.personality) ? v.argumentative : 0));
            if (fan) this.startArg('anti', target, fan);
          }
        } else if (big && target && this.rng.next() < 0.6) this.argOn('anti');
        this.anti = null;
        break;
      }
      case 'READ_SC':
      case 'IGNORE_SC':
      case 'THANKS_BIG':
      case 'WRONG_NAME':
      case 'STOP_READ': {
        const sc = this.sc;
        const owner = sc ? this.byId[sc.id] : null;
        const extra = { wrong: d.wrong ?? '', name: sc?.name ?? '' };
        if (owner) {
          const ans = {
            READ_SC: sc.troll ? ['読まれてて草', '読むなよw'] : ['読まれた！！', 'ありがとう！', '泣いた'],
            IGNORE_SC: ['無視された', 'え', '……'],
            THANKS_BIG: ['こちらこそ！', '大げさw'],
            WRONG_NAME: ['{name}です', '名前ちがう', '誰だよ{wrong}', '{wrong}じゃない'],
            STOP_READ: ['ちゃんと読まれた…泣', '止まらなくていいのに'],
          }[type];
          this.say(owner, this.pick(ans), { delay: 1.5, prio: 3, hl: true, extra });
        }
        this.react(type, extra, { big: type === 'STOP_READ' || type === 'WRONG_NAME' });
        this.sc = null;
        break;
      }
      case 'DENY_FATIGUE':
        this.denyAction();
        this.react('YOYU', {}, { n: 2, exclude: ['anti', 'kosan', 'yogo'] });
        break;
      case 'YOYU':
        if (this.ctx.fatigueLevel >= 2) this.denyAction();
        else this.react('YOYU', {}, { n: 3 });
        break;
      case 'READ_CHAT': {
        const r = this.readTarget;
        if (r && r.viewerId && this.byId[r.viewerId]) {
          const v = this.byId[r.viewerId];
          this.say(v, v.personality === 'anti' ? this.pick(['読まれてて草', 'え、読まれた', '読むなよ']) : this.pick(['読まれた！！', 'え、読まれた！', '名前呼ばれた！', '一生の思い出']), { delay: 1.4, prio: 3, hl: true });
        }
        this.readTarget = null;
        this.react('READ_CHAT', {}, { n: 3 });
        break;
      }
      case 'SLEEP_FAKE':
        this.react('SLEEP_FAKE', {}, { big: true, n: 14 });
        this.say('kiri', '切り抜きタイトル「残り100mで寝たふり」', { delay: 3, prio: 3, hl: true });
        this.say('mochi', '伝説の寝たふり回、リアタイ2回目', { delay: 5, prio: 3, hl: true });
        this.argOn('focus');
        break;
      case 'RUN':
        this.react('RUN', {}, { big: true });
        this.argOn('focus');
        break;
      case 'TROLL_ACTION':
      case 'BACKWARD':
      case 'PEACE_JUDGE':
      case 'ENSHUTSU':
      case 'ANGRY_GROUND':
      case 'STOP_READ_':
        this.react(type, {}, { big: d.buzz > 0.3 });
        if (this.ctx.pos <= 3 && this.rng.next() < 0.5) this.argOn('focus');
        if (d.clip && d.buzz > 0.3) this.say('kiri', this.pick([`切り抜きタイトル「${d.clip}」`, 'ここ切り抜きます', 'サムネ決まった']), { delay: 2.4, prio: 2 });
        break;
      case 'FILM_RIVAL':
        this.say('makafan', this.pick(['ありがとうございます！！！', '真壁さん映った', '神カメラ']), { delay: 1, prio: 3, hl: true });
        this.react('FILM_RIVAL', {}, { n: 3 });
        break;
      default:
        this.react(type, {}, { big: d.buzz > 0.3 });
        if (d.clip && d.buzz > 0.35) this.say('kiri', this.pick([`切り抜きタイトル「${d.clip}」`, 'ここ切り抜きます']), { delay: 2.4, prio: 2 });
    }
  }

  // 結果画面用: コメント欄の物語のまとめ（名前のある人の最後の一言）
  stories() {
    const pick = ['taro', 'rom', 'ryo', 'mochi', 'piyo', 'haha', 'oji', 'gachi', 'oil', 'jyuman', 'mike', 'yu'];
    const out = [];
    for (const id of pick) {
      const v = this.byId[id];
      const last = this.finalWords[id] ?? this.lastNamed[id];
      if (v && last) out.push({ name: v.displayName, note: v.note, text: last, color: v.color, badge: v.badge });
    }
    return out;
  }
}
