// 競歩のレース（three.js に依存しない・Node でも動く）。
//   10 人 × 残り 2000m（5 周）。プレイヤーのものは「ペース（5 段）・横の位置・SPACE（立て直す / 給水）」と、
//   ACTION（ActionSystem）が置いていく mods（手を振る・立ち止まる・寝たふり・走る…）。
//
// 見えないもの（画面に数字は出さない）
//   E    … 余力（0〜1）。速いほど・外を回るほど減る。前の人の真後ろ（風よけ）だと少し減りにくい。
//   lc   … ロス・オブ・コンタクト（浮き）。余力に見合わない速さで出る。走ったら 1。
//   bk   … ベントニー（膝の曲がり）。疲れで出る。変な歩き方でも出る。
// 体に出るもの（Gait が読む）: 腕が下がる・歩幅が縮む・頭が揺れる・前に倒れる・ふらつく・浮く・膝が曲がる・顔。
//
// 審判 6 人（周回の中の決まった場所）。前を通るたびに、その時のフォームを見る。
//   黄色のパドル（注意）→ 赤カード（掲示板へ）。赤 3 枚でペナルティゾーン（30 秒）、4 枚で失格。
//
// 出すイベント（emit）: lap / bell / remain / overtake / overtaken / leader / paddle / red / penalty / penaltyEnd / dq /
//   tripStart / trip / fall / water / waterMiss / finish / surge / kick / fatigue / formBad / goodForm / blocked / stop

import { LAP, RACE, JUDGES, WATER, PENALTY, progressFactor, crossed } from './track.js';
import { ATHLETES, PACES } from './athletes.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (k) => {
  const x = clamp(k);
  return x * x * (3 - 2 * x);
};

const K1 = 0.0025; // 余力の減り（速さの 2 乗）
const K2 = 0.02; // 速すぎる時の追加
const BASE_DRAIN = 0.0005;

export function drainRate(v, a) {
  const easy = a.vSus - 0.65;
  return BASE_DRAIN + K1 * Math.max(0, v - easy) ** 2 + K2 * Math.max(0, v - (a.vSus + 0.17)) ** 2;
}

// 余力から出せる速さの上限
export function speedCap(E, a) {
  if (E < 0.02) return 4.1;
  return a.kick * (0.8 + 0.2 * smooth(E / 0.32));
}

// 余力から決まる「浮かずに歩ける速さ」
export function legalSpeed(E, focus = 0) {
  return 4.8 + 0.34 * E + 0.08 * focus;
}

// 集団のペース（残り距離）
function packPace(rem) {
  if (rem > 1600) return 4.4;
  if (rem > 1200) return 4.44;
  if (rem > 800) return 4.5;
  if (rem > 400) return 4.56;
  return 4.66;
}

class Walker {
  constructor(a, i) {
    this.a = a;
    this.id = a.id;
    this.i = i;
    this.player = !!a.player;
    this.d = a.gap; // 8000m 通過からの距離（最初は先頭からの差。マイナス = まだ 8000m の手前）
    this.y = 0.1 + (i % 3) * 0.55;
    this.v = 4.4;
    this.vT = 4.4;
    this.E = a.e0;
    this.phase = i * 1.7;
    this.stepLen = 1.22;
    this.lc = 0;
    this.bk = 0;
    this.lcAvg = 0;
    this.bkAvg = 0;
    this.red = 0;
    this.redBy = new Set();
    this.yellowBy = new Set(); // `${judge}:${type}`
    this.yellows = 0;
    this.penaltyPending = false;
    this.inPenalty = false;
    this.penaltyLeft = 0;
    this.penaltyServed = 0;
    this.dq = false;
    this.finished = false;
    this.finishT = 0;
    this.place = 0;
    this.rank = i + 1;
    this.trip = 0; // つまずきのよろけ（秒）
    this.fall = 0; // 転倒の経過（秒・0 = 転んでいない）
    this.drink = 0; // 水を飲んでいる（秒）
    this.drinkLap = -1;
    this.draft = false;
    this.blocked = null;
    this.kicking = false;
    this.surge = 0;
    this.yT = this.y;
    this.stopped = false;
    this.afterFinish = 0;
  }

  get rem() {
    return RACE.dist - this.d;
  }
}

export class RaceSim {
  constructor({ rng, emit = () => {} } = {}) {
    this.rng = rng;
    this.emit = emit;
    this.reset();
  }

