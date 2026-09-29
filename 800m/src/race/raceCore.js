import { EV } from '../core/events.js';
import { clamp } from '../core/mathx.js';
import { PHYS, targetSpeed, staminaRate, stepFrequency } from './physiology.js';
import { TRACK, MAX_OFF, progressFactor, laneCenter } from './trackLogic.js';

// RaceCore: 12 人・800m・2 周。ゲームで一番壊れてはいけない部分。
// - 表示・カメラ・Modifier はここの値を読むだけ。書き換えない（Object.freeze はしないが、書くのはここだけ）
// - 1/60 秒の固定ステップ。入力（intent）以外に外から影響を受けない → 同じ seed と入力なら同じ結果
// - 画面が反転しても 2D になっても、d は 0m → 800m で進む
//
// runner: { id, d, off, v, stamina, lap, rank, finished, finishTime, effortEff, bursting, drafting,
//           blocked, phase, rhythmStreak, rhythmBonus, talent }

export const RACE_STATE = { IDLE: 'idle', MARKS: 'marks', SET: 'set', RUNNING: 'running', DONE: 'done' };

export class RaceCore {
  constructor(defs, bus) {
    this.defs = defs;
    this.bus = bus;
    this.n = defs.length;
    this.playerIndex = defs.findIndex((d) => d.isPlayer);
    this.reset();
  }

  reset(startDistance = 0) {
    this.state = RACE_STATE.IDLE;
    this.time = 0;
    this.stateTime = 0;
    this.startDistance = startDistance;
    this.runners = this.defs.map((def, i) => {
      // スタート: 横一列のウォーターフォール（外側ほど少し前）。途中開始（?distance=）は集団のまま
      const off = clamp(0.35 + i * 0.78, 0, MAX_OFF);
      const stagger = startDistance > 0 ? -((i * 7) % 5) * 0.8 : off * 0.42;
      return {
        id: def.id,
        index: i,
        isPlayer: !!def.isPlayer,
        d: startDistance + stagger,
        off: startDistance > 0 ? laneCenter(1 + (i % 3)) : off,
        targetOff: startDistance > 0 ? laneCenter(1 + (i % 3)) : off,
        v: startDistance > 0 ? 7.6 : 0,
        stamina: startDistance > 0 ? clamp(100 - startDistance * 0.06, 20, 100) : 100,
        lap: startDistance >= 400 ? 2 : 1,
        rank: i + 1,
        finished: false,
        finishTime: 0,
        effort: PHYS.effort.normal,
        effortEff: PHYS.effort.normal,
        bursting: false,
        drafting: false,
        draftBonus: def.draftBonus ?? 0.65,
        blocked: false,
        phase: (i * 0.37) % 1,
        stepFreq: 0,
        rhythmStreak: 0,
        rhythmBonus: 0,
        talent: def.talent ?? 1,
        cheer: 0,
      };
    });
    this.player = this.runners[this.playerIndex];
    this.order = this.runners.map((_, i) => i);
    this.finishOrder = [];
    this.lastRank = this.n;
    this.nextMark = Math.floor(startDistance / 100) * 100 + 100;
    this.flags = { lap2: startDistance >= 400, f100: startDistance >= 700, f40: startDistance >= 760, low: false };
    this.updateRanks();
  }

  get running() {
    return this.state === RACE_STATE.RUNNING;
  }

  // スタートの号令（位置について → よーい → 号砲）。setDelay は seed から決める
  begin(setDelay = 1.1) {
    this.state = RACE_STATE.MARKS;
    this.stateTime = 0;
    this.setDelay = setDelay;
    this.bus.emit(EV.ON_YOUR_MARKS, {});
  }

