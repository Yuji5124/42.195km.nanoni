import * as THREE from 'three';
import { ALL_STORIES } from './stories.js';
import { EXTRA_STORIES } from './stories2.js';
import { SpecialCrowd } from '../people/SpecialCrowd.js';
import { CAM_POS, JUDGE_TABLE, BAR, RUNWAY, CLOCK_BOARD, BENCH } from '../stadium/field.js';
import { LOOKS_FIELD } from './fieldCast.js';

// 観客ドラマの進行役。
//   1) 選ぶ: 100 本以上の候補から 1 プレイ 8〜12 本（同じ種類ばかりにしない。家族・恋・審判・鳥・夜空は入りやすい）
//   2) 座らせる: 物語の人を座席（ゾーン・列・隣どうし）に割り当て、その席のビルボードを空席にする
//   3) 時刻: 'takane#2.run-1' のような試技の時刻を、競技の予定から秒に直す（試技の結果で出し分ける）
//   4) 進める: 時刻が来たら行動（姿勢・表情・視線・小物）を書き換える。ヒント（反射光・立つ・こちらを向く）
//   5) 撮影の判定へ: いまのテレビとしての面白さ（v）・感情（em）・重要な瞬間（key）を NPC に載せておく
// 物語は同時に起きる（順番に出さない）。全部は見られない。

const AZ_BAR = Math.atan2(RUNWAY.z - CAM_POS.z, BAR.x - CAM_POS.x);

export class StoryDirector {
  constructor({ rng, comp, layout, plan, bus }) {
    this.rng = rng;
    this.comp = comp;
    this.layout = layout;
    this.plan = plan;
    this.bus = bus;
    this.pool = [...ALL_STORIES, ...EXTRA_STORIES];
    this.reserved = new Set();
    this.active = [];
    this.beats = [];
    this.captured = new Map(); // storyId → { beats: Set, best, shots: [] }
    this.npcs = [];
    this.fieldRoles = {};
  }

  get total() {
    return this.pool.length;
  }

  // ---- 1) 選ぶ
  select(force = []) {
    const rng = this.rng;
    const pick = (list, n) => {
      const out = [];
      const pool = list.filter((s) => !out.includes(s));
      while (out.length < n && pool.length) {
        const sum = pool.reduce((a, s) => a + (s.weight ?? 1), 0);
        let r = rng.next() * sum;
        let idx = 0;
        for (; idx < pool.length; idx++) {
          r -= pool[idx].weight ?? 1;
          if (r <= 0) break;
        }
        const s = pool.splice(Math.min(idx, pool.length - 1), 1)[0];
        out.push(s);
      }
      return out;
    };
    const byCat = (c, opts = {}) => this.pool.filter((s) => s.cat === c && (opts.major === undefined || !!s.major === opts.major) && !['birds', 'sky'].includes(s.id));
    const chosen = [];
    const add = (arr) => {
      for (const s of arr) {
        if (chosen.includes(s)) continue;
        if (chosen.some((c) => (c.conflicts ?? []).includes(s.id) || (s.conflicts ?? []).includes(c.id))) continue;
        chosen.push(s);
      }
    };
    add(this.pool.filter((s) => s.id === 'birds' || s.id === 'sky'));
    add(force.map((id) => this.pool.find((s) => s.id === id)).filter(Boolean));
    // 母親は 7 割（いなければ別の家族の物語）
    if (rng.next() < 0.72) add(this.pool.filter((s) => s.id === 'mother'));
    add(pick(byCat('family', { major: true }).filter((s) => s.id !== 'mother'), chosen.some((s) => s.id === 'mother') ? 1 : 2));
    add(pick(byCat('romance', { major: true }), 1));
    add(pick([...byCat('judge')], rng.next() < 0.6 ? 2 : 1));
    add(pick([...byCat('sad', { major: true }), ...byCat('athlete', { major: true })], 1));
    if (rng.next() < 0.5) add(pick(byCat('random', { major: true }), 1));
    // 小さな物語: くだらないもの多め
    const minors = this.pool.filter((s) => !s.major && !chosen.includes(s));
    const comedy = minors.filter((s) => s.cat === 'comedy');
    const others = minors.filter((s) => s.cat !== 'comedy');
    add(pick(comedy, 3 + Math.floor(rng.next() * 2)));
    add(pick(others, 2 + Math.floor(rng.next() * 2)));
    // 合計 10〜13（鳥・夜空を含む）
    const target = 10 + Math.floor(rng.next() * 4);
    while (chosen.length > target) {
      const i = chosen.findLastIndex((s) => !s.major && !force.includes(s.id));
      if (i < 0) break;
      chosen.splice(i, 1);
    }
    this.active = chosen.map((s) => ({ ...s, start: 0 }));
    // 小さな物語の開始時刻（窓の中で）
    for (const s of this.active) {
      if (s.win) s.start = s.win[0] + rng.next() * (s.win[1] - s.win[0]);
    }
    return this.active;
  }