  reset() {
    this.t = 0;
    this.walkers = ATHLETES.map((a, i) => new Walker(a, i));
    this.player = this.walkers.find((w) => w.player);
    this.order = [...this.walkers];
    this.finishers = [];
    this.ctl = { pace: 2, lat: 0, space: false };
    // ACTION が置いていく効果（ActionSystem が書く）
    this.mods = {
      speedMul: 1,
      speedUntil: 0,
      stopUntil: 0,
      lcAdd: 0,
      bkAdd: 0,
      formUntil: 0,
      tripAdd: 0,
      tripUntil: 0,
      focusUntil: 0,
      runUntil: 0,
      lieUntil: 0,
      backUntil: 0,
      arm: null, // wave / thumb / phone / drink / point / none
      armUntil: 0,
      distract: 0, // コメント欄を見ている等（つまずき・フォームに効く）
      distractUntil: 0,
    };
    this.attention = 1; // 審判の注目（炎上で上がる）
    this.heatFocus = 0; // 炎上で集中が切れる（つまずきやすい）
    this.qte = null;
    this.stats = { trips: 0, falls: 0, yellows: 0, reds: 0, water: 0, bestRank: 99, lead: 0, overtakes: 0, overtaken: 0, stopSec: 0, penalty: 0 };
    this.rankHold = 0;
    this.sortWalkers();
    this.shownRank = this.player.rank;
    this.leader = null;
    this.fatigueLevel = 0;
    this.formBadT = 0;
    this.goodFormT = 0;
    this.remainMarks = new Set();
    this.done = false;
    this.doneT = 0;
    this.surged = false;
    this.lastLap = 0;
    this.sortWalkers();
  }

  get clock() {
    return RACE.clock0 + this.t;
  }

  get lapsToGo() {
    return Math.max(0, Math.ceil((RACE.dist - Math.max(0, this.player.d)) / LAP - 1e-6));
  }

  // 1 フレーム（dt 秒）
  step(dt) {
    if (this.done) {
      this.t += dt;
      this.doneT += dt;
      for (const w of this.walkers) this.moveAfter(w, dt);
      return;
    }
    this.t += dt;
    const P = this.player;
    for (const w of this.walkers) {
      const prevD = w.d;
      if (w.finished) {
        this.moveAfter(w, dt);
        continue;
      }
      if (w.dq) {
        w.v = Math.max(0, w.v - 3 * dt);
        w.yT = 9.5;
        w.y += (w.yT - w.y) * Math.min(1, dt * 0.6);
        w.d += w.v * dt * 0.5;
        this.gait(w, dt);
        continue;
      }
      if (w.inPenalty) {
        this.penaltyStep(w, dt);
        this.gait(w, dt);
        continue;
      }
      if (w.player) this.playerSpeed(w, dt);
      else this.aiSpeed(w, dt);
      this.traffic(w, dt);
      // 進む（カーブの外は損）
      const f = progressFactor(w.d, w.y);
      w.d += w.v * dt * f;
      // 余力
      let drain = drainRate(w.v, w.a);
      if (w.draft) drain *= 0.88;
      if (w.v < 0.5) drain = -0.004; // 止まると少し戻る
      w.E = clamp(w.E - drain * dt);
      if (w.drink > 0) {
        w.drink -= dt;
        w.E = clamp(w.E + 0.016 * dt);
      }
      this.form(w, dt);
      this.gait(w, dt);
      this.judges(w, prevD);
      this.waterCheck(w, prevD);
      if (w.penaltyPending && crossed(prevD, w.d, PENALTY.s - 6)) this.enterPenalty(w);
      if (w.d >= RACE.dist) this.finish(w);
    }
    this.sortWalkers();
    this.playerEvents(dt);
    this.aiEvents();
    if (!this.done && (P.finished || P.dq)) {
      // プレイヤーが終わってから、ほかの選手を少し待つ
      // ゴール（失格）の後も少しは配信が続く（コメント欄の締め・ACTION「倒れ込む」など）
      const left = this.walkers.filter((w) => !w.finished && !w.dq);
      const lastFinT = this.finishers.length ? this.finishers[this.finishers.length - 1].finishT : this.t;
      const since = this.t - (P.dq ? this.dqT : P.finishT);
      if (since > 13 && (left.length === 0 || this.t - lastFinT > 14 || since > 32)) {
        this.done = true;
        this.doneT = 0;
        this.emit('raceEnd', {});
      }
    }
  }

