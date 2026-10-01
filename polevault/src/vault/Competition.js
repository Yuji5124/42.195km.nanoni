import * as THREE from 'three';
import { Vaulter, T_RUN, T_POLE } from './Vaulter.js';
import { RUNWAY, BAR, PIT } from '../stadium/field.js';
import { SKINS, HAIRS } from '../people/Figure.js';

// 男子棒高跳び決勝（最後の 4 人）。競技は真面目に。3 分の放送の中で 10 本の試技を見せる。
//   5.80 → 5.90 → 6.00 → 6.05（大会記録 6.02 を超える高さ）。リヴァが 6.05 の 3 回目を失敗した瞬間に高嶺の優勝が決まり、
//   最後の 10 秒に高嶺がひとりで 6.05（大会新記録）に挑む。まれに（seed）世界記録の高さへバーを上げる。
// 放送に映らなかった試技（1 回目の失敗など）は記録（marks）にだけ入っていて、実況が触れる。

export const ATHLETES = [
  { id: 'keller', name: 'ヨナス・ケラー', short: 'ケラー', en: 'JONAS KELLER', nat: 'GER', color: 0x24262e, shorts: 0x24262e, hair: 'buzz', hairColor: 0xc9a25a, skin: SKINS[0], tape: 0xffffff, poleColor: 0x2b2f3a, clapper: false, seed: 1, benchFace: 'serious' },
  { id: 'takane', name: '高嶺 ソラ', short: '高嶺', en: 'SORA TAKANE', nat: 'JPN', color: 0xd0283c, shorts: 0xd0283c, hair: 'short', hairColor: HAIRS[0], skin: SKINS[1], tape: 0xffd23f, poleColor: 0x1f3d8a, clapper: true, seed: 2, benchFace: 'neutral' },
  { id: 'riva', name: 'マテオ・リヴァ', short: 'リヴァ', en: 'MATTEO RIVA', nat: 'ITA', color: 0x2b62c9, shorts: 0x1a2a66, hair: 'short', hairColor: 0x4a3020, skin: SKINS[1], tape: 0xffffff, poleColor: 0x6b1f2a, clapper: true, seed: 3, benchFace: 'thoughtful' },
  { id: 'salas', name: 'ディエゴ・サラス', short: 'サラス', en: 'DIEGO SALAS', nat: 'MEX', color: 0x1d7a4a, shorts: 0xf2f2f2, hair: 'short', hairColor: HAIRS[0], skin: SKINS[2], tape: 0xd0283c, poleColor: 0x2a2a2a, clapper: false, seed: 4, benchFace: 'neutral' },
];

export const MEET_RECORD = 6.02;

// 1 本の試技の時刻（t0 = 儀式の始まり）
const RITUAL = 3.5;
const REACT = 3.0;

function plan(t0, id, height, clear, margin, extra = {}) {
  const ritual = extra.ritual ?? RITUAL;
  const tRun = t0 + ritual;
  const tTO = tRun + T_RUN;
  const tRel = tTO + T_POLE;
  const fl = Vaulter.planFlight(height, margin);
  const tLand = tRel + fl.T;
  const tEnd = tLand + REACT + (extra.final ? 2.5 : 0);
  // バーの面を通る時刻（骨盤の x がバーの x）
  const tCross = tRel + Math.max(0.05, (BAR.x - 0.1 - fl.rel.x) / fl.vx);
  return { t0, id, height, clear, margin, tRun, tTO, tRel, tLand, tEnd, tCross, walkIn: 4.2, ...extra };
}