  // ---- 3) 時刻を秒に
  resolveTime(t, story) {
    if (typeof t === 'number') return t;
    if (t.startsWith('+')) return story.start + parseFloat(t.slice(1));
    const m = /^(\w+)#(\d)\.(\w+)([+-][\d.]+)?$/.exec(t);
    if (!m) return null;
    const [, id, n, ph, off] = m;
    const list = this.comp.attempts.filter((a) => a.id === id);
    const a = list[+n - 1];
    if (!a) return null;
    const base = { ready: a.t0, run: a.tRun, to: a.tTO, cross: a.tCross, land: a.tLand, res: a.tLand + 0.35, end: a.tEnd }[ph];
    if (base === undefined) return null;
    return base + (off ? parseFloat(off) : 0);
  }

  attemptOf(t) {
    const m = /^(\w+)#(\d)/.exec(typeof t === 'string' ? t : '');
    if (!m) return null;
    return this.comp.attempts.filter((a) => a.id === m[1])[+m[2] - 1] ?? null;
  }

  // ---- 2) 座らせる（CrowdField を作る前）
  reserveSeats() {
    const L = this.layout;
    const rng = this.rng;
    const camAz = (i) => Math.atan2(L.z[i] - CAM_POS.z, L.x[i] - CAM_POS.x);
    const zoneOk = (i, seat) => {
      const tier = L.tier[i];
      const seg = L.seg[i];
      const row = L.row[i];
      const [r0, r1] = seat.rows ?? [0, 30];
      if (row < r0 || row > r1) return false;
      const x = L.x[i];
      switch (seat.zone) {
        case 'barLine': {
          if (tier !== 0 || (seg !== 1 && seg !== 2)) return false;
          let d = camAz(i) - AZ_BAR;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          return Math.abs(d) < 0.03;
        }
        case 'nearMain': {
          if (tier !== 0 || seg !== 0) return false;
          const dx = seat.dx ?? [-16, 16];
          return x - CAM_POS.x > dx[0] && x - CAM_POS.x < dx[1];
        }
        case 'mainUpper':
          return tier === 1 && seg === 0 && (!L.booth || Math.abs(x) > L.booth.half || row < L.booth.row);
        case 'back':
          return tier === 0 && seg === 2 && (!seat.dx || (x > seat.dx[0] && x < seat.dx[1]));
        case 'backUpper':
          return tier === 1 && seg === 2 && (!seat.dx || (x > seat.dx[0] && x < seat.dx[1]));
        case 'curveE':
          return tier === 0 && seg === 1;
        case 'curveW':
          return tier === 0 && seg === 3;
        case 'front':
          return tier === 0 && seg !== 0 && row <= 3;
        default:
          return tier === 0 && seg !== 0;
      }
    };
    const used = this.reserved;
    const nearUsed = (i) => {
      for (let d = -2; d <= 2; d++) if (used.has(i + d)) return true;
      return false;
    };
    const findSeat = (seat, pair = false) => {
      const cands = [];
      for (let i = 0; i < L.count; i++) {
        if (!zoneOk(i, seat) || nearUsed(i)) continue;
        if (pair) {
          const j = L.neighbor(i, 1);
          if (j < 0 || nearUsed(j)) continue;
        }
        cands.push(i);
      }
      if (!cands.length) return -1;
      return cands[Math.floor(rng.next() * cands.length)];
    };
    this.seats = {};
    for (const s of this.active) {
      for (const c of s.cast ?? []) {
        if (!c.seat || c.seat.pairOf) continue;
        const pairRole = c.seat.pair ?? s.cast.find((o) => o.seat?.pairOf === c.role)?.role;
        let id = findSeat(c.seat, !!pairRole);
        if (id < 0) id = findSeat({ zone: 'any', rows: [0, 20] }, !!pairRole);
        if (id < 0) continue;
        used.add(id);
        this.seats[c.role] = id;
        if (pairRole) {
          const j = L.neighbor(id, 1);
          used.add(j);
          this.seats[pairRole] = j;
        }
      }
    }
    // 物語のない「ただの観客」（細かい人形）: 撮影台のすぐ後ろ・正面のスタンド
    this.ambient = [];
    const amb = [
      ['nearMain', 16, [0, 6], [-10, 12]],
      ['nearMain', 6, [6, 14], [-14, 16]],
      ['back', 8, [0, 12]],
      ['curveE', 6, [0, 14]],
      ['curveW', 3, [0, 12]],
      ['mainUpper', 3, [0, 8]],
      ['backUpper', 4, [0, 10]],
    ];
    for (const [zone, n, rows, dx] of amb) {
      for (let k = 0; k < n; k++) {
        const id = findSeat({ zone, rows, dx });
        if (id < 0) continue;
        used.add(id);
        this.ambient.push({ id, zone });
      }
    }
    for (const id of used) this.plan.kind[id] = 2; // ビルボードは空席に（上に 3D の人が座る）
  }