  // ---- プレイヤーの速さ
  playerSpeed(w, dt) {
    const m = this.mods;
    const t = this.t;
    let vT = PACES[this.ctl.pace].v;
    vT = Math.min(vT, speedCap(w.E, w.a));
    if (t < m.speedUntil) vT *= m.speedMul;
    if (t < m.focusUntil) vT *= 1.012;
    if (t < m.backUntil) vT = Math.min(vT, 3.2);
    if (t < m.runUntil) vT = Math.max(vT, 5.7);
    let acc = 0.45;
    let dec = 1.1;
    if (t < m.stopUntil || t < m.lieUntil || w.fall > 0) {
      vT = 0;
      dec = w.fall > 0 ? 6 : 3.2;
      this.stats.stopSec += dt;
    }
    if (w.trip > 0) {
      vT *= 0.72;
      dec = 4;
      w.trip -= dt;
    }
    if (t < m.runUntil) acc = 1.6;
    w.vT = vT;
    w.v += clamp(vT - w.v, -dec * dt, acc * dt);
    // 横（←→）。立ち止まっている時は動かない
    if (w.fall <= 0 && t >= m.lieUntil) w.y += this.ctl.lat * 1.35 * dt;
    // 給水を取りに行く（ACTION「水を飲む」）: レーン 2 へ寄って、取ったら戻る
    if (this.waterAuto && this.ctl.lat === 0) {
      const tgt = this.nearWater(w) ? WATER.y - WATER.reach + 0.35 : 0.2;
      w.y += clamp(tgt - w.y, -0.9 * dt, 1.2 * dt);
      if (!this.nearWater(w) && w.y < 0.3) this.waterAuto = false;
    }
    w.y = clamp(w.y, 0, 8.6);
  }

  // ---- AI の速さ（集団・戦術・余力）
  aiSpeed(w, dt) {
    const a = w.a;
    const rem = w.rem;
    let vT = packPace(rem) + (a.vSus - 4.5) * 0.6;
    // 先頭を引く・揺さぶる
    if (a.style === 'lead' && rem < 1250 && rem > 980) vT += 0.14;
    if (a.style === 'surge' && rem < 1560 && rem > 1240) vT += 0.2;
    if (a.style === 'sit') {
      const ahead = this.nearestAhead(w, 4);
      if (ahead) vT = Math.min(vT + 0.05, ahead.v + 0.02);
    }
    // ラスト
    const kickAt = a.kickAt ?? 300;
    if (rem < kickAt && w.E > 0.08) {
      if (!w.kicking) {
        w.kicking = true;
        if (rem > 120) this.emit('kick', { id: w.id, name: a.short, rem });
      }
      vT = a.kick;
    }
    // 先頭集団から大きく離れた選手は自分のペース
    vT = Math.min(vT, speedCap(w.E, a));
    // ふらつき（少しだけ）
    vT += Math.sin(this.t * 0.37 + w.i * 2.1) * 0.03;
    if (w.trip > 0) {
      vT *= 0.75;
      w.trip -= dt;
    }
    if (w.drink > 0) vT *= 0.985;
    w.vT = vT;
    w.v += clamp(vT - w.v, -1.1 * dt, 0.42 * dt);
    // 横: 基本は内側。前が詰まっていたら外へ
    w.y += clamp(w.yT - w.y, -0.9 * dt, 0.9 * dt);
    // ときどき つまずく（AI）
    if (this.rng.next() < 0.00012 * dt * 60) w.trip = 0.6;
  }

  nearestAhead(w, within, dyMax = 0.7) {
    let best = null;
    let bd = within;
    for (const o of this.walkers) {
      if (o === w || o.finished || o.dq || o.inPenalty) continue;
      const dd = o.d - w.d;
      if (dd > 0 && dd < bd && Math.abs(o.y - w.y) < dyMax) {
        bd = dd;
        best = o;
      }
    }
    return best;
  }

