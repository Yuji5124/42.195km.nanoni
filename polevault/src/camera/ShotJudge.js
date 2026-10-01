// AI CAMERA JUDGE と視聴率。
//
//   1) 毎 0.25 秒: いまの画面の「テレビとしての質」q（-1〜1.5）→ 視聴率（v = 床 + たまり bonus）
//        床: 大会が終盤になるほど自然に上がる / bonus: q で増え、30 秒ほどで抜ける / SHOT の点数で跳ねる
//        競技の動き（助走〜着地）の間に選手が映っていない → 視聴者は競技を見たい（ただし物語のカットは半分許される）
//        同じものを長く映すと飽きる（夜空は 12 秒を過ぎると下がり始める）
//   2) SHOT（Space）/ ロックし続けた映像（3 秒ごと）: 8 つの値の合計 × AI の倍率 = 点数
//        sports / composition / timing / emotion / story / beauty / rarity / unexpected
//   3) AI のスコア（0〜100）: ゲームの中の情報（何が映っているか）+ 実際の画像の解析（鮮明さ・コントラスト・彩り・光）
//        + ゲーム用の乱数。完全に正解にしない: 世界記録は 88、夜空だけで 92、審判のアップで 95（HE LOOKS THOUGHTFUL）
//        癖: 審判ばかり撮ると JUDGE BIAS（審判に甘くなる）/ 同じものばかりだと BORING
//   4) Cheers（視聴率 × 時間 + 点数）と、今日の給料（出来高）

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const PHASE_W = { ritual: 0.35, run: 0.75, plant: 1.1, rise: 1.15, invert: 1.15, push: 1.15, clear: 1.25, fall: 1.0, land: 0.8, react: 0.85, walkin: 0.28, walk: 0.18, bench: 0.16 };
const ACTION = new Set(['run', 'plant', 'rise', 'invert', 'push', 'clear', 'fall', 'land']);

// 大きさの「ちょうどよさ」（画面の縦に対する比）
function sizeFit(frac, lo = 0.05, best = 0.12, hi = 0.95) {
  return sstep(lo * 0.4, best, frac) * (1 - 0.5 * sstep(hi, hi * 1.6, frac));
}

const WEIRD = ['CHAIR DETECTED (41%)', 'DRAMATIC TENSION 62%', 'THIS IS ART', 'POLE: CONFIRMED', 'HUMAN? (99%)', 'GRASS TEXTURE: EXCELLENT', 'NIGHT: DETECTED', 'GRAVITY: PRESENT', 'EMOTION: PROBABLY', 'SANDWICH (3%)', 'VIBE: STRONG', 'CAMERAMAN: TRYING'];

export class ShotJudge {
  constructor({ rng }) {
    this.rng = rng;
    this.v = 12.4;
    this.bonus = 0;
    this.peak = 12.4;
    this.sumV = 0;
    this.sumT = 0;
    this.cheers = 0;
    this.points = 0;
    this.onAir = false;
    this.q = 0;
    this.qAcc = 0;
    this.shots = [];
    this.recent = []; // 直近の SHOT の主役（飽き）
    this.judgeShots = 0;
    this.judgeBias = false;
    this.missed = 0;
    this.moments = new Map();
    this.history = []; // 視聴率のグラフ
    this.spike = 0;
    this.prevV = 12.4;
    this.mainLabel = '';
    this.stats = { sports: 0, story: 0, beauty: 0, master: 0, judge: 0 };
    this.floorBoost = 0;
  }

  floor(t) {
    return 12.4 + 5.2 * sstep(15, 175, t) + this.floorBoost;
  }

  boost(a) {
    this.floorBoost = Math.max(this.floorBoost, a);
  }

