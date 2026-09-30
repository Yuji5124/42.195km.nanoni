import * as THREE from 'three';
import { BoxerModel } from '../fighters/BoxerModel.js';
import { BoxerAnimator } from '../fighters/BoxerAnimator.js';
import { RING, JUMBO } from '../arena/BoxingArena.js';

// ROUND 1 のハプニング（中継・会場・UI の事故）。試合と選手・レフェリーは真面目なまま、周りだけがちゃんとしていない。
// 時刻はラウンドの経過（ゲーム内の秒）。ダウン中・リプレイ中は止まり、戻ってから起きる。
// 画面が隠れる・暗くなるものは、その間 相手の攻撃を待たせる（grace）= 理不尽に当てない。
//
//    5 秒  タイトル表示が遅れて出る
//   13 秒  カメラが天井の吊り下げビジョンを映してしまう（試合はビジョンの中で続いている → 失礼しました）
//  (25 秒  COUNTER へ ＝ いつものシステム変更)
//   36 秒  チュートリアルが今さら出る（1 / 12・スキップできません）
//   46 秒  紙吹雪の誤発射（まだ 1 ラウンド目）
//   54 秒  一瞬 8BIT になって戻る（誤操作）
//  (62 秒  SIDE VIEW へ)
//   70 秒  撮影スタッフが手前を横切る
//   84 秒  停電 → 予備電源
//   94 秒  まちがった BGM が流れる
//  101 秒  試合の時計が一瞬 88:88

const _v = new THREE.Vector3();

export class Happenings {
  constructor(m) {
    this.m = m;
    this.done = new Set();
    this.camHold = 0;
    this.blackout = 0;
    this.blackT = -1;
    this.clockText = null;
    this.clockT = 0;
    this.staffT = -1;
    this.glitchT = -1;
    this.count = 0;
    this.list = [
      [5, 'title'],
      [13, 'camera'],
      [36, 'tutorial'],
      [46, 'confetti'],
      [54, 'glitch'],
      [70, 'staff'],
      [84, 'blackout'],
      [94, 'bgm'],
      [101, 'clock'],
    ];
  }

  // 戦っている間だけ呼ぶ
  update(dt, round, t) {
    if (round === 1 && !this.m.params.has('nohappen')) {
      for (const [at, id] of this.list) {
        if (t >= at && !this.done.has(id)) {
          this.done.add(id);
          this.start(id);
          break;
        }
      }
    }
  }

  // 戦っていない時も進める（演出の後始末）
  tick(dt) {
    const m = this.m;
    this.camHold = Math.max(0, this.camHold - dt);
    if (this.camHold <= 0 && this.camWas) {
      this.camWas = false;
      m.rig.cut();
      m.show.telop('失礼しました', 'info small', 1.4, true);
    }
    // 停電: 暗くなる → ちらつく → 戻る
    if (this.blackT >= 0) {
      this.blackT += dt;
      const t = this.blackT;
      let k;
      if (t < 0.15) k = t / 0.15;
      else if (t < 2.2) k = 1;
      else if (t < 2.9) k = Math.floor(t * 14) % 2 ? 1 : 0.3;
      else k = Math.max(0, 1 - (t - 2.9) * 2);
      this.setBlackout(k);
      if (t > 2.2 && !this.powerBack) {
        this.powerBack = true;
        m.bAudio.powerUp?.();
      }
      if (t > 3.6) {
        this.blackT = -1;
        this.setBlackout(0);
        m.show.telop('予備電源に切り替わりました', 'info', 2.2, true);
      }
    }
    // 撮影スタッフが横切る
    if (this.staffT >= 0) {
      this.staffT += dt;
      const x = -3.9 + this.staffT * 1.8;
      this.staffAnim.override = { action: 'rest', pose: 'walk', x, z: 3.45, y: RING.y, yaw: Math.PI / 2 };
      this.staffAnim.update(dt, {});
      if (x > 4.6) {
        this.staffT = -1;
        this.staff.root.visible = false;
      }
    }
    // 一瞬 8BIT → 戻す
    if (this.glitchT >= 0) {
      this.glitchT += dt;
      if (this.glitchT > 3.2) {
        this.glitchT = -1;
        if (m.phase === 'fight' && m.round === 1) {
          m.systems.set([this.glitchBack], { label: `${this.glitchBack === 'counter' ? 'COUNTER' : '3D'}（戻しました）` });
          m.show.telop('失礼しました、戻します', 'info small', 1.6, true);
        }
      }
    }
    if (this.clockT > 0) {
      this.clockT -= dt;
      this.clockText = Math.floor(this.clockT * 6) % 2 ? '88:88' : '--:--';
      if (this.clockT <= 0) this.clockText = null;
    }
  }