  // ---- 前が詰まる・風よけ・横の接触・AI の追い越しライン
  traffic(w, dt) {
    w.draft = false;
    w.blocked = null;
    let blocked = null;
    let bd = 9;
    for (const o of this.walkers) {
      if (o === w || o.finished || o.dq || o.inPenalty) continue;
      const dd = o.d - w.d;
      const dy = Math.abs(o.y - w.y);
      if (dd > 0.45 && dd < 2.4 && dy < 0.7) w.draft = true;
      if (dd > 0 && dd < 0.85 && dy < 0.55 && dd < bd) {
        bd = dd;
        blocked = o;
      }
      // 横に並んでいる人の方へは寄れない
      if (Math.abs(dd) < 0.7 && dy < 0.56) {
        const push = o.y > w.y ? -1 : 1;
        w.y += push * (0.56 - dy) * Math.min(1, dt * 6);
      }
    }
    if (blocked) {
      w.blocked = blocked;
      if (w.v > blocked.v) w.v += (blocked.v - w.v) * Math.min(1, dt * 5);
    }
    if (!w.player) {
      // 速く行きたいのに前が詰まっていたら外へ出る。空いていたら内へ戻る
      const ahead = this.nearestAhead(w, 2.2, 0.6);
      if (ahead && w.vT > ahead.v + 0.04) w.yT = Math.min(3, ahead.y + 0.75);
      else if (!this.sideBusy(w, -0.6)) w.yT = Math.max(0.05, w.yT - dt * 0.5);
      w.y = clamp(w.y, 0, 8.6);
    }
  }

  sideBusy(w, dir) {
    for (const o of this.walkers) {
      if (o === w || o.finished || o.dq) continue;
      if (Math.abs(o.d - w.d) < 1.4 && Math.sign(o.y - w.y) === Math.sign(dir) && Math.abs(o.y - w.y) < 0.9) return true;
    }
    return false;
  }

  // ---- フォーム（浮き・膝）
  form(w, dt) {
    const t = this.t;
    const m = this.mods;
    const focus = w.player && t < m.focusUntil ? 1 : 0;
    const vL = legalSpeed(w.E, focus);
    let lc = clamp((w.v - vL) / 0.45);
    let bk = clamp((0.3 - w.E) / 0.3) * 0.55;
    if (!w.player) {
      lc *= w.a.form;
      bk *= w.a.form * 0.62;
    } else {
      if (t < m.formUntil) {
        lc += m.lcAdd;
        bk += m.bkAdd;
      }
      if (t < m.runUntil) lc = 1;
      if (t < m.distractUntil) bk += 0.06 * m.distract;
      if (focus) {
        lc *= 0.6;
        bk *= 0.6;
      }
      lc = clamp(lc);
      bk = clamp(bk);
    }
    if (w.v < 2) {
      lc = 0;
      bk = 0;
    }
    w.lc = lc;
    w.bk = bk;
    const k = Math.min(1, dt / 1.4);
    w.lcAvg += (lc - w.lcAvg) * k;
    w.bkAvg += (bk - w.bkAvg) * k;
  }

  // ---- 歩きの位相・歩幅
  gait(w, dt) {
    const fat = 1 - w.E;
    w.stepLen = 1.2 + 0.07 * (w.v - 4.4) - 0.07 * Math.max(0, fat - 0.4);
    if (w.v > 0.3) w.phase += (Math.PI * w.v * dt) / Math.max(0.6, w.stepLen);
    if (w.fall > 0) w.fall += dt;
    if (w.fall > 3.2) w.fall = 0;
  }

  // ---- 審判
  judges(w, prevD) {
    if (w.v < 1.5) return;
    for (const j of JUDGES) {
      if (!crossed(prevD, w.d, j.s)) continue;
      const att = w.player ? this.attention : 1;
      const sev = Math.max(w.lcAvg, w.bkAvg);
      const type = w.lcAvg >= w.bkAvg ? '~' : '<';
      const key = `${j.id}:${type}`;
      const rng = this.rng.next();
      const yellowed = w.yellowBy.has(key);
      // 赤（1 人の審判から 1 枚まで）
      if (!w.redBy.has(j.id) && sev > 0.38) {
        let p = clamp((sev - 0.36) * 1.7, 0, 0.95) * att;
        if (yellowed) p *= 1.6;
        if (rng < p) {
          this.giveRed(w, j, type);
          continue;
        }
      }
      if (!yellowed && sev > 0.2) {
        const p = clamp((sev - 0.17) * 2.1, 0, 0.92) * Math.min(1.5, att);
        if (this.rng.next() < p) {
          w.yellowBy.add(key);
          w.yellows++;
          if (w.player) this.stats.yellows++;
          this.emit('paddle', { id: w.id, judge: j.id, type, player: w.player, name: w.a.short });
        }
      }
    }
  }