  // ---------------------------------------------------------------
  // 1) 連続の質
  quality(items, ctx) {
    const { t, comp } = ctx;
    let best = 0;
    let sum = 0;
    let main = null;
    const active = comp.activeAt(t);
    const actVaulter = active ? comp.vaulters[active.id] : null;
    const actPhase = actVaulter?.phase?.name;
    let athleteShown = false;
    let cutaway = false;
    for (const it of items) {
      const q = this.itemQ(it, ctx);
      it.q = q;
      if (it.s.kind === 'athlete' && it.s.vaulter === actVaulter && it.frac > 0.03) athleteShown = true;
      if (it.s.kind === 'npc' && it.s.npc?.beat && it.frac > 0.02 && it.s.npc.interest >= 0.6) cutaway = true;
      if (q > best) {
        best = q;
        main = it;
      }
      sum += Math.max(0, q);
    }
    let q = best + Math.min(0.35, (sum - best) * 0.25);
    if (!items.length) q = -0.12;
    if (main) q *= 0.35 + 0.65 * main.sharp;
    // 競技の動きを映していない
    if (active && ACTION.has(actPhase) && !athleteShown) q -= (cutaway ? 0.22 : 0.5) * (PHASE_W[actPhase] ?? 0.8);
    // 急なパン（ぶれた映像）
    q -= 0.3 * ctx.shake;
    this.main = main;
    return clamp(q, -1, 1.6);
  }

  itemQ(it, ctx) {
    const s = it.s;
    const { t } = ctx;
    const nov = (tau) => 1.2 * Math.exp(-s.screen / tau) - 0.2;
    switch (s.kind) {
      case 'athlete': {
        const v = s.vaulter;
        let w = PHASE_W[v.phase.name] ?? 0.2;
        if (t < v.cheerUntil) w = Math.max(w, 1.05);
        if (v.lookBeat) w = Math.max(w, 0.7);
        return w * sizeFit(it.frac, 0.04, 0.14) * (0.55 + 0.45 * it.center);
      }
      case 'npc':
      case 'judge':
      case 'staff':
      case 'field': {
        const n = s.npc;
        const fit = sizeFit(it.frac, 0.03, 0.12);
        if (n.beat && n.interest > 0) return n.interest * fit * nov(10);
        if (s.kind === 'judge') return (0.16 + (this.judgeBias ? 0.25 : 0)) * fit * nov(7);
        if (s.kind === 'staff') return 0.1 * fit * nov(6);
        return 0.06 * fit * nov(5);
      }
      case 'birds': {
        const st = ctx.birds.state;
        const w = st === 'moon' ? 1.15 : st === 'leave' ? 0.9 : st === 'tower' || st === 'roof' ? 0.38 : 0.5;
        return w * sizeFit(it.frac, 0.004, 0.03, 0.5) * nov(8);
      }
      case 'moon':
        return (ctx.sky.moonVisible ? 0.42 : 0.05) * nov(6);
      case 'light':
        return 0.14 * nov(5);
      case 'meteor':
        return 1.4;
      case 'plane':
        return 0.32 * nov(6);
      case 'cat':
        return 0.85 * sizeFit(it.frac, 0.01, 0.05) * nov(9);
      case 'wave':
        return 0.55 * nov(8);
      case 'flicker':
        return 0.5;
      case 'screen':
        return 0.06 * nov(4);
      case 'bar':
        return 0.06;
      default:
        return 0;
    }
  }

  // 毎フレーム（0.25 秒ごとに質を測る）
  tick(dt, items, ctx) {
    const { t } = ctx;
    this.qAcc += dt;
    if (this.qAcc >= 0.25 || this._q === undefined) {
      this.qAcc = 0;
      this._q = this.quality(items, ctx);
      this.updateMoments(items, ctx);
    }
    const q = this._q;
    this.q = q;
    // 主役の「飽き」
    const main = this.main;
    for (const it of items) if (it === main) it.s.screen += dt;
    if (ctx.allSubjects) for (const s of ctx.allSubjects) if (!main || s !== main.s) s.screen = Math.max(0, s.screen - dt * 0.25);
    this.floorBoost = Math.max(0, this.floorBoost - dt * 0.02);
    if (!this.onAir) return;
    this.bonus += (0.36 * q - this.bonus / 24) * dt;
    const target = this.floor(t) + this.bonus;
    this.v = clamp(target, 5, 62);
    this.peak = Math.max(this.peak, this.v);
    this.sumV += this.v * dt;
    this.sumT += dt;
    this.cheers += this.v * dt * 8;
    // スパイク（1 秒で 1.2% 以上）
    this._spikeT = (this._spikeT ?? 0) + dt;
    if (this._spikeT >= 1) {
      if (this.v - this.prevV > 1.2) this.spike = 2.2;
      this.prevV = this.v;
      this._spikeT = 0;
      this.history.push(this.v);
    }
    this.spike = Math.max(0, this.spike - dt);
  }