  step(dt, intents, env = {}) {
    this.stateTime += dt;
    if (this.state === RACE_STATE.MARKS && this.stateTime > 1.7) {
      this.state = RACE_STATE.SET;
      this.stateTime = 0;
      this.bus.emit(EV.SET, {});
    } else if (this.state === RACE_STATE.SET && this.stateTime > this.setDelay) {
      this.state = RACE_STATE.RUNNING;
      this.stateTime = 0;
      this.bus.emit(EV.RACE_START, { startDistance: this.startDistance });
    }
    if (this.state !== RACE_STATE.RUNNING && this.state !== RACE_STATE.DONE) return;
    if (this.state === RACE_STATE.RUNNING) this.time += dt;

    const rs = this.runners;
    const cheer = env.cheer ?? 0;
    // 並び順（前から）
    this.order.sort((a, b) => rs[b].d - rs[a].d);

    for (let k = 0; k < this.n; k++) {
      const r = rs[this.order[k]];
      const it = intents[r.index] ?? {};
      if (r.finished) {
        // ゴール後はゆっくりジョグ
        r.v = Math.max(2.2, r.v - PHYS.decel * dt);
        r.d += r.v * dt;
        r.phase += dt * stepFrequency(r.v);
        continue;
      }

      // ---- 努力度とスパート
      let e = clamp(it.effort ?? PHYS.effort.normal, 0.45, PHYS.effort.push);
      r.bursting = !!it.burst && r.stamina > 3;
      if (r.bursting) e = PHYS.effort.burst;
      if (r.stamina <= 0.5) e = Math.min(e, 0.74); // 尽きたら普通にも走れない
      r.effort = e;
      r.effortEff = e;

      // ---- 横位置（レーン）
      if (typeof it.lateral === 'number') {
        // プレイヤー: 押している間だけ動く
        r.targetOff = it.lateral !== 0 ? clamp(r.off + it.lateral * 1.2, 0, MAX_OFF) : r.off;
      } else if (typeof it.targetOff === 'number') {
        r.targetOff = clamp(it.targetOff, 0, MAX_OFF);
      }
      const dOff = r.targetOff - r.off;
      r.off += clamp(dOff, -PHYS.lateralSpeed * dt, PHYS.lateralSpeed * dt);

      // ---- 前の選手: ドラフトとブロック
      r.drafting = false;
      r.blocked = false;
      let capSpeed = Infinity;
      for (let a = k - 1; a >= 0; a--) {
        const o = rs[this.order[a]];
        const gap = o.d - r.d;
        if (gap > PHYS.draftGap[1]) break;
        const lat = Math.abs(o.off - r.off);
        if (gap > PHYS.draftGap[0] && lat < PHYS.draftLateral) r.drafting = true;
        if (gap < PHYS.blockGap && lat < PHYS.blockLateral && !o.finished) {
          r.blocked = true;
          capSpeed = Math.min(capSpeed, o.v + 0.15);
        }
      }

      // ---- 速さ
      let target = targetSpeed(r);
      if (r.blocked) target = Math.min(target, capSpeed);
      if (r.v < target) r.v = Math.min(target, r.v + PHYS.accel * (r.v < 3 ? 1.35 : 1) * dt);
      else r.v = Math.max(target, r.v - PHYS.decel * dt);

      // ---- スタミナ
      r.stamina = clamp(r.stamina + staminaRate(r, r.isPlayer ? cheer : env.aiCheer ?? cheer * 0.5) * dt, 0, 100);

      // ---- 前進（曲線の外側は損）
      const prevD = r.d;
      r.d += r.v * dt * progressFactor(r.d, r.off);
      r.lap = r.d >= TRACK.lap ? 2 : 1;

      // ---- 足の接地（リズム・足音・アニメが共有する）
      r.stepFreq = stepFrequency(r.v);
      const prevPhase = r.phase;
      r.phase += dt * r.stepFreq;
      if (Math.floor(prevPhase) !== Math.floor(r.phase)) {
        this.bus.emit(EV.FOOTSTEP, { runner: r.index, foot: Math.floor(r.phase) % 2, v: r.v, player: r.isPlayer });
      }

      // ---- リズム入力（プレイヤー / 自動操縦）
      if (it.step) this.judgeRhythm(r);

      // ---- ゴール（0.01 秒まで補間）
      if (prevD < TRACK.race && r.d >= TRACK.race) {
        r.finished = true;
        const over = (r.d - TRACK.race) / Math.max(0.1, r.v);
        r.finishTime = this.time - over;
        this.finishOrder.push(r.index);
        this.bus.emit(EV.RUNNER_FINISH, { runner: r.index, place: this.finishOrder.length, time: r.finishTime });
        if (r.isPlayer) this.bus.emit(EV.FINISH, { place: this.finishOrder.length, time: r.finishTime });
      }
    }

    this.separate();
    this.updateRanks();
    this.emitPlayerEvents();
    if (this.state === RACE_STATE.RUNNING && this.finishOrder.length === this.n) {
      this.state = RACE_STATE.DONE;
      this.bus.emit(EV.RACE_END, { order: this.finishOrder.slice() });
    }
  }

