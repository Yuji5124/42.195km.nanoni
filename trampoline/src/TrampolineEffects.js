import * as THREE from 'three';
import { DRAMAS } from './data/dramas.js';

// イベントの中身（data/events.js の effects から名前で呼ばれる）。
// それぞれ start / update / end を持てる（m = TrampolineMode, inst = 発生中のイベント）。

const _v = new THREE.Vector3();

export const EFFECTS = {
  // バレリーナ: クラシック・観客・世界がさらに遅く（timeScale はイベント側）
  ballet: {
    start(m) {
      m.sfx.setBallet(true);
      m.cheer.hype(0.25);
    },
    end(m) {
      m.sfx.setBallet(false);
    },
  },

  crowdCheer: {
    start(m) {
      m.sfx.ooh(2.5);
      m.audio.cheerSwell(2);
      m.cheer.hype(0.2);
    },
  },

  flash: {
    start(m) {
      m.fx.flash(0.3);
      m.audio.shutter();
    },
  },

  // FACE LOCK: 顔しか映さない（回転しても頭の向きごと追う）
  faceLock: {
    start(m) {
      m.cam.faceLock = true;
      m.cam.set('FACE', { cut: true });
      if (m.air) m.air.faceT = 0; // 通常の「顔 → 中継」の切り替えをしない
    },
    end(m) {
      m.cam.faceLock = false;
      if (m.cam.shot === 'FACE') m.cam.set(m.defaultShot(), { dur: 0.4 });
    },
  },

  // カメラが選手を見失う: 天井 → 観客 → 花火 → 審判 → …（着地の瞬間を映せない）
  cameraLost: {
    start(m, inst) {
      const seat = m.arena.seats[Math.floor(m.rng.next() * m.arena.seats.length)];
      inst.data.points = [
        new THREE.Vector3(8, 34, -6), // 天井
        new THREE.Vector3(seat.x, seat.y + 1.2, seat.z), // 観客
        m.bg.lastBurst.clone(), // 花火（最後に上がった所）
        m.judges.center.clone(), // 審判
        new THREE.Vector3(-20, 22, -40), // 大型ビジョン
      ];
      inst.data.i = -1;
      inst.data.after = 0;
      m.hud.caption('（カメラ 3 番、選手を探しています）', 2.2);
    },
    update(m, inst, dt) {
      const d = inst.data;
      const i = Math.min(d.points.length - 1, Math.floor(inst.t / 0.62));
      if (i !== d.i) {
        d.i = i;
        m.cam.lookPoint.copy(d.points[i]);
        m.cam.set('LOOK', { dur: 0.22 });
        m.cam.shake(0.25);
      }
      // 着地したあと少ししてから、やっと戻ってくる
      if (m.phase !== 'air') {
        d.after += dt;
        if (d.after > 0.7) inst.done = true;
      }
    },
    end(m) {
      m.cam.set(m.defaultShot(), { dur: 0.25 });
    },
  },

  // 速すぎる: 残像（侍の半透明の分身）+ 画面の残像
  afterimage: {
    start(m) {
      m.ghosts.setActive(true);
      m.fx.target.blur = 0.82;
    },
    end(m) {
      m.ghosts.setActive(false);
      m.fx.target.blur = 0;
    },
  },

  // スローなのに見えない: 本体までほとんど透明に
  invisible: {
    start(m) {
      m.athlete.setOpacity(0.16);
    },
    end(m) {
      m.athlete.setOpacity(1);
    },
  },

  // 観客も跳ぶ（強いほど、観客席ごと揺れる）
  crowdJump: {
    start(m, inst) {
      const s = Math.min(1, (inst.ctx.attemptSum ?? 0) / 16000);
      m.arena.bump(0.45 + s * 0.8, s > 0.45 ? s : 0);
      m.cam.shake(0.3 + s * 0.6);
      m.audio.cheerSwell(2 + s * 3);
      m.audio.thump();
      m.cheer.hype(0.3);
    },
  },

  // 一人だけ異常に高く跳ぶ観客
  flyer: {
    start(m) {
      m.arena.launchFlyer(m.rng);
      m.hud.caption('（一人だけ、高い）', 2.4);
    },
  },

  // 天井 OPEN: 時間がほぼ止まる → 轟音 → 観客がざわつく → 屋根が左右へ開く → 夜空 → 「競技は続行します」
  roofOpen: {
    start(m, inst) {
      m.time.to(0.04, 3);
      m.sfx.roofRumble();
      m.audio.hush(1.4);
      m.audio.setMusic(null);
      m.hud.comment('……屋根が、開きます。', 3.2);
      m.arena.openRoof(true);
      inst.data.step = 0;
    },
    update(m, inst) {
      const d = inst.data;
      if (d.step === 0 && inst.t > 1.4) {
        d.step = 1;
        m.sfx.murmur();
        m.arena.flashStorm(3);
        m.cheer.hype(0.5);
        m.hud.caption('（ざわ……）', 2);
      }
      if (d.step === 1 && inst.t > 3.6) {
        d.step = 2;
        // 観客席の上に、開いていく屋根と夜空
        m.cam.lookPoint.set(0, 44, -34);
        m.cam.set('LOOK', { dur: 1.6 });
      }
      if (d.step === 2 && inst.t > 6.4) {
        d.step = 3;
        m.hud.comment('競技は、続行します。', 3);
      }
      if (inst.t > 7.4) inst.done = true;
    },
    end(m) {
      m.time.to(1, 2);
      m.skyReady = true;
      m.cam.set('WIDE', { dur: 1 });
    },
  },

  // 観客ドラマ: 競技を無視して観客席の 2 人を映す
  drama: {
    start(m, inst) {
      const pool = DRAMAS.filter((d) => !m.dramaSeen?.has(d.id));
      const script = (pool.length ? pool : DRAMAS)[Math.floor(m.rng.next() * (pool.length || DRAMAS.length))];
      (m.dramaSeen ??= new Set()).add(script.id);
      inst.data.script = script;
      m.drama.play(script, m.rng);
      m.cam.crowdPoint.copy(m.drama.center);
      m.cam.dramaFrom.copy(m.drama.cameraPos);
      m.cam.set('CROWD', { cut: true });
      m.audio.duckMusic(0.6, script.duration);
      m.audio.hush(0.6);
    },
    update(m, inst) {
      if (!m.drama.playing) inst.done = true;
    },
    end(m, inst) {
      const s = inst.data.script;
      if (s) {
        _v.copy(m.drama.center);
        m.fx.confettiBurst({ x: _v.x, y: _v.y - 5, z: _v.z }, 90, 2.5);
        m.nanoni(s.message, 'AUDIENCE', s.label, s.score);
      }
      m.drama.stop();
      m.cam.set(m.defaultShot(), { dur: 0.6 });
    },
  },
};
