// 自動操縦（テスト・デモ用）。?auto=serious|balance|flame
//   serious … 真面目に歩くだけ（給水・追い越し・ラストのスパート）。ACTION は「真面目」系だけ
//   balance … 真面目に歩きつつ、ほどほどにふざける（寝たふり・走るはしない）
//   flame   … 誘惑は全部押す

const FUN = ['wave', 'thumb', 'yoyu', 'deny', 'look', 'readsc', 'laughoff', 'thanks', 'smile', 'lol', 'poker', 'hype', 'rival', 'wave2', 'chatter', 'readall', 'shout', 'subscribe', 'handshake', 'cry', 'collapse'];
const MILD_TEMPT = ['reply', 'weird', 'enshutsu', 'wrongname', 'genki', 'peace'];

export class Autopilot {
  constructor(session, style = 'serious', rng) {
    this.s = session;
    this.style = style;
    this.rng = rng;
    this.nextAct = 6 + rng.next() * 4;
    this.qteDelay = 0.25 + rng.next() * 0.2;
  }

  step() {
    const s = this.s;
    const sim = s.sim;
    const P = sim.player;
    const st = this.style;
    // 歩き
    sim.ctl.pace = st === 'flame' ? 2 : P.rem < 290 ? 4 : P.rem < 700 ? 3 : 2;
    let lat = 0;
    if (P.blocked) lat = 1;
    else if (P.y > 0.35 && !sim.sideBusy(P, -0.6) && !sim.waterAuto) lat = -1;
    sim.ctl.lat = lat;
    if (sim.qte) {
      const skill = st === 'serious' ? 0.95 : st === 'balance' ? 0.8 : 0.5;
      if (sim.qte.t > this.qteDelay) {
        if (this.rng.next() < skill) sim.ctl.space = true;
        this.qteDelay = sim.qte.window + 1; // 失敗する時は押さない
      }
    } else this.qteDelay = 0.25 + this.rng.next() * 0.2;
    const list = s.actions.list;
    const has = (id) => list.some((a) => a.id === id);
    if (st !== 'flame' && has('water')) s.doAction('water');
    // ACTION
    if (s.t < this.nextAct) return;
    let pick = null;
    if (st === 'serious') {
      pick = ['focus', 'serious', 'back2', 'ignore'].find(has) ?? null;
      this.nextAct = s.t + 12 + this.rng.next() * 6;
    } else if (st === 'balance') {
      if (P.rem < 400 && !P.finished) pick = has('focus') ? 'focus' : null;
      else {
        const tempt = this.rng.next() < 0.35 ? MILD_TEMPT.filter(has) : [];
        const fun = FUN.filter(has);
        const pool = tempt.length ? tempt : fun;
        pick = pool.length ? pool[Math.floor(this.rng.next() * pool.length)] : null;
      }
      this.nextAct = s.t + 11 + this.rng.next() * 9;
    } else {
      const tempt = list.filter((a) => a.tempt).map((a) => a.id);
      const fun = FUN.filter(has);
      const pool = tempt.length ? tempt : fun;
      pick = pool.length ? pool[Math.floor(this.rng.next() * pool.length)] : null;
      this.nextAct = s.t + 4 + this.rng.next() * 4;
    }
    if (pick) s.doAction(pick);
  }
}
