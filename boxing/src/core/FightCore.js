// 試合の中身（見た目・カメラ・画面の方式から独立）。
// ゲームシステムがどれだけ変わっても、同じ相手・同じ HP・同じラウンドの試合がここで続く。
//
//   プレイヤー: J = ジャブ（左）/ K = ストレート（右）/ L = ガード（押している間）/ A D = よける（スリップ）/ Space = アッパー（特殊）
//   相手（AI）: 予備動作（テル）を必ず見せてから打つ（Punch-Out!! の分かりやすさ）
//     → テルの最後によければ PERFECT（カウンターのチャンス）/ ガードすれば軽く済む / 何もしなければ当たる
//   カウンター: 相手の空振りの直後に打つと 2 倍
//
// 位置の決め方（rules.mode）: fixed = 間合いは自動（よけるはスリップ）/ axis = 前後に動ける（横視点）/ circle = 相手の周りを回る（真上視点）
// イベント（emit）: punch / land / blocked / whiff / tell / dodge / perfect / counter / hit / guardHit / down / combo / exchange / guardUp / stun

export const PUNCHES = {
  jab: { hand: 'L', windup: 0.07, strike: 0.08, recover: 0.15, dmg: 4, reach: 1.32, name: 'JAB' },
  straight: { hand: 'R', windup: 0.12, strike: 0.1, recover: 0.22, dmg: 8, reach: 1.38, name: 'STRAIGHT' },
  upper: { hand: 'R', windup: 0.2, strike: 0.12, recover: 0.3, dmg: 13, reach: 1.1, name: 'UPPERCUT' },
  hook: { hand: 'L', windup: 0.12, strike: 0.12, recover: 0.24, dmg: 9, reach: 1.2, name: 'HOOK' },
};

// 相手の攻撃（テル = 予備動作の長さ）
export const ATTACKS = {
  jab: { punch: 'jab', tell: 0.5, dmg: 6 },
  straight: { punch: 'straight', tell: 0.62, dmg: 9 },
  hook: { punch: 'hook', tell: 0.72, dmg: 11 },
  upper: { punch: 'upper', tell: 0.82, dmg: 13 },
};

const SLIP = 0.42;
const DIST = 1.12;

export class Fighter {
  constructor(side, maxHp) {
    this.side = side;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.x = side === 'player' ? -DIST / 2 : DIST / 2;
    this.z = 0;
    this.yaw = 0;
    this.action = 'idle';
    this.t = 0; // 今の行動の経過
    this.punch = null; // { type, phase, t, resolved }
    this.slipDir = 0;
    this.slipT = 0;
    this.guardHeld = false;
    this.guard = 0; // 0〜1（見た目）
    this.hitT = 0; // 当たった直後（見た目の揺れ）
    this.hitDir = 0;
    this.stun = 0;
    this.downs = 0;
    this.stats = { thrown: 0, landed: 0, dodges: 0, perfect: 0, counters: 0, blocked: 0, damage: 0 };
    this.walk = 0;
  }
}

export class FightCore {
  constructor(rng, { playerHp = 100, enemyHp = 160 } = {}) {
    this.rng = rng;
    this.player = new Fighter('player', playerHp);
    this.enemy = new Fighter('enemy', enemyHp);
    this.rules = { mode: 'fixed', tellScale: 1, dmgMul: 1, playerDmgMul: 1, counterMul: 2, aggression: 1 };
    this.listeners = [];
    this.running = false;
    this.time = 0;
    this.center = { x: 0, z: 0 };
    this.axis = 0; // 2 人を結ぶ線の向き（ゆっくり回る）
    this.axisSpin = 0.05;
    this.counterWindow = 0; // プレイヤーのカウンターのチャンス（秒）
    this.enemyPlan = { next: 1.6, attack: null, t: 0, tellPos: null };
    this.recent = []; // 最近のプレイヤーのパンチ時刻（相手のガード判断）
    this.lastLand = { player: -9, enemy: -9 };
    this.combo = { n: 0, t: -9 };
    this.roundStats = [];
    this.difficulty = 1;
  }

  on(fn) {
    this.listeners.push(fn);
  }

  emit(type, info = {}) {
    for (const fn of this.listeners) fn({ type, t: this.time, ...info });
  }

  setRules(r) {
    this.rules = { ...this.rules, ...r };
  }

  // 2 人の位置（リングの座標）を線の向きと中心から
  get dist() {
    return Math.hypot(this.enemy.x - this.player.x, this.enemy.z - this.player.z);
  }