  // ---- 人を出す
  spawn(scene, specials) {
    this.sp = specials;
    const rng = this.rng;
    // フィールドの人（いつもいる）
    const F = (role, look, pos, yaw, meta = {}) => {
      const n = specials.addAt(SpecialCrowd.look(rng, look), pos, yaw, { role, kind: meta.kind ?? 'field', label: meta.label, chair: meta.chair, ...meta });
      this.fieldRoles[role] = n;
      return n;
    };
    const face = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
    const barC = { x: BAR.x, z: RUNWAY.z };
    const jt = JUDGE_TABLE;
    F('judgeChief', LOOKS_FIELD.judge, { x: jt.x - 0.6, y: 0, z: jt.z - 0.55 }, 0, { kind: 'judge', label: '審判長', chair: true });
    F('judge2', LOOKS_FIELD.judge2, { x: jt.x + 0.6, y: 0, z: jt.z - 0.55 }, 0, { kind: 'judge', label: '審判', chair: true });
    const oL = { x: 21.3, z: 23.9 };
    const oR = { x: 23.0, z: 32.3 };
    F('officialL', LOOKS_FIELD.official, { ...oL, y: 0 }, face(oL, barC), { kind: 'judge', label: '審判（バー）' });
    F('officialR', LOOKS_FIELD.official, { ...oR, y: 0 }, face(oR, barC), { kind: 'judge', label: '審判（バー）' });
    F('timekeeper', LOOKS_FIELD.official, { x: CLOCK_BOARD.x - 0.8, y: 0, z: CLOCK_BOARD.z + 0.9 }, Math.PI, { kind: 'judge', label: '計時員' });
    const cA = { x: 18.6, z: 24.4 };
    const cB = { x: 24.6, z: 33.2 };
    F('crewA', LOOKS_FIELD.crew, { ...cA, y: 0 }, face(cA, barC), { kind: 'staff', label: 'バーのスタッフ' });
    F('crewB', LOOKS_FIELD.crew, { ...cB, y: 0 }, face(cB, barC), { kind: 'staff', label: 'バーのスタッフ' });
    const ph = [{ x: 27.6, z: 33.9 }, { x: 29.4, z: 34.1 }, { x: 31.2, z: 33.9 }];
    ['photogA', 'photogB', 'photogC'].forEach((r, i) => F(r, LOOKS_FIELD.photog, { ...ph[i], y: 0 }, face(ph[i], barC), { kind: 'staff', label: '写真記者' }));
    F('nord', LOOKS_FIELD.lover, { x: BENCH.x - BENCH.len / 2 - 1.6, y: 0, z: BENCH.z + 1.6 }, Math.PI, { kind: 'athlete', label: '女子の選手', chair: true });
    for (const r of ['judgeChief', 'judge2', 'timekeeper']) specials.setAct(this.fieldRoles[r], { prop: 'clipboard', pose: r === 'timekeeper' ? 'clipboard' : 'sit' });
    for (const r of ['photogA', 'photogB', 'photogC']) specials.setAct(this.fieldRoles[r], { pose: 'kneel', prop: 'camera', look: 'bar' });
    for (const r of ['crewA', 'crewB']) specials.setAct(this.fieldRoles[r], { pose: 'behindBack' });
    for (const n of Object.values(this.fieldRoles)) n.base = { ...n.act };

    // 物語の人
    this.roles = { ...this.fieldRoles };
    for (const s of this.active) {
      for (const c of s.cast ?? []) {
        const id = this.seats[c.role];
        if (id === undefined) continue;
        const spec = SpecialCrowd.look(rng, c.look ?? {});
        const npc = specials.addSeated(spec, id, { role: c.role, story: s.id, label: c.label ?? '観客' });
        this.roles[c.role] = npc;
        npc.storyObj = s;
      }
    }
    // ただの観客
    for (const a of this.ambient) {
      const npc = specials.addSeated(SpecialCrowd.look(rng, {}), a.id, { role: `amb${a.id}`, label: '観客' });
      npc.ambient = { next: rng.next() * 8 };
    }
    // 物語の拍を時刻に直す
    this.beats = [];
    for (const s of this.active) {
      for (const bt of s.beats ?? []) {
        const at = this.resolveTime(bt.t, s);
        if (at === null) continue;
        if (bt.if) {
          const a = this.attemptOf(bt.t);
          if (a && (bt.if === 'clear') !== !!a.clear) continue;
        }
        this.beats.push({ ...bt, at, story: s, done: false });
      }
    }
    this.beats.sort((a, b) => a.at - b.at);
  }

