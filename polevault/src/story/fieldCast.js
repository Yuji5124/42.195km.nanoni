import { SKINS, HAIRS } from '../people/Figure.js';

// フィールドにいつもいる人の見た目（審判・スタッフ・写真記者・ベンチの外の女子選手）
export const LOOKS_FIELD = {
  judge: { female: false, build: 'adult', hair: 'short', top: 'blazer', color: 0x1b2a5a, pants: 0x1b2a5a, hairColor: 0x3a3030, skin: SKINS[1], extras: ['glasses'], acc: 0xf4f4f4 },
  judge2: { female: true, build: 'slim', hair: 'pony', top: 'blazer', color: 0x1b2a5a, pants: 0x1b2a5a, hairColor: HAIRS[0], skin: SKINS[0], extras: [], acc: 0xf4f4f4 },
  official: { female: false, build: 'adult', hair: 'short', top: 'jacket', color: 0x1b2a5a, pants: 0x2a2a34, hairColor: HAIRS[0], skin: SKINS[2], extras: ['cap'], acc: 0xf4f4f4 },
  crew: { female: false, build: 'adult', hair: 'short', top: 'long', color: 0xf2c12e, pants: 0x2a2a34, hairColor: HAIRS[0], skin: SKINS[1], extras: ['cap'], acc: 0x1b2a5a },
  photog: { female: false, build: 'big', hair: 'short', top: 'jacket', color: 0x2a2a2e, pants: 0x2a2a30, hairColor: HAIRS[1], skin: SKINS[1], extras: [], acc: 0xff6a1f },
  lover: { female: true, build: 'slim', hair: 'pony', top: 'jacket', color: 0xd0283c, pants: 0x1a1c24, hairColor: 0xc9a25a, skin: SKINS[0], extras: [], acc: 0xffffff },
};
