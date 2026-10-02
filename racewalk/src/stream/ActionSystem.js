// ACTION / REACTION（左の欄）。状況から 3〜6 個を選んで並べ、押されたらレースと配信とコメント欄に効かせる。
//   並べ方: いちばん上は「真面目」な選択肢 → ふつうの選択肢 → 誘惑（光る・下の方）。
//   押さなくてもいい。押すかどうかはプレイヤーが決める。
//   同じものを何度も押すと、配信の伸び（buzz）は減っていく（飽き）。ラスト・上位・事件の直後は伸びが大きい。

import { ACTIONS, ACTION_BY_ID, SERIOUS } from './actions.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

// スパチャの名前を間違える（それっぽい読み違い）
const WRONG = {
  石油王: '石油玉',
  十万円の男: '十円の男',
  もち: 'もちもち',
  がんばれおじさん: 'がんばりおじさん',
  'Mike_from_Ohio': 'マイク・フロム・大阪',
};
export function wrongName(name) {
  if (WRONG[name]) return WRONG[name];
  if (/[a-zA-Z]/.test(name)) return name.replace(/[aeiou]/, 'o').replace(/_.*/, '');
  const chars = [...name];
  if (chars.length >= 3) [chars[0], chars[1]] = [chars[1], chars[0]];
  else chars.push('さん');
  return chars.join('');
}

export class ActionSystem {
  constructor({ sim, metrics, rng, onAction = () => {} }) {
    this.sim = sim;
    this.metrics = metrics;
    this.rng = rng;
    this.onAction = onAction;
    this.reset();
  }

  reset() {
    this.uses = {};
    this.lastUse = {};
    this.used = new Set();
    this.globalT = -9;
    this.list = [];
    this.mode = 'normal';
    this.expr = null;
    this.recomputeT = 0;
    this.seen = new Set();
    this.attentionBonus = 0;
    this.count = 0;
    this.log = [];
  }

  // 状況の名前
  modeOf(c) {
    if (c.dq) return 'dq';
    if (c.finished) return 'after';
    if (c.inPenalty) return 'penalty';
    if (c.t - c.tripT < 6.5) return 'trip';
    if (c.rem < 400) return 'final';
    const scT = c.sc ? c.sc.t : -99;
    const antiT = c.anti ? c.anti.t : -99;
    if (c.sc && scT >= antiT) return 'superchat';
    if (c.anti) return 'anti';
    if (c.fatigueShown) return 'fatigue';
    return 'normal';
  }

  ok(a, c) {
    if (a.once && this.used.has(a.id)) return false;
    if (a.max && (this.uses[a.id] ?? 0) >= a.max) return false;
    const last = this.lastUse[a.id] ?? -99;
    if (c.t - last < (a.cd ?? 5)) return false;
    if (a.when && !a.when(c)) return false;
    return true;
  }

  // 並べる（6 個まで）
  compute(c) {
    const mode = this.modeOf(c);
    this.mode = mode;
    const prim = ACTIONS.filter((a) => a.ctx.includes(mode) && this.ok(a, c));
    const extra = ACTIONS.filter((a) => a.ctx.includes('*') && this.ok(a, c) && !['after', 'dq', 'penalty'].includes(mode) && !(mode === 'trip' && a.id !== 'water'));
    const sid = SERIOUS[mode];
    const serious = prim.filter((a) => a.id === sid);
    const normal = prim.filter((a) => a.id !== sid && !a.tempt);
    const tempt = [...prim.filter((a) => a.id !== sid && a.tempt), ...extra.filter((a) => a.tempt)];
    const util = extra.filter((a) => !a.tempt);
    let out = [...serious, ...util, ...normal];
    const room = Math.max(0, 6 - tempt.length);
    out = out.slice(0, Math.max(room, Math.min(3, out.length)));
    out = [...out, ...tempt].slice(0, 6);
    return out;
  }

  update(dt, c, pressure = null) {
    this.recomputeT -= dt;
    if (this.recomputeT > 0 && this.list.length) return;
    this.recomputeT = 0.25;
    const acts = this.compute(c);
    this.list = acts.map((a, i) => {
      const fresh = !this.seen.has(a.id);
      this.seen.add(a.id);
      return {
        id: a.id,
        key: i + 1,
        icon: a.icon,
        label: typeof a.label === 'function' ? a.label(c) : a.label,
        tempt: !!a.tempt,
        big: !!a.big,
        fresh,
        pressure: pressure?.get(a.id) ?? null,
      };
    });
  }