  start(id) {
    const m = this.m;
    const S = m.show;
    const talk = (who, text) => m.hud.talk(who, text, { dur: 3.4, b: who === '解説' });
    this.count++;
    S.addHype(0.03);
    switch (id) {
      case 'title': {
        this.flashDom('hp-title', '<small>WORLD CHAMPIONSHIP · LIVE</small><b>ボクシング、なのに。</b><em>（タイトル表示が遅れました）</em>', 3.4);
        talk('実況', 'あ、いまタイトルが出ました');
        break;
      }
      case 'camera': {
        this.camHold = 2.3;
        this.camWas = true;
        m.core.grace(2.5);
        m.rig.cut();
        m.fx.glitchBurst(0.8);
        S.telop('ただいま映像が乱れております', 'info', 2, true);
        talk('実況', 'カメラさん、そっちは天井です！ 試合はビジョンでご覧ください');
        break;
      }
      case 'tutorial': {
        this.flashDom(
          'hp-tut',
          '<div class="t-h">TUTORIAL <span>1 / 12</span></div><div class="t-b"><b>カウンター</b>とは？<br />相手のパンチを<b>よけた直後</b>に打つと、ダメージが大きくなります。</div><div class="t-f"><i></i><span>スキップできません</span></div>',
          4.8
        );
        talk('解説', '今さらチュートリアルが出ましたね');
        break;
      }
      case 'confetti': {
        S.confettiBurst(520);
        S.balloonBurst(10);
        m.bAudio.cheer(0.8);
        S.telop('紙吹雪、早すぎ', 'gold', 2, true);
        talk('実況', 'まだ 1 ラウンド目です！');
        break;
      }
      case 'glitch': {
        if (m.systems.forced) break;
        this.glitchBack = m.systems.ids[0] === 'counter' ? 'counter' : '3d';
        m.systems.set(['8bit'], { label: '8BIT？' });
        this.glitchT = 0;
        talk('実況', 'おっと、誰かがボタンを押しました');
        break;
      }
      case 'staff': {
        if (!this.staff) {
          this.staff = new BoxerModel('staff');
          m.scene.add(this.staff.root);
          const dummy = { x: 0, z: 0, yaw: 0, action: 'idle', slipDir: 0, guard: 0, hitT: 0, stun: 0, walk: 1, punch: null, hitDir: 0 };
          this.staffAnim = new BoxerAnimator(this.staff, dummy);
        }
        this.staff.root.visible = true;
        this.staffAnim.snapNext = true;
        this.staffT = 0;
        m.core.grace(3);
        S.telop('撮影スタッフが横切ります', 'info small', 2.4, true);
        talk('解説', 'カメラマンさん、映ってます');
        break;
      }
      case 'blackout': {
        this.blackT = 0;
        this.powerBack = false;
        m.core.grace(2.8);
        m.bAudio.powerDown?.();
        m.bAudio.ooh();
        S.telop('停電！？', 'gold', 1.8, true);
        talk('実況', '会場が真っ暗です！ 試合は… 続いています！');
        S.react('phones');
        break;
      }
      case 'bgm': {
        m.bAudio.wrongBgm?.();
        S.telop('♪ BGM：まちがい', 'info', 3, true);
        talk('解説', '音響さん、それは入場曲ではありません');
        break;
      }
      case 'clock': {
        this.clockT = 1.6;
        S.telop('試合の時計が一瞬おかしくなりました', 'info small', 2, true);
        break;
      }
      default:
        break;
    }
  }

  flashDom(cls, html, sec) {
    const el = document.createElement('div');
    el.className = `hp ${cls}`;
    el.innerHTML = html;
    document.getElementById('ui').insertBefore(el, document.getElementById('telop'));
    el.style.setProperty('--dur', `${sec}s`);
    setTimeout(() => el.remove(), sec * 1000 + 100);
  }

  setBlackout(k) {
    const m = this.m;
    this.blackout = k;
    m.arena.setBlackout(k);
    m.field.uniforms.uLight.value = 0.55 * (1 - k * 0.85);
    for (const sc of m.show.jumboScreens ?? []) sc.material.color.setScalar(1.15 * (1 - k * 0.95));
  }

  // カメラの横取り: リングサイドのカメラが上を向いて、吊り下げビジョンを映してしまう（ビジョンの中で試合は続く）
  camera(rig, dt) {
    if (this.camHold <= 0) return false;
    const w = Math.sin(this.camHold * 2.2) * 0.25;
    _v.set(w, JUMBO.y - 0.2, 0);
    rig.aim(new THREE.Vector3(1.2, 9.5, 17), _v, 26, 5, dt);
    return true;
  }

  // 停電中のフラッシュを増やす
  get flashBoost() {
    return this.blackout * 0.8;
  }
}
