import * as THREE from 'three';
import { P, makePose, applyPose, blendPose } from '../people/Poses.js';
import { CAM_POS, RUNWAY, BAR, TUNNEL, PIT } from '../stadium/field.js';
import { R0, CORE } from '../stadium/StadiumLayout.js';

// エピローグ: 3 分の中継が終わったあと、プレイヤーが撮った映像の中から 2〜4 本の短い物語を再生する（各 7〜9 秒）。
//   撮った映像（自分のサムネイル）を VTR として左上に出し、意味を短い文で明かす。泣かせすぎない（笑い・寂しさ・偶然・日常）。
//   撮らなかった物語は明かさない。最後に「この日、あなたが知らない物語も、まだ 27,941 人分あった。」
// 場面（stage）: reunion（母と息子）/ corridor（通路の二人）/ talk（審判と元妻）/ leave（帰っていく姉）/ leaveCoach / sign
//   / seatPair・seat（席の人）/ birds / sky / crowd / field（猫）/ final（競技）

const _v = new THREE.Vector3();

export class Epilogue {
  constructor(mode) {
    this.m = mode;
    this.scenes = [];
    this.i = -1;
    this.t = 0;
    this.done = false;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
  }

  // どの物語を見せるか
  build() {
    const m = this.m;
    const st = m.stories;
    const judge = m.judge;
    const cands = [];
    for (const [id, c] of st.captured) {
      const s = st.storyById(id);
      if (!s?.epilogue) continue;
      const score = c.value + (s.major ? 2500 : 0) + c.beats.size * 500 + ([...c.beats].some((b) => b.key) ? 1500 : 0);
      cands.push({ s, c, score });
    }
    // 夜空・鳥（撮っていれば）
    const skyShot = judge.shots.filter((sh) => sh.lines.includes('MOON DETECTED') && sh.V.beauty >= 300).sort((a, b) => b.points - a.points)[0];
    if (skyShot && !cands.some((c) => c.s.id === 'sky')) cands.push({ s: st.storyById('sky'), c: { best: skyShot, shots: [skyShot] }, score: skyShot.points * 0.8 });
    const birdShot = judge.shots.filter((sh) => sh.lines.includes('TWO BIRDS DETECTED')).sort((a, b) => b.points - a.points)[0];
    if (birdShot && !cands.some((c) => c.s.id === 'birds')) cands.push({ s: st.storyById('birds'), c: { best: birdShot, shots: [birdShot] }, score: birdShot.points + 1200 });
    cands.sort((a, b) => b.score - a.score);
    const chosen = cands.slice(0, 4);
    // 2 本に足りなければ、競技（高嶺）の場面
    if (chosen.length < 2) {
      const recShot = judge.shots.filter((sh) => sh.kind === 'athlete').sort((a, b) => b.points - a.points)[0];
      chosen.push({ s: { id: 'final', title: '競技', epilogue: { stage: 'final', lines: this.finalLines(!!recShot) } }, c: { best: recShot ?? null } });
    }
    // 夜空は最後に（中継の最後の映像）
    chosen.sort((a, b) => (a.s.id === 'sky') - (b.s.id === 'sky'));
    this.scenes = chosen.map((x) => ({ story: x.s, shot: x.c.best ?? null, lines: x.s.epilogue.lines, stage: x.s.epilogue.stage, dur: Math.max(7, 2.2 + x.s.epilogue.lines.length * 2) }));
    this.unknown = st.unknownCount(m.seed);
    return this.scenes;
  }

  finalLines(filmed) {
    const c = this.m.comp;
    const fin = c.attempts[c.attempts.length - 1];
    const h = fin.clear ? fin.height.toFixed(2) : '6.00';
    return [`高嶺 ソラは、${h}m で優勝した。`, filmed ? 'あなたのカメラは、その夜の彼をちゃんと撮っていた。' : 'その瞬間、あなたのカメラは別の場所を見ていた。', 'それも、その日の中継だった。'];
  }

  start() {
    document.getElementById('cue').innerHTML = '';
    document.getElementById('subs').innerHTML = '';
    this.i = -1;
    this.t = 0;
    this.thinned = 0;
    this.next();
  }

