import { PITCH } from './MatchSim.js';
import { clamp } from '../../../src/core/math.js';

// MatchDirector: 90 分を 9 倍速で再生しない。
//   選手とボールはいつも普通の速さ。時計だけが速く進み（前半 45 分 ≒ 実時間 3〜4 分）、
//   「見せ場（moment）」を時刻どおりに起こすため、攻撃の組み立て（パスの連続 → クロス / スルーパス → シュート）を
//   逆算して始める。見せ場と見せ場の間はつなぎのポゼッション（横パス・奪い合い）。
//   ゴールの後は喜ぶ → 自陣へ戻る → キックオフ（場面転換）。
//
// 見せ場の表（data/timeline.js）: { t: シュートの実時刻(秒), team, outcome: goal|save|wide|over|post, final: through|cross|corner|long, big }
// 出すイベント（bus 'match'）: kickoff / buildup / chance / bigChance / shot / goal / save / miss / restart / addedTime / whistle

const HALF = 45 * 60;

export class MatchDirector {
  constructor(sim, bus, rng, { moments = [], halfSeconds = 225 } = {}) {
    this.sim = sim;
    this.bus = bus;
    this.rng = rng;
    this.moments = moments.map((m) => ({ ...m, done: false }));
    this.halfSeconds = halfSeconds;
    this.rate = HALF / halfSeconds;
    this.state = 'prematch';
    this.realT = 0;
    this.clock = 0;
    this.score = { home: 0, away: 0 };
    this.goals = [];
    this.play = null;
    this.addedShown = false;
    this.addedMinutes = 2;
    this.lastEvent = null;
  }

  emit(type, info = {}) {
    const ev = { type, t: this.realT, clock: this.clock, minute: this.minute, ...info };
    this.lastEvent = ev;
    this.bus.emit('match', ev);
  }

  get minute() {
    return Math.floor(this.clock / 60) + 1;
  }

