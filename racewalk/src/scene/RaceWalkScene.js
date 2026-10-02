// 中央の 3D（配信の映像）。夜の陸上競技場・観客 3 万人・競歩の 10 人・審判・係員・配信用ドローン・カメラ。
//   競技場と観客と夜空は棒高跳び（polevault）・サッカー（soccer）の部品をそのまま使う。
//   人は Figure（1 人 1 draw call・表情つき）。動きは walk/Gait.js（競歩）を RaceSim の状態から毎フレーム作る。
//   カメラ: face（配信ドローン・顔）/ back（追走・前が見える）/ rival（真壁）/ sleep（真上）/ finish（フィニッシュの横）/ intro

import * as THREE from 'three';
import { createRng } from '../../../src/core/math.js';
import { CrowdDirector, POSE } from '../../../soccer/src/crowd/CrowdDirector.js';
import { CrowdField } from '../../../soccer/src/crowd/CrowdField.js';
import { StadiumLayout, CORE } from '../../../polevault/src/stadium/StadiumLayout.js';
import { CrowdPlan, ZONE } from '../../../polevault/src/stadium/CrowdPlan.js';
import { NightSky } from '../../../polevault/src/sky/NightSky.js';
import { Figure, SKINS, HAIRS, BONE } from '../../../polevault/src/people/Figure.js';
import { makePose, applyPose, P as POSES, lookAtWorld } from '../../../polevault/src/people/Poses.js';
import { RWStadium } from './RWStadium.js';
import { racewalk, run, stand, lying, armOverride } from '../walk/Gait.js';
import { trackPoint, yawOf, JUDGES, WATER, PENALTY, LAP, RM, SX, LAP_BOARD } from '../race/track.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _tp = {};
const _ex = { yaw: 0, roll: 0, sway: 0, bob: 0 };

// 選手の見た目（Figure）+ 姿勢
class WalkerView {
  constructor(scene, w) {
    const a = w.a;
    this.w = w;
    this.fig = new Figure({
      build: 'athlete',
      hair: a.hair,
      top: 'singlet',
      bottom: 'shorts',
      extras: a.extras ?? [],
      colors: { skin: SKINS[a.skin ?? 1], hair: a.hairColor ?? HAIRS[0], top: a.color, bottom: a.shorts, shoe: a.player ? 0x39e6ff : 0xf2f2f2, acc: a.acc ?? 0xffffff, acc2: 0x18181c },
    });
    this.fig.u.uRim.value = 0.4;
    this.fig.u.uGlow.value = 0.08;
    this.fig.mesh.castShadow = true;
    this.fig.setExpr(a.player ? 'smile' : 'serious');
    scene.add(this.fig.root);
    this.pose = makePose();
    this.yaw = 0;
    this.lieK = 0; // 0 = 立っている / 1 = 寝ている
    this.fallK = 0;
    this.backK = 0;
    this.armK = 0;
    this.arm = null;
    this.talkT = 0;
    this.stepPrev = 0;
    this.pos = new THREE.Vector3();
  }
}

export class RaceWalkScene {
  constructor(canvas, { seed = 1, touch = false, quality = null } = {}) {
    this.canvas = canvas;
    this.seed = seed;
    this.touch = touch;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03050c);
    scene.fog = new THREE.Fog(0x0a0f1e, 140, 700);
    this.scene = scene;
    this.pixelRatio = Math.min(devicePixelRatio || 1, touch ? 1.5 : 2);
    this.quality = quality;

    // ---- 光（ナイター）。影は主人公のまわりだけ（光源ごと主人公についていく）
    scene.add(new THREE.HemisphereLight(0x7d8cc4, 0x1c1a16, 0.55));
    scene.add(new THREE.AmbientLight(0x404858, 0.3));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 20, far: 220 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    this.key = key;
    this.keyDir = new THREE.Vector3(-20, 70, 95).normalize();
    const back = new THREE.DirectionalLight(0xc8d8ff, 1.3);
    back.position.set(60, 55, -90);
    scene.add(back, back.target);