  // ------------------------------------------------------------------
  update(dt, input) {
    if (!this.running) return;
    this.time += dt;
    const P = this.player;
    const E = this.enemy;
    this.counterWindow = Math.max(0, this.counterWindow - dt);
    for (const f of [P, E]) {
      f.t += dt;
      f.hitT = Math.max(0, f.hitT - dt);
      f.stun = Math.max(0, f.stun - dt);
    }
    this.movePair(dt, input);
    this.updatePlayer(dt, input);
    this.updateEnemy(dt);
    for (const f of [P, E]) f.guard += ((f.guardHeld && f.action !== 'punch' ? 1 : 0) - f.guard) * Math.min(1, dt * 14);
  }

  // 位置: fixed は間合い一定（ゆっくり回る）/ axis は前後 / circle は周りを回る
  movePair(dt, input) {
    const P = this.player;
    const E = this.enemy;
    const mode = this.rules.mode;
    if (P.action === 'down' || E.action === 'down') return;
    if (mode === 'fixed') {
      if (this.rules.still) {
        // 正面固定: 中心へ戻って止まる（向きも変えない）
        this.center.x *= 1 - Math.min(1, dt * 2);
        this.center.z *= 1 - Math.min(1, dt * 2);
      } else {
        this.axis += this.axisSpin * dt * Math.sin(this.time * 0.13);
        // 中心もゆっくり動く（リングの中）
        this.center.x = Math.sin(this.time * 0.11) * 0.9;
        this.center.z = Math.cos(this.time * 0.08) * 0.7;
      }
      const d = DIST;
      const cx = this.center.x;
      const cz = this.center.z;
      const ax = Math.cos(this.axis);
      const az = Math.sin(this.axis);
      P.x += (cx - ax * d * 0.5 - P.x) * Math.min(1, dt * 4);
      P.z += (cz - az * d * 0.5 - P.z) * Math.min(1, dt * 4);
      E.x += (cx + ax * d * 0.5 - E.x) * Math.min(1, dt * 4);
      E.z += (cz + az * d * 0.5 - E.z) * Math.min(1, dt * 4);
    } else if (mode === 'axis') {
      // 横視点: プレイヤーは A D で前後（相手へ近づく / 離れる）
      const ax = Math.cos(this.axis);
      const az = Math.sin(this.axis);
      const move = P.action === 'punch' || P.action === 'hit' ? 0 : input.moveAxis * 2.3;
      P.x += ax * move * dt;
      P.z += az * move * dt;
      P.walk = Math.abs(move);
      // 相手は間合い 1.15m を取ろうとする（攻撃の時は踏み込む）
      const want = E.action === 'tell' ? 1.0 : 1.3;
      const dx = E.x - P.x;
      const dz = E.z - P.z;
      const dd = Math.hypot(dx, dz) || 1;
      const k = (want - dd) * Math.min(1, dt * 2.2);
      E.x += (dx / dd) * k;
      E.z += (dz / dd) * k;
      this.clampRing(P);
      this.clampRing(E);
      if (Math.hypot(E.x - P.x, E.z - P.z) < 0.75) {
        E.x = P.x + (dx / dd) * 0.75;
        E.z = P.z + (dz / dd) * 0.75;
      }
    } else if (mode === 'circle') {
      // 真上視点: A D で相手の周りを回る
      const move = P.action === 'punch' || P.action === 'hit' ? 0 : input.moveAxis;
      const dx = P.x - E.x;
      const dz = P.z - E.z;
      const r = Math.max(0.9, Math.hypot(dx, dz));
      let a = Math.atan2(dz, dx) + (move * 2.4 * dt) / r;
      const want = 1.15;
      const rr = r + (want - r) * Math.min(1, dt * 3);
      P.x = E.x + Math.cos(a) * rr;
      P.z = E.z + Math.sin(a) * rr;
      P.walk = Math.abs(move);
      // 相手はゆっくりリングの中央へ戻る
      E.x += (0 - E.x) * dt * 0.3;
      E.z += (0 - E.z) * dt * 0.3;
      this.clampRing(P);
      a = Math.atan2(E.z - P.z, E.x - P.x);
      this.axis = a;
    }
    // 向き合う
    const a = Math.atan2(E.z - P.z, E.x - P.x);
    if (mode !== 'fixed') this.axis = a;
    P.yaw = Math.atan2(Math.cos(a), Math.sin(a));
    E.yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
  }

  clampRing(f) {
    const L = 2.55;
    f.x = Math.max(-L, Math.min(L, f.x));
    f.z = Math.max(-L, Math.min(L, f.z));
  }

