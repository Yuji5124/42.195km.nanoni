import * as THREE from 'three';

// Canvas で作るテクスチャ（画像ファイルは使わない）

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = null, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// 小さな決定的乱数
function rnd(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// トラックのタータン（赤茶 + ざらつき）
export function trackTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#93402f';
  g.fillRect(0, 0, 256, 256);
  const r = rnd(7);
  for (let i = 0; i < 9000; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? 'rgba(60,18,10,0.18)' : 'rgba(220,120,90,0.12)';
    g.fillRect(r() * 256, r() * 256, 1.5, 1.5);
  }
  return tex(c, { repeat: [40, 40] });
}

// 芝（刈り目のしま）
export function grassTexture() {
  const [c, g] = canvas(512, 512);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#2a5a2c' : '#326832';
    g.fillRect(0, i * 64, 512, 64);
  }
  const r = rnd(11);
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(20,50,20,0.22)' : 'rgba(120,170,90,0.12)';
    g.fillRect(r() * 512, r() * 512, 1, 2);
  }
  return tex(c, { repeat: [6, 6] });
}

// 着地マット（青 + 縫い目 + 文字）
export function matTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#1d4fb8';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(10,30,90,0.6)';
  g.lineWidth = 4;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(i * 128, 0);
    g.lineTo(i * 128, 512);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = 'bold 58px "Chakra Petch", sans-serif';
  g.textAlign = 'center';
  g.save();
  g.translate(256, 256);
  g.rotate(-Math.PI / 2);
  g.fillText('NANONI', 0, 18);
  g.restore();
  return tex(c);
}

// バー（白地に黒の帯）
export function barTexture() {
  const [c, g] = canvas(256, 8);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#f4f4f2' : '#d22c2c';
    g.fillRect(i * 16, 0, 16, 8);
  }
  return tex(c);
}

// LED 広告（前の壁）: 架空のスポンサーと大会名
export function ledTexture() {
  const [c, g] = canvas(2048, 64);
  const ads = [
    ['NIGHT GAMES TOKYO', '#ffd23f', '#0b1440'],
    ['なのに。 SPORTS', '#ffffff', '#c3122f'],
    ['42.195', '#39e6ff', '#05060f'],
    ['POLE VAULT FINAL', '#ffffff', '#0d3b8c'],
    ['MOON MILK', '#fff6d0', '#3b2a58'],
    ['視聴率', '#05060f', '#ffd23f'],
    ['ASAKUSA RAMEN', '#ffffff', '#b8331b'],
    ['TAKANE AIR', '#0b1440', '#9ad8ff'],
  ];
  const w = 2048 / ads.length;
  ads.forEach(([t, fg, bg], i) => {
    g.fillStyle = bg;
    g.fillRect(i * w, 0, w, 64);
    g.fillStyle = fg;
    g.font = 'bold 40px "Chakra Petch", "Dela Gothic One", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, i * w + w / 2, 34);
  });
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// コンクリート（スタンドの段）
export function concreteTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#6b6f78';
  g.fillRect(0, 0, 128, 128);
  const r = rnd(5);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)';
    g.fillRect(r() * 128, r() * 128, 2, 2);
  }
  return tex(c, { repeat: [60, 1] });
}

// 月（満月に近い。海のもよう・ふちの暗さ）
export function moonTexture() {
  const [c, g] = canvas(256, 256);
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 124);
  grd.addColorStop(0, '#fffbea');
  grd.addColorStop(0.8, '#f1ead2');
  grd.addColorStop(0.97, '#cfc6aa');
  grd.addColorStop(1, 'rgba(200,190,160,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(128, 128, 124, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'source-atop';
  const r = rnd(42);
  const maria = [[96, 92, 34], [150, 80, 26], [140, 140, 38], [86, 150, 22], [176, 120, 18], [120, 186, 20]];
  for (const [x, y, s] of maria) {
    g.fillStyle = 'rgba(150,140,120,0.45)';
    g.beginPath();
    g.ellipse(x, y, s, s * 0.8, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(120,110,95,${0.12 + r() * 0.2})`;
    g.beginPath();
    g.arc(30 + r() * 196, 30 + r() * 196, 1 + r() * 5, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, { aniso: 4 });
}

// やわらかい光の玉（ハロ・照明のグロー）
export function glowTexture() {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return tex(c, { srgb: false, aniso: 1 });
}

// 雲（fbm っぽいかたまり。白 + アルファ）
export function cloudTexture(seed = 1) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rnd(seed * 97 + 3);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const x = S * (0.18 + r() * 0.64);
    const y = S * (0.35 + r() * 0.32);
    const rad = S * (0.06 + r() * 0.16);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const a = 0.16 + r() * 0.2;
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  // 端は消す
  const data = g.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x / S - 0.5) * 2;
      const dy = (y / S - 0.5) * 2;
      const e = Math.max(0, 1 - Math.pow(Math.hypot(dx, dy * 1.4), 3));
      const o = (y * S + x) * 4 + 3;
      data.data[o] = Math.min(255, data.data[o] * e * 1.4);
    }
  }
  g.putImageData(data, 0, 0);
  const t = tex(c, { aniso: 1 });
  t.userData = { image: data, size: S };
  return t;
}

// 大型ビジョン / 得点板（更新できる Canvas）
export function boardCanvas(w = 512, h = 256) {
  const [c, g] = canvas(w, h);
  const t = tex(c, { aniso: 4 });
  return { canvas: c, g, tex: t };
}
