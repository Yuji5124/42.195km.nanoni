// 実況（A）・解説（B）・ディレクター（D: カメラマンのインカム）・主人公の独り言。
//   実況は真面目なスポーツ中継。そこへカメラマンへの困惑が混ざる（「……カメラが観客席へ。」「鳥ですね。」「鳥です。」）。
//   観客の物語の意味は説明しない（「かなり緊張している様子です。」まで）。意味はエピローグで分かる。
//   ディレクターはカメラマンだけに聞こえる（「どこ撮ってる！」「いいぞ、数字上がってる！」）。

const pick = (rng, arr) => arr[Math.floor(rng.next() * arr.length)];

export class Commentary {
  constructor({ hud, rng, comp }) {
    this.hud = hud;
    this.rng = rng;
    this.comp = comp;
    this.queue = [];
    this.gap = 0;
    this.lastCam = '';
    this.camT = 0;
    this.awayT = 0;
    this.said = new Map();
    this.skyT = 0;
    this.lastMainKind = '';
    this.mainT = 0;
    this.lastStoryLine = new Map();
  }

  // who: A / B / D（ディレクター）/ voice / pa
  line(text, who = 'A', { pri = 1, dur = 3.6, key = null, cool = 0 } = {}, t = 0) {
    if (key) {
      const last = this.said.get(key);
      if (last !== undefined && t - last < cool) return;
      this.said.set(key, t);
    }
    // 優先度の低いものは、詰まっていたら捨てる
    if (this.queue.length > 2 && pri < 2) return;
    this.queue.push({ text, who, dur, pri });
    this.queue.sort((a, b) => b.pri - a.pri);
  }

  update(dt) {
    this.gap -= dt;
    if (this.gap <= 0 && this.queue.length) {
      const l = this.queue.shift();
      this.hud.sub(l.text, l.who, l.dur);
      this.gap = l.who === 'D' ? 0.9 : 1.35;
    }
  }

  // ---- 競技のイベント
  onEvent(type, e, t) {
    const a = e.a;
    const ath = e.athlete;
    const h = a ? `${a.height.toFixed(2).replace('.', 'メートル')}` : '';
    const rng = this.rng;
    switch (type) {
      case 'vault:ready':
        if (a.final) {
          if (a.wr) this.line(`高嶺、バーを${h}に上げました。……世界記録を超える高さです。`, 'A', { pri: 3, dur: 4.5 }, t);
          else this.line(`高嶺、${h}。大会記録に挑戦します。`, 'A', { pri: 3, dur: 4 }, t);
          setTimeout(() => this.line('……会場が、静かになりました。', 'B', { pri: 3, dur: 3.5 }, t), 3200);
        } else if (a.no === 3) this.line(`${ath.short}、${h}。3回目、もう後がありません。`, 'A', { pri: 2 }, t);
        else this.line(`${ath.short}、${h}に挑戦します。`, 'A', { pri: 2 }, t);
        break;
      case 'vault:run':
        this.line(pick(rng, ['助走に入りました。', '助走、スタート。', 'さあ、行きます。']), 'A', { pri: 2, dur: 2.4 }, t);
        break;
      case 'vault:clear':
        if (a.final) break;
        this.line(pick(rng, [`成功！ ${h}、クリア！`, `跳んだ！ ${h}！`, `${ath.short}、${h}を一回で！`]), 'A', { pri: 3 }, t);
        if (rng.next() < 0.6) setTimeout(() => this.line(pick(rng, ['踏み切りが良かったですね。', 'ポールに乗れていました。', '余裕がありましたね。']), 'B', { pri: 1 }, t), 1800);
        break;
      case 'vault:fail':
        if (a.final) break;
        this.line(pick(rng, ['あーっと、バーが落ちました。', '惜しい！ 胸が触れました。', '……失敗。']), 'A', { pri: 3 }, t);
        break;
      case 'vault:out':
        setTimeout(() => this.line(`${ath.short}、ここで競技終了です。`, 'A', { pri: 2 }, t), 2200);
        break;
      case 'vault:winner':
        this.line('リヴァ、3回目も失敗！', 'A', { pri: 4, dur: 3 }, t);
        setTimeout(() => this.line('この瞬間、高嶺ソラの優勝が決まりました！', 'A', { pri: 4, dur: 4 }, t), 1500);
        setTimeout(() => this.line('おい、高嶺！ 高嶺の顔！', 'D', { pri: 4, dur: 2.5 }, t), 900);
        break;
      case 'vault:record':
        if (a.wr) this.line('跳んだ！ 世界新記録！ 6メートル35！', 'A', { pri: 5, dur: 4.5 }, t);
        else this.line('跳んだ！ 大会新記録！ 6メートル05！', 'A', { pri: 5, dur: 4.5 }, t);
        setTimeout(() => this.line('……すごいものを見ました。', 'B', { pri: 4, dur: 4 }, t), 2600);
        break;
      default:
        break;
    }
    if (type === 'vault:fail' && a.final) this.line('……あーっと。バーが落ちました。それでも、優勝は高嶺です。', 'A', { pri: 5, dur: 5 }, t);
  }