  next() {
    this.i++;
    this.t = 0;
    const el = document.getElementById('eText');
    el.innerHTML = '';
    if (this.i >= this.scenes.length) {
      if (this.i === this.scenes.length) {
        // 最後の一言
        document.getElementById('eVtr').classList.add('hidden');
        const p = document.createElement('p');
        p.className = 'big';
        p.innerHTML = `この日、あなたが知らない物語も、<br />まだ ${this.unknown.toLocaleString('en-US')} 人分あった。`;
        el.appendChild(p);
        this.lastCard = true;
        this.lineT = [];
        this.stageWide();
        return;
      }
      this.done = true;
      return;
    }
    const sc = this.scenes[this.i];
    const vtr = document.getElementById('eVtr');
    if (sc.shot?.thumb) {
      vtr.classList.remove('hidden');
      document.getElementById('eImg').src = sc.shot.thumb;
      const tt = sc.shot.t;
      document.getElementById('eStamp').textContent = `YOUR SHOT ${Math.floor(tt / 60)}:${String(Math.floor(tt % 60)).padStart(2, '0')} · AI ${sc.shot.ai}`;
    } else vtr.classList.add('hidden');
    this.lineT = sc.lines.map((_, k) => 0.8 + k * 1.9);
    this.shown = 0;
    this.stage(sc);
  }

  skip() {
    if (this.lastCard) {
      this.done = true;
      return;
    }
    this.next();
  }

