// 情報パネル: 試合が進むほど・会場が騒がしくなるほど増える。画面の左右の端だけに並ぶ（中央の選手と相手のパンチは隠さない）。
//   ROUND 1 … パンチ数 → 命中率 → よけた回数
//   ROUND 2 … 観客数・盛り上がり・心拍数・カウンター・システム変更回数
//   ROUND 3 … 気温・湿度・好きな食べ物・ラッキーカラー・リングまでの歩数・平均年齢・ゴング係の緊張・カメラ台数・Wi-Fi …
//   FINAL   … 小さいパネルが大量に（まばたきの回数・月の位置・紙吹雪の枚数 …）

const bar = (v, n = 5) => '█'.repeat(Math.round(v * n)) + '░'.repeat(n - Math.round(v * n));

// [id, 側, ラベル, 値の関数, 出る条件（round, t, hype）, 見た目]
function defs(m) {
  const c = m.core;
  const P = c.player;
  const st = P.stats;
  const acc = () => (st.thrown ? `${Math.round((st.landed / st.thrown) * 100)}%` : '—');
  const hr = () => Math.round(92 + m.hype * 55 + (P.action === 'punch' ? 12 : 0) + Math.sin(m.time * 1.3) * 3);
  const steps = () => 142 + Math.floor(m.time * 0.9);
  return [
    ['punch', 'L', 'PUNCHES', () => st.thrown, (r, t) => r > 1 || t > 28],
    ['acc', 'L', 'ACCURACY', acc, (r, t) => r > 1 || t > 55],
    ['dodge', 'L', 'DODGES', () => st.dodges, (r, t) => r > 1 || t > 85],
    ['aud', 'R', 'AUDIENCE', () => '19,868', (r) => r >= 2],
    ['exc', 'R', 'EXCITEMENT', () => `${Math.round(m.hype * 100)}%`, (r) => r >= 2],
    ['hr', 'R', 'HEART RATE ♥', hr, (r, t) => r >= 2 && (r > 2 || t > 15)],
    ['ctr', 'L', 'COUNTERS', () => st.counters, (r, t) => r >= 2 && (r > 2 || t > 30)],
    ['sysn', 'R', 'SYSTEM CHANGES', () => m.systems.changes, (r, t) => r >= 2 && (r > 2 || t > 45)],
    ['perf', 'L', 'PERFECT', () => st.perfect, (r, t) => r >= 2 && (r > 2 || t > 70)],
    ['temp', 'R', '会場の気温', () => `${(24.5 + m.hype * 2.4).toFixed(1)}℃`, (r) => r >= 3, 'jp'],
    ['hum', 'R', '湿度', () => `${Math.round(58 + m.hype * 9)}%`, (r, t) => r >= 3 && (r > 3 || t > 6), 'jp'],
    ['food1', 'L', '侍の好きな食べ物', () => 'おにぎり', (r, t) => r >= 3 && (r > 3 || t > 12), 'jp'],
    ['food2', 'L', '王者の好きな食べ物', () => 'オムライス', (r, t) => r >= 3 && (r > 3 || t > 18), 'jp'],
    ['lucky', 'R', '今日のラッキーカラー', () => '赤', (r, t) => r >= 3 && (r > 3 || t > 24), 'jp'],
    ['steps', 'L', 'リングまでの歩数', () => `${steps()} 歩`, (r, t) => r >= 3 && (r > 3 || t > 30), 'jp'],
    ['age', 'R', '観客の平均年齢', () => '34.2 歳', (r, t) => r >= 3 && (r > 3 || t > 36), 'jp'],
    ['gong', 'L', 'ゴング係の緊張', () => bar(0.4 + m.hype * 0.6), (r, t) => r >= 3 && (r > 3 || t > 42), 'jp'],
    ['cams', 'R', 'カメラ', () => `${m.arena.cameraRigs.filter((x) => x.visible).length + 32} 台`, (r, t) => r >= 3 && (r > 3 || t > 48), 'jp'],
    ['wifi', 'L', '会場 Wi-Fi', () => ['▂___', '▂▄__', '▂▄▆_', '▂▄▆█'][Math.floor(m.time * 0.7) % 4], (r, t) => r >= 3 && (r > 3 || t > 54), 'jp'],
    ['line', 'R', '売店の行列', () => `${38 + Math.floor(Math.sin(m.time * 0.1) * 9)} 人`, (r, t) => r >= 3 && (r > 3 || t > 62), 'jp'],
    ['lights', 'L', '照明', () => '1,024 灯', (r, t) => r >= 3 && (r > 3 || t > 70), 'jp'],
    ['phones', 'R', 'スマホを掲げた人', () => `${Math.round(m.hype * 7400)} 人`, (r, t, h) => r >= 3 && (r > 3 || t > 78 || h > 0.6), 'jp'],
    // FINAL: 小さいのが大量に
    ['ref', 'L', 'レフェリーの歩数', () => `${Math.floor(m.time * 1.7)}`, (r) => r >= 4, 'jp tiny'],
    ['clap', 'R', '拍手の回数', () => `${Math.floor(m.time * 310 * (0.3 + m.hype)).toLocaleString('en-US')}`, (r) => r >= 4, 'jp tiny'],
    ['conf', 'L', '紙吹雪', () => `${Math.floor(m.show.confettiCount).toLocaleString('en-US')} 枚`, (r, t) => r >= 4 && t > 5, 'jp tiny'],
    ['water', 'R', '実況席の水', () => `残り ${Math.max(5, 40 - Math.floor(m.time * 0.05))}%`, (r, t) => r >= 4 && t > 10, 'jp tiny'],
    ['blink', 'L', '会場のまばたき', () => `${Math.floor(m.time * 3300).toLocaleString('en-US')} 回`, (r, t) => r >= 4 && t > 15, 'jp tiny'],
    ['moon', 'R', '月の位置', () => '南東', (r, t) => r >= 4 && t > 20, 'jp tiny'],
    ['luck', 'L', '今日の運勢', () => '大吉', (r, t) => r >= 4 && t > 25, 'jp tiny'],
    ['balloon', 'R', '風船', () => `${Math.floor(m.hype * 480)} 個`, (r, t) => r >= 4 && t > 30, 'jp tiny'],
    ['glow', 'L', 'サイリウム', () => `${Math.floor(m.hype * 6100)} 本`, (r, t) => r >= 4 && t > 35, 'jp tiny'],
    ['bpm', 'R', '会場の BPM', () => `${Math.round(118 + m.hype * 30)}`, (r, t) => r >= 4 && t > 40, 'tiny'],
    ['kcal', 'L', '侍の消費カロリー', () => `${Math.floor(P.stats.thrown * 1.8 + m.time * 0.2)} kcal`, (r, t) => r >= 4 && t > 45, 'jp tiny'],
    ['door', 'R', '会場のドア', () => '24 枚', (r, t) => r >= 4 && t > 50, 'jp tiny'],
    ['seat', 'L', '座席の数', () => '19,868', (r, t) => r >= 4 && t > 55, 'jp tiny'],
    ['speed', 'R', 'いまのパンチ', () => `時速 ${m.show.lastSpeed} km`, (r, t) => r >= 4 && t > 60, 'jp tiny'],
    ['cable', 'L', 'ケーブルの長さ', () => '8.4 km', (r, t) => r >= 4 && t > 65, 'jp tiny'],
    ['fan', 'R', '妙に盛り上がっている人', () => '1 人', (r, t) => r >= 4 && t > 70, 'jp tiny'],
  ].map(([id, side, label, fn, when, cls = '']) => ({ id, side, label, fn, when, cls }));
}

export class Panels {
  constructor(m) {
    this.m = m;
    this.list = defs(m);
    this.shown = new Map();
    this.left = document.getElementById('panelsL');
    this.right = document.getElementById('panelsR');
    this.t = 0;
  }

  get count() {
    return this.shown.size;
  }

  update(dt, round, t) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    const h = this.m.hype;
    for (const d of this.list) {
      if (!this.shown.has(d.id) && d.when(round, t, h)) {
        const el = document.createElement('div');
        el.className = `pn ${d.cls}`;
        el.style.setProperty('--c', d.side === 'L' ? '#39e6ff' : '#ff3d7f');
        el.innerHTML = `<span>${d.label}</span><b></b>`;
        (d.side === 'L' ? this.left : this.right).appendChild(el);
        this.shown.set(d.id, { el, b: el.lastChild, v: null });
      }
    }
    for (const d of this.list) {
      const s = this.shown.get(d.id);
      if (!s) continue;
      const v = String(d.fn());
      if (v !== s.v) {
        if (s.v !== null && /^[\d,.%]+/.test(v)) {
          s.el.classList.remove('bump');
          void s.el.offsetWidth;
          s.el.classList.add('bump');
        }
        s.v = v;
        s.b.textContent = v;
      }
    }
  }
}
