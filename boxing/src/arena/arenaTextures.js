import { makeCanvas, toTexture, FONT_JP } from '../../../src/world/textures.js';
import { createRng } from '../../../src/core/math.js';

// 会場の Canvas テクスチャ（画像ファイルは使わない）
export const FONT_NUM = `"Chakra Petch", "Arial Narrow", Arial, sans-serif`;

// リングのキャンバス（マット）: 薄いグレー + 中央のロゴ + 赤・青コーナーの三角
export function makeCanvasTexture() {
  const S = 1024;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#d8dbe2';
  g.fillRect(0, 0, S, S);
  const rng = createRng(5);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(0,0,0,${0.015 + rng.next() * 0.025})`;
    g.fillRect(rng.int(0, S), rng.int(0, S), 2, 2);
  }
  // コーナーの三角（赤 = 左上、青 = 右下）
  const tri = (x, y, dx, dy, col) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + dx, y);
    g.lineTo(x, y + dy);
    g.fill();
  };
  tri(0, 0, 150, 150, '#c3182e');
  tri(S, S, -150, -150, '#1d3fb5');
  tri(S, 0, -150, 150, '#f4f4f4');
  tri(0, S, 150, -150, '#f4f4f4');
  // 中央のロゴ
  g.save();
  g.translate(S / 2, S / 2);
  g.fillStyle = 'rgba(11,26,74,0.9)';
  g.beginPath();
  g.arc(0, 0, 250, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffd23f';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(0, 0, 232, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 60px ${FONT_NUM}`;
  g.fillText('NANONI', 0, -70);
  g.font = `700 42px ${FONT_NUM}`;
  g.fillText('WORLD BOXING', 0, -14);
  g.font = `68px ${FONT_JP}`;
  g.fillStyle = '#ffd23f';
  g.fillText('ボクシング、', 0, 62);
  g.font = `44px ${FONT_JP}`;
  g.fillStyle = '#ffffff';
  g.fillText('なのに。', 0, 132);
  g.restore();
  const t = toTexture(c);
  t.anisotropy = 8;
  return t;
}

// エプロン（リングの側面）の幕
export function makeApronTexture() {
  const [c, g] = makeCanvas(1024, 160);
  const grad = g.createLinearGradient(0, 0, 0, 160);
  grad.addColorStop(0, '#0b1030');
  grad.addColorStop(1, '#05060f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 160);
  g.fillStyle = '#ffd23f';
  g.fillRect(0, 0, 1024, 8);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 64px ${FONT_NUM}`;
  g.fillText('NANONI WORLD CHAMPIONSHIP', 512, 70);
  g.font = `30px ${FONT_JP}`;
  g.fillStyle = '#39e6ff';
  g.fillText('試合はちゃんとしてる。', 512, 128);
  return toTexture(c);
}

// LED 広告（1 階スタンドの縁）: 架空のスポンサー
export const SPONSORS = [
  ['なのに銀行', '#1d3fb5', '#ffffff'],
  ['GONG 保険', '#101018', '#ffd23f'],
  ['42.195 WATER', '#0b7bd8', '#ffffff'],
  ['侍エナジー', '#c3182e', '#ffffff'],
  ['RINGSIDE TV', '#0a0a12', '#39e6ff'],
  ['ボクシング、なのに。', '#ffffff', '#0b1a4a'],
  ['CAMERA × 48', '#00a3a3', '#ffffff'],
  ['会場 Wi-Fi', '#5b2a8a', '#ffffff'],
];

export function makeAdTexture() {
  const W = 2048;
  const H = 128;
  const [c, g] = makeCanvas(W, H);
  const cell = W / SPONSORS.length;
  SPONSORS.forEach(([text, bg, fg], i) => {
    g.fillStyle = bg;
    g.fillRect(i * cell, 0, cell, H);
    g.fillStyle = fg;
    const jp = /[ぁ-んァ-ン一-龥]/.test(text);
    g.font = `${jp ? 60 : 56}px ${jp ? FONT_JP : FONT_NUM}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, i * cell + cell / 2, H / 2 + 4, cell - 24);
  });
  return toTexture(c, { repeat: true });
}

// 入場ゲートの画面
export function makeGateTexture() {
  const [c, g] = makeCanvas(1024, 512);
  const grad = g.createRadialGradient(512, 256, 20, 512, 256, 520);
  grad.addColorStop(0, '#3a1030');
  grad.addColorStop(1, '#05060f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `120px ${FONT_JP}`;
  g.fillText('侍', 512, 200);
  g.font = `700 64px ${FONT_NUM}`;
  g.fillStyle = '#ffd23f';
  g.fillText('SAMURAI', 512, 340);
  return toTexture(c);
}

// 丸いぼかし（照明のハロ・フラッシュ）
export function makeHaloTexture() {
  const [c, g] = makeCanvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,250,235,0.6)');
  grad.addColorStop(0.55, 'rgba(255,240,210,0.12)');
  grad.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c);
}

// 光の筋（スポットライトの円錐・レーザー）: 縦のグラデーション
export function makeBeamTexture() {
  const [c, g] = makeCanvas(64, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  const g2 = g.createLinearGradient(0, 0, 64, 0);
  g2.addColorStop(0, 'rgba(0,0,0,1)');
  g2.addColorStop(0.5, 'rgba(0,0,0,0)');
  g2.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = g2;
  g.fillRect(0, 0, 64, 256);
  return toTexture(c);
}