  // ---- 場面を作る
  stage(sc) {
    const m = this.m;
    const st = m.stories;
    const R = st.roles;
    const tk = m.comp.vaulters.takane;
    this.puppets = [];
    this.focus = null;
    this.followBirds = false;
    this.skyPan = false;
    this.focusDist = null;
    this.drift = null;
    const stagePuppet = (fig, pos, yaw, pose, expr) => {
      fig.root.position.copy(pos);
      fig.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      this.puppets.push({ fig, pose, expr, cur: makePose() });
    };
    const npcOf = (role) => R[role];
    const id = sc.story.id;
    const first = sc.story.cast?.[0]?.role;
    const npc = first ? npcOf(first) : null;
    const lookAtFrom = (target, off, fov = 30) => {
      this.camLook.copy(target);
      this.camPos.copy(target).add(off);
      this.fov = fov;
      this.drift = new THREE.Vector3(off.z, 0, -off.x).normalize().multiplyScalar(0.25);
    };
    tk.puppet = true;
    switch (sc.stage) {
      case 'reunion': {
        // 母は一番前の列へ（同じ方角）・高嶺はスタンドの前の壁の下
        const sp = npc.seatPos;
        const dir = new THREE.Vector3(sp.x - Math.max(-CORE.sx, Math.min(CORE.sx, sp.x)), 0, sp.z).normalize();
        const front = new THREE.Vector3(Math.max(-CORE.sx, Math.min(CORE.sx, sp.x)), 0, 0).addScaledVector(dir, R0 + 0.9);
        front.y = 1.9;
        npc.fig.root.position.copy(front);
        npc.offset.set(0, 0, 0);
        npc.seatPos.copy(front);
        m.specials.setAct(npc, { pose: 'reachUp', expr: 'cry', stand: true, look: 'none', prop: 'handkerchief' });
        npc.yaw = Math.atan2(-dir.x, -dir.z);
        const below = new THREE.Vector3(Math.max(-CORE.sx, Math.min(CORE.sx, sp.x)), 0, 0).addScaledVector(dir, R0 - 1.0);
        const o = makePose();
        P.standBase(o, tk.fig.B.hipY);
        P.reachUp(o, 'R');
        o.hL = [0.12, 0.62, 0.3];
        o.pL = [0.6, 0, 0];
        o.headX = -0.45;
        stagePuppet(tk.fig, below, Math.atan2(dir.x, dir.z), o, 'laugh');
        const mid = front.clone().add(below).multiplyScalar(0.5);
        mid.y = 2.3;
        // 横から少し引いて（二人とも頭まで入る）
        lookAtFrom(mid, new THREE.Vector3(-dir.z * 4.2 - dir.x * 4.2, -0.4, dir.x * 4.2 - dir.z * 4.2), 40);
        this.focus = mid;
        break;
      }
      case 'corridor': {
        const nord = R.nord;
        const riva = m.comp.vaulters.riva;
        riva.puppet = true;
        const a = new THREE.Vector3(TUNNEL.x - 0.5, 0, TUNNEL.z - 1.2);
        const b = new THREE.Vector3(TUNNEL.x + 0.5, 0, TUNNEL.z - 1.2);
        nord.seated = false;
        nord.seatPos.copy(b);
        nord.yaw = -Math.PI / 2;
        m.specials.setAct(nord, { pose: 'talk', expr: 'smile', stand: true, look: 'none' });
        const o = makePose();
        P.standBase(o, riva.fig.B.hipY);
        P.talkHands(o, 0);
        o.headX = 0.15;
        stagePuppet(riva.fig, a, Math.PI / 2, o, 'smile');
        const mid = a.clone().add(b).multiplyScalar(0.5);
        mid.y = 1.4;
        lookAtFrom(mid, new THREE.Vector3(2.5, 0.3, -9), 24);
        this.focus = mid;
        break;
      }
      case 'talk': {
        const ex = R.exwife;
        const jc = R.judgeChief;
        const sp = ex.seatPos.clone();
        const front = new THREE.Vector3(sp.x, 1.9, R0 + 0.9);
        ex.seatPos.copy(front);
        ex.yaw = Math.PI;
        m.specials.setAct(ex, { pose: 'talk', expr: 'smile', stand: true, look: 'npc:judgeChief' });
        jc.seated = false;
        jc.seatPos.set(sp.x, 0, R0 - 1.1);
        jc.yaw = 0;
        m.specials.setAct(jc, { pose: 'behindBack', expr: 'smile', stand: true, look: 'npc:exwife', prop: null });
        const mid = new THREE.Vector3(sp.x, 1.8, R0 - 0.2);
        lookAtFrom(mid, new THREE.Vector3(5, 0.2, -9), 26);
        this.focus = mid;
        break;
      }
      case 'leave':
      case 'leaveCoach': {
        m.specials.setAct(npc, { pose: 'stand', expr: sc.stage === 'leaveCoach' ? 'smile' : 'sigh', stand: true, look: 'none' });
        const back = npc.seatPos.clone();
        npc.walk = { from: npc.fig.root.position.clone(), to: back.clone().add(new THREE.Vector3(Math.sin(npc.yaw + Math.PI / 2) * 6, 0, Math.cos(npc.yaw + Math.PI / 2) * 6)), t: 0, dur: 7 };
        const head = npc.fig.headWorld(new THREE.Vector3());
        const toField = new THREE.Vector3(Math.sin(npc.yaw), 0, Math.cos(npc.yaw));
        lookAtFrom(head, toField.multiplyScalar(14).add(new THREE.Vector3(0, -2.5, 0)), 22);
        this.focus = head;
        if (sc.stage === 'leaveCoach') {
          const o = makePose();
          P.standBase(o, tk.fig.B.hipY);
          P.cheer(o, 0);
          stagePuppet(tk.fig, new THREE.Vector3(BAR.x - 6, 0, RUNWAY.z + 4), Math.atan2(CAM_POS.x - BAR.x, CAM_POS.z - RUNWAY.z), o, 'laugh');
        }
        break;
      }
      case 'sign': {
        m.specials.setAct(npc, { pose: 'holdSign', expr: 'cry', stand: true, prop: 'sign:ソラ\nがんばれ', look: 'none' });
        const head = npc.fig.headWorld(new THREE.Vector3());
        const toField = new THREE.Vector3(Math.sin(npc.yaw), 0, Math.cos(npc.yaw));
        const o = makePose();
        P.standBase(o, tk.fig.B.hipY);
        o.hR = [-0.24, 0.42, 0.4];
        o.pR = [-0.7, -0.1, 0];
        o.headX = -0.35;
        const p = head.clone().addScaledVector(toField, 9);
        p.y = 0;
        stagePuppet(tk.fig, p, Math.atan2(-toField.x, -toField.z), o, 'laugh');
        lookAtFrom(head.clone().addScaledVector(toField, 4.5), toField.clone().multiplyScalar(5).add(new THREE.Vector3(toField.z * 3, -0.5, -toField.x * 3)), 38);
        this.focus = head;
        break;
      }
      case 'seatPair':
      case 'seat': {
        const target = npc ?? Object.values(R).find((n) => n.story === id) ?? (sc.story.beats?.[0] ? R[sc.story.beats[0].r] : null);
        if (target) {
          const last = [...(sc.story.beats ?? [])].reverse().find((b) => b.r === target.role && b.a);
          if (last) m.specials.setAct(target, { pose: last.a.p ?? 'sit', expr: last.a.e ?? 'smile', prop: last.a.prop ?? target.act.prop, stand: last.a.stand ?? false, look: last.a.l ?? 'field' });
          const head = target.fig.headWorld(new THREE.Vector3());
          const toField = new THREE.Vector3(Math.sin(target.yaw), 0, Math.cos(target.yaw));
          lookAtFrom(head, toField.multiplyScalar(4.2).add(new THREE.Vector3(toField.z * 1.4, 0.8, -toField.x * 1.4)), 30);
          this.focus = head;
        } else this.stageWide();
        break;
      }
      case 'birds': {
        // フィールドから望遠で、月の方へ飛んでいく 2 羽を追う
        this.birdsT = 169;
        m.birds.update(this.birdsT, 0);
        const c = m.birds.center(new THREE.Vector3());
        this.camPos.set(12, 1.7, 36);
        this.camLook.copy(c);
        this.fov = 9;
        this.drift = null;
        this.followBirds = true;
        break;
      }
      case 'sky': {
        const md = m.sky.moonDir.clone();
        this.camPos.set(CAM_POS.x, CAM_POS.y, CAM_POS.z);
        this.camLook.copy(this.camPos).addScaledVector(md, 100);
        this.camLook.y -= 6;
        this.fov = 34;
        this.drift = new THREE.Vector3(0, 0.02, 0);
        this.skyPan = true;
        break;
      }
      case 'crowd':
        m.crowd.startWave({ from: 0.5, lapSeconds: 14, laps: 1 });
        this.stageWide();
        break;
      case 'field': {
        const c = m.catPos ?? new THREE.Vector3(8, 0, 20);
        lookAtFrom(c.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(2.5, 0.6, 3), 26);
        this.focus = c;
        break;
      }
      default: {
        const o = makePose();
        P.standBase(o, tk.fig.B.hipY);
        P.cheer(o, 0);
        const p = new THREE.Vector3(BAR.x - 3, 0, RUNWAY.z + 3);
        stagePuppet(tk.fig, p, Math.atan2(CAM_POS.x - p.x, CAM_POS.z - p.z), o, 'laugh');
        lookAtFrom(new THREE.Vector3(p.x, 1.5, p.z), new THREE.Vector3(-3, 0.2, 6), 32);
        this.focus = new THREE.Vector3(p.x, 1.5, p.z);
      }
    }
  }

