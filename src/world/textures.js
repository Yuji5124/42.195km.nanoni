import * as THREE from 'three';
import { createRng } from '../core/math.js';

// 画像ファイルを使わず Canvas で生成するテクスチャ群（素材ゼロでも東京っぽく見せる）

export const FONT_JP = `"Dela Gothic One", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", "Noto Sans JP", "Noto Sans CJK JP", sans-serif`;
export const FONT_PIXEL = `"DotGothic16", ${FONT_JP}`;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = false, srgb = true, pixel = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (pixel) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  } else {
    t.anisotropy = 4;
  }
  return t;
}

export function makeRoadTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#1b1c22';
  g.fillRect(0, 0, 512, 512);
  const rng = createRng(7);
  for (let i = 0; i < 5000; i++) {
    const v = 20 + rng.int(0, 22);
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(rng.int(0, 511), rng.int(0, 511), 2, 2);
  }
  // 車線（破線）
  g.fillStyle = 'rgba(235,235,235,0.75)';
  for (const x of [512 * (2 / 7), 512 * (5 / 7)]) {
    for (let y = 0; y < 512; y += 128) g.fillRect(x - 3, y, 6, 72);
  }
  // 東京マラソンのブルーライン
  g.fillStyle = '#1f7bff';
  g.fillRect(256 - 5, 0, 10, 512);
  // 路肩の白線
  g.fillStyle = 'rgba(240,240,240,0.9)';
  g.fillRect(6, 0, 7, 512);
  g.fillRect(512 - 13, 0, 7, 512);
  const t = toTexture(c, { repeat: true });
  return t;
}

export function makeSidewalkTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#4a4650';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(20,20,30,0.55)';
  g.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  // 点字ブロック
  g.fillStyle = '#c8a020';
  g.fillRect(200, 0, 40, 256);
  return toTexture(c, { repeat: true });
}

export function makeFenceTexture() {
  const [c, g] = canvas(1024, 64);
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#1747c9');
  grd.addColorStop(1, '#0c2a82');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 64);
  g.fillStyle = '#ffffff';
  g.font = `bold 34px ${FONT_JP}`;
  g.textBaseline = 'middle';
  const words = ['42.195km、なのに。', 'TOKYO', '声援ください', 'DIGITAL MARATHON'];
  let x = 16;
  let i = 0;
  while (x < 1024) {
    const w = words[i++ % words.length];
    g.fillText(w, x, 34);
    x += g.measureText(w).width + 48;
  }
  return toTexture(c, { repeat: true });
}

export function makeBlobTexture() {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.6)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c, { srgb: false });
}

export function makeGlowTexture() {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c, { srgb: false });
}