  // ------------------------------------------------------------------
  updatePlayer(dt, input) {
    const P = this.player;
    const E = this.enemy;
    if (P.action === 'down' || P.action === 'win' || P.action === 'lose' || P.action === 'rest') return;
    if (P.action === 'hit' && P.t > 0.32) this.setAction(P, 'idle');
    if (P.action === 'slip' && P.t > SLIP) {
      this.setAction(P, 'idle');
      P.slipDir = 0;
    }
    P.guardHeld = !!input.guard && P.action !== 'hit';
    // 打つ
    if (P.action === 'punch') this.advancePunch(P, E, dt);
    const free = P.action === 'idle' || (P.action === 'punch' && P.punch.phase === 'recover' && P.punch.t > 0.05);
    if (free && P.action !== 'hit') {
      if (input.slip && this.rules.mode !== 'circle') {
        this.setAction(P, 'slip');
        P.slipDir = input.slip;
        P.slipAt = this.time;
        this.emit('slip', { who: 'player', dir: input.slip });
      } else if (!P.guardHeld) {
        const type = input.special ? 'upper' : input.straight ? 'straight' : input.jab ? 'jab' : null;
        if (type) this.startPunch(P, type);
      }
    }
  }

  startPunch(f, type) {
    this.setAction(f, 'punch');
    f.punch = { type, phase: 'windup', t: 0, resolved: false };
    f.stats.thrown++;
    if (f.side === 'player') {
      this.recent.push(this.time);
      if (this.recent.length > 8) this.recent.shift();
    }
    this.emit('punch', { who: f.side, punch: type });
  }

  advancePunch(f, target, dt) {
    const p = f.punch;
    const def = PUNCHES[p.type];
    p.t += dt;
    if (p.phase === 'windup' && p.t >= def.windup) {
      p.phase = 'strike';
      p.t = 0;
    } else if (p.phase === 'strike' && p.t >= def.strike) {
      if (!p.resolved) {
        p.resolved = true;
        if (f.side === 'player') this.resolvePlayerPunch(p, def);
      }
      p.phase = 'recover';
      p.t = 0;
    } else if (p.phase === 'recover' && p.t >= def.recover) {
      this.setAction(f, 'idle');
      f.punch = null;
    }
  }

  // プレイヤーのパンチの結果
  resolvePlayerPunch(p, def) {
    const P = this.player;
    const E = this.enemy;
    if (E.action === 'down') return;
    const inReach = this.dist <= def.reach + 0.05;
    if (!inReach) {
      this.emit('whiff', { who: 'player', punch: p.type });
      return;
    }
    // 相手がよけている（テルの無い時のウィービング）
    if (E.action === 'slip') {
      this.emit('whiff', { who: 'player', punch: p.type, dodged: true });
      return;
    }
    // カウンター = 相手の空振りの直後（1 回よけたら 1 回だけ）
    const counter = this.counterWindow > 0;
    let dmg = def.dmg * this.rules.dmgMul;
    const beat = this.rules.onBeat ? this.rules.onBeat() : null;
    if (beat === 'perfect') dmg *= 2;
    else if (beat === 'miss') dmg *= 0.5;
    const guarding = E.guardHeld || (this.rules.enemyGuardAlways && E.action !== 'hit' && E.action !== 'stun');
    if (guarding && !counter) {
      // ガードの上から: ストレートとアッパーは少し通る
      const through = p.type === 'jab' ? 0.08 : 0.3;
      dmg *= through;
      E.stats.blocked++;
      this.damage(E, dmg, P);
      this.emit('blocked', { who: 'player', punch: p.type, dmg });
      if (p.type !== 'jab' && this.rng.next() < 0.35) {
        E.guardHeld = false;
        E.stun = 0.5;
        this.setAction(E, 'stun');
        this.emit('guardBreak', { who: 'player' });
      }
      return;
    }
    if (counter) {
      dmg *= this.rules.counterMul;
      this.counterWindow = 0;
    }
    P.stats.landed++;
    if (counter) P.stats.counters++;
    this.combo = this.time - this.combo.t < 0.7 ? { n: this.combo.n + 1, t: this.time } : { n: 1, t: this.time };
    this.damage(E, dmg, P);
    E.hitT = 0.3;
    E.hitDir = p.type === 'jab' ? 0.4 : p.type === 'upper' ? 0 : -0.6;
    if (E.action === 'tell' || E.action === 'punch') {
      // 打ち終わりを止める（打ち勝った）
      this.enemyPlan.attack = null;
    }
    if (E.hp > 0 && E.action !== 'down') {
      this.setAction(E, 'hit');
      // ぐらつきは 1 回だけ（ぐらついている間に当てても延びない = 永久コンボにならない）
      if ((counter || p.type === 'upper') && E.stun <= 0) E.stun = 0.5;
      // 3 発続けてもらったら固める（王者は打たれっぱなしにならない）
      E.streak = this.time - (E.lastHitT ?? -9) < 1.6 ? (E.streak ?? 0) + 1 : 1;
      E.lastHitT = this.time;
      if (E.streak >= 3) {
        E.streak = 0;
        E.stun = 0;
        E.guardHeld = true;
        E.guardUntil = this.time + 1.3 + this.rng.next() * 0.5;
        this.emit('guardUp', { who: 'enemy' });
      }
    }
    this.lastLand.player = this.time;
    this.emit('land', { who: 'player', punch: p.type, dmg, counter, beat, combo: this.combo.n });
    if (this.combo.n >= 3) this.emit('combo', { who: 'player', n: this.combo.n });
    if (this.time - this.lastLand.enemy < 1.2) this.emit('exchange', {});
  }