  // ---- 4) 進める
  update(t, dt, ctx) {
    const sp = this.sp;
    for (const bt of this.beats) {
      if (bt.done || t < bt.at) continue;
      bt.done = true;
      if (bt.r.startsWith('@')) {
        // 選手の視線（リヴァがベンチの外の恋人を見る）
        const v = this.comp.vaulters[bt.r.slice(1)];
        const who = this.roles[bt.look];
        if (v && who) {
          v.lookNpc = who;
          v.lookUntil = t + (bt.dur ?? 3);
          v.lookBeat = bt;
        }
        continue;
      }
      const npc = this.roles[bt.r];
      if (!npc) continue;
      if (bt.a) {
        const act = {};
        if (bt.a.p !== undefined) act.pose = bt.a.p;
        if (bt.a.e !== undefined) act.expr = bt.a.e;
        if (bt.a.l !== undefined) act.look = bt.a.l;
        if (bt.a.prop !== undefined) act.prop = bt.a.prop;
        if (bt.a.stand !== undefined) act.stand = bt.a.stand;
        sp.setAct(npc, { ...npc.base, ...act });
        // 長さのない拍は「その人のふだんの状態」を変える（看板を持っている・寝ている…）
        if (!bt.dur) npc.base = { ...npc.base, ...act };
      }
      npc.beat = bt;
      npc.beatUntil = t + (bt.dur ?? 6);
      npc.interest = bt.v ?? 0.3;
      npc.emotion = bt.em ?? (bt.v ?? 0.3) * 0.6;
      // ヒント
      if (bt.hint) this.hint(npc, bt.hint, ctx);
      this.bus.emit('story:beat', { npc, beat: bt, story: bt.story });
    }
    // 拍の終わり → 元の行動へ（物語の人は「試合を見る」）
    for (const npc of sp.list) {
      if (npc.beat && t > npc.beatUntil) {
        npc.beat = null;
        npc.interest = 0;
        npc.emotion = 0;
        sp.setAct(npc, npc.base);
      }
    }
    this.updateField(t, dt);
    this.updateAmbient(t, dt);
    // 選手の視線（恋人を見る）
    for (const id in this.comp.vaulters) {
      const v = this.comp.vaulters[id];
      if (v.lookNpc && t < v.lookUntil) v.look = v.lookNpc.fig.headWorld(v._lookV ?? (v._lookV = new THREE.Vector3()));
      else if (v.lookNpc) {
        v.lookNpc = null;
        v.look = null;
        v.lookBeat = null;
      }
    }
  }