  // ---- カメラが何を映しているか（毎フレーム）
  onCamera(t, dt, { main, shotPhase, judge, active }) {
    const kind = main?.s.kind ?? 'none';
    if (kind === this.lastMainKind) this.mainT += dt;
    else {
      this.lastMainKind = kind;
      this.mainT = 0;
    }
    const actionNow = active && ['run', 'plant', 'rise', 'invert', 'push', 'clear', 'fall'].includes(shotPhase);
    const onAthlete = kind === 'athlete';
    // 試技の最中にカメラが観客席へ
    if (actionNow && !onAthlete) {
      this.awayT += dt;
      if (this.awayT > 0.9 && (kind === 'npc' || kind === 'none')) {
        this.line('……カメラが観客席へ。', 'A', { pri: 2, key: 'away', cool: 30 }, t);
        this.line('何かあるのでしょうか。', 'B', { pri: 2, key: 'away2', cool: 30 }, t);
        this.line('おい、どこ撮ってる！ 跳ぶぞ！', 'D', { pri: 3, key: 'dAway', cool: 25, dur: 2.4 }, t);
      }
    } else if (onAthlete && this.awayT > 2.5) {
      this.line('……競技に戻ります。', 'A', { pri: 2, key: 'back', cool: 25 }, t);
      this.awayT = 0;
    } else if (onAthlete) this.awayT = 0;
    // 鳥
    if (kind === 'birds' && this.mainT > 1.2) {
      this.line('鳥ですね。', 'A', { pri: 2, key: 'bird1', cool: 50 }, t);
      this.line('鳥です。', 'B', { pri: 2, key: 'bird2', cool: 50 }, t);
    }
    // 夜空・月
    if (kind === 'moon' || (kind === 'none' && main === null)) this.skyT += dt;
    else this.skyT = Math.max(0, this.skyT - dt * 2);
    if (kind === 'moon' && this.mainT > 2) this.line('きれいな月が出ています。', 'B', { pri: 1, key: 'moon', cool: 60 }, t);
    if (this.skyT > 9) {
      this.line('……競技は続いています。', 'A', { pri: 2, key: 'sky', cool: 40 }, t);
      this.line('空はもういい！ 戻って！', 'D', { pri: 2, key: 'dSky', cool: 40, dur: 2.2 }, t);
    }
    // 審判のアップ
    if (kind === 'judge' && main.frac > 0.18 && this.mainT > 1.5) {
      this.line(`${main.s.label}です。`, 'A', { pri: 1, key: 'judge', cool: 45 }, t);
      this.line('……いい表情ですね。', 'B', { pri: 1, key: 'judge2', cool: 45 }, t);
    }
    // 物語の人（説明しすぎない: 物語ごとの実況を 1 回だけ）
    if (kind === 'npc' && main.s.npc?.beat && this.mainT > 1.4) {
      const st = main.s.npc.beat.story;
      const last = this.lastStoryLine.get(st.id) ?? -99;
      if (st.onAir?.length && t - last > 22) {
        this.lastStoryLine.set(st.id, t);
        this.line(pick(this.rng, st.onAir), this.rng.next() < 0.5 ? 'A' : 'B', { pri: 1 }, t);
      }
    }
    if (kind === 'cat' && this.mainT > 0.8) this.line('……猫です。', 'A', { pri: 2, key: 'cat', cool: 60 }, t);
    void judge;
  }

  // ---- SHOT のあと
  onShot(shot, t) {
    if (shot.master) {
      this.line(shot.master === 2 ? '……今の一枚、何が起きたんですか。' : '……！', 'B', { pri: 4 }, t);
      this.line('最高！ 今の最高！', 'D', { pri: 4, dur: 2.2 }, t);
      return;
    }
    if (shot.ai >= 90 && (shot.V.sport === 0 || shot.kind === 'judge')) {
      this.line('なぜこんなに高いのでしょうか。', 'A', { pri: 2, key: 'why', cool: 40 }, t);
    } else if (shot.points >= 2500) this.line(this.rng.next() < 0.5 ? 'いいぞ、数字上がってる！' : 'それ！ それ使う！', 'D', { pri: 2, key: 'dGood', cool: 12, dur: 2 }, t);
    else if (shot.boring) this.line('同じ絵ばっかりだぞ。', 'D', { pri: 2, key: 'dBoring', cool: 20, dur: 2 }, t);
    else if (shot.sharp < 0.45) this.line('ピント！', 'D', { pri: 2, key: 'dFocus', cool: 15, dur: 1.6 }, t);
  }
}