  damage(f, dmg, from) {
    f.hp = Math.max(0, f.hp - dmg);
    if (from) from.stats.damage += dmg;
    if (f.hp <= 0 && f.action !== 'down') {
      this.setAction(f, 'down');
      f.downs++;
      f.punch = null;
      f.guardHeld = false;
      this.emit('down', { who: f.side, downs: f.downs });
    }
  }

  // ------------------------------------------------------------------
  // 相手の AI
  updateEnemy(dt) {
    const E = this.enemy;
    const P = this.player;
    if (['down', 'win', 'lose', 'rest'].includes(E.action)) return;
    const plan = this.enemyPlan;
    if (E.action === 'hit' && E.t > 0.3) this.setAction(E, E.stun > 0 ? 'stun' : 'idle');
    if (E.action === 'stun' && E.stun <= 0) this.setAction(E, 'idle');
    if (E.action === 'slip' && E.t > 0.4) this.setAction(E, 'idle');
    if (E.action === 'punch') {
      this.advancePunch(E, P, dt);
      return;
    }
    if (E.action === 'hit' || E.action === 'stun') return;
    // ガード: プレイヤーが続けて打ってきたら固める
    const recentN = this.recent.filter((t) => this.time - t < 1.3).length;
    if (E.action === 'idle' && recentN >= 3 && !E.guardHeld && this.counterWindow <= 0) {
      E.guardHeld = true;
      E.guardUntil = this.time + 0.9 + this.rng.next() * 0.6;
      this.emit('guardUp', { who: 'enemy' });
    }
    if (E.guardHeld && this.time > (E.guardUntil ?? 0)) E.guardHeld = false;
    // 攻撃の予定
    if (E.action === 'idle' && !P.action.startsWith('down')) {
      plan.next -= dt * this.rules.aggression;
      if (plan.next <= 0 && !E.guardHeld) {
        const keys = this.difficulty < 1.2 ? ['jab', 'jab', 'straight', 'hook'] : ['jab', 'straight', 'hook', 'hook', 'upper'];
        const type = keys[Math.floor(this.rng.next() * keys.length)];
        const a = ATTACKS[type];
        const tell = a.tell * this.rules.tellScale * (1.15 - 0.15 * this.difficulty);
        plan.attack = { type, tell, t: 0, tellPos: { x: P.x, z: P.z } };
        this.setAction(E, 'tell');
        this.emit('tell', { who: 'enemy', attack: type, duration: tell });
      } else if (this.rng.next() < dt * 0.25) {
        // たまにウィービング（見た目）
        this.setAction(E, 'slip');
        E.slipDir = this.rng.chance(0.5) ? 1 : -1;
      }
    }
    if (E.action === 'tell' && plan.attack) {
      plan.attack.t += dt;
      if (plan.attack.t >= plan.attack.tell) this.enemyStrike();
    } else if (E.action === 'tell' && !plan.attack) {
      this.setAction(E, 'idle');
    }
  }

