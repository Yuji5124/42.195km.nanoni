import * as THREE from 'three';
import { makeCanvas, toTexture, FONT_JP } from '../../../src/world/textures.js';
import { createRng } from '../../../src/core/math.js';

// スタジアム用の Canvas テクスチャ（画像ファイルは使わない）
export const FONT_NUM = `"Chakra Petch", "Arial Narrow", Arial, sans-serif`;

// ピッチ: 芝の縞 + ライン。105 × 68m を 2048 × 1328px に（1m ≒ 19.5px）
export function makePitchTexture() {
  const W = 2048;
  const H = 1328;
  const [c, g] = makeCanvas(W, H);
  const k = W / 105;
  const stripes = 18;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#2f8a3c' : '#277a33';
    g.fillRect((i * W) / stripes, 0, W / stripes + 1, H);
  }
  // 芝のムラ
  const rng = createRng(11);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '0,0,0'},${0.02 + rng.next() * 0.03})`;
    g.fillRect(rng.int(0, W), rng.int(0, H), 3, 3);
  }
  g.strokeStyle = 'rgba(245,245,240,0.92)';
  g.lineWidth = 0.14 * k;
  const X = (m) => (m + 52.5) * k;
  const Z = (m) => (m + 34) * k;
  g.strokeRect(X(-52.5) + 2, Z(-34) + 2, 105 * k - 4, 68 * k - 4);
  g.beginPath();
  g.moveTo(X(0), Z(-34));
  g.lineTo(X(0), Z(34));
  g.stroke();
  g.beginPath();
  g.arc(X(0), Z(0), 9.15 * k, 0, Math.PI * 2);
  g.stroke();
  for (const side of [-1, 1]) {
    const gx = side * 52.5;
    // ペナルティエリア・ゴールエリア
    g.strokeRect(side < 0 ? X(-52.5) : X(52.5 - 16.5), Z(-20.16), 16.5 * k, 40.32 * k);
    g.strokeRect(side < 0 ? X(-52.5) : X(52.5 - 5.5), Z(-9.16), 5.5 * k, 18.32 * k);
    g.beginPath();
    g.arc(X(gx - side * 11), Z(0), 9.15 * k, side < 0 ? -0.93 : Math.PI - 0.93, side < 0 ? 0.93 : Math.PI + 0.93);
    g.stroke();
    g.fillStyle = 'rgba(245,245,240,0.92)';
    g.beginPath();
    g.arc(X(gx - side * 11), Z(0), 0.2 * k, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.arc(X(0), Z(0), 0.25 * k, 0, Math.PI * 2);
  g.fill();
  const t = toTexture(c);
  t.anisotropy = 8;
  return t;
}

// LED 広告ボード（横に長い、流れる）: 架空のスポンサー
export const SPONSORS = [
  ['なのに銀行', '#1d3fb5', '#ffffff'],
  ['SAMURAI ENERGY', '#101018', '#ffd23f'],
  ['42.195 WATER', '#0b7bd8', '#ffffff'],
  ['FIND YOUR SEAT', '#ff3d7f', '#ffffff'],
  ['東京ラーメン', '#c8102e', '#ffe9a8'],
  ['SEAT.AI', '#0a0a12', '#39e6ff'],
  ['サッカー、なのに。', '#ffffff', '#0b1a4a'],
  ['NANONI AIRLINES', '#00a3a3', '#ffffff'],
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
    g.font = `${/[ぁ-んァ-ン一-龥]/.test(text) ? 64 : 58}px ${/[ぁ-んァ-ン一-龥]/.test(text) ? FONT_JP : FONT_NUM}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, i * cell + cell / 2, H / 2 + 4, cell - 24);
  });
  const t = toTexture(c, { repeat: true });
  return t;
}

// ブロック番号 / 列番号のアトラス（cols × rows のマス。マス i に番号 i+1）
export function makeNumberAtlas({ count, cols, cellW, cellH, bg, fg, font = FONT_NUM, prefix = '', border = null }) {
  const rows = Math.ceil(count / cols);
  const [c, g] = makeCanvas(cols * cellW, rows * cellH);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < count; i++) {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    g.fillStyle = bg;
    g.fillRect(x, y, cellW, cellH);
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = cellH * 0.06;
      g.strokeRect(x + cellH * 0.05, y + cellH * 0.05, cellW - cellH * 0.1, cellH - cellH * 0.1);
    }
    g.fillStyle = fg;
    g.font = `700 ${Math.floor(cellH * 0.74)}px ${font}`;
    g.fillText(`${prefix}${i + 1}`, x + cellW / 2, y + cellH * 0.55, cellW * 0.92);
  }
  const t = toTexture(c);
  t.anisotropy = 8;
  return { texture: t, cols, rows, uv: (i) => [(i % cols) / cols, 1 - (Math.floor(i / cols) + 1) / rows, 1 / cols, 1 / rows] };
}

// VIP ボックスの窓（暖色の光・人影）
export function makeWindowTexture() {
  const [c, g] = makeCanvas(512, 64);
  g.fillStyle = '#10131c';
  g.fillRect(0, 0, 512, 64);
  const rng = createRng(4);
  for (let i = 0; i < 16; i++) {
    const x = i * 32 + 3;
    const warm = rng.range(0.5, 1);
    g.fillStyle = `rgb(${Math.floor(255 * warm)},${Math.floor(205 * warm)},${Math.floor(140 * warm)})`;
    g.fillRect(x, 10, 26, 42);
    g.fillStyle = 'rgba(20,20,30,0.55)';
    for (let k = 0; k < 3; k++) {
      if (rng.chance(0.5)) g.fillRect(x + 3 + k * 8, 30, 5, 22);
    }
  }
  return toTexture(c, { repeat: true });
}

// 屋根の裏（トラス）
export function makeRoofTexture() {
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#1a1d27';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#2c3142';
  g.lineWidth = 6;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.stroke();
  }
  g.lineWidth = 3;
  for (let i = -256; i <= 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 256, 256);
    g.moveTo(i + 256, 0);
    g.lineTo(i, 256);
    g.stroke();
  }
  return toTexture(c, { repeat: true });
}

// スタンド名（屋根の縁）
export function makeFasciaTexture(text) {
  const [c, g] = makeCanvas(1024, 96);
  g.fillStyle = '#0b1030';
  g.fillRect(0, 0, 1024, 96);
  g.fillStyle = '#ffffff';
  g.font = `700 62px ${FONT_NUM}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, 52);
  g.fillStyle = '#39e6ff';
  g.fillRect(0, 86, 1024, 10);
  return toTexture(c);
}

// 丸いぼかし（照明のハロ）
export function makeHaloTexture() {
  const [c, g] = makeCanvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,250,235,0.55)');
  grad.addColorStop(0.5, 'rgba(255,240,210,0.12)');
  grad.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c);
}

// 夜空（上ほど暗い + 地平の街あかり）
export function makeSkyTexture() {
  const [c, g] = makeCanvas(64, 512);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#02030a');
  grad.addColorStop(0.55, '#0a0f24');
  grad.addColorStop(0.8, '#1d2140');
  grad.addColorStop(1, '#3a2c3c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 512);
  return toTexture(c);
}

export function colorHex(hex) {
  return new THREE.Color(hex);
}