function neonText(g, text, x, y, color, size, font = FONT_JP) {
  g.font = `${size}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = size * 0.35;
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText(text, x, y);
}

const NEON = ['#ff3d7f', '#39e6ff', '#ffd23f', '#3dff8b', '#ff7a1a', '#c77dff', '#ff4d4d', '#5dfdff'];

// 縦長看板 8 枚（各 128×512）
export const VERTICAL_SIGNS = ['走れ', 'カラオケ', '居酒屋', 'ラーメン', '寿', '声援', 'なのに', '餃子'];
// 横長看板 16 枚（各 256×128）
export const HORIZONTAL_SIGNS = [
  'SHINJUKU', '42.195km', 'なのに。', 'TOKYO', 'CHEER!!', 'RAMEN', 'KARAOKE', '東京マラソン',
  'LIVE', 'GAME', '24H', '寿司', 'HOTEL', 'DIGITAL', '給水', 'がんばれ',
];

export function makeSignAtlases() {
  const [vc, vg] = canvas(1024, 512);
  VERTICAL_SIGNS.forEach((text, i) => {
    const x0 = i * 128;
    const col = NEON[i % NEON.length];
    vg.fillStyle = '#0c0a14';
    vg.fillRect(x0 + 4, 4, 120, 504);
    vg.strokeStyle = col;
    vg.lineWidth = 6;
    vg.shadowColor = col;
    vg.shadowBlur = 14;
    vg.strokeRect(x0 + 10, 10, 108, 492);
    vg.shadowBlur = 0;
    const chars = [...text];
    const size = Math.min(92, 440 / chars.length);
    chars.forEach((ch, j) => {
      neonText(vg, ch, x0 + 64, 256 - ((chars.length - 1) * size) / 2 + j * size, col, size);
    });
  });

  const [hc, hg] = canvas(1024, 512);
  HORIZONTAL_SIGNS.forEach((text, i) => {
    const x0 = (i % 4) * 256;
    const y0 = Math.floor(i / 4) * 128;
    const col = NEON[(i * 3) % NEON.length];
    hg.fillStyle = '#0c0a14';
    hg.fillRect(x0 + 4, y0 + 4, 248, 120);
    hg.strokeStyle = col;
    hg.lineWidth = 5;
    hg.shadowColor = col;
    hg.shadowBlur = 12;
    hg.strokeRect(x0 + 10, y0 + 10, 236, 108);
    hg.shadowBlur = 0;
    const size = Math.min(64, 420 / Math.max(3, [...text].length));
    neonText(hg, text, x0 + 128, y0 + 66, col, size);
  });

  return { vertical: toTexture(vc), horizontal: toTexture(hc) };
}

// アーチ・横断幕・電光掲示などの汎用テキスト
export function makeBannerTexture(lines, { width = 1024, height = 256, bg = '#0b0f24', fg = '#ffffff', accent = '#39e6ff', font = FONT_JP } = {}) {
  const [c, g] = canvas(width, height);
  g.fillStyle = bg;
  g.fillRect(0, 0, width, height);
  g.strokeStyle = accent;
  g.lineWidth = 10;
  g.shadowColor = accent;
  g.shadowBlur = 18;
  g.strokeRect(10, 10, width - 20, height - 20);
  g.shadowBlur = 0;
  const arr = Array.isArray(lines) ? lines : [lines];
  const size = Math.min(height * 0.62 / arr.length, (width * 1.6) / Math.max(...arr.map((l) => [...l].length)));
  arr.forEach((line, i) => {
    g.font = `${size}px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = fg;
    g.shadowColor = accent;
    g.shadowBlur = 16;
    g.fillText(line, width / 2, height / 2 + (i - (arr.length - 1) / 2) * size * 1.12);
  });
  g.shadowBlur = 0;
  return toTexture(c);
}

// 緑の道路案内標識
export function makeRoadSignTexture(lines) {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = '#0f6b3c';
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 8;
  g.strokeRect(12, 12, 1000, 232);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const half = [lines.slice(0, 2), lines.slice(2, 4)];
  half.forEach(([jp, en], i) => {
    const cx = 256 + i * 512;
    g.font = `92px ${FONT_JP}`;
    g.fillText(jp ?? '', cx, 108);
    g.font = `bold 44px "Chakra Petch", Arial, sans-serif`;
    g.fillText(en ?? '', cx, 196);
  });
  g.font = `bold 120px Arial`;
  g.fillText('↑', 512, 128);
  return toTexture(c);
}