  // 真横に並んだ選手どうしは重ならない。譲るのは後ろの選手（前にいる方が優先 = 前の選手を大外へ押し出さない）
  separate() {
    const rs = this.runners;
    for (let a = 0; a < this.n; a++) {
      for (let b = a + 1; b < this.n; b++) {
        const A = rs[a];
        const B = rs[b];
        const dd = A.d - B.d;
        if (Math.abs(dd) > 0.7) continue;
        const dx = B.off - A.off;
        if (Math.abs(dx) < 0.48) {
          const push = (0.48 - Math.abs(dx)) * (dx >= 0 ? 1 : -1);
          // ほぼ並んでいる時は半分ずつ、差がある時は後ろの選手が 8 割よける
          const wA = Math.abs(dd) < 0.15 ? 0.5 : dd < 0 ? 0.8 : 0.2;
          A.off = clamp(A.off - push * wA, 0, MAX_OFF);
          B.off = clamp(B.off + push * (1 - wA), 0, MAX_OFF);
          // 壁際で押し返せない分は相手が引き受ける
          if (A.off <= 0 || B.off >= MAX_OFF) {
            const over = 0.48 - Math.abs(B.off - A.off);
            if (over > 0) {
              if (A.off <= 0) B.off = clamp(B.off + over, 0, MAX_OFF);
              else A.off = clamp(A.off - over, 0, MAX_OFF);
            }
          }
        }
      }
    }
  }

  judgeRhythm(r) {
    const f = r.phase - Math.floor(r.phase);
    const dist = Math.min(f, 1 - f) / Math.max(0.1, r.stepFreq);
    let grade = 'MISS';
    if (dist < 0.055) grade = 'PERFECT';
    else if (dist < 0.11) grade = 'GOOD';
    if (grade === 'PERFECT') r.rhythmStreak++;
    else if (grade === 'MISS') r.rhythmStreak = 0;
    r.rhythmBonus = Math.min(0.012, r.rhythmStreak * 0.0015);
    if (r.isPlayer) this.bus.emit(EV.RHYTHM, { grade, streak: r.rhythmStreak });
    return grade;
  }

  updateRanks() {
    const rs = this.runners;
    const ranked = rs.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.d - a.d;
    });
    ranked.forEach((r, i) => (r.rank = i + 1));
    this.ranked = ranked;
  }

  emitPlayerEvents() {
    const p = this.player;
    if (!p || this.state !== RACE_STATE.RUNNING) return;
    if (p.rank < this.lastRank) this.bus.emit(EV.PLAYER_OVERTAKE, { rank: p.rank, from: this.lastRank });
    else if (p.rank > this.lastRank) this.bus.emit(EV.PLAYER_OVERTAKEN, { rank: p.rank, from: this.lastRank });
    if (p.rank === 1 && this.lastRank !== 1) this.bus.emit(EV.PLAYER_FIRST, {});
    if (p.rank === this.n && this.lastRank !== this.n) this.bus.emit(EV.PLAYER_LAST, {});
    this.lastRank = p.rank;
    while (p.d >= this.nextMark && this.nextMark <= 800) {
      this.bus.emit(EV.DISTANCE, { meters: this.nextMark });
      this.bus.emit(`DISTANCE_${this.nextMark}`, { meters: this.nextMark }); // DISTANCE_100 など（購読しやすい別名）
      this.nextMark += 100;
    }
    if (!this.flags.lap2 && p.d >= 400) {
      this.flags.lap2 = true;
      this.bus.emit(EV.LAP_2, {});
    }
    if (!this.flags.f100 && p.d >= 700) {
      this.flags.f100 = true;
      this.bus.emit(EV.FINAL_100, {});
    }
    if (!this.flags.f40 && p.d >= 760) {
      this.flags.f40 = true;
      this.bus.emit(EV.FINAL_40, {});
    }
    if (!this.flags.low && p.stamina < 20) {
      this.flags.low = true;
      this.bus.emit(EV.STAMINA_LOW, {});
    }
  }

  // 開発パネル / 検証用: 全員を同じだけ進める・戻す（距離を動かせるのは RaceCore の中だけ）
  shiftAll(delta) {
    for (const r of this.runners) {
      if (r.finished) continue;
      r.d = clamp(r.d + delta, 0, TRACK.race - 1);
      r.lap = r.d >= TRACK.lap ? 2 : 1;
    }
    const p = this.player;
    this.nextMark = Math.floor(p.d / 100) * 100 + 100;
    this.flags.lap2 = p.d >= 400;
    this.flags.f100 = p.d >= 700;
    this.flags.f40 = p.d >= 760;
    this.updateRanks();
  }

  // 結果（順位・タイム）。未ゴールの選手は現在の距離から推定
  results() {
    return this.ranked.map((r) => ({
      index: r.index,
      id: r.id,
      place: r.rank,
      time: r.finished ? r.finishTime : this.time + (TRACK.race - r.d) / Math.max(1, r.v),
      finished: r.finished,
      isPlayer: r.isPlayer,
    }));
  }
}