  // 見逃し: 試技のバー越え・物語の大事な瞬間を、その間に一度も映さなかった
  updateMoments(items, ctx) {
    if (!this.onAir) return;
    const { t, comp, stories } = ctx;
    const seen = (pred) => items.some((it) => pred(it) && it.frac > 0.02);
    for (const a of comp.attempts) {
      const key = `vault:${a.id}@${a.t0}`;
      if (t >= a.tCross - 0.6 && t <= a.tCross + 0.6) {
        const m = this.moments.get(key) ?? { seen: false, label: `${comp.byId[a.id].short} ${a.height.toFixed(2)}` };
        if (seen((it) => it.s.vaulter === comp.vaulters[a.id])) m.seen = true;
        this.moments.set(key, m);
      } else if (t > a.tCross + 0.6 && this.moments.has(key) && !this.moments.get(key).done) {
        const m = this.moments.get(key);
        m.done = true;
        if (!m.seen) this.missed++;
      }
    }
    for (const bt of stories.beats) {
      if (!bt.key || (bt.v ?? 0) < 0.95) continue;
      const npc = stories.roles[bt.r];
      if (!npc) continue;
      const key = `beat:${bt.story.id}:${bt.at}`;
      const end = bt.at + Math.min(4, bt.dur ?? 4);
      if (t >= bt.at && t <= end) {
        const m = this.moments.get(key) ?? { seen: false, label: bt.story.title };
        if (seen((it) => it.s.npc === npc)) m.seen = true;
        this.moments.set(key, m);
      } else if (t > end && this.moments.has(key) && !this.moments.get(key).done) {
        const m = this.moments.get(key);
        m.done = true;
        if (!m.seen) this.missed++;
      }
    }
  }