  giveRed(w, j, type) {
    w.redBy.add(j.id);
    w.red++;
    if (w.player) this.stats.reds++;
    this.emit('red', { id: w.id, judge: j.id, type, count: w.red, player: w.player, name: w.a.short });
    if (w.red >= 4 && !w.dq) {
      w.dq = true;
      if (w.player) this.dqT = this.t;
      this.emit('dq', { id: w.id, player: w.player, name: w.a.short });
    } else if (w.red === 3) {
      w.penaltyPending = true;
    }
  }

  enterPenalty(w) {
    w.penaltyPending = false;
    w.inPenalty = true;
    w.penaltyLeft = PENALTY.sec;
    w.penaltyServed++;
    if (w.player) this.stats.penalty++;
    this.emit('penalty', { id: w.id, player: w.player, name: w.a.short, sec: PENALTY.sec });
  }

  penaltyStep(w, dt) {
    // ゾーンへ寄って止まる → 時間が来たら戻る
    w.penaltyLeft -= dt;
    if (w.penaltyLeft > 0) {
      w.yT = PENALTY.y;
      w.y += clamp(w.yT - w.y, -2.2 * dt, 2.2 * dt);
      const moving = Math.abs(w.yT - w.y) > 0.2;
      w.v += clamp((moving ? 1.6 : 0) - w.v, -3 * dt, 1 * dt);
      w.d += w.v * dt * 0.35;
      if (w.player) this.stats.stopSec += dt;
      w.E = clamp(w.E + 0.006 * dt);
    } else {
      w.inPenalty = false;
      w.yT = 0.3;
      this.emit('penaltyEnd', { id: w.id, player: w.player, name: w.a.short });
    }
  }

  // 給水所の手前（SPACE / ACTION で取れる範囲）
  nearWater(w = this.player) {
    const l = (((w.d - WATER.s) % LAP) + LAP) % LAP;
    return l > LAP - 34 || l < 1;
  }

  waterCheck(w, prevD) {
    if (!crossed(prevD, w.d, WATER.s)) return;
    const lap = Math.floor(w.d / LAP);
    if (w.drinkLap === lap) return;
    if (w.player) {
      const want = this.waterWanted;
      const reach = w.y >= WATER.y - WATER.reach;
      if (want && reach) {
        this.waterAuto = this.waterAuto ? 'back' : false;
        w.drinkLap = lap;
        w.drink = 3;
        this.stats.water++;
        this.emit('water', { id: w.id, player: true });
      } else this.emit('waterMiss', { reach, want });
      this.waterWanted = false;
    } else if (this.rng.next() < 0.45) {
      w.drinkLap = lap;
      w.drink = 2.5;
    }
  }

  finish(w) {
    w.finished = true;
    w.finishT = this.t;
    w.place = this.finishers.length + 1;
    this.finishers.push(w);
    this.emit('finish', { id: w.id, place: w.place, player: w.player, name: w.a.short, time: RACE.clock0 + this.t });
  }

  moveAfter(w, dt) {
    // フィニッシュの後: 歩いて止まる
    w.afterFinish += dt;
    const vT = w.afterFinish < 2 ? 3 : w.afterFinish < 5 ? 1.2 : 0;
    w.v += clamp(vT - w.v, -2 * dt, 1 * dt);
    w.d += w.v * dt;
    if (w.player) w.y += clamp(1.5 - w.y, -dt, dt);
    if (w.fall > 0) w.fall += dt;
    if (w.v > 0.3) w.phase += (Math.PI * w.v * dt) / 1.1;
  }

  sortWalkers() {
    const score = (w) => (w.dq ? -1e6 + w.d : w.finished ? 1e6 - w.finishT : w.d);
    this.order = [...this.walkers].sort((a, b) => score(b) - score(a));
    this.order.forEach((w, i) => (w.rank = i + 1));
  }