  // 相手の攻撃が当たる瞬間
  enemyStrike() {
    const E = this.enemy;
    const P = this.player;
    const plan = this.enemyPlan;
    const atk = plan.attack;
    plan.attack = null;
    const a = ATTACKS[atk.type];
    this.startPunch(E, a.punch);
    E.punch.phase = 'strike';
    E.punch.resolved = true;
    plan.next = (0.9 + this.rng.next() * 1.3) / this.difficulty;
    // よけた？
    let dodged = false;
    let perfect = false;
    const mode = this.rules.mode;
    if (P.action === 'down') return;
    if (P.action === 'slip' && P.slipAt !== undefined) {
      const lead = this.time - P.slipAt;
      if (lead <= SLIP + 0.02) {
        dodged = true;
        perfect = lead <= 0.24;
      }
    }
    if (mode === 'axis' && this.dist > PUNCHES[a.punch].reach + 0.08) dodged = true;
    if (mode === 'circle' && Math.hypot(P.x - atk.tellPos.x, P.z - atk.tellPos.z) > 0.5) {
      dodged = true;
      perfect = Math.hypot(P.x - atk.tellPos.x, P.z - atk.tellPos.z) < 0.9;
    }
    if (this.rules.forceDodge) dodged = true;
    // ゲームシステムの判定（QTE: 正しいボタンを押していたら必ずよける）
    const hook = this.rules.dodgeHook?.(atk);
    if (hook) {
      dodged = true;
      perfect = hook === 'perfect';
    }
    if (dodged) {
      P.stats.dodges++;
      if (perfect) P.stats.perfect++;
      this.counterWindow = perfect ? 1.1 : 0.55;
      E.stun = perfect ? 0.7 : 0;
      this.emit(perfect ? 'perfect' : 'dodge', { who: 'player', attack: atk.type });
      this.emit('whiff', { who: 'enemy', punch: a.punch });
      return;
    }
    let dmg = a.dmg * this.rules.playerDmgMul * (0.85 + 0.15 * this.difficulty);
    if (P.guardHeld) {
      dmg *= 0.18;
      P.stats.blocked++;
      this.damage(P, dmg, E);
      P.hitT = 0.15;
      this.emit('guardHit', { who: 'enemy', attack: atk.type, dmg });
      return;
    }
    E.stats.landed++;
    this.damage(P, dmg, E);
    P.hitT = 0.35;
    P.hitDir = atk.type === 'hook' ? 0.8 : atk.type === 'upper' ? 0 : -0.3;
    if (P.hp > 0) {
      this.setAction(P, 'hit');
      P.punch = null;
      P.slipDir = 0;
    }
    this.lastLand.enemy = this.time;
    this.emit('hit', { who: 'enemy', attack: atk.type, dmg });
    if (this.time - this.lastLand.player < 1.2) this.emit('exchange', {});
  }

  // ゲームシステムが相手の攻撃を起こす（リズムゲーム: 拍に合わせて当たる）
  forceTell(type, tell) {
    const E = this.enemy;
    const P = this.player;
    if (!['idle', 'slip'].includes(E.action) || E.guardHeld || P.action === 'down') return false;
    this.enemyPlan.attack = { type, tell, t: 0, tellPos: { x: P.x, z: P.z } };
    this.setAction(E, 'tell');
    this.emit('tell', { who: 'enemy', attack: type, duration: tell });
    return true;
  }

  // ゲームシステムが切り替わった瞬間は相手の攻撃を少し待たせる（切り替えで理不尽に当てない）
  grace(sec = 0.5) {
    const a = this.enemyPlan.attack;
    if (a) a.tell += sec;
    this.enemyPlan.next = Math.max(this.enemyPlan.next, sec);
  }

  setAction(f, a) {
    f.action = a;
    f.t = 0;
    if (a !== 'punch') f.punch = null;
  }

  // ダウンからの復帰（カウントはモード側）
  getUp(f, hpFrac) {
    f.hp = Math.round(f.maxHp * hpFrac);
    this.setAction(f, 'idle');
    f.stun = 0;
    this.emit('getup', { who: f.side });
  }

  // ラウンドの始め: 両者をコーナー寄りから中央へ
  resetPositions() {
    this.player.x = -DIST / 2;
    this.player.z = 0;
    this.enemy.x = DIST / 2;
    this.enemy.z = 0;
    this.axis = 0;
    this.center = { x: 0, z: 0 };
    for (const f of [this.player, this.enemy]) {
      if (f.action !== 'down') this.setAction(f, 'idle');
      f.punch = null;
      f.guardHeld = false;
      f.stun = 0;
    }
    this.enemyPlan.next = 1.5;
    this.enemyPlan.attack = null;
    this.counterWindow = 0;
  }

  // 相手のテルの進み具合（0〜1）: 画面の方式が予告表示に使う
  tellProgress() {
    const a = this.enemyPlan.attack;
    return a ? { type: a.type, k: a.t / a.tell, left: a.tell - a.t, tell: a.tell } : null;
  }
}