  // ---------------------------------------------------------------
  // 2) 1 枚の評価
  evaluate(items, ctx, img, { lock = false } = {}) {
    const rng = this.rng;
    const { t, comp, sky, birds } = ctx;
    const V = { sport: 0, composition: 0, timing: 0, emotion: 0, story: 0, beauty: 0, rarity: 0, unexpected: 0 };
    const lines = [];
    const why = [];
    const boxes = [];
    const has = (kind) => items.filter((it) => it.s.kind === kind);
    const athletes = has('athlete').filter((it) => it.frac > 0.025);
    const npcs = items.filter((it) => ['npc', 'judge', 'staff', 'field'].includes(it.s.kind) && it.frac > 0.02);
    const moon = has('moon')[0];
    const moonOk = moon && sky.moonVisible;
    const bird = has('birds')[0];
    const lights = has('light').filter((it) => Math.abs(it.ndc.x) < 0.9 && Math.abs(it.ndc.y) < 0.9);
    const bar = has('bar')[0];
    const main = items[0] ?? null;
    const sharp = main ? main.sharp : 1;
    let master = 0;
    let storyHit = null;
    let label = '';
    let sportMoment = false;
    let recordShot = false;

    // ---- 競技
    for (const it of athletes) {
      const v = it.s.vaulter;
      const ph = v.phase;
      const a = comp.activeAt(t);
      const mine = a && a.id === v.info.id;
      const okSharp = it.sharp > 0.45;
      boxes.push({ it, text: `athlete ${(0.9 + rng.next() * 0.09).toFixed(2)}` });
      if (!okSharp) continue;
      let val = 0;
      let l = '';
      if (ph.name === 'run' && it.center > 0.55) (val = 150), (l = '助走を綺麗に追う');
      else if (ph.name === 'plant') (val = 250), (l = 'ポールがしなる瞬間');
      else if (ph.name === 'rise') (val = (ph.bend ?? 0) > 0.25 ? 250 : 180), (l = ph.bend > 0.25 ? 'ポールがしなる瞬間' : '踏み切り');
      else if (ph.name === 'invert' || ph.name === 'push') (val = 300), (l = '上昇');
      else if (ph.name === 'clear') {
        val = 800;
        l = 'バー越え';
        if (ph.apex && it.frac > 0.13 && it.center > 0.45) {
          val += 600;
          l = '美しい空中姿勢';
        }
        if (bar) V.composition += 150;
        // タイミング（バーを越える瞬間）
        if (mine) {
          const dt = Math.abs(t - a.tCross);
          V.timing += Math.round(400 * clamp(1 - dt / 0.4, 0, 1));
          if (dt < 0.15) lines.push('PERFECT TIMING');
          if (a.final && a.clear) {
            recordShot = true;
            val += a.wr ? 5000 : 2500;
            l = a.wr ? '世界記録' : '大会記録';
          }
          if (!a.clear) (val = 450), (l = 'バーに触れた');
        }
      } else if (ph.name === 'fall') (val = mine && a.final && a.clear ? 1800 : 260), (l = mine && a.final && a.clear ? '大会新記録の着地' : '落下');
      else if (ph.name === 'land') (val = 250), (l = '着地');
      else if (ph.name === 'react' && ph.smile && it.frac > 0.2) (val = 400), (l = '選手の笑顔');
      else if (ph.name === 'react') (val = 160), (l = '選手の反応');
      else if (ph.name === 'ritual') (val = 120), (l = '集中');
      else (val = 60), (l = '選手');
      if (t < v.cheerUntil && v.info.id === 'takane') {
        val = Math.max(val, 1500);
        l = '優勝決定';
      }
      if (v.lookBeat) {
        V.story += 500;
        storyHit = storyHit ?? { story: 'lovers', npc: null, beat: v.lookBeat };
        l = l || '視線';
      }
      if (val > V.sport) {
        V.sport = val;
        label = `${v.info.short}・${l}`;
      }
      if (val >= 250) sportMoment = true;
    }
    if (athletes.length) lines.unshift('ATHLETE DETECTED');

    // ---- 人（物語・審判・スタッフ）
    let bestStory = 0;
    for (const it of npcs) {
      const n = it.s.npc;
      boxes.push({ it, text: `${it.s.kind === 'judge' ? 'judge' : 'person'} ${(0.6 + rng.next() * 0.38).toFixed(2)}` });
      const vis = it.sharp > 0.4 && it.frac > 0.03;
      if (!vis) continue;
      if (n.beat && n.interest > 0) {
        const sv = n.interest * 1000 * (n.beat.key ? 1.3 : 1);
        const ev = (n.emotion ?? 0) * 600;
        if (sv > bestStory) {
          bestStory = sv;
          storyHit = { npc: n, beat: n.beat, story: n.story ?? n.beat.story?.id };
          if (!label || V.sport < sv) label = `${it.s.label}・${n.beat.story?.title ?? ''}`;
        }
        V.emotion = Math.max(V.emotion, Math.round(ev));
      }
      if (it.s.kind === 'judge' && it.frac > 0.16) {
        V.unexpected = Math.max(V.unexpected, 350);
        if (!label) label = `${it.s.label}のアップ`;
      } else if (it.s.kind === 'staff' && it.frac > 0.12) V.unexpected = Math.max(V.unexpected, 200);
      else if (!n.beat && it.frac > 0.2) V.unexpected = Math.max(V.unexpected, 120);
      if (['cry', 'pray'].includes(n.act.expr) || n.act.pose === 'wipeTears') {
        if ((athletes.length || bar) && (n.emotion ?? 0) >= 0.7) V.composition = Math.max(V.composition, 1000);
      }
    }
    V.story = Math.max(V.story, Math.round(bestStory));
    const judges = npcs.filter((it) => it.s.kind === 'judge' && it.frac > 0.12);
    if (judges.length) {
      lines.push('JUDGE DETECTED');
      if (rng.next() < 0.6) lines.push('FACE EXPRESSION INTERESTING');
      if (rng.next() < 0.5) lines.push('STORY POTENTIAL HIGH');
    } else if (npcs.length && !athletes.length) lines.push(npcs.length > 1 ? `${npcs.length} PERSONS DETECTED` : 'PERSON DETECTED');

    // ---- 空・鳥・照明・出来事
    if (moon) boxes.push({ it: moon, text: `moon ${moonOk ? '0.99' : '0.41'}` });
    if (moonOk) {
      lines.push('MOON DETECTED');
      V.beauty += Math.round(300 * (moon.frac > 0.05 ? 1.6 : 1));
      if (athletes.some((it) => it.frac > 0.05 && it.sharp > 0.5)) {
        V.composition = Math.max(V.composition, 1500);
        why.push('選手＋月');
      }
      if (bird && birds.state !== 'away') {
        V.composition = Math.max(V.composition, 900 + (athletes.length ? 600 : 0));
        why.push('鳥＋月');
      }
    }
    if (bird && bird.frac > 0.004) {
      boxes.push({ it: bird, text: `bird ${(0.8 + rng.next() * 0.15).toFixed(2)}` });
      V.beauty += 200;
      lines.push('TWO BIRDS DETECTED');
      if (birds.state === 'moon' || birds.state === 'leave') V.rarity += 400;
    }
    if (lights.length) {
      V.beauty += 150;
      if (athletes.some((it) => it.frac > 0.08 && it.sharp > 0.5)) {
        V.composition = Math.max(V.composition, 800);
        why.push('選手＋照明');
      }
    }
    const pitchUp = ctx.cam.pitch > 0.16;
    if (pitchUp && (moonOk || !items.length) && !athletes.length && !npcs.length) {
      V.beauty += 100;
      if (lights.length || ctx.cam.pitch < 0.4) {
        V.composition = Math.max(V.composition, 400);
        why.push('夜空＋スタジアム');
      }
    }
    for (const it of items) {
      const k = it.s.kind;
      if (k === 'meteor') (V.rarity += 1500), (V.beauty += 1200), lines.push('METEOR DETECTED'), (label = '流れ星');
      if (k === 'plane') (V.beauty += 300), (V.rarity += 200), lines.push('AIRCRAFT DETECTED');
      if (k === 'cat') (V.rarity += 600), (V.unexpected += 400), lines.push('CAT DETECTED'), (label = label || '猫');
      if (k === 'wave') (V.rarity += 300), (V.beauty += 200), lines.push('CROWD WAVE');
      if (k === 'flicker') (V.rarity += 400), lines.push('LIGHT ANOMALY');
      if (k === 'screen' && it.frac > 0.3) (V.unexpected += 120), lines.push('SCREEN DETECTED');
      if (k === 'event' && it.s.story) storyHit = storyHit ?? { story: it.s.story, npc: null, beat: null };
    }
    // 構図: 主役が中央か三分割
    if (main) V.composition += Math.round(200 * Math.max(main.center * 0.8, main.thirds));
    // 画像の解析
    const f = img ?? { sharp: 0.5, contrast: 0.5, color: 0.4, highlight: 0.1, luma: 0.3 };
    V.beauty = Math.round(V.beauty * (0.75 + 0.25 * f.contrast + 0.2 * f.color + 0.15 * f.highlight));

    // ---- MASTER SHOT: 選手（バー越え）＋バー＋月（＋涙・鳥）
    const nowA = comp.activeAt(t);
    const clearing = !!nowA && nowA.clear && Math.abs(t - nowA.tCross) < 0.5 && athletes.some((it) => it.s.vaulter === comp.vaulters[nowA.id] && ['clear', 'push'].includes(it.s.vaulter.phase.name) && it.sharp > 0.5 && it.frac > 0.05);
    if (clearing && bar && moonOk) {
      master = 1;
      const tears = npcs.some((it) => (it.s.npc.emotion ?? 0) >= 0.8);
      if (tears || (bird && birds.state !== 'away')) master = 2;
      V.composition += master === 2 ? 5000 : 3000;
    }

    // ---- 飽き・審判びいき
    const mainId = main?.s.id ?? 'none';
    const recent = this.recent.filter((r) => t - r.t < 25);
    const boring = !lock && recent.length >= 2 && recent.slice(-2).every((r) => r.id === mainId) && !sportMoment;
    const isJudge = main && main.s.kind === 'judge' && main.frac > 0.12;
    if (!lock) {
      this.recent.push({ id: mainId, t });
      if (this.recent.length > 6) this.recent.shift();
      if (isJudge) this.judgeShots++;
      else if (!isJudge && this.judgeShots > 0 && main) this.judgeShots -= 0.34;
      this.judgeBias = this.judgeShots >= 3;
    }

    // ---- AI のスコア
    let ai = 48;
    if (athletes.length) ai += 12 + (sportMoment ? 9 : 0);
    if (V.story > 0) ai += 8 + 12 * (storyHit?.npc?.emotion ?? 0.5);
    if (isJudge) {
      ai += 26 + (this.judgeBias ? 10 : 0);
      lines.push('HE LOOKS THOUGHTFUL');
    }
    if (moonOk) ai += 16;
    if (moonOk && !athletes.length && !npcs.length) {
      ai += 19;
      lines.push('VERY BEAUTIFUL');
    }
    if (bird) ai += 10;
    if (items.some((it) => it.s.kind === 'meteor')) ai += 24;
    ai += f.sharp * 8 + f.contrast * 5 + f.color * 4 + f.highlight * 4;
    ai -= (1 - sharp) * 30;
    ai -= ctx.shake * 18;
    if (!items.length) {
      ai -= 22;
      lines.push('NO SUBJECT');
    }
    if (boring) {
      ai -= 16;
      lines.push('BORING');
    }
    if (sharp < 0.5) lines.push('OUT OF FOCUS');
    if (ctx.shake > 0.5) lines.push('MOTION BLUR');
    ai += (rng.next() - 0.5) * 7;
    // 癖: 記録の瞬間には妙に厳しい（スポーツが分かっていない）
    if (recordShot) {
      ai = Math.min(ai, 86 + rng.next() * 4);
      lines.push('SPORT VALUE STANDARD');
    }
    if (master) ai = Math.max(ai, 96 + rng.next() * 3);
    ai = Math.round(clamp(ai, 3, 99));
    // 説明の行（多すぎない）
    if (V.emotion >= 480) lines.push('EMOTION HIGH');
    if (V.story >= 700) lines.push('STORY VALUE HIGH');
    if (V.composition >= 1000 && !lines.includes('COMPOSITION EXCELLENT')) lines.push('COMPOSITION EXCELLENT');
    if (moonOk && V.sport === 0) lines.push('SPORT VALUE LOW');
    if (V.beauty >= 600) lines.push('BEAUTY EXTREME');
    if (storyHit?.story && ctx.storyAi?.(storyHit.story)) lines.push(...ctx.storyAi(storyHit.story).slice(0, 1));
    if (rng.next() < 0.22) lines.push(WEIRD[Math.floor(rng.next() * WEIRD.length)]);
    if (master) lines.unshift(master === 2 ? 'MIRACLE COMPOSITION' : 'MASTER SHOT');

    const aiMult = 0.55 + (ai / 100) * 0.8;
    const sharpMul = 0.4 + 0.6 * sharp;
    const motionMul = ctx.shake > 0.5 ? 0.6 : 1;
    const boringMul = boring ? 0.5 : 1;
    const sum = Object.values(V).reduce((a, b) => a + b, 0);
    let points = Math.round(sum * aiMult * sharpMul * motionMul * boringMul);
    if (lock) points = Math.round(points * 0.35);

    const shot = {
      t,
      points,
      ai,
      V,
      lines: [...new Set(lines)].slice(0, 6),
      label: label || (main ? main.s.label : '何もない'),
      en: main?.s.en ?? 'Empty Frame',
      main: mainId,
      kind: main?.s.kind ?? 'none',
      master,
      why,
      boxes,
      story: storyHit,
      lock,
      boring,
      judgeBias: this.judgeBias,
      sportMoment,
      recordShot,
      sharp,
    };
    // 集計
    if (!lock) {
      this.shots.push(shot);
      if (V.sport >= 150) this.stats.sports++;
      if (V.story >= 300) this.stats.story++;
      if (V.beauty >= 420 || why.some((w) => w.includes('月'))) this.stats.beauty++;
      if (master) this.stats.master++;
      if (isJudge) this.stats.judge++;
    }
    this.points += points;
    if (this.onAir) {
      this.bonus += Math.min(9, points / 1100);
      this.cheers += points * 0.3;
      if (points >= 1200) this.spike = 2.2;
    }
    return shot;
  }