export class Competition {
  constructor(scene, rng, bus, stadium) {
    this.scene = scene;
    this.bus = bus;
    this.stadium = stadium;
    this.rng = rng;
    this.athletes = ATHLETES.map((a) => ({ ...a }));
    this.byId = Object.fromEntries(this.athletes.map((a) => [a.id, a]));
    // 最後の試技: 85% は大会新記録の成功 / まれに世界記録の高さ
    const wr = rng.next() < 0.12;
    const finalHeight = wr ? 6.35 : 6.05;
    const finalClear = wr ? rng.next() < 0.45 : rng.next() < 0.86;
    this.variant = wr ? 'wr' : 'mr';
    const m = () => 0.06 + rng.next() * 0.12;
    this.attempts = [
      plan(15, 'keller', 5.8, true, m(), { no: 1 }),
      plan(31, 'takane', 5.8, true, m() + 0.05, { no: 1 }),
      plan(47, 'riva', 5.8, true, m(), { no: 1 }),
      plan(63, 'salas', 5.9, false, -0.12, { no: 3, out: true }),
      plan(79, 'takane', 5.9, true, m(), { no: 1 }),
      plan(95, 'keller', 5.9, false, -0.08, { no: 3, out: true }),
      plan(111, 'riva', 6.0, true, 0.05, { no: 1 }),
      plan(127, 'takane', 6.0, true, 0.08, { no: 1 }),
      plan(143, 'riva', 6.05, false, -0.06, { no: 3, out: true, decides: true }),
      plan(158.5, 'takane', finalHeight, finalClear, finalClear ? 0.09 : -0.07, { no: wr ? 1 : 3, final: true, ritual: 8.6, record: finalClear, wr }),
    ];
    // 記録（放送の前・映らなかった試技も含む）
    this.marks = {
      keller: { 5.6: 'O', 5.7: 'O', 5.8: '', 5.9: 'XX' },
      takane: { 5.6: '-', 5.7: 'O', 5.8: '', 5.9: '', 6.0: '', 6.05: wr ? '' : 'XX' },
      riva: { 5.6: 'O', 5.7: 'O', 5.8: '', 5.9: 'XO', 6.0: '', 6.05: 'XX' },
      salas: { 5.6: 'O', 5.7: 'XO', 5.8: 'O', 5.9: 'XX' },
    };
    if (wr) this.marks.takane[6.35] = '';
    // 選手
    this.vaulters = {};
    this.athletes.forEach((a, i) => {
      const v = new Vaulter(scene, a, i);
      this.vaulters[a.id] = v;
    });
    for (const a of this.attempts) this.vaulters[a.id].addAttempt(a);
    this.barHeight = 5.8;
    this.bar = { knocked: false, t: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), angVel: new THREE.Vector3(), restAt: 0 };
    this.fired = new Set();
    this.winner = null;
    this.record = false;
    this.current = null;
    this.time = 0;
  }

  // いま助走路にいる試技（儀式〜反応）
  activeAt(t) {
    for (const a of this.attempts) if (t >= a.t0 - 0.5 && t < a.tEnd) return a;
    return null;
  }

  nextAt(t) {
    return this.attempts.find((a) => a.t0 > t) ?? null;
  }

  // 1 回だけのイベント
  fire(key, t, at, fn) {
    if (t >= at && !this.fired.has(key)) {
      this.fired.add(key);
      fn();
    }
  }

  update(t, dt) {
    this.time = t;
    const ctx = {
      onCross: (v, a) => this.onCross(v, a),
      onLand: (v, a) => this.bus.emit('vault:land', { a, athlete: this.byId[a.id] }),
    };
    for (const a of this.attempts) {
      const ath = this.byId[a.id];
      const k = `${a.id}@${a.t0}`;
      this.fire(`${k}:ready`, t, a.t0, () => {
        this.barHeight = a.height;
        this.resetBar();
        this.current = a;
        this.bus.emit('vault:ready', { a, athlete: ath });
      });
      this.fire(`${k}:run`, t, a.tRun, () => this.bus.emit('vault:run', { a, athlete: ath }));
      this.fire(`${k}:plant`, t, a.tTO - 0.35, () => this.bus.emit('vault:plant', { a, athlete: ath }));
      this.fire(`${k}:takeoff`, t, a.tTO, () => this.bus.emit('vault:takeoff', { a, athlete: ath }));
      this.fire(`${k}:release`, t, a.tRel, () => this.bus.emit('vault:release', { a, athlete: ath }));
      this.fire(`${k}:cross`, t, a.tCross, () => this.onCross(this.vaulters[a.id], a));
      this.fire(`${k}:result`, t, a.tLand + 0.35, () => this.onResult(a));
      this.fire(`${k}:end`, t, a.tEnd, () => this.bus.emit('vault:end', { a, athlete: ath }));
    }
    for (const id in this.vaulters) this.vaulters[id].update(t, dt, ctx);
    this.updateBar(t, dt);
    this.updateClock(t);
  }

  onCross(v, a) {
    if (a._crossDone) return;
    a._crossDone = true;
    if (!a.clear) this.knockBar(a);
    this.bus.emit(a.clear ? 'vault:over' : 'vault:hit', { a, athlete: this.byId[a.id] });
  }

  onResult(a) {
    const ath = this.byId[a.id];
    const mk = this.marks[a.id];
    mk[a.height] = (mk[a.height] ?? '') + (a.clear ? 'O' : 'X');
    if (a.clear && a.height > MEET_RECORD + 1e-6) this.record = true;
    this.bus.emit(a.clear ? 'vault:clear' : 'vault:fail', { a, athlete: ath });
    if (a.out) this.bus.emit('vault:out', { a, athlete: ath });
    if (a.decides) {
      this.winner = 'takane';
      this.vaulters.takane.cheerUntil = a.tLand + 3.2;
      this.bus.emit('vault:winner', { a, athlete: this.byId.takane });
    }
    if (a.final && a.clear) this.bus.emit('vault:record', { a, athlete: ath, wr: a.wr });
  }

  // ---- バー（支柱のピンに載っている → 当たると落ちる）
  resetBar() {
    this.bar.knocked = false;
  }

  knockBar(a) {
    const b = this.bar;
    b.knocked = true;
    b.t = 0;
    b.pos.set(BAR.x, a.height, RUNWAY.z);
    b.vel.set(1.3 + this.rng.next() * 0.6, 0.6, (this.rng.next() - 0.5) * 0.4);
    b.rot.set(0, 0, 0);
    b.angVel.set((this.rng.next() - 0.5) * 1.4, (this.rng.next() - 0.5) * 2.0, (this.rng.next() - 0.5) * 3);
  }

  updateBar(t, dt) {
    const bar = this.stadium.bar;
    const b = this.bar;
    if (!b.knocked) {
      bar.position.set(BAR.x, this.barHeight, RUNWAY.z);
      bar.rotation.set(Math.PI / 2, 0, 0);
      return;
    }
    b.t += dt;
    b.vel.y -= 9.81 * dt;
    b.pos.addScaledVector(b.vel, dt);
    b.rot.addScaledVector(b.angVel, dt);
    const inPit = b.pos.x > PIT.x0 - 1 && b.pos.x < PIT.x1;
    const floor = inPit ? PIT.h + 0.02 : 0.02;
    if (b.pos.y < floor) {
      b.pos.y = floor;
      if (b.vel.y < -1) this.bus.emit('bar:bounce', { v: -b.vel.y, pos: b.pos.clone() });
      b.vel.y = -b.vel.y * 0.28;
      b.vel.x *= 0.5;
      b.vel.z *= 0.5;
      b.angVel.multiplyScalar(0.4);
      b.rot.x *= 0.5;
      b.rot.z *= 0.5;
    }
    bar.position.copy(b.pos);
    bar.rotation.set(Math.PI / 2 + b.rot.x, b.rot.y, b.rot.z);
  }

  updateClock(t) {
    const a = this.activeAt(t);
    if (!a) {
      const n = this.nextAt(t);
      if (n && n.t0 - t < 6) this.stadium.drawClock(60, this.byId[n.id].en, true);
      return;
    }
    const sec = t < a.tRun ? 60 - (t - (a.t0 - 2)) * 3.2 : 60 - (a.tRun - (a.t0 - 2)) * 3.2;
    const key = Math.floor(sec);
    if (key !== this._clockKey) {
      this._clockKey = key;
      this.stadium.drawClock(Math.max(0, sec), this.byId[a.id].en, true);
    }
  }

  // 記録の表（大型ビジョン・結果）
  marksText(id, upTo = null) {
    const mk = this.marks[id];
    const hs = Object.keys(mk)
      .map(Number)
      .sort((a, b) => a - b)
      .filter((h) => upTo === null || h <= upTo + 1e-6);
    return hs
      .filter((h) => h >= 5.8)
      .map((h) => `${h.toFixed(2)} ${mk[h] || '-'}`)
      .join('  ');
  }

  bestOf(id) {
    const mk = this.marks[id];
    let best = 0;
    for (const h of Object.keys(mk).map(Number)) if ((mk[h] ?? '').includes('O')) best = Math.max(best, h);
    return best;
  }

  standings() {
    return this.athletes
      .map((a) => ({ ...a, best: this.bestOf(a.id), misses: Object.values(this.marks[a.id]).join('').split('X').length - 1 }))
      .sort((x, y) => y.best - x.best || x.misses - y.misses);
  }
}