    // ---- 競技場・観客 3 万人・夜空
    this.stadium = new RWStadium(scene);
    this.stadium.replaceLed();
    this.layout = new StadiumLayout();
    this.plan = new CrowdPlan(this.layout, createRng(seed + 3));
    this.crowd = new CrowdDirector(this.layout, this.plan, createRng(seed + 4));
    this.crowd.ultras = [];
    this.crowd.set(this.crowd.all, POSE.SIT, { spread: 0 });
    // ブロックの中心（観客の反応を主人公からの距離で決める）
    const L = this.layout;
    const nb = L.blocks.length;
    const ax = new Float64Array(nb);
    const az = new Float64Array(nb);
    for (let i = 0; i < L.count; i++) {
      ax[L.block[i]] += L.x[i];
      az[L.block[i]] += L.z[i];
    }
    this.blocks = L.blocks.map((b, i) => ({ index: i, cx: ax[i] / Math.max(1, L.blockCount[i]), cz: az[i] / Math.max(1, L.blockCount[i]) }));
    this.field = new CrowdField(scene, this.layout, this.plan, this.crowd, { a2c: !touch, fog: scene.fog });
    this.field.uniforms.uCore.value.set(CORE.sx, 0.01);
    this.field.uniforms.uLight.value = 0.72;
    this.field.uniforms.uSeat.value.set(0x24305a);
    for (const c of this.field.uniforms.uShirts.value) {
      const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      c.setRGB(c.r * 0.72 + l * 0.18, c.g * 0.72 + l * 0.18, c.b * 0.72 + l * 0.18);
    }
    this.sky = new NightSky(scene, { x: 0, y: 2, z: 0 }, { moonAz: 2.3, moonEl: 0.32, rng: createRng(seed + 9) });

    // ---- 人
    this.walkers = [];
    this.people = [];
    this.buildOfficials();
    this.buildDrone();