  hint(npc, kind, ctx) {
    const sp = this.sp;
    if (kind === 'glint') sp.glint(npc, { size: 0.55, life: 1.0, at: npc.props.phone?.visible ? 'hand' : 'head' });
    if (kind === 'marker' || kind === 'stand' || kind === 'face' || kind === 'glint') this.bus.emit('story:hint', { npc, kind });
    void ctx;
  }

  // 審判・スタッフ・写真記者: 競技に合わせて動く
  updateField(t, dt) {
    const R = this.fieldRoles;
    const sp = this.sp;
    const a = this.comp.activeAt(t) ?? this.lastResult;
    const busy = (n) => n.beat && t <= n.beatUntil;
    for (const at of this.comp.attempts) {
      const res = at.tLand + 0.35;
      if (t >= res && t < res + 0.1 && !at._fieldDone) {
        at._fieldDone = true;
        this.lastResult = at;
        // バーの審判: 旗を上げる（白 = 成功 / 赤 = 失敗）
        for (const r of ['officialL', 'officialR']) {
          if (busy(R[r])) continue;
          sp.setAct(R[r], { ...R[r].base, pose: 'flagUp', prop: at.clear ? 'officialWhite' : 'officialRed', expr: 'serious', look: 'bar' });
          R[r].flagUntil = t + 2.6;
        }
        // 審判長・審判: 記録を書く
        for (const r of ['judgeChief', 'judge2']) {
          if (busy(R[r])) continue;
          sp.setAct(R[r], { ...R[r].base, pose: 'write', expr: 'serious', look: 'down' });
          R[r].writeUntil = t + 2.4;
        }
        // 写真記者: シャッターの光
        if (at.clear) for (const r of ['photogA', 'photogB', 'photogC']) sp.glint(R[r], { size: 0.8, life: 0.25 });
      }
      // バーを越える瞬間: 写真記者のフラッシュ
      if (t >= at.tCross && t < at.tCross + 0.1 && !at._flash) {
        at._flash = true;
        for (const r of ['photogA', 'photogB', 'photogC']) sp.glint(R[r], { size: 0.9, life: 0.22 });
      }
      // 失敗の後: スタッフがバーを戻す
      if (!at.clear && t >= at.tEnd - 1 && t < at.tEnd + 1.2) {
        for (const r of ['crewA', 'crewB']) if (!busy(R[r])) sp.setAct(R[r], { ...R[r].base, pose: 'reachUp', look: 'bar' });
      } else if (!at.clear && t >= at.tEnd + 1.2 && t < at.tEnd + 1.3) {
        for (const r of ['crewA', 'crewB']) if (!busy(R[r])) sp.setAct(R[r], R[r].base);
      }
    }
    for (const r of ['officialL', 'officialR']) if (R[r].flagUntil && t > R[r].flagUntil && !busy(R[r])) {
      R[r].flagUntil = 0;
      sp.setAct(R[r], R[r].base);
    }
    for (const r of ['judgeChief', 'judge2']) if (R[r].writeUntil && t > R[r].writeUntil && !busy(R[r])) {
      R[r].writeUntil = 0;
      sp.setAct(R[r], R[r].base);
    }
    // 審判長のくせ: 時計を見る・ためいき（物語がない時も、ときどき）
    const jc = R.judgeChief;
    if (!busy(jc) && !jc.writeUntil) {
      const cyc = t % 23;
      const want = cyc < 1.5 ? { look: 'board', expr: 'thoughtful' } : cyc > 15 && cyc < 16.5 ? { expr: 'sigh' } : {};
      const key = JSON.stringify(want);
      if (key !== jc._idleKey) {
        jc._idleKey = key;
        sp.setAct(jc, { ...jc.base, ...want });
      }
    }
    void a;
    void dt;
  }