  clockText() {
    if (this.clock < HALF) {
      const m = Math.floor(this.clock / 60);
      const s = Math.floor(this.clock % 60);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    const extra = this.clock - HALF;
    const m = Math.floor(extra / 60);
    const s = Math.floor(extra % 60);
    return `45:00 +${m}:${String(s).padStart(2, '0')}`;
  }

  // ------------------------------------------------------------------
  start() {
    this.state = 'live';
    this.startKickoff('home');
    this.emit('kickoff', { team: 'home' });
  }

  update(dt) {
    const sim = this.sim;
    if (this.state === 'live') {
      this.realT += dt;
      const rate = this.clock < HALF ? this.rate * (this.fastForward ?? 1) : this.addedRate ?? 1;
      this.clock += dt * rate;
      if (this.clock >= HALF - 60 * 1.2 && !this.addedShown) {
        this.addedShown = true;
        this.emit('addedTime', { minutes: this.addedMinutes });
      }
    }
    if (this.state !== 'prematch') this.runPlay(dt);
    sim.update(dt);
  }

  // ------------------------------------------------------------------
  // プレー（手順の列）
  runPlay(dt) {
    if (!this.play) this.nextPlay();
    const p = this.play;
    if (!p) return;
    p.t += dt;
    const step = p.steps[p.i];
    if (!step) {
      this.play = null;
      return;
    }
    if (!step.started) {
      step.started = true;
      step.t = 0;
      step.start?.();
    }
    step.t += dt;
    step.update?.(dt, step.t);
    if (step.t >= step.dur) {
      step.end?.();
      p.i++;
      if (p.i >= p.steps.length) this.play = null;
    }
  }

  setPlay(name, steps) {
    this.play = { name, steps, i: 0, t: 0 };
  }

  // 次に何をするか: 見せ場が近ければ逆算して攻撃、遠ければつなぎ
  nextPlay() {
    const sim = this.sim;
    if (this.state === 'halftime' || this.state === 'fulltime') {
      this.setPlay('idle', [this.wait(1)]);
      return;
    }
    if (this.forced) {
      const m = this.forced;
      this.forced = null;
      this.buildAttack(m);
      return;
    }
    const m = this.moments.find((x) => !x.done);
    const holderTeam = sim.ball.holder?.team ?? sim.possession;
    if (m) {
      const lead = m.final === 'cross' || m.final === 'corner' ? 11 : 9;
      const gap = m.t - this.realT - lead;
      if (gap <= 2.5) {
        m.done = true;
        this.buildAttack(m);
        return;
      }
      // 攻める側にボールを渡すつなぎ（最後は奪う / 渡す）
      this.buildFiller(holderTeam, Math.min(gap, 7 + this.rng.next() * 3), m.team);
      return;
    }
    this.buildFiller(holderTeam, 6 + this.rng.next() * 4, this.rng.chance(0.5) ? 'home' : 'away');
  }

  // 見せ場を今すぐ起こす（ラストワンプレー など）
  force(moment) {
    this.forced = moment;
    this.play = null;
  }

  // ------------------------------------------------------------------
  // 手順の部品
  wait(dur, update) {
    return { dur, update };
  }

  call(fn) {
    return { dur: 0, start: fn };
  }

  // ボールを持っていなければ、最寄りの味方に渡す（つなぎのため）
  ensureHolder(team) {
    const sim = this.sim;
    const b = sim.ball;
    if (b.holder && b.holder.team === team) return b.holder;
    const p = sim.nearestTo(team, b.pos.x, b.pos.z);
    sim.give(p);
    return p;
  }

  u(p) {
    return p.pos.x * this.sim.dir[p.team];
  }

  pickReceiver(holder, forward = 1, { minD = 7, maxD = 30, exclude = [] } = {}) {
    const sim = this.sim;
    let best = null;
    let bs = -Infinity;
    for (const q of sim.players) {
      if (q.team !== holder.team || q === holder || q.role === 'GK' || exclude.includes(q)) continue;
      const d = q.pos.distanceTo(holder.pos);
      if (d < minD || d > maxD) continue;
      const du = this.u(q) - this.u(holder);
      const sc = du * forward - Math.abs(d - 17) * 0.3 + this.rng.next() * 7;
      if (sc > bs) {
        bs = sc;
        best = q;
      }
    }
    return best ?? sim.nearestTo(holder.team, holder.pos.x, holder.pos.y, holder);
  }

  // 持っている人が少し運ぶ
  dribble(p, du, dv, dur, speed = 5) {
    const sim = this.sim;
    return {
      dur,
      start: () => {
        const dir = sim.dir[p.team];
        p.dribble = {
          x: clamp(p.pos.x + du * dir, -PITCH.hx + 2, PITCH.hx - 2),
          z: clamp(p.pos.y + dv, -PITCH.hz + 1.5, PITCH.hz - 1.5),
          speed,
        };
        if (sim.ball.holder !== p) sim.give(p);
      },
      end: () => {
        p.dribble = null;
      },
    };
  }

  // パス（受け手は落下点へ走る）
  pass(getFrom, getTo, { lofted = false, speed = null, lead = 2.5, onArrive = null, point = null } = {}) {
    const sim = this.sim;
    const step = {
      dur: 1,
      start: () => {
        const from = typeof getFrom === 'function' ? getFrom() : getFrom;
        const to = typeof getTo === 'function' ? getTo() : getTo;
        if (sim.ball.holder !== from) sim.give(from);
        step.from = from;
        step.to = to;
        // 受け手が走り込む先（少し前へ）
        const dir = sim.dir[to.team];
        const target = point ?? { x: clamp(to.pos.x + dir * lead, -PITCH.hx + 1, PITCH.hx - 1), z: clamp(to.pos.y + (this.rng.next() - 0.5) * 3, -PITCH.hz + 1, PITCH.hz - 1) };
        const dist = Math.hypot(target.x - sim.ball.pos.x, target.z - sim.ball.pos.z);
        const sp = speed ?? (lofted ? 17 : clamp(11 + dist * 0.25, 12, 19));
        const dur = sim.kick(target, { h: lofted ? Math.min(7, 2 + dist * 0.12) : 0, speed: sp, receiver: to });
        if (onArrive) sim.ball.flight.onArrive = onArrive;
        step.dur = dur + 0.05;
      },
    };
    return step;
  }

  // ------------------------------------------------------------------
  // つなぎ: team が回して、最後は nextTeam にボールが移る（奪う）
  buildFiller(team, dur, nextTeam) {
    const sim = this.sim;
    const steps = [];
    let holder = this.ensureHolder(team);
    let t = 0;
    let cur = holder;
    const rng = this.rng;
    while (t < dur - 2) {
      const hold = 0.5 + rng.next() * 1.1;
      steps.push(this.dribble(cur, 1 + rng.next() * 4, (rng.next() - 0.5) * 6, hold, 3.5));
      const next = this.pickReceiver(cur, rng.next() < 0.6 ? 0.3 : -0.4, { minD: 8, maxD: 24 });
      const from = cur;
      steps.push(this.pass(() => from, () => next));
      t += hold + 1.4;
      cur = next;
    }
    if (nextTeam && nextTeam !== team) {
      // 最後のパスをカットされる
      const from = cur;
      steps.push(
        this.call(() => {
          const opp = sim.nearestTo(nextTeam, sim.ball.pos.x, sim.ball.pos.z);
          const dir = sim.dir[from.team];
          const pt = { x: clamp(from.pos.x + dir * 9, -PITCH.hx + 4, PITCH.hx - 4), z: clamp(from.pos.y + (rng.next() - 0.5) * 8, -PITCH.hz + 2, PITCH.hz - 2) };
          opp.override = { x: pt.x, z: pt.z, speed: 7.5, until: 1.2 };
          const d = sim.kick(pt, { speed: 13, receiver: opp });
          sim.ball.flight.onArrive = () => this.emit('turnover', { team: nextTeam });
          this.play.steps.splice(this.play.i + 1, 0, this.wait(d + 0.3));
        })
      );
    }
    this.setPlay('filler', steps);
  }

  // ------------------------------------------------------------------
  // 見せ場の攻撃: 組み立て → 最後のボール → シュート（時刻に合わせて）
  buildAttack(m) {
    this.currentMoment = m;
    const sim = this.sim;
    const rng = this.rng;
    const team = m.team;
    const opp = team === 'home' ? 'away' : 'home';
    const dir = sim.dir[team];
    const side = rng.chance(0.5) ? 1 : -1;
    const steps = [];
    let holder = this.ensureHolder(team);
    if (m.final === 'corner') {
      this.buildCorner(m, side);
      return;
    }
    // 組み立て（2〜3 本）
    let cur = holder;
    const nPass = m.final === 'long' ? 2 : 3;
    for (let i = 0; i < nPass; i++) {
      const from = cur;
      steps.push(this.dribble(from, 3 + rng.next() * 5, (rng.next() - 0.5) * 4, 0.5 + rng.next() * 0.6, 5));
      const to = this.pickReceiver(from, 1.4, { minD: 9, maxD: 30 });
      steps.push(this.pass(() => from, () => to, { lead: 4 }));
      cur = to;
      if (i === 0) steps.push(this.call(() => this.emit('buildup', { team })));
    }
    const players = sim.team(team);
    const strikers = players.filter((p) => p.role === 'ST');
    const winger = players.find((p) => p.role === (side > 0 ? 'RM' : 'LM'));
    const shooter = m.scorerIndex !== undefined ? players[m.scorerIndex] : strikers[rng.int(0, 1)];
    let shotFrom;
    if (m.final === 'cross') {
      // サイドへ → えぐる → クロス → ヘディング
      const wingPt = { x: 34 * dir, z: 25 * side };
      steps.push(this.pass(() => cur, () => winger, { point: wingPt, lofted: true }));
      steps.push(this.dribble(winger, 8, 2 * side, 1.1, 6.5));
      steps.push(this.call(() => this.emit(m.big ? 'bigChance' : 'chance', { team, shooter: shooter.name })));
      const box = { x: 45 * dir, z: (1.5 + rng.next() * 3) * -side * 0.6 };
      steps.push(
        this.call(() => {
          shooter.override = { x: box.x, z: box.z, speed: 7.8, until: 3 };
        })
      );
      steps.push(this.wait(0.35));
      steps.push(this.pass(() => winger, () => shooter, { point: box, lofted: true, speed: 19 }));
      shotFrom = 'head';
    } else if (m.final === 'long') {
      const cm = players.find((p) => p.role === 'CM');
      steps.push(this.pass(() => cur, () => cm, { point: { x: 26 * dir, z: (rng.next() - 0.5) * 12 } }));
      steps.push(this.call(() => this.emit(m.big ? 'bigChance' : 'chance', { team, shooter: cm.name })));
      steps.push(this.dribble(cm, 3, 0, 0.9, 5));
      this.pushShot(steps, m, cm, 'foot');
      this.setPlay('attack', this.fitTiming(steps, m));
      return;
    } else {
      // スルーパス
      const pt = { x: 39 * dir, z: (2 + rng.next() * 6) * side };
      steps.push(this.call(() => this.emit(m.big ? 'bigChance' : 'chance', { team, shooter: shooter.name })));
      steps.push(this.pass(() => cur, () => shooter, { point: pt, speed: 17 }));
      steps.push(this.dribble(shooter, 4, -side * 2, 0.8, 7));
      shotFrom = 'foot';
    }
    this.pushShot(steps, m, shooter, shotFrom);
    void opp;
    this.setPlay('attack', this.fitTiming(steps, m));
  }

  buildCorner(m, side) {
    this.currentMoment = m;
    const sim = this.sim;
    const team = m.team;
    const dir = sim.dir[team];
    const players = sim.team(team);
    const taker = players.find((p) => p.role === (side > 0 ? 'RM' : 'LM'));
    const shooter = m.scorerIndex !== undefined ? players[m.scorerIndex] : players.find((p) => p.role === 'CB');
    const steps = [];
    steps.push(
      this.call(() => {
        sim.dead(dir * (PITCH.hx - 0.3), side * (PITCH.hz - 0.3));
        this.emit('corner', { team });
        taker.override = { x: dir * (PITCH.hx - 0.8), z: side * (PITCH.hz - 0.8), speed: 7, hold: true };
        // ゴール前に人が集まる
        for (const p of sim.players) {
          if (p === taker || p.role === 'GK') continue;
          const att = p.team === team;
          if (att && (p.role === 'LB' || p.role === 'RB')) continue;
          p.override = { x: dir * (PITCH.hx - 7 - this.rng.next() * 8), z: (this.rng.next() - 0.5) * 16, speed: 5, hold: true };
        }
      })
    );
    steps.push(this.wait(4.5));
    steps.push(
      this.call(() => {
        sim.give(taker);
        this.emit(m.big ? 'bigChance' : 'chance', { team, shooter: shooter.name });
      })
    );
    steps.push(this.wait(1.2));
    const box = { x: dir * (PITCH.hx - 7), z: -side * 1.5 };
    steps.push(
      this.call(() => {
        taker.override = null;
        shooter.override = { x: box.x, z: box.z, speed: 7.5, until: 3 };
      })
    );
    steps.push(this.pass(() => taker, () => shooter, { point: box, lofted: true, speed: 19 }));
    this.pushShot(steps, m, shooter, 'head', true);
    this.setPlay('attack', this.fitTiming(steps, m));
  }

  // シュート（結果つき）
  pushShot(steps, m, shooter, how, releaseAll = false) {
    const sim = this.sim;
    const rng = this.rng;
    const team = m.team;
    const opp = team === 'home' ? 'away' : 'home';
    const dir = sim.dir[team];
    const gk = sim.gk(opp);
    const shot = { dur: 1 };
    shot.start = () => {
      if (releaseAll) for (const p of sim.players) if (p.override?.hold) p.override = null;
      if (sim.ball.holder !== shooter) sim.give(shooter);
      const side = rng.chance(0.5) ? 1 : -1;
      let tz;
      let ty;
      let tx = dir * (PITCH.hx + 0.9);
      switch (m.outcome) {
        case 'goal':
          tz = side * (2.1 + rng.next() * 1.2);
          ty = how === 'head' ? 0.6 + rng.next() * 1.2 : 0.3 + rng.next() * 1.8;
          break;
        case 'save':
          tz = side * (0.6 + rng.next() * 2);
          ty = 0.4 + rng.next() * 1.3;
          tx = dir * (PITCH.hx - 0.9);
          break;
        case 'over':
          tz = side * rng.next() * 2.5;
          ty = 4.2;
          tx = dir * (PITCH.hx + 6);
          break;
        case 'post':
          tz = side * (PITCH.goalW / 2);
          ty = 1.1;
          tx = dir * PITCH.hx;
          break;
        default: // wide
          tz = side * (4.6 + rng.next() * 2.4);
          ty = 0.4 + rng.next() * 1.2;
          tx = dir * (PITCH.hx + 5);
      }
      const speed = how === 'head' ? 15 : 26;
      const d = sim.kick({ x: tx, z: tz }, { h: m.outcome === 'over' ? 1.5 : 0.25, speed, y1: ty, curve: (rng.next() - 0.5) * 1.5 });
      shot.dur = d + 0.1;
      // キーパー: セーブなら正面へ、ゴールなら逆へ跳ぶ（届かない）
      const gkz = m.outcome === 'save' ? tz : m.outcome === 'goal' ? -Math.sign(tz) * 1.2 : tz * 0.3;
      gk.override = { x: dir * (PITCH.hx - 0.8), z: clamp(gkz, -3.4, 3.4), speed: 9, until: d + 1.2 };
      this.emit('shot', { team, shooter: shooter.name, outcome: m.outcome, eta: d, target: { x: tx, y: ty, z: tz } });
      sim.ball.flight.onArrive = () => this.resolve(m, shooter, gk, { tx, ty, tz });
    };
    steps.push(shot);
  }

  resolve(m, shooter, gk, tgt) {
    this.currentMoment = null;
    const sim = this.sim;
    const team = m.team;
    const opp = team === 'home' ? 'away' : 'home';
    const dir = sim.dir[team];
    const b = sim.ball;
    if (m.outcome === 'goal') {
      b.state = 'net';
      b.pos.set(tgt.tx, tgt.ty, tgt.tz);
      b.vel.set(dir * 4, 0, 0);
      this.score[team]++;
      const goal = { team, minute: Math.min(45, this.minute), clock: this.clock, scorer: shooter.name, index: this.goals.length };
      this.goals.push(goal);
      this.emit('goal', { team, scorer: shooter.name, score: { ...this.score }, goal });
      this.celebrate(shooter, team);
      return;
    }
    if (m.outcome === 'save') {
      sim.give(gk);
      gk.holdHands = true;
      this.emit('save', { team, keeper: gk.name });
      this.setPlay('save', [
        this.wait(2.4),
        this.call(() => {
          gk.holdHands = false;
          const mate = this.pickReceiver(gk, 1, { minD: 20, maxD: 55 });
          sim.kick({ x: mate.pos.x, z: mate.pos.y }, { h: 12, speed: 22, receiver: mate });
          this.emit('restart', { team: opp });
        }),
        this.wait(2.8),
      ]);
      return;
    }
    // 外れた: ゴールキック
    this.emit('miss', { team, outcome: m.outcome });
    if (m.outcome === 'post') {
      b.state = 'rolling';
      b.vel.set(-dir * 9, 0, (Math.random() - 0.5) * 6);
    } else {
      b.state = 'rolling';
      b.vel.set(dir * 3, 0, 0);
    }
    this.setPlay('goalkick', [
      this.wait(2.2),
      this.call(() => {
        sim.dead(-sim.dir[opp] * (PITCH.hx - 5.5), 6 * Math.sign(tgt.tz || 1));
        gk.override = { x: sim.ball.pos.x + sim.dir[opp] * -1.2, z: sim.ball.pos.z, speed: 5, until: 2.5 };
      }),
      this.wait(2.6),
      this.call(() => {
        sim.give(gk);
        const mate = this.pickReceiver(gk, 1, { minD: 30, maxD: 65 });
        sim.kick({ x: mate.pos.x, z: mate.pos.y }, { h: 14, speed: 23, receiver: mate });
        this.emit('restart', { team: opp });
      }),
      this.wait(3),
    ]);
  }

  // ゴール: 喜ぶ（コーナーフラッグへ走る）→ 戻る → キックオフ
  celebrate(scorer, team) {
    const sim = this.sim;
    const dir = sim.dir[team];
    const cz = scorer.pos.y >= 0 ? 1 : -1;
    const corner = { x: dir * (PITCH.hx - 3), z: cz * (PITCH.hz - 3) };
    sim.mode = 'celebrate';
    for (const p of sim.players) {
      if (p.team === team && p.role !== 'GK') {
        const off = p === scorer ? 0 : 2 + Math.random() * 3;
        const a = Math.random() * Math.PI * 2;
        p.override = { x: corner.x - dir * off * Math.abs(Math.cos(a)), z: corner.z - cz * off * Math.abs(Math.sin(a)), speed: p === scorer ? 7.8 : 7, hold: true };
        p.celebrate = 1;
      } else {
        p.override = { x: p.pos.x * 0.9, z: p.pos.y * 0.9, speed: 1.4, hold: true };
      }
    }
    const opp = team === 'home' ? 'away' : 'home';
    this.setPlay('celebrate', [
      this.wait(9),
      this.call(() => {
        for (const p of sim.players) {
          p.override = null;
          p.celebrate = 0;
        }
        sim.mode = 'reset';
        sim.dead(0, 0);
        this.emit('reset');
      }),
      this.wait(8.5),
      this.call(() => this.startKickoff(opp, false)),
    ]);
  }

  startKickoff(team, instant = true) {
    const sim = this.sim;
    sim.mode = 'kickoff';
    sim.dead(0, 0);
    if (instant) {
      for (const p of sim.players) {
        const dir = sim.dir[p.team];
        p.pos.set(p.base.u * dir * 0.98 + (p.base.u > -10 ? -dir * 4 : 0), p.base.v);
        p.vel.set(0, 0);
        p.override = null;
      }
    }
    const st = sim.team(team).filter((p) => p.role === 'ST')[0];
    const cm = sim.team(team).find((p) => p.role === 'CM');
    this.setPlay('kickoff', [
      this.call(() => {
        st.override = { x: -sim.dir[team] * 0.5, z: 0, speed: 3, until: 1.5 };
      }),
      this.wait(1.5),
      this.call(() => {
        sim.mode = 'play';
        sim.give(st);
        if (!instant) this.emit('kickoff', { team });
      }),
      this.pass(() => st, () => cm, { lead: 0 }),
    ]);
  }

  // 時刻合わせ: シュートが m.t に来るよう、手順の「持つ時間」を伸び縮み（±）
  fitTiming(steps, m) {
    const est = steps.reduce((a, s) => a + (s.dur ?? 0), 0) + 3.2; // パスの飛ぶ時間ぶんを含めた概算
    const want = m.t - this.realT;
    const slack = want - est;
    if (Math.abs(slack) > 0.3) {
      const holds = steps.filter((s) => s.dur > 0.3 && !s.started && s.start && s.end);
      const each = clamp(slack / Math.max(1, holds.length), -0.4, 1.2);
      for (const s of holds) s.dur = Math.max(0.3, s.dur + each);
    }
    return steps;
  }

  // 進行中の見せ場の攻撃をやめる（主人公が移動中で見られない時: 結果だけ別に反映する）。やめた見せ場を返す
  abortAttack() {
    const m = this.currentMoment;
    if (!m || !this.play || (this.play.name !== 'attack')) return null;
    this.currentMoment = null;
    this.play = null;
    for (const p of this.sim.players) {
      p.override = null;
      p.dribble = null;
    }
    return m;
  }

  // ハーフタイム / 試合終了の笛
  whistle(kind = 'halftime') {
    this.state = kind;
    this.emit('whistle', { kind, score: { ...this.score } });
    const sim = this.sim;
    sim.mode = 'reset';
    for (const p of sim.players) p.override = null;
  }

  // 実況に使う: いま画面で起きていること
  get ballPos() {
    return this.sim.ball.pos;
  }
}
