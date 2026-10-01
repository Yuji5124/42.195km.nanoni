import * as THREE from 'three';

// 顔の表情アトラス（4 × 4 = 16 表情・1 枚の Canvas）。肌の色は塗らない（透明）→ シェーダーで肌の色と混ぜる。
// 望遠で寄った時に「祈っている」「泣いている」「考えている」が読めることが目的。大きめの目・はっきりした眉と口。
//   セルの中の座標: 横 0〜1 = 顔の右端（見る人の左）〜左端、縦は上が額。目は v ≈ 0.5、口は v ≈ 0.28。

export const EXPR = {
  neutral: 0,
  smile: 1,
  laugh: 2,
  worried: 3,
  cry: 4,
  pray: 5,
  surprised: 6,
  sleep: 7,
  serious: 8,
  sad: 9,
  thoughtful: 10,
  eat: 11,
  love: 12,
  sigh: 13,
  shout: 14,
  blink: 15,
};

const CELL = 128;
let cached = null;

export function getFaceAtlas() {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = CELL * 4;
  const g = c.getContext('2d');
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const INK = '#2a1a16';
  for (const [name, idx] of Object.entries(EXPR)) {
    const ox = (idx % 4) * CELL;
    const oy = Math.floor(idx / 4) * CELL;
    g.save();
    g.translate(ox, oy);
    drawFace(g, name, INK);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  cached = tex;
  return tex;
}

// 1 セルぶん（128px）の顔
function drawFace(g, name, INK) {
  const ex = 22; // 目の中心の左右
  const ey = 62; // 目の高さ
  const my = 92; // 口の高さ
  const cx = 64;
  const eye = (x, open = 1, look = 0) => {
    // 白目 + 黒目 + ハイライト
    const h = 13 * open;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(x, ey, 10, Math.max(1.5, h), 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = INK;
    g.beginPath();
    g.ellipse(x + look, ey + 1, 7.5, Math.max(1.2, h * 0.78), 0, 0, Math.PI * 2);
    g.fill();
    if (open > 0.4) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x + look + 2.6, ey - 4, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  };
  const closed = (x, curve = 1) => {
    // 閉じた目（下向きの弧 = 穏やか / 上向き = 笑い）
    g.strokeStyle = INK;
    g.lineWidth = 3.4;
    g.beginPath();
    g.moveTo(x - 9, ey);
    g.quadraticCurveTo(x, ey + 7 * curve, x + 9, ey);
    g.stroke();
  };
  const brow = (x, tilt, y = ey - 20, w = 10) => {
    // tilt > 0 = 内側が上（困り）/ < 0 = 内側が下（真剣）
    g.strokeStyle = INK;
    g.lineWidth = 4;
    const inner = x < cx ? x + w : x - w;
    const outer = x < cx ? x - w : x + w;
    g.beginPath();
    g.moveTo(outer, y + tilt * 0.4);
    g.lineTo(inner, y - tilt);
    g.stroke();
  };
  const blush = (a = 0.45) => {
    g.fillStyle = `rgba(240, 110, 120, ${a})`;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + s * 32, ey + 17, 9, 5, 0, 0, Math.PI * 2);
      g.fill();
    }
  };
  const mouth = (kind) => {
    g.strokeStyle = INK;
    g.fillStyle = '#6b2030';
    g.lineWidth = 3.2;
    g.beginPath();
    switch (kind) {
      case 'line':
        g.moveTo(cx - 8, my);
        g.lineTo(cx + 8, my);
        g.stroke();
        break;
      case 'smile':
        g.moveTo(cx - 10, my - 2);
        g.quadraticCurveTo(cx, my + 8, cx + 10, my - 2);
        g.stroke();
        break;
      case 'open':
        g.moveTo(cx - 12, my - 4);
        g.quadraticCurveTo(cx, my + 16, cx + 12, my - 4);
        g.closePath();
        g.fill();
        g.stroke();
        break;
      case 'O':
        g.ellipse(cx, my, 6, 8, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        break;
      case 'frown':
        g.moveTo(cx - 9, my + 4);
        g.quadraticCurveTo(cx, my - 5, cx + 9, my + 4);
        g.stroke();
        break;
      case 'wave':
        g.moveTo(cx - 10, my);
        g.quadraticCurveTo(cx - 5, my - 5, cx, my);
        g.quadraticCurveTo(cx + 5, my + 5, cx + 10, my);
        g.stroke();
        break;
      case 'small':
        g.ellipse(cx, my, 3.5, 3, 0, 0, Math.PI * 2);
        g.fill();
        break;
      case 'shout':
        g.moveTo(cx - 14, my - 8);
        g.lineTo(cx + 14, my - 8);
        g.quadraticCurveTo(cx + 12, my + 16, cx, my + 16);
        g.quadraticCurveTo(cx - 12, my + 16, cx - 14, my - 8);
        g.closePath();
        g.fill();
        g.stroke();
        break;
      default:
        break;
    }
  };
  const tears = () => {
    g.fillStyle = 'rgba(120, 200, 255, 0.95)';
    for (const s of [-1, 1]) {
      const x = cx + s * ex;
      g.beginPath();
      g.moveTo(x + s * 5, ey + 8);
      g.quadraticCurveTo(x + s * 11, ey + 26, x + s * 6, ey + 34);
      g.quadraticCurveTo(x + s * 1, ey + 26, x + s * 5, ey + 8);
      g.fill();
    }
  };
  const L = cx - ex; // 見る人の左の目
  const R = cx + ex;
  switch (name) {
    case 'neutral':
      eye(L);
      eye(R);
      brow(L, 0);
      brow(R, 0);
      mouth('line');
      break;
    case 'smile':
      closed(L, -1);
      closed(R, -1);
      brow(L, 1);
      brow(R, 1);
      mouth('smile');
      blush(0.35);
      break;
    case 'laugh':
      closed(L, -1.2);
      closed(R, -1.2);
      brow(L, 2);
      brow(R, 2);
      mouth('open');
      blush(0.45);
      break;
    case 'worried':
      eye(L, 0.9);
      eye(R, 0.9);
      brow(L, 6);
      brow(R, 6);
      mouth('wave');
      break;
    case 'cry':
      closed(L, 1);
      closed(R, 1);
      brow(L, 7);
      brow(R, 7);
      mouth('frown');
      tears();
      blush(0.4);
      break;
    case 'pray':
      closed(L, 1);
      closed(R, 1);
      brow(L, 4);
      brow(R, 4);
      mouth('line');
      break;
    case 'surprised':
      eye(L, 1.15);
      eye(R, 1.15);
      brow(L, 3, ey - 26);
      brow(R, 3, ey - 26);
      mouth('O');
      break;
    case 'sleep':
      closed(L, 0.6);
      closed(R, 0.6);
      mouth('small');
      g.fillStyle = 'rgba(42, 26, 22, 0.8)';
      g.font = 'bold 18px sans-serif';
      g.fillText('z', cx + 30, ey - 22);
      break;
    case 'serious':
      eye(L, 0.75);
      eye(R, 0.75);
      brow(L, -4);
      brow(R, -4);
      mouth('line');
      break;
    case 'sad':
      eye(L, 0.7, 0);
      eye(R, 0.7, 0);
      brow(L, 6);
      brow(R, 6);
      mouth('frown');
      break;
    case 'thoughtful':
      eye(L, 0.8, -3);
      eye(R, 0.8, -3);
      brow(L, -2);
      brow(R, 4, ey - 24);
      mouth('wave');
      break;
    case 'eat':
      eye(L, 0.9);
      eye(R, 0.9);
      brow(L, 1);
      brow(R, 1);
      g.fillStyle = 'rgba(240, 150, 140, 0.55)';
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(cx + s * 20, my - 4, 10, 8, 0, 0, Math.PI * 2);
        g.fill();
      }
      mouth('small');
      break;
    case 'love':
      closed(L, -1);
      closed(R, -1);
      brow(L, 2);
      brow(R, 2);
      mouth('smile');
      blush(0.7);
      break;
    case 'sigh':
      eye(L, 0.45);
      eye(R, 0.45);
      brow(L, 3);
      brow(R, 3);
      mouth('small');
      break;
    case 'shout':
      eye(L, 1);
      eye(R, 1);
      brow(L, -3);
      brow(R, -3);
      mouth('shout');
      break;
    case 'blink':
      closed(L, 0.4);
      closed(R, 0.4);
      brow(L, 0);
      brow(R, 0);
      mouth('line');
      break;
    default:
      break;
  }
}