  // ただの観客: ときどき拍手・スマホ・前のめり・隣と話す。試技の結果には反応する
  updateAmbient(t, dt) {
    const sp = this.sp;
    const pool = [
      { pose: 'sit', expr: 'neutral' },
      { pose: 'clap', expr: 'smile' },
      { pose: 'lean', expr: 'serious' },
      { pose: 'phone', expr: 'neutral', prop: 'phone', look: 'fixed' },
      { pose: 'talk', expr: 'laugh', look: 'neighborL' },
      { pose: 'armsCrossed', expr: 'neutral' },
      { pose: 'chin', expr: 'thoughtful' },
    ];
    const recent = this.comp.attempts.find((a) => t >= a.tLand + 0.35 && t < a.tLand + 3.5);
    const running = this.comp.attempts.find((a) => t >= a.tRun && t < a.tLand);
    for (const npc of sp.list) {
      if (npc.beat && t <= npc.beatUntil) continue;
      const amb = npc.ambient;
      // 物語の人も、拍の外では試合に反応する
      let act = null;
      if (recent) act = recent.clear ? { pose: npc.id % 3 === 0 ? 'cheer' : 'clap', expr: 'laugh', stand: npc.id % 4 === 0 } : { pose: npc.id % 2 ? 'handsOnHead' : 'sit', expr: 'sigh' };
      else if (running) act = { pose: npc.id % 3 === 0 ? 'lean' : 'sit', expr: 'serious', look: 'field' };
      if (npc.kind !== 'npc') continue;
      if (act) {
        const key = JSON.stringify(act);
        if (npc._reactKey !== key) {
          npc._reactKey = key;
          sp.setAct(npc, { ...npc.base, ...act });
        }
        continue;
      }
      if (npc._reactKey) {
        npc._reactKey = null;
        sp.setAct(npc, npc.base);
      }
      if (!amb) continue;
      amb.next -= dt;
      if (amb.next <= 0) {
        amb.next = 6 + this.rng.next() * 12;
        const a = pool[Math.floor(this.rng.next() * pool.length)];
        sp.setAct(npc, { ...npc.base, ...a });
      }
    }
  }

  // ---- 撮影: 物語のどの拍を撮ったか
  capture(npcOrStory, shot) {
    const sid = typeof npcOrStory === 'string' ? npcOrStory : npcOrStory.story ?? npcOrStory.storyObj?.id;
    if (!sid) return null;
    let c = this.captured.get(sid);
    if (!c) {
      c = { beats: new Set(), best: null, shots: [], value: 0 };
      this.captured.set(sid, c);
    }
    const bt = typeof npcOrStory === 'string' ? null : npcOrStory.beat;
    const isNew = bt && !c.beats.has(bt);
    if (bt) c.beats.add(bt);
    c.shots.push(shot);
    c.value += shot.points ?? 0;
    if (!c.best || (shot.points ?? 0) > (c.best.points ?? 0)) c.best = shot;
    return { story: this.active.find((s) => s.id === sid), isNew, key: !!bt?.key };
  }

  storyById(id) {
    return this.active.find((s) => s.id === id) ?? this.pool.find((s) => s.id === id);
  }

  // 撮らなかった物語の数（エピローグの最後の一言）
  unknownCount(seed) {
    const filmed = this.captured.size;
    return 27000 + ((seed * 7919) % 2900) + (12 - filmed) * 37;
  }
}
