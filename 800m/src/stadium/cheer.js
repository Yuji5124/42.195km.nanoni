import { EV } from '../core/events.js';
import { clamp } from '../core/mathx.js';

// 観客の盛り上がり（CHEER 0〜100）。背景ではなく、レースに反応する。
//   上がる: 順位が上がる / 先頭に立つ / 接戦 / おかしな出来事 / ラストスパート / リズムが揃う
//   CHEER 80 以上: スタミナが少し回復（physiology.js）。勝敗を決めるほどではない
// 観客の Modifier（歓声の逆再生など）も「反応」は同じ値から。

export class CrowdEnergy {
  constructor(bus) {
    this.bus = bus;
    this.value = 20;
    this.pulse = 0; // 直近の反応（音の歓声の大きさ）
    const react = (amount, type) => {
      this.value = clamp(this.value + amount, 0, 100);
      this.pulse = Math.max(this.pulse, amount / 15);
      bus.emit(EV.CROWD_REACT, { type, amount, value: this.value });
    };
    bus.on(EV.RACE_START, () => react(18, 'start'));
    bus.on(EV.PLAYER_OVERTAKE, () => react(7, 'overtake'));
    bus.on(EV.PLAYER_FIRST, () => react(16, 'lead'));
    bus.on(EV.LAP_2, () => react(8, 'bell'));
    bus.on(EV.MODIFIER_START, (e) => react(e.legendary ? 20 : 4, 'strange'));
    bus.on(EV.FINAL_100, () => react(12, 'final100'));
    bus.on(EV.FINAL_40, () => react(14, 'final40'));
    bus.on(EV.RUNNER_FINISH, (e) => e.place === 1 && react(30, 'winner'));
    bus.on(EV.RHYTHM, (e) => e.grade === 'PERFECT' && e.streak > 0 && e.streak % 16 === 0 && react(4, 'rhythm'));
  }

  reset() {
    this.value = 20;
    this.pulse = 0;
    this.closeT = 0;
  }

  update(dt, core) {
    const p = core.player;
    if (!core.running) {
      this.pulse = Math.max(0, this.pulse - dt);
      return;
    }
    // 接戦（誰かと 1m 以内で並走）
    let close = false;
    for (const r of core.runners) if (r !== p && Math.abs(r.d - p.d) < 1.0 && Math.abs(r.off - p.off) < 1.6) close = true;
    if (close) this.value += dt * 3;
    if (p.bursting && p.d > 650) this.value += dt * 6;
    // 順位に応じた普段の盛り上がりへ戻る
    const base = 18 + (core.n - p.rank) * 3 + (p.d > 700 ? 20 : 0);
    this.value += (base - this.value) * Math.min(1, dt * 0.25);
    this.value = clamp(this.value, 0, 100);
    this.pulse = Math.max(0, this.pulse - dt * 1.2);
  }
}
