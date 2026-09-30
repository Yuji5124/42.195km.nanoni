import { SYSTEM_CLASSES, SYSTEM_IDS } from './Systems.js';

// どのラウンドで・いつ・どのゲームシステムに変わるか。
//
//   ROUND 1 … 時刻で変わる: 普通の 3D → 25 秒で正面固定カウンター → 62 秒で横スクロール
//   ROUND 2 … 「慣れた瞬間」に変わる: 15 秒たって、そのシステムで 4 回うまくいったら（最長 28 秒）
//   ROUND 3 … 中継・監視カメラ・スマホ・望遠（周りが騒がしくなる。変わる間隔は約 20 秒）
//   FINAL   … 2 つ重ね（横スクロール × 8BIT など）を 10 秒ごと → 残り 34 秒で「???」（3 秒ごと）→ 残り 12 秒で 3D に戻る
//
// 試合は止めない。切り替えの瞬間だけ相手の攻撃を 0.6 秒待たせる（切り替えで理不尽に当てない）。

export const ROUND_SEC = 110; // 1 ラウンドの長さ（ゲーム内の秒。表示は 3:00）

const PLAN = {
  1: { fixed: [['3d', 0], ['counter', 25], ['side', 62]] },
  2: { adaptive: ['top', 'fps', 'rhythm', '8bit', 'qte', 'slow'], min: 15, max: 28 },
  3: { adaptive: ['tv', 'cctv', 'phone', 'tele', 'counter'], min: 17, max: 24 },
  4: {
    combos: [
      ['side', '8bit'],
      ['fps', 'rhythm'],
      ['top', 'cctv'],
      ['phone', 'slow'],
      ['counter', 'tv'],
      ['tele', 'qte'],
      ['side', 'phone'],
    ],
    every: 10.5,
  },
};

const DEFAULT_RULES = { mode: 'fixed', still: false, tellScale: 1, counterMul: 2, enemyGuardAlways: false, dodgeHook: null, onBeat: null, forceDodge: false };

export class SystemDirector {
  constructor(m) {
    this.m = m;
    this.active = [];
    this.ids = [];
    this.changes = 0;
    this.seen = new Set();
    this.round = 0;
    this.segT = 0;
    this.idx = 0;
    this.mystery = false;
    this.forced = m.params.get('sys');
  }

  get primary() {
    return this.active[0];
  }

  get timeScale() {
    return this.active.reduce((a, s) => Math.min(a, s.timeScale ?? 1), 1);
  }

  get name() {
    return this.active.map((s) => s.name).join(' × ');
  }

  // ids: ['side'] / ['side', '8bit']
  set(ids, { silent = false, label = null } = {}) {
    const m = this.m;
    for (const s of this.active) s.exit();
    this.active = ids.map((id) => new SYSTEM_CLASSES[id](m));
    this.ids = ids;
    const rules = { ...DEFAULT_RULES, ...m.baseRules };
    for (const s of [...this.active].reverse()) Object.assign(rules, s.rules ?? {});
    rules.mode = this.active[0].rules?.mode ?? 'fixed';
    // 重ねた時: 移動のしかたは 1 つ目、リズムの攻撃（aggression 0）は重ねても生かす
    m.core.setRules(rules);
    m.fx.setLook(this.active[0].look, this.active[1]?.look ?? null);
    for (const s of this.active) s.enter();
    document.body.dataset.sys = this.active[0].id;
    document.body.dataset.sys2 = this.active[1]?.id ?? '';
    const shown = label ?? this.name;
    m.hud.setSystem(shown, this.mystery ? '???' : this.active.map((s) => s.sub).join(' ＋ '), this.active[0].keys, !silent);
    m.core.grace(0.6);
    m.rig.cut();
    if (!silent) {
      this.changes++;
      for (const id of ids) this.seen.add(id);
      m.onSystemChange?.(this);
    } else for (const id of ids) this.seen.add(id);
  }

  // ラウンドの始め
  startRound(round) {
    this.round = round;
    this.segT = 0;
    this.idx = 0;
    this.mystery = false;
    if (this.forced && SYSTEM_CLASSES[this.forced.split(',')[0]]) {
      this.set(this.forced.split(',').filter((id) => SYSTEM_CLASSES[id]), { silent: true });
      return;
    }
    const plan = PLAN[round];
    if (plan.fixed) this.set([plan.fixed[0][0]], { silent: round === 1 });
    else if (plan.adaptive) this.set([plan.adaptive[0]]);
    else this.set(plan.combos[0]);
  }

  // ラウンドの時刻 t（ゲーム内の秒）
  update(dt, t) {
    for (const s of this.active) s.update(dt);
    if (this.forced) return;
    this.segT += dt;
    const plan = PLAN[this.round];
    if (!plan) return;
    if (plan.fixed) {
      const next = plan.fixed[this.idx + 1];
      if (next && t >= next[1]) {
        this.idx++;
        this.set([next[0]]);
      }
    } else if (plan.adaptive) {
      const s = this.primary;
      const used = this.segT >= plan.min && s.acts >= 4;
      if ((used || this.segT >= plan.max) && this.idx < plan.adaptive.length - 1 && t < ROUND_SEC - 8) {
        this.idx++;
        this.segT = 0;
        if (used) this.m.onUsedTo?.(s);
        this.set([plan.adaptive[this.idx]]);
      }
    } else if (plan.combos) {
      const left = ROUND_SEC - t;
      if (left <= 12) {
        if (this.mystery || this.ids.length > 1 || this.ids[0] !== '3d') {
          this.mystery = false;
          this.set(['3d'], { label: '3D（たぶん）' });
        }
      } else if (left <= 34) {
        // ???: 3 秒ごとに何か
        if (!this.mystery || this.segT >= 3) {
          this.mystery = true;
          this.segT = 0;
          const pick = () => SYSTEM_IDS[Math.floor(Math.random() * SYSTEM_IDS.length)];
          let ids = [pick()];
          if (Math.random() < 0.5) {
            const b = pick();
            if (b !== ids[0] && b !== 'slow') ids.push(b);
          }
          if (ids[0] === 'slow') ids = ['slow'];
          this.set(ids, { label: '???' });
        }
      } else if (this.segT >= plan.every) {
        this.segT = 0;
        this.idx = (this.idx + 1) % plan.combos.length;
        this.set(plan.combos[this.idx]);
      }
    }
  }

  input(raw) {
    let r = raw;
    for (const s of this.active) r = s.input(r);
    return r;
  }

  camera(rig, dt) {
    this.primary?.camera(rig, dt);
  }

  onFight(ev) {
    for (const s of this.active) s.onFight(ev);
    // 慣れの目安: うまくいった行動
    const s = this.primary;
    if (!s) return;
    if (ev.type === 'land' && ev.who === 'player') s.acts += ev.counter ? 2 : 1;
    if (ev.type === 'dodge') s.acts += 1;
    if (ev.type === 'perfect') s.acts += 1.5;
  }

  clear() {
    for (const s of this.active) s.exit();
    this.active = [];
    document.body.dataset.sys = 'none';
    document.body.dataset.sys2 = '';
  }
}