    // ---- カメラ
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2200);
    this.cam = { mode: 'intro', pos: new THREE.Vector3(30, 6, 60), look: new THREE.Vector3(0, 1.2, 36), vel: new THREE.Vector3(), fov: 50, shake: 0, t: 0, cut: true };
    this.camera.position.copy(this.cam.pos);
    this.time = 0;
    this.blockState = new Map();
    this.cheerT = 0;
  }

  addWalkers(sim) {
    for (const w of sim.walkers) this.walkers.push(new WalkerView(this.scene, w));
    this.player = this.walkers.find((v) => v.w.player);
    this.sim = sim;
  }

  // 新しいレース（やり直し・intro → 本番）: 見た目はそのまま、中身だけ付け替える
  rebind(sim) {
    this.sim = sim;
    this.walkers.forEach((v, i) => {
      v.w = sim.walkers[i];
      v.lieK = 0;
      v.fallK = 0;
      v.backK = 0;
      v.armK = 0;
      v.arm = null;
    });
    this.cam.cut = true;
    this.blockState.clear();
  }

  resetBoards() {
    this.stadium.drawLap(5);
    this.stadium.drawBoard([]);
    this.stadium.drawPenalty(null);
    for (const j of this.judges) j.raiseT = 0;
  }

  // 警告掲示板（赤カードのある選手）
  drawBoard(sim, marks) {
    const rows = sim.walkers
      .filter((w) => w.red > 0)
      .sort((a, b) => b.red - a.red)
      .map((w) => ({ bib: w.a.bib, short: w.a.short, red: w.red, marks: marks[w.id] ?? [] }));
    this.stadium.drawBoard(rows);
  }

  // 審判 6 人・給水の係 2 人・ペナルティの係・周回の係・主任審判（掲示板）
  buildOfficials() {
    const mk = (spec, s, y, face, role) => {
      const fig = new Figure({ build: 'adult', hair: spec.hair ?? 'short', top: spec.top ?? 'blazer', bottom: 'pants', extras: spec.extras ?? ['cap'], colors: { skin: SKINS[spec.skin ?? 1], hair: HAIRS[spec.hairC ?? 0], top: spec.color ?? 0x1d3f8a, bottom: 0x2a2c34, shoe: 0x202024, acc: spec.cap ?? 0xf4f4f4 } });
      fig.u.uGlow.value = 0.12;
      trackPoint(s, y, _tp);
      fig.root.position.set(_tp.x, 0, _tp.z);
      const yaw = yawOf(_tp.dx, _tp.dz);
      fig.root.rotation.y = face === 'out' ? yaw - Math.PI / 2 : face === 'in' ? yaw + Math.PI / 2 : face === 'back' ? yaw + Math.PI : yaw;
      fig.setExpr('serious');
      this.scene.add(fig.root);
      const p = { fig, pose: makePose(), role, s, y, raiseT: 0, paddle: null, base: fig.root.rotation.y, t: Math.random() * 5 };
      this.people.push(p);
      return p;
    };
    this.judges = JUDGES.map((j, i) => {
      const p = mk({ color: 0x1d3f8a, skin: i % 3, hairC: i % 4 === 3 ? 4 : 0 }, j.s, j.y + 0.25, 'out', 'judge');
      p.judgeId = j.id;
      // パドル（黄色の円盤 + 棒）を右手に持たせる
      const g = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 6), new THREE.MeshLambertMaterial({ color: 0x222222 }));
      stick.position.y = -0.02;
      g.add(stick);
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }));
      disc.position.y = 0.24;
      g.add(disc);
      g.visible = false;
      p.fig.bones.handR.add(g);
      p.paddle = { g, c, tex, disc };
      return p;
    });
    mk({ color: 0x2a6ad8, top: 'polo', extras: ['cap'], skin: 0 }, WATER.s - 1, WATER.y + 1.1, 'in', 'staff');
    mk({ color: 0x2a6ad8, top: 'polo', extras: [], skin: 2, hair: 'bob' }, WATER.s + 1.2, WATER.y + 1.1, 'in', 'staff');
    this.penaltyJudge = mk({ color: 0x1d3f8a, skin: 1 }, PENALTY.s + 1, PENALTY.y + 1.8, 'in', 'penalty');
    this.lapMan = mk({ color: 0x1d3f8a, skin: 2 }, LAP_BOARD.s + 1.2, LAP_BOARD.y - 0.8, 'back', 'lap');
    this.chief = mk({ color: 0x0f1f4a, skin: 1, hairC: 4, top: 'suit', extras: [] }, 386, -3.0, 'back', 'chief');
    for (let k = 0; k < 3; k++) mk({ color: 0x30343c, top: 'jacket', extras: ['cap'], skin: k }, 2 + k * 1.3, 9.7, 'back', 'photo');
  }

  buildDrone() {
    const g = new THREE.Group();
    const bm = new THREE.MeshLambertMaterial({ color: 0x1a1c22 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.24), bm);
    g.add(body);
    this.rotors = [];
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.025), bm);
      arm.position.set(x * 0.13, 0.02, z * 0.13);
      arm.rotation.y = Math.atan2(z, x) * -1;
      g.add(arm);
      const r = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshBasicMaterial({ color: 0xbfc8d8, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      r.rotation.x = -Math.PI / 2;
      r.position.set(x * 0.2, 0.05, z * 0.2);
      g.add(r);
      this.rotors.push(r);
    }
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.2) }));
    led.position.set(0, 0.0, 0.13);
    g.add(led);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0x0a0a10 }));
    lens.position.set(0, -0.05, 0.1);
    g.add(lens);
    this.drone = g;
    this.droneLed = led;
    this.scene.add(g);
  }

  resize(w, h, pr = this.pixelRatio) {
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.w = w;
    this.h = h;
  }

  // ------------------------------------------------------------------ 毎フレーム
  // view: { t, actions(ActionSystem), session, camMode, speaking }
  update(dt, view) {
    this.time += dt;
    const sim = this.sim;
    for (const v of this.walkers) this.poseWalker(v, dt, view);
    this.updateOfficials(dt, view);
    this.updateCrowd(dt, view);
    this.updateCamera(dt, view);
    // 影の光は主人公についていく
    const P = this.player.fig.root.position;
    this.key.target.position.copy(P);
    this.key.position.copy(P).addScaledVector(this.keyDir, 120);
    this.sky.update(dt, this.time, this.camera);
    this.crowd.update(dt);
    this.stadium.update(dt, this.time);
    // ドローン（顔カメラの位置。追走カメラの時は前に見える）
    for (const r of this.rotors) r.rotation.z += dt * 60;
    this.droneLed.visible = Math.sin(this.time * 6) > -0.2;
    void sim;
  }

  poseWalker(v, dt, view) {
    const w = v.w;
    const fig = v.fig;
    const o = v.pose;
    const sim = this.sim;
    const t = this.time;
    const hipRest = fig.hipRest;
    const fat = clamp((0.62 - w.E) / 0.55);
    const st = { phase: w.phase, v: w.v, fat, lc: w.lc, bk: w.bk, t, hipRest };
    const m = sim.mods;
    const isP = w.player;
    // 寝る（寝たふり・倒れ込む）/ 転倒
    const lie = isP && sim.t < m.lieUntil;
    const fall = w.fall > 0 ? w.fall : 0;
    v.lieK = clamp(v.lieK + (lie ? dt / 0.7 : -dt / 0.9));
    const fallK = fall > 0 ? (fall < 0.45 ? fall / 0.45 : fall < 1.6 ? 1 : 1 - (fall - 1.6) / 1.4) : 0;
    v.fallK = clamp(fallK);
    const backward = isP && sim.t < m.backUntil;
    v.backK = clamp(v.backK + (backward ? dt / 0.5 : -dt / 0.5));
    const running = isP && sim.t < m.runUntil;
    let mode = 'walk';
    if (w.finished && w.v < 1.2) mode = 'stand';
    if (w.inPenalty && w.v < 0.8) mode = 'stand';
    if (w.dq && w.v < 0.6) mode = 'stand';
    if (running) mode = 'run';
    if (mode === 'walk') racewalk(o, st, _ex);
    else if (mode === 'run') run(o, st, _ex);
    else stand(o, { ...st, fat: Math.max(fat, 0.4) }, _ex, w.finished && w.afterFinish > 5 ? (w.place === 1 && isP && w.afterFinish < 14 ? 'win' : 'knees') : 'hips');
    // 腕（ACTION）
    if (isP) {
      const armOn = sim.t < m.armUntil ? m.arm : w.drink > 0 ? 'drink' : null;
      if (armOn) v.arm = armOn;
      v.armK = clamp(v.armK + (armOn ? dt / 0.25 : -dt / 0.3));
      if (v.arm) armOverride(o, v.arm, t, v.armK);
    } else if (w.drink > 0) armOverride(o, 'drink', t, clamp(w.drink / 0.4) * clamp((2.5 - w.drink) / 0.3 + 0.01));
    // つまずき: 前につんのめる
    if (w.trip > 0) {
      o.spineX += 0.35 * Math.sin(clamp(w.trip / 0.9) * Math.PI);
      armOverride(o, 'flex', t, 0.4 * Math.sin(clamp(w.trip / 0.9) * Math.PI));
    }
    // 寝る / 転ぶ: いったん姿勢を混ぜる
    if (v.lieK > 0 || v.fallK > 0) {
      const k = Math.max(v.lieK, v.fallK);
      const lo = (v._lo ??= makePose());
      lying(lo, st, {});
      if (v.fallK > v.lieK) {
        lo.hL = [0.25, 0.1, 0.45];
        lo.hR = [-0.25, 0.1, 0.45];
        lo.headX = -0.4;
      }
      for (const key of Object.keys(o)) {
        if (Array.isArray(o[key])) for (let i = 0; i < 3; i++) o[key][i] += (lo[key][i] - o[key][i]) * k;
        else o[key] += (lo[key] - o[key]) * k;
      }
    }
    applyPose(fig, o, true);
    // 骨盤のひねり・傾き
    const amp = mode === 'walk' ? 1 : 0;
    fig.bones.hips.rotation.set(0, _ex.yaw * amp, _ex.roll * amp);
    // 位置と向き
    trackPoint(w.d, w.y, _tp);
    const yaw = yawOf(_tp.dx, _tp.dz) + Math.PI * v.backK;
    // 横に揺れる（進む向きに直角）
    const sx = -_tp.dz;
    const sz = _tp.dx;
    const sway = _ex.sway * (mode === 'walk' ? 1 : 0);
    v.pos.set(_tp.x + sx * sway, 0, _tp.z + sz * sway);
    // 寝る: 仰向け（後ろへ倒れる）/ 転ぶ: うつ伏せ（前へ）
    const root = fig.root;
    root.position.copy(v.pos);
    const pitch = v.lieK > v.fallK ? -Math.PI / 2 * v.lieK : (Math.PI / 2) * 0.92 * v.fallK;
    root.rotation.set(0, 0, 0);
    root.rotateY(yaw);
    root.rotateX(pitch);
    // 原点は足元: 足元を軸に倒すと、体は地面に沿う（仰向けは後ろへ・うつ伏せは前へ）。背中/お腹の厚みだけ上げる
    const lift = Math.max(v.lieK, v.fallK);
    root.position.y = lift * 0.13;
    v.lieDir = v.lieK > v.fallK ? -1 : 1;
    v.lift = lift;
    // 表情
    let expr = null;
    if (isP) {
      expr = view.actions.exprAt(sim.t);
      if (!expr) {
        if (w.fall > 0 || w.trip > 0) expr = 'surprised';
        else if (w.finished) expr = w.place === 1 ? 'laugh' : w.afterFinish > 6 ? 'sigh' : 'shout';
        else if (w.dq) expr = 'cry';
        else if (w.inPenalty) expr = 'sigh';
        else if (sim.t < m.focusUntil) expr = 'serious';
        else expr = w.E > 0.6 ? 'smile' : w.E > 0.46 ? 'neutral' : w.E > 0.32 ? 'serious' : w.E > 0.17 ? 'sigh' : 'worried';
      }
      // しゃべっている間は口が動く
      if (view.speaking && !['sleep', 'cry'].includes(expr)) expr = Math.sin(t * 22) > 0 ? 'shout' : expr === 'smile' ? 'smile' : 'neutral';
    } else {
      expr = w.finished ? (w.place === 1 ? 'laugh' : 'sigh') : w.dq ? 'sad' : w.E > 0.4 ? 'serious' : 'sigh';
    }
    fig.setExpr(expr);
    fig.updateFace(dt);
    // 足音（主人公）
    if (isP && view.onStep && w.v > 1 && mode !== 'stand') {
      const k = Math.floor(w.phase / Math.PI);
      if (k !== v.stepPrev) {
        v.stepPrev = k;
        view.onStep(w.v, fat);
      }
    }
  }

  updateOfficials(dt, view) {
    const P = this.player;
    for (const p of this.people) {
      p.t += dt;
      const o = p.pose;
      POSES.standBase(o, p.fig.hipRest);
      POSES.armsDown(o);
      o.headX = 0;
      o.headY = 0;
      o.spineY = 0;
      if (p.role === 'judge') {
        POSES.behindBack(o);
        // 近くの選手（主人公優先）を目で追う
        if (P.fig.root.position.distanceTo(p.fig.root.position) < 26) lookAtWorld(p.fig, o, _w.copy(P.fig.root.position).setY(1.2), { headY: 1.55, torso: 0.3 });
        if (p.raiseT > 0) {
          p.raiseT -= dt;
          o.hR = [-0.12, 0.52, 0.3];
          o.pR = [-0.7, 0, -0.2];
          p.paddle.g.visible = true;
        } else p.paddle.g.visible = false;
      } else if (p.role === 'staff') {
        POSES.talkHands(o, p.t * 0.6);
      } else if (p.role === 'penalty') {
        POSES.clipboard(o, p.t, false);
      } else if (p.role === 'chief') {
        POSES.armsCrossed(o);
      } else if (p.role === 'photo') {
        POSES.binoculars(o);
        lookAtWorld(p.fig, o, _w.copy(P.fig.root.position).setY(1.3), { headY: 1.55, torso: 0.5 });
      } else if (p.role === 'lap') {
        POSES.behindBack(o);
      }
      applyPose(p.fig, o, true);
      p.fig.updateFace(dt);
    }
  }

  // 審判がパドルを上げる（~ = 浮き / < = 膝）
  paddle(judgeId, type) {
    const p = this.judges.find((j) => j.judgeId === judgeId);
    if (!p) return;
    const { c, tex } = p.paddle;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = '#ffd23f';
    g.beginPath();
    g.arc(32, 32, 31, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#05060f';
    g.font = 'bold 44px "Chakra Petch", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(type, 32, 34);
    tex.needsUpdate = true;
    p.raiseT = 2.4;
  }

  // 観客: 主人公の近くのブロックが立つ・ラストは総立ち・あおると跳ぶ
  updateCrowd(dt, view) {
    this.cheerT -= dt;
    if (this.cheerT > 0) return;
    this.cheerT = 0.5;
    const P = this.player.w;
    const pp = this.player.fig.root.position;
    const final = P.rem < 400 && !P.finished;
    const hype = view.session?.crowdHype > 0;
    const big = view.session?.metrics.heat > 7;
    const want = new Map();
    for (const b of this.blocks) {
      const dx = b.cx - pp.x;
      const dz = b.cz - pp.z;
      const d = Math.hypot(dx, dz);
      let pose = POSE.SIT;
      if (P.finished && P.afterFinish < 12) pose = d < 70 ? POSE.JUMP : POSE.CHEER;
      else if (hype && d < 55) pose = POSE.JUMP;
      else if (final && P.rem < 150 && d < 90) pose = POSE.CHEER;
      else if (final && d < 45) pose = POSE.STAND;
      else if (d < 22) pose = POSE.CLAP;
      else if (big && b.index % 5 === 0) pose = POSE.PHONE;
      want.set(b.index, pose);
    }
    for (const [bi, pose] of want) {
      if (this.blockState.get(bi) !== pose) {
        this.blockState.set(bi, pose);
        this.crowd.set([bi], pose, { spread: 0.3 });
      }
    }
  }

  // ------------------------------------------------------------------ カメラ
  updateCamera(dt, view) {
    const c = this.cam;
    const sim = this.sim;
    const P = this.player;
    const w = P.w;
    const pp = P.fig.root.position;
    trackPoint(w.d, w.y, _tp);
    const fx = _tp.dx;
    const fz = _tp.dz;
    // 外向き（主人公の右）
    const ox = fz;
    const oz = -fx;
    let mode = view.camMode;
    if (view.phase === 'intro') mode = 'intro';
    else if (w.finished && w.afterFinish < 3.5) mode = 'finish';
    else if (sim.t < sim.mods.lieUntil || w.fall > 0.3) mode = 'sleep';
    else if (view.session?.camRival > 0) mode = 'rival';
    else if (w.inPenalty) mode = 'penalty';
    if (mode !== c.mode) {
      c.cut = mode === 'finish' || c.mode === 'intro' || mode === 'rival' || c.mode === 'rival';
      c.mode = mode;
    }
    const pos = _v;
    const look = _w;
    let fov = 50;
    const t = this.time;
    if (mode === 'face') {
      // 配信ドローン: 主人公の斜め前。間に別の選手が入ったら、反対側（内側 / 外側）へ回る
      const lead = 2.9 + 0.15 * Math.sin(t * 0.21);
      const side = this.droneSide(pp, fx, fz, ox, oz, lead, dt);
      pos.set(pp.x + fx * lead + ox * 0.95 * side, 1.95 + 0.06 * Math.sin(t * 1.3), pp.z + fz * lead + oz * 0.95 * side);
      look.set(pp.x + fx * 0.25, 1.32, pp.z + fz * 0.25);
      fov = 44;
    } else if (mode === 'back') {
      // 追走カメラ: 少し高い所から。後ろの選手がさえぎる時は横へずれる
      const side = this.droneSide(pp, fx, fz, ox, oz, -4.8, dt, 'sideB', 0.9);
      pos.set(pp.x - fx * 4.8 + ox * 0.9 * side, 2.9, pp.z - fz * 4.8 + oz * 0.9 * side);
      look.set(pp.x + fx * 11, 0.7, pp.z + fz * 11);
      fov = 58;
    } else if (mode === 'rival') {
      const mk = this.walkers.find((x) => x.w.id === 'makabe');
      const mp = mk.fig.root.position;
      pos.set(mp.x + fx * 2.4 + ox * 0.9, 1.7, mp.z + fz * 2.4 + oz * 0.9);
      look.set(mp.x, 1.45, mp.z);
      fov = 44;
    } else if (mode === 'sleep') {
      // 真上から（胴の真ん中を見る）
      const dir = P.lieDir ?? -1;
      const cx = pp.x + fx * 0.85 * dir;
      const cz = pp.z + fz * 0.85 * dir;
      pos.set(cx - fx * 1.2 * dir + ox * 0.9, 3.4, cz - fz * 1.2 * dir + oz * 0.9);
      look.set(cx, 0.15, cz);
      fov = 48;
    } else if (mode === 'finish') {
      pos.set(SX + 1.2, 1.25, RM - 6.5);
      look.set(pp.x, 1.1, pp.z);
      fov = 40;
    } else if (mode === 'penalty') {
      pos.set(pp.x + fx * 3.2 - ox * 2.4, 1.8, pp.z + fz * 3.2 - oz * 2.4);
      look.set(pp.x, 1.3, pp.z);
      fov = 48;
    } else {
      // intro: 先頭集団をゆっくり回る
      const lead = this.walkers.reduce((a, b) => (a.w.d > b.w.d ? a : b));
      const lp = lead.fig.root.position;
      const a = t * 0.12;
      pos.set(pp.x + Math.cos(a) * 9 + ox * 4, 3.2 + Math.sin(t * 0.3), pp.z + Math.sin(a) * 9 + oz * 4);
      look.set((pp.x + lp.x) / 2, 1.1, (pp.z + lp.z) / 2);
      fov = 46;
    }
    if (c.cut) {
      c.pos.copy(pos);
      c.look.copy(look);
      c.cut = false;
    } else {
      const k = 1 - Math.exp(-dt * (mode === 'face' ? 5 : 3.5));
      c.pos.lerp(pos, k);
      c.look.lerp(look, 1 - Math.exp(-dt * 7));
    }
    c.fov += (fov - c.fov) * (1 - Math.exp(-dt * 3));
    this.camera.position.copy(c.pos);
    // 手ぶれ（ドローンの揺れ）
    const sh = 0.012 + (view.shake ?? 0) * 0.08;
    this.camera.position.x += Math.sin(t * 2.3) * sh;
    this.camera.position.y += Math.sin(t * 3.1 + 1) * sh;
    this.camera.lookAt(c.look);
    this.camera.fov = c.fov;
    this.camera.updateProjectionMatrix();
    // ドローン: 顔カメラの時は「カメラそのもの」なので隠す
    const dronePos = _v.set(pp.x + fx * 2.6 + ox * 0.75, 2.05, pp.z + fz * 2.6 + oz * 0.75);
    this.drone.position.lerp(dronePos, 1 - Math.exp(-dt * 5));
    this.drone.lookAt(pp.x, 1.4, pp.z);
    this.drone.visible = mode !== 'face';
  }

  // ドローンを内側（-1）と外側（+1）のどちらに置くか（視線をさえぎる選手が少ない方。すぐには切り替えない）
  droneSide(pp, fx, fz, ox, oz, lead, dt, key = 'side', off = 0.95) {
    const blocked = (side) => {
      const cx = pp.x + fx * lead + ox * off * side;
      const cz = pp.z + fz * lead + oz * off * side;
      let n = 0;
      for (const v of this.walkers) {
        if (v === this.player) continue;
        const q = v.fig.root.position;
        const ax = pp.x - cx;
        const az = pp.z - cz;
        const L2 = ax * ax + az * az;
        const k = ((q.x - cx) * ax + (q.z - cz) * az) / L2;
        if (k < 0.02 || k > 0.92) continue;
        const dx = cx + ax * k - q.x;
        const dz = cz + az * k - q.z;
        if (dx * dx + dz * dz < 0.5 * 0.5) n++;
      }
      return n;
    };
    this[key] ??= 1;
    const tk = `${key}T`;
    const now = blocked(this[key]);
    if (now > 0 && blocked(-this[key]) < now) {
      this[tk] = (this[tk] ?? 0) + dt;
      if (this[tk] > 0.35) {
        this[key] = -this[key];
        this[tk] = 0;
      }
    } else this[tk] = 0;
    return this[key];
  }

  render() {
    const size = this.renderer.getDrawingBufferSize(_v);
    this.field.update(this.camera, size.y);
    this.renderer.render(this.scene, this.camera);
  }
}