  stageWide() {
    this.camPos.set(0, 30, 70);
    this.camLook.set(0, 5, -30);
    this.fov = 55;
    this.drift = new THREE.Vector3(0.6, 0, 0);
    this.focus = null;
    this.puppets = [];
  }

  update(dt) {
    const m = this.m;
    this.t += dt;
    const sc = this.scenes[this.i];
    // 文を 1 行ずつ
    if (sc && this.shown < sc.lines.length && this.t >= this.lineT[this.shown]) {
      const p = document.createElement('p');
      p.textContent = sc.lines[this.shown];
      document.getElementById('eText').appendChild(p);
      this.shown++;
    }
    if (sc && this.t > sc.dur) this.next();
    else if (this.lastCard && this.t > 5) this.done = true;
    // 観客が少しずつ帰っていく
    this.thinT = (this.thinT ?? 0) + dt;
    if (this.thinT > 0.25 && this.thinned < 0.45) {
      this.thinT = 0;
      this.thinned += 0.02;
      const L = m.layout;
      const n = Math.floor(L.count * 0.02);
      for (let k = 0; k < n; k++) {
        const id = Math.floor(m.rng.next() * L.count);
        if (m.plan.kind[id] === 0) m.field.setKind(id, 2);
      }
    }
    // 人形（選手）の姿勢
    for (const p of this.puppets ?? []) {
      blendPose(p.cur, p.pose, 1 - Math.exp(-dt * 6));
      applyPose(p.fig, p.cur);
      p.fig.setExpr(p.expr);
      p.fig.updateFace(dt);
      p.fig.root.updateMatrixWorld(true);
    }
    if (this.followBirds) {
      this.birdsT += dt * 1.1;
      m.birds.update(this.birdsT, dt);
      const c = m.birds.center(_v);
      this.camLook.lerp(c, 1 - Math.exp(-dt * 3));
      this.focusDist = this.camPos.distanceTo(c);
    }
    // カメラ（ゆっくり動く）
    const cam = m.camera;
    if (this.drift) this.camPos.addScaledVector(this.drift, dt);
    if (this.skyPan) this.camLook.y += dt * 1.2;
    cam.position.copy(this.camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.camLook);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    const fd = this.focus ? cam.position.distanceTo(this.focus) : this.focusDist ?? 400;
    m.post.set({ focus: fd, zoom: 4.5, time: m.time });
  }
}