  // 押された（番号 1〜6 か id）
  trigger(idOrKey, c) {
    const item = typeof idOrKey === 'number' ? this.list[idOrKey - 1] : this.list.find((x) => x.id === idOrKey);
    if (!item) return null;
    if (c.t - this.globalT < 0.9) return null;
    const a = ACTION_BY_ID[item.id];
    if (!a || !this.ok(a, c)) return null;
    return this.apply(a, c, item);
  }

  apply(a, c, item = null) {
    const sim = this.sim;
    const t = sim.t;
    const m = sim.mods;
    const r = a.race ?? {};
    if (r.stop) m.stopUntil = t + r.stop;
    if (r.speed) {
      m.speedMul = r.speed[0];
      m.speedUntil = t + r.speed[1];
    }
    if (r.form) {
      m.lcAdd = r.form[0];
      m.bkAdd = r.form[1];
      m.formUntil = t + r.form[2];
    }
    if (r.trip) {
      m.tripAdd = r.trip[0];
      m.tripUntil = t + r.trip[1];
    }
    if (r.focus) m.focusUntil = t + r.focus;
    if (r.run) m.runUntil = t + r.run;
    if (r.lie) m.lieUntil = t + r.lie;
    if (r.back) m.backUntil = t + r.back;
    if (r.distract) {
      m.distract = r.distract[0];
      m.distractUntil = t + r.distract[1];
    }
    if (r.arm) {
      m.arm = r.arm[0];
      m.armUntil = t + r.arm[1];
    }
    if (r.energy) sim.player.E = clamp(sim.player.E + r.energy);
    // しゃべると息が上がる（競歩しながら配信）
    if (a.say?.length && !sim.player.finished) sim.player.E = clamp(sim.player.E - 0.0035);
    if (r.water) {
      sim.waterAuto = true;
      sim.waterWanted = true;
    }
    if (r.attention) this.attentionBonus += r.attention;

    // 配信: 飽き × タイミング
    const n = this.uses[a.id] ?? 0;
    const novelty = Math.pow(0.58, n);
    let tm = 1;
    if (c.rem < 400 && !c.finished) tm *= 1 + 1.6 * clamp(1 - c.rem / 400);
    if (c.rank <= 3 && !c.finished) tm *= 1.2;
    if (this.mode === 'trip') tm *= 1.2;
    const s = a.stream ?? {};
    let heat = (s.heat ?? 0) * (0.7 + 0.3 * novelty);
    // 疲れているのに「余裕」「疲れてない」と言う（嘘）は燃える
    if (a.lie && c.fatigueLevel >= 2) heat += 0.25 * c.fatigueLevel;
    this.metrics.impulse({ buzz: (s.buzz ?? 0) * novelty * tm, heat, trust: s.trust ?? 0, fun: (s.fun ?? 0) * novelty, label: a.clip ?? null, clip: tm });
    if (a.subs) this.metrics.subs += this.metrics.ccu * 0.004;

    if (a.expr) this.expr = { name: a.expr[0], until: t + a.expr[1] };
    const say = this.fill(this.pick(a.say), c);
    this.uses[a.id] = n + 1;
    this.lastUse[a.id] = c.t;
    this.globalT = c.t;
    if (a.once) this.used.add(a.id);
    this.count++;
    this.log.push({ t: c.t, id: a.id });
    this.recomputeT = 0;
    const info = { action: a, say, mode: this.mode, label: item?.label ?? a.label, novelty, c };
    this.onAction(info);
    return info;
  }

  pick(arr) {
    if (!arr || !arr.length) return '';
    return arr[Math.floor(this.rng.next() * arr.length)];
  }

  fill(s, c) {
    if (!s) return '';
    return s
      .replaceAll('{anti}', c.anti?.name ?? 'アンチ')
      .replaceAll('{sc}', c.sc?.name ?? '')
      .replaceAll('{amount}', c.sc ? c.sc.amount.toLocaleString('en-US') : '')
      .replaceAll('{msg}', c.sc?.msg ?? '')
      .replaceAll('{wrong}', c.sc ? wrongName(c.sc.name) : '')
      .replaceAll('{read}', c.readLine ?? 'がんばれ')
      .replaceAll('{rival}', '真壁');
  }

  exprAt(t) {
    return this.expr && t < this.expr.until ? this.expr.name : null;
  }
}