// 巨大ビジョン: ピクセルの柴犬 + コピー
export function makeVisionTexture(text) {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#0a0a12';
  g.fillRect(0, 0, 1024, 512);
  const dog = [
    '....oo......oo....',
    '...oOOo....oOOo...',
    '...oOOOooooOOOo...',
    '..oOOOOOOOOOOOOo..',
    '..oOOwwOOOOwwOOo..',
    '.oOOwkwOOOOwkwOOo.',
    '.oOOwwwwwwwwwwOOo.',
    '.oOwwwwwkkwwwwwOo.',
    '.oOwwwwwkkwwwwwOo.',
    '..oOwwwwrrwwwwOo..',
    '...oOwwwwwwwwOo...',
    '....oBBBBBBBBo....',
    '...oBBwBBBBwBBo...',
    '...oBBBBBBBBBBo...',
  ];
  const colors = { o: '#5a3418', O: '#d9893b', w: '#fff3e0', k: '#141414', r: '#ff6f91', B: '#3b5bdb' };
  const px = 24;
  dog.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (colors[ch]) {
        g.fillStyle = colors[ch];
        g.fillRect(40 + x * px, 60 + y * px, px, px);
      }
    });
  });
  g.fillStyle = '#ffffff';
  g.font = `76px ${FONT_JP}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#ff3d7f';
  g.shadowBlur = 20;
  text.split('\n').forEach((line, i) => g.fillText(line, 740, 190 + i * 110));
  g.shadowBlur = 0;
  // 走査線
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < 512; y += 4) g.fillRect(0, y, 1024, 2);
  return toTexture(c);
}

// 横スクロール区間の背景（ドット絵の夕焼け・富士山・鳥居）
export function makeBackdrop2DTexture() {
  const W = 320;
  const H = 120;
  const [c, g] = canvas(W, H);
  const sky = ['#2b1b4a', '#4a2366', '#7a2c6e', '#c2446a', '#f07a5a', '#ffb35a'];
  sky.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(0, i * 14, W, 14);
  });
  g.fillStyle = '#ffd98a';
  g.fillRect(222, 44, 22, 22);
  // 富士山
  g.fillStyle = '#3a3f7a';
  for (let y = 0; y < 60; y++) {
    const half = 12 + y * 1.6;
    g.fillRect(110 - half, 40 + y, half * 2, 1);
  }
  g.fillStyle = '#f4f4ff';
  for (let y = 0; y < 14; y++) {
    const half = 12 + y * 1.6;
    g.fillRect(110 - half + (y % 3), 40 + y, half * 2 - (y % 3) * 2, 1);
  }
  // 街並みシルエット
  const rng = createRng(3);
  g.fillStyle = '#1a1433';
  for (let x = 0; x < W; x += 8) {
    const h = rng.int(10, 34);
    g.fillRect(x, H - h, 8, h);
  }
  g.fillStyle = '#ffd23f';
  for (let i = 0; i < 60; i++) g.fillRect(rng.int(0, W), rng.int(H - 30, H - 4), 1, 1);
  // 鳥居
  g.fillStyle = '#e8322a';
  const tx = 262;
  g.fillRect(tx, 64, 34, 4);
  g.fillRect(tx + 3, 72, 28, 3);
  g.fillRect(tx + 6, 68, 4, 40);
  g.fillRect(tx + 24, 68, 4, 40);
  return toTexture(c, { pixel: true });
}

// 横スクロールの床（レンガ風の地面の断面、1 マス 4 ワールド単位で繰り返す）
export function makeGroundSectionTexture() {
  const [c, g] = canvas(16, 16);
  g.fillStyle = '#7a3b1e';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#b8612e';
  g.fillRect(0, 0, 16, 2);
  g.fillStyle = '#4a2210';
  g.fillRect(0, 7, 16, 1);
  g.fillRect(0, 15, 16, 1);
  g.fillRect(7, 0, 1, 7);
  g.fillRect(3, 8, 1, 7);
  g.fillRect(12, 8, 1, 7);
  const t = toTexture(c, { repeat: true, pixel: true });
  return t;
}

export function makeFinishLineTexture() {
  const [c, g] = canvas(256, 64);
  const s = 16;
  for (let y = 0; y < 64; y += s) {
    for (let x = 0; x < 256; x += s) {
      g.fillStyle = (x / s + y / s) % 2 === 0 ? '#ffffff' : '#111111';
      g.fillRect(x, y, s, s);
    }
  }
  return toTexture(c, { pixel: true });
}
