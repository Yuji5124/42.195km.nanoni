import { EV } from '../core/events.js';

// 「なのに。」の文を作る。
//   1 つだけ    → その Modifier の end（例: 「魚眼なのに。」）
//   2〜3 つ     → 部品を組み立てる: 主語（subj）+ 様子（adv）+ 述語（pred）+「のに。」
//                  例: 巨人の侍が / 鏡の中で / TV中継されている → 「巨人の侍が鏡の中でTV中継されているのに。」
//                  主語がない時は「〜て、〜で、〜なのに。」とつなぐ
//   Modifier と関係ない短い文（「まだ312mなのに。」）もここ。すべて EventBus に流す（NANONI_TEXT / NANONI_COMBO）

export function endText(inst, ctx = {}) {
  return inst.def.nnEnd?.(inst, ctx) ?? inst.def.nn.end;
}

export function comboSentence(insts, ctx = {}) {
  const list = insts.slice().sort((a, b) => a.serial - b.serial).slice(-3);
  if (!list.length) return '';
  if (list.length === 1) return endText(list[0], ctx);
  const subj = list.find((i) => i.def.nn.subj);
  const pred = [...list].reverse().find((i) => i !== subj && i.def.nn.pred);
  const adv = list.find((i) => i !== subj && i !== pred && i.def.nn.adv);
  if (subj && pred) return `${subj.def.nn.subj}${adv ? adv.def.nn.adv : ''}${pred.def.nn.pred}のに。`;
  const last = list[list.length - 1];
  return `${list
    .slice(0, -1)
    .map((i) => i.def.nn.te)
    .join('、')}、${endText(last, ctx)}`;
}

// 距離・出来事の短い一言
const DISTANCE_LINES = {
  100: 'まだ100mなのに。',
  200: 'まだ半周なのに。',
  300: 'まだ300mなのに。',
  500: 'もう500mなのに。',
  600: 'あと200mなのに。',
};

export class NanoniVoice {
  // getState(): { d, running, finale, manager }
  constructor(bus, hud, getState) {
    this.bus = bus;
    this.hud = hud;
    this.getState = getState;
    this.pending = [];
    this.queue = [];
    this.cool = 0;
    this.count = 0;
    const say = (text, pri = 1) => this.say(text, pri);
    bus.on(EV.MODIFIER_START, (e) => this.pending.push(e));
    bus.on(EV.DISTANCE, ({ meters }) => DISTANCE_LINES[meters] && say(DISTANCE_LINES[meters], 1));
    bus.on(EV.LAP_2, () => say('あと1周もあるのに。', 2));
    bus.on(EV.FINAL_100, () => say('あと100mなのに。', 2));
    bus.on(EV.PLAYER_FIRST, () => say('先頭なのに。', 1));
    bus.on(EV.PLAYER_LAST, () => say('最下位なのに。', 0));
    bus.on(EV.STAMINA_LOW, () => say('もう脚が重いのに。', 1));
  }

  reset() {
    this.pending = [];
    this.queue = [];
    this.cool = 0;
    this.count = 0;
    this.last = '';
  }

  say(text, pri = 1) {
    const st = this.getState();
    if (!st.running || st.finale) return; // ラスト 40m は何も言わない
    this.queue.push({ text, pri });
    this.queue.sort((a, b) => b.pri - a.pri);
    if (this.queue.length > 3) this.queue.length = 3;
  }

  update(dt) {
    const st = this.getState();
    // 同じフレームに始まった Modifier はまとめて 1 つの文に
    if (this.pending.length) {
      const started = this.pending;
      this.pending = [];
      const running = st.manager.running;
      const ctx = { d: st.d };
      const count = running.length;
      if (count >= 2) {
        const text = comboSentence(running, ctx);
        this.count++;
        this.queue.unshift({ text, pri: 3, combo: count });
      } else if (started.length) {
        const inst = running.find((i) => i.id === started[started.length - 1].id);
        if (inst) {
          // たまに距離の一言に置き換える（「まだ312mなのに。」）
          const r = (Math.floor(st.d * 7.31) % 10) / 10;
          const text = r < 0.25 ? (st.d < 400 ? `まだ${Math.floor(st.d)}mなのに。` : `もう${Math.floor(st.d)}mなのに。`) : endText(inst, ctx);
          this.queue.unshift({ text, pri: 2 });
        }
      }
    }
    this.cool -= dt;
    if (this.cool > 0 || !this.queue.length) return;
    const item = this.queue.shift();
    if (item.text === this.last) return;
    this.last = item.text;
    this.hud.nanoni(item.text);
    if (item.combo) {
      this.hud.combo(`なのにCOMBO ×${item.combo}`);
      this.bus.emit(EV.NANONI_COMBO, { count: item.combo, text: item.text });
    } else this.bus.emit(EV.NANONI_TEXT, { text: item.text });
    this.cool = 2.1;
  }
}
