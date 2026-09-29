// 12 人の出場選手。並び順 = スタートの位置（内側から）。プレイヤーは 6 番目。
//   look: 見た目（ユニフォームの色・肌・髪・体格）。build は runners/runnerBuilder.js
export const RUNNERS = [
  { id: 'HAYAMI', name: '速水', en: 'HAYAMI', bib: 2, personality: 'SPRINTER', look: { top: 0xe8322a, bottom: 0x1a1a22, skin: 0xe0ac85, hair: 0x1a1210, shoe: 0xffd23f, hairStyle: 'short', height: 1.0 } },
  { id: 'ICHIJO', name: '一定', en: 'ICHIJO', bib: 3, personality: 'PACER', look: { top: 0x9aa0ac, bottom: 0x30343e, skin: 0xf1c9a5, hair: 0x2a2a2a, shoe: 0xffffff, hairStyle: 'buzz', height: 1.02 } },
  { id: 'OIKAWA', name: '追川', en: 'OIKAWA', bib: 4, personality: 'CHASER', look: { top: 0x2ecc71, bottom: 0x14301e, skin: 0xc68b62, hair: 0x120d0a, shoe: 0x39e6ff, hairStyle: 'short', height: 0.98 } },
  { id: 'MIE', name: '見栄', en: 'MIE', bib: 5, personality: 'SHOWMAN', look: { top: 0xffd23f, bottom: 0xff3d7f, skin: 0xf1c9a5, hair: 0xd9a441, shoe: 0xff3d7f, hairStyle: 'pompadour', height: 1.03 } },
  { id: 'ASEDA', name: '焦田', en: 'ASEDA', bib: 6, personality: 'PANIC', look: { top: 0xff7a2a, bottom: 0x2a1a10, skin: 0xe8b894, hair: 0x3a2412, shoe: 0xffffff, hairStyle: 'messy', height: 0.97 } },
  { id: 'SAMURAI', name: '侍', en: 'SAMURAI', bib: 1, personality: 'PLAYER', isPlayer: true, look: { samurai: true } },
  { id: 'OSOZAKI', name: '遅咲', en: 'OSOZAKI', bib: 7, personality: 'LATE', look: { top: 0x7a5cff, bottom: 0x1e1840, skin: 0x8d5a3c, hair: 0x0e0a08, shoe: 0x7af0ff, hairStyle: 'buzz', height: 1.05 } },
  { id: 'UTSUGI', name: '映木', en: 'UTSUGI', bib: 8, personality: 'CAMERA', look: { top: 0xf4f4f4, bottom: 0xd8102c, skin: 0xf1c9a5, hair: 0x241810, shoe: 0xd8102c, hairStyle: 'side', height: 1.0 } },
  { id: 'SHIZUKA', name: '静', en: 'SHIZUKA', bib: 9, personality: 'QUIET', look: { top: 0x1f2f6a, bottom: 0x10162e, skin: 0xe0ac85, hair: 0x101010, shoe: 0x9aa0ac, hairStyle: 'long', height: 0.96 } },
  { id: 'KONTON', name: '混沌', en: 'KONTON', bib: 10, personality: 'CHAOS', look: { top: 0xc733ff, bottom: 0x39e6ff, skin: 0xf1c9a5, hair: 0x39e6ff, shoe: 0xc733ff, hairStyle: 'spiky', height: 1.01 } },
  { id: 'KAZEYOKE', name: '風除', en: 'KAZEYOKE', bib: 11, personality: 'DRAFTER', look: { top: 0x18a3a3, bottom: 0x0e2a2a, skin: 0xc68b62, hair: 0x1a1210, shoe: 0xffffff, hairStyle: 'short', height: 0.99 } },
  { id: 'NAZO', name: '？？？', en: 'NAZO', bib: 12, personality: 'MYSTERY', look: { top: 0x15151c, bottom: 0x15151c, skin: 0xe8b894, hair: 0x15151c, shoe: 0x15151c, hairStyle: 'hood', height: 1.0 } },
];
