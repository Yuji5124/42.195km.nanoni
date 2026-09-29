import { EV } from '../core/events.js';
import { formatTime } from '../core/mathx.js';
import { REGISTRY } from '../modifiers/registry.js';

// 実況（画面下の字幕）。真面目な陸上中継の言葉で、変なことが起きても淡々と伝える。
//   実況が遅れる（P.audio.announcerDelay 秒）/ 未来の実況（P.audio.announcerFuture）も、ここで扱う。
//   ラスト 40m（760m〜）は黙る。ゴールの瞬間だけ叫ぶ。

export class Announcer {
  // get(): { core, runners(RUNNERS), P, cheer }
  constructor(bus, hud, get) {
    this.bus = bus;
    this.hud = hud;
    this.get = get;
    this.queue = [];
    this.cool = 0;
    this.futureT = 0;
    const say = (text, pri = 1) => this.push(text, pri);
    const leader = () => {
      const g = this.get();
      return g.runners[g.core.ranked[0].index].name;
    };
    const time = () => formatTime(this.get().core.time);
    bus.on(EV.ON_YOUR_MARKS, () => say('男子800m決勝。各選手、スタートラインに並びます。', 2));
    bus.on(EV.RACE_START, () => say('スタートしました！', 3));
    bus.on(EV.DISTANCE, ({ meters }) => {
      if (meters === 200) say(`200m通過、先頭は${leader()}。${time()}。`, 1);
      if (meters === 600) say('残り200m！ ここからが800mです！', 2);
    });
    bus.on(EV.LAP_2, () => say(`鐘が鳴りました、ラスト1周！ 先頭は${leader()}、400mは${time()}！`, 2));
    bus.on(EV.PLAYER_FIRST, () => say('侍が先頭に立ちました！', 2));
    bus.on(EV.PLAYER_OVERTAKE, ({ rank }) => rank <= 3 && say(`侍、${rank}番手に上がった！`, 1));
    bus.on(EV.FINAL_100, () => say('最後の直線！', 2));
    bus.on(EV.MODIFIER_START, (e) => {
      const d = REGISTRY.get(e.id);
      if (!d || e.source === 'url') return;
      if (d.legendary) say(`……信じられません。${d.nn.name}！`, 3);
      else if ((e.d * 7) % 10 < 4) say(`えー、ただいま「${d.nn.name}」となっております。`, 0);
    });
    bus.on('CHAOS_CALM', () => {
      // ラスト 40m の合図だけ言って、あとはゴールまで黙る
      this.queue = [];
      this.show('……静かになりました。残り40m、ここからは本当の勝負！', 2600);
      this.cool = 99;
    });
    bus.on(EV.FINISH, ({ place, time: t }) => {
      this.queue = [];
      this.cool = 4;
      this.show(`侍、${place}着でゴール！ タイムは${formatTime(t)}！`, 4000);
    });
  }

  reset() {
    this.queue = [];
    this.hud.announce('', 10);
    this.cool = 0;
    this.futureT = 2;
  }

  push(text, pri) {
    const g = this.get();
    const d = g.core.player.d;
    if (g.core.running && d >= 760 && pri < 3) return;
    const delay = g.P.audio.announcerDelay || 0;
    this.queue.push({ text: delay ? `${text}（${delay}秒前の実況）` : text, pri, at: g.clock + delay });
    this.queue.sort((a, b) => a.at - b.at || b.pri - a.pri);
    if (this.queue.length > 4) this.queue.splice(1, this.queue.length - 4);
  }

  show(text, ms = 3200) {
    this.hud.announce(text, ms);
    this.bus.emit('ANNOUNCE', { text });
  }

  update(dt) {
    const g = this.get();
    this.cool -= dt;
    // 未来の実況: まだ起きていないことを先に言う
    if (g.P.audio.announcerFuture > 0.5 && g.core.running) {
      this.futureT -= dt;
      if (this.futureT <= 0) {
        this.futureT = 3.2;
        const p = g.core.player;
        const pred = g.core.time + (800 - p.d) / Math.max(4, p.v);
        const lines = [
          `【未来】${Math.min(790, Math.floor(p.d / 50) * 50 + 150)}m通過、侍が${Math.max(1, p.rank - 2)}番手に上がりました！`,
          `【未来】ゴール！ 侍のタイムは${formatTime(pred)}！`,
          '【未来】このあと、観客が全員走り出します。',
          '【未来】残り40m、音楽が消えます。',
        ];
        this.queue.unshift({ text: lines[Math.floor((p.d / 13) % lines.length)], pri: 2, at: g.clock });
      }
    }
    // 古くなった実況は捨てる（「残り200m！」を 700m で言わない）。遅れる実況はわざとなので捨てない
    this.queue = this.queue.filter((q) => q.pri >= 3 || g.clock - q.at < 4 || q.text.includes('秒前の実況'));
    const top = this.queue[0];
    if (!top || top.at > g.clock) return;
    // 大事な実況（先頭・ラスト1周・最後の直線）は少し早く割り込める
    if (this.cool > (top.pri >= 2 ? 1.8 : 0)) return;
    this.queue.shift();
    this.show(top.text);
    this.cool = 3.4;
  }
}