  // ---------------------------------------------------------------
  get average() {
    return this.sumT > 0 ? this.sumV / this.sumT : this.v;
  }

  pay(final = false) {
    const k = final ? 1 : clamp(this.sumT / 165, 0, 1);
    const base = 30000 * (final ? 1 : k);
    const avg = Math.round(this.average * 2600 * k);
    const peak = Math.round(this.peak * 1000 * k);
    const stories = this.storyCount ?? 0;
    const story = this.stats.story * 3500 + stories * 6000;
    const sports = this.stats.sports * 1500;
    const masterB = this.stats.master ? 40000 + (this.stats.master - 1) * 10000 : 0;
    const total = Math.round((base + avg + peak + story + sports + masterB) / 100) * 100;
    return { base: Math.round(base), avg, peak, story, sports, master: masterB, total };
  }
}

// 画像の解析（160 × 90 の縮小画像）: 鮮明さ（ラプラシアンの分散）・コントラスト・彩り（Hasler & Süsstrunk）・明るい点の割合
export function analyzePixels(data, w, h) {
  const N = w * h;
  const L = new Float32Array(N);
  let sum = 0;
  let sum2 = 0;
  let rgS = 0;
  let rgS2 = 0;
  let ybS = 0;
  let ybS2 = 0;
  let hi = 0;
  for (let i = 0; i < N; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    L[i] = l;
    sum += l;
    sum2 += l * l;
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    rgS += rg;
    rgS2 += rg * rg;
    ybS += yb;
    ybS2 += yb * yb;
    if (l > 0.9) hi++;
  }
  const mean = sum / N;
  const std = Math.sqrt(Math.max(0, sum2 / N - mean * mean));
  const sRG = Math.sqrt(Math.max(0, rgS2 / N - (rgS / N) ** 2));
  const sYB = Math.sqrt(Math.max(0, ybS2 / N - (ybS / N) ** 2));
  const colorful = Math.sqrt(sRG * sRG + sYB * sYB) + 0.3 * Math.hypot(rgS / N, ybS / N);
  let lap = 0;
  let lap2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w];
      lap += v;
      lap2 += v * v;
      n++;
    }
  }
  const lapVar = lap2 / n - (lap / n) ** 2;
  return {
    luma: mean,
    contrast: clamp(std / 0.25, 0, 1),
    color: clamp(colorful / 0.35, 0, 1),
    sharp: clamp(Math.sqrt(lapVar) / 0.09, 0, 1),
    highlight: clamp((hi / N) * 40, 0, 1),
  };
}