  // ---- プレイヤーの出来事（順位の変化・疲れの段階・フォーム・つまずき・残り距離）
  playerEvents(dt) {
    const P = this.player;
    const t = this.t;
    // つまずきの QTE
    if (this.qte) {
      this.qte.t += dt;
      if (this.ctl.space) {
        this.qte = null;
        P.trip = 0.9;
        this.stats.trips++;
        this.emit('trip', { recovered: true });
      } else if (this.qte.t > this.qte.window) {
        this.qte = null;
        P.fall = 0.001;
        P.v *= 0.4;
        P.E = clamp(P.E - 0.025);
        this.stats.falls++;
        this.emit('fall', {});
      }
    } else if (!P.finished && !P.dq && !P.inPenalty && P.fall <= 0 && P.v > 2.5) {
      const m = this.mods;
      const fat = 1 - P.E;
      let h = 0.0011 + 0.0075 * Math.max(0, fat - 0.35) ** 2 * 4;
      if (t < m.distractUntil) h += 0.012 * m.distract;
      if (t < m.tripUntil) h += m.tripAdd;
      h += 0.0011 * this.heatFocus;
      if (t < m.focusUntil) h *= 0.35;
      if (P.blocked && P.blocked.d - P.d < 0.6) h += 0.03;
      if (this.rng.next() < h * dt) {
        this.qte = { t: 0, window: 0.95 - 0.3 * clamp(fat) };
        this.emit('tripStart', { window: this.qte.window });
      }
    }
    if (this.ctl.space && !this.qte && this.nearWater()) this.waterWanted = true;
    this.ctl.space = false;

    if (P.finished || P.dq) return;
    // 順位（0.7 秒続いたら確定。横に並んでいる時のちらつきを抑える）
    if (P.rank !== this.shownRank) {
      this.rankHold += dt;
      if (this.rankHold > 0.7) {
        const before = this.shownRank;
        this.shownRank = P.rank;
        this.rankHold = 0;
        if (P.rank < before) {
          this.stats.overtakes += before - P.rank;
          this.emit('overtake', { rank: P.rank, from: before, who: this.order[P.rank]?.a.short });
        } else {
          this.stats.overtaken += P.rank - before;
          this.emit('overtaken', { rank: P.rank, from: before, who: this.order[P.rank - 2]?.a.short });
        }
      }
    } else this.rankHold = 0;
    this.stats.bestRank = Math.min(this.stats.bestRank, this.shownRank);
    if (this.shownRank === 1) this.stats.lead += dt;
    const lead = this.order[0];
    if (lead !== this.leader) {
      const prev = this.leader;
      this.leader = lead;
      if (prev) this.emit('leader', { id: lead.id, player: lead.player, name: lead.a.short });
    }
    // 疲れの見え方（段階が変わったら）
    const E = P.E;
    const lvl = E > 0.6 ? 0 : E > 0.46 ? 1 : E > 0.32 ? 2 : E > 0.17 ? 3 : 4;
    if (lvl > this.fatigueLevel || lvl < this.fatigueLevel - 1) {
      this.fatigueLevel = lvl;
      this.emit('fatigue', { level: lvl });
    }
    // フォーム
    const sev = Math.max(P.lcAvg, P.bkAvg);
    if (sev > 0.3) {
      this.formBadT += dt;
      if (this.formBadT > 1.2) {
        this.formBadT = -8;
        this.emit('formBad', { type: P.lcAvg >= P.bkAvg ? '~' : '<', sev });
      }
    } else if (this.formBadT > 0) this.formBadT = 0;
    else this.formBadT = Math.min(0, this.formBadT + dt);
    if (t < this.mods.focusUntil && sev < 0.08) {
      this.goodFormT += dt;
      if (this.goodFormT > 4) {
        this.goodFormT = -20;
        this.emit('goodForm', {});
      }
    }
    // 周回・残り
    const lap = Math.floor(Math.max(0, P.d) / LAP);
    if (lap > this.lastLap) {
      this.lastLap = lap;
      const left = 5 - lap;
      if (left === 1) this.emit('bell', {});
      else if (left > 0) this.emit('lap', { left });
    }
    for (const r of [1500, 1000, 600, 200, 100, 50]) {
      if (P.rem < r && !this.remainMarks.has(r)) {
        this.remainMarks.add(r);
        this.emit('remain', { m: r });
      }
    }
  }

  aiEvents() {
    const mk = this.walkers.find((w) => w.id === 'makabe');
    if (!this.surged && mk && mk.rem < 1240) {
      this.surged = true;
      this.emit('surge', { id: 'makabe', name: mk.a.short });
    }
  }

  // 先頭（または目標）までの差（秒）
  gapTo(w, other = this.order[0]) {
    if (!other || other === w) return 0;
    return (other.d - w.d) / Math.max(3, w.v || 4.4);
  }

  ahead(w = this.player) {
    return this.order[w.rank - 2] ?? null;
  }

  behind(w = this.player) {
    return this.order[w.rank] ?? null;
  }
}
