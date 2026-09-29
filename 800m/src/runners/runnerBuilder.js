import { PartBuilder, G, LEG, ARM } from './proceduralRig.js';

// 見た目の組み立て。骨の上にローポリの丸いパーツを載せる（ボクセル人間にはしない）。
//   samurai: 髷・鉢巻・羽織（背中に家紋）・腰の刀・軽い甲冑（肩当て・小手・すね当て）・ランニングシューズ
//   athlete: ランニングシャツとショーツ、髪型いろいろ、ゼッケン
//   stick:   棒人間（同じ骨に結んだ細い棒 +丸い頭）

const SAMURAI = {
  skin: 0xe8b38c,
  hair: 0x16121a,
  kimono: 0xf0ece2,
  haori: 0x1d2c5e,
  haoriEdge: 0xc9a040,
  mon: 0xf4efe0,
  hakama: 0x23232e,
  armor: 0x2a1f24,
  armorRed: 0xa51f2b,
  gold: 0xcaa244,
  steel: 0x8c93a0,
  band: 0xffffff,
  shoe: 0xe8322a,
  sole: 0xf6f6f6,
  saya: 0x101014,
  tsuka: 0x1b2552,
  eye: 0x120d12,
};

function head(pb, skin, hair) {
  pb.add(G.sph(0.118, 14, 10), 'head', skin, { at: [0, 0.1, 0], s: [0.94, 1.1, 1.02] })
    .add(G.sph(0.068, 10, 6), 'head', skin, { at: [0, 0.045, -0.035], s: [1, 0.8, 1] })
    .add(G.box(0.028, 0.014, 0.01), 'head', SAMURAI.eye, { at: [-0.041, 0.102, -0.115] })
    .add(G.box(0.028, 0.014, 0.01), 'head', SAMURAI.eye, { at: [0.041, 0.102, -0.115] })
    .add(G.box(0.044, 0.012, 0.012), 'head', hair, { at: [-0.044, 0.126, -0.112], r: [0, 0, -0.25] })
    .add(G.box(0.044, 0.012, 0.012), 'head', hair, { at: [0.044, 0.126, -0.112], r: [0, 0, 0.25] })
    .add(G.box(0.02, 0.034, 0.022), 'head', skin, { at: [0, 0.083, -0.122] })
    .add(G.box(0.04, 0.008, 0.006), 'head', 0x6a2a2a, { at: [0, 0.045, -0.112] })
    .add(G.sph(0.023, 6, 5), 'head', skin, { at: [-0.113, 0.09, 0.005], s: [0.6, 1, 1] })
    .add(G.sph(0.023, 6, 5), 'head', skin, { at: [0.113, 0.09, 0.005], s: [0.6, 1, 1] });
}

function hairStyle(pb, style, color) {
  switch (style) {
    case 'buzz':
      pb.add(G.sph(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 'head', color, { at: [0, 0.108, 0.004], r: [0.35, 0, 0], s: [0.97, 1.06, 1.04] });
      break;
    case 'long':
      pb.add(G.sph(0.128, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 'head', color, { at: [0, 0.11, 0.008], r: [0.4, 0, 0], s: [1, 1.12, 1.08] });
      pb.add(G.box(0.2, 0.26, 0.05), 'head', color, { at: [0, -0.02, 0.1] });
      break;
    case 'pompadour':
      pb.add(G.sph(0.126, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 'head', color, { at: [0, 0.11, 0.008], r: [0.4, 0, 0], s: [0.98, 1.1, 1.06] });
      pb.add(G.cap(0.07, 0.08), 'head', color, { at: [0, 0.22, -0.06], r: [1.2, 0, 0] });
      break;
    case 'spiky':
      pb.add(G.sph(0.126, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 'head', color, { at: [0, 0.11, 0.008], r: [0.4, 0, 0], s: [0.98, 1.1, 1.06] });
      for (let k = 0; k < 5; k++) pb.add(G.cyl(0, 0.035, 0.12, 5), 'head', color, { at: [(k - 2) * 0.045, 0.24, 0.01], r: [0.2, 0, (k - 2) * 0.3] });
      break;
    case 'hood':
      pb.add(G.sph(0.14, 14, 10), 'head', color, { at: [0, 0.11, 0.02], s: [1, 1.12, 1.08] });
      pb.add(G.box(0.16, 0.12, 0.02), 'head', 0x05050a, { at: [0, 0.08, -0.13] });
      break;
    case 'messy':
      pb.add(G.sph(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), 'head', color, { at: [0, 0.112, 0.01], r: [0.35, 0.3, 0.1], s: [1, 1.12, 1.08] });
      break;
    case 'side':
    case 'short':
    default:
      pb.add(G.sph(0.127, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 'head', color, { at: [0, 0.112, 0.008], r: [0.42, style === 'side' ? 0.3 : 0, 0], s: [0.97, 1.1, 1.06] });
  }
}

function neckTorsoArmsLegs(pb, c) {
  pb.add(G.cyl(0.048, 0.056, 0.11, 8), 'neck', c.skin, { at: [0, 0.03, 0.004] });
  // 胴（ランニングシャツ）
  pb.add(G.cyl(0.19, 0.155, 0.34, 12), 'chest', c.top, { at: [0, 0.1, 0], s: [1, 1, 0.66] });
  pb.add(G.sph(0.19, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 'chest', c.top, { at: [0, 0.26, 0], s: [1, 0.34, 0.66] });
  pb.add(G.cyl(0.155, 0.165, 0.16, 12), 'spine', c.top, { at: [0, 0.06, 0], s: [1, 1, 0.7] });
  // ゼッケン
  pb.add(G.box(0.15, 0.11, 0.01), 'chest', 0xf6f6f0, { at: [0, 0.07, -0.116] });
  // 腰（ショーツ）
  pb.add(G.cyl(0.16, 0.18, 0.2, 12), 'pelvis', c.bottom, { at: [0, -0.02, 0], s: [1, 1, 0.76] });
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    pb.add(G.sph(0.06, 8, 6), `upperArm.${side}`, c.skin);
    pb.limb(`upperArm.${side}`, ARM.upper, 0.052, 0.042, c.skin, 8);
    pb.add(G.sph(0.045, 8, 6), `lowerArm.${side}`, c.skin);
    pb.limb(`lowerArm.${side}`, ARM.lower, 0.041, 0.032, c.skin, 8);
    pb.add(G.sph(0.045, 8, 6), `hand.${side}`, c.skin, { at: [0, -0.035, -0.005], s: [0.9, 1.05, 1.1] });
    // ショーツの脚 + 太もも
    pb.limb(`upperLeg.${side}`, 0.2, 0.1, 0.095, c.bottom, 10);
    pb.limb(`upperLeg.${side}`, LEG.thigh, 0.085, 0.06, c.skin, 9);
    pb.add(G.sph(0.058, 8, 6), `lowerLeg.${side}`, c.skin);
    pb.limb(`lowerLeg.${side}`, LEG.shin, 0.056, 0.038, c.skin, 8);
    // シューズ
    pb.add(G.box(0.1, 0.03, 0.27), `foot.${side}`, 0xf4f4f4, { at: [0, -LEG.ankle + 0.015, -0.055] });
    pb.add(G.cap(0.042, 0.16, 6), `foot.${side}`, c.shoe, { at: [0, -LEG.ankle + 0.05, -0.05], r: [Math.PI / 2, 0, 0], s: [1.05, 1, 0.9] });
    void sx;
  }
}

export function buildAthlete(skel, look) {
  const pb = new PartBuilder(skel);
  const c = { skin: look.skin, top: look.top, bottom: look.bottom, shoe: look.shoe };
  head(pb, look.skin, look.hair);
  hairStyle(pb, look.hairStyle, look.hair);
  neckTorsoArmsLegs(pb, c);
  return pb.build();
}

export function buildSamurai(skel) {
  const c = SAMURAI;
  const pb = new PartBuilder(skel);
  head(pb, c.skin, c.hair);
  // 髪: 月代（そり上げ）風に前は肌、横と後ろに髪
  pb.add(G.sph(0.125, 14, 8, 0, Math.PI * 2, Math.PI * 0.25, Math.PI * 0.4), 'head', c.hair, { at: [0, 0.1, 0.012], r: [0.2, 0, 0], s: [0.98, 1.12, 1.07] });
  pb.add(G.sph(0.1, 10, 8), 'head', c.hair, { at: [0, 0.08, 0.06], s: [1.05, 1.05, 0.9] });
  // 鉢巻（白）と結び目
  pb.add(G.cyl(0.128, 0.13, 0.034, 16, true), 'head', c.band, { at: [0, 0.148, 0.006], s: [0.97, 1, 1.08] });
  pb.add(G.box(0.05, 0.044, 0.035), 'head', c.band, { at: [0, 0.148, 0.138] });
  // 髷（ばねの骨に結ぶ）
  pb.add(G.cap(0.03, 0.12, 6), 'topknot', c.hair, { at: [0, 0.02, -0.04], r: [Math.PI / 2 - 0.25, 0, 0] });
  pb.add(G.cyl(0.032, 0.032, 0.025, 8), 'topknot', c.band, { at: [0, 0.0, 0.02], r: [Math.PI / 2, 0, 0] });
  // 鉢巻の尾
  pb.add(G.box(0.032, 0.17, 0.006), 'bandTail1', c.band, { at: [-0.012, -0.085, 0] });
  pb.add(G.box(0.03, 0.14, 0.006), 'bandTail2', c.band, { at: [-0.012, -0.07, 0] });
  pb.add(G.box(0.03, 0.15, 0.006), 'bandTail1', c.band, { at: [0.015, -0.075, 0], r: [0, 0, 0.12] });

  pb.add(G.cyl(0.048, 0.056, 0.11, 8), 'neck', c.skin, { at: [0, 0.03, 0.004] });
  // 小袖（白）の胴と、羽織（紺・金の縁）
  pb.add(G.cyl(0.19, 0.155, 0.34, 12), 'chest', c.kimono, { at: [0, 0.1, 0], s: [1, 1, 0.66] });
  pb.add(G.cyl(0.155, 0.165, 0.16, 12), 'spine', c.kimono, { at: [0, 0.06, 0], s: [1, 1, 0.7] });
  // 羽織: 前は開いた 2 枚、肩は丸く
  pb.add(G.sph(0.205, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 'chest', c.haori, { at: [0, 0.262, 0], s: [1, 0.36, 0.7] });
  for (const sx of [-1, 1]) {
    pb.add(G.box(0.12, 0.4, 0.03), 'chest', c.haori, { at: [sx * 0.12, 0.08, -0.118], r: [0.05, 0, sx * 0.08] });
    pb.add(G.box(0.02, 0.4, 0.034), 'chest', c.haoriEdge, { at: [sx * 0.06, 0.08, -0.12], r: [0.05, 0, sx * 0.08] });
    pb.add(G.box(0.03, 0.4, 0.25), 'chest', c.haori, { at: [sx * 0.19, 0.08, 0], s: [1, 1, 0.9] });
  }
  // 羽織の背（ばね）と家紋
  pb.add(G.box(0.38, 0.5, 0.03), 'haori', c.haori, { at: [0, -0.25, 0.01] });
  pb.add(G.cyl(0.07, 0.07, 0.01, 16), 'haori', c.mon, { at: [0, -0.12, 0.028], r: [Math.PI / 2, 0, 0] });
  pb.add(G.cyl(0.045, 0.045, 0.012, 16), 'haori', c.haori, { at: [0, -0.12, 0.03], r: [Math.PI / 2, 0, 0] });
  pb.add(G.box(0.38, 0.03, 0.034), 'haori', c.haoriEdge, { at: [0, -0.49, 0.012] });
  // 帯と袴（短め）
  pb.add(G.cyl(0.17, 0.17, 0.08, 12), 'pelvis', c.armorRed, { at: [0, 0.1, 0], s: [1, 1, 0.8] });
  pb.add(G.cyl(0.165, 0.19, 0.22, 12), 'pelvis', c.hakama, { at: [0, -0.02, 0], s: [1, 1, 0.78] });
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    // 腕: 羽織の袖・肩当て・小手・拳
    pb.add(G.sph(0.065, 10, 8), `upperArm.${side}`, c.haori);
    pb.limb(`upperArm.${side}`, ARM.upper, 0.066, 0.058, c.haori, 9);
    pb.add(G.box(0.03, 0.15, 0.14), `upperArm.${side}`, c.armor, { at: [sx * 0.066, -0.07, 0], r: [0, 0, sx * 0.22] });
    pb.add(G.box(0.032, 0.014, 0.142), `upperArm.${side}`, c.gold, { at: [sx * 0.082, -0.143, 0], r: [0, 0, sx * 0.22] });
    pb.add(G.sph(0.052, 8, 6), `lowerArm.${side}`, c.haori);
    pb.limb(`lowerArm.${side}`, ARM.lower, 0.05, 0.04, c.armor, 8);
    pb.add(G.box(0.02, 0.15, 0.05), `lowerArm.${side}`, c.steel, { at: [sx * 0.042, -0.12, 0] });
    pb.add(G.sph(0.046, 8, 6), `hand.${side}`, c.skin, { at: [0, -0.035, -0.005], s: [0.9, 1.05, 1.1] });
    // 脚: 袴の脚 → すね当て → シューズ
    pb.limb(`upperLeg.${side}`, LEG.thigh * 0.95, 0.1, 0.125, c.hakama, 10);
    pb.add(G.cyl(0.12, 0.11, 0.08, 10), `lowerLeg.${side}`, c.hakama, { at: [0, -0.02, 0] });
    pb.limb(`lowerLeg.${side}`, LEG.shin, 0.055, 0.042, c.skin, 8);
    pb.add(G.box(0.1, 0.26, 0.04), `lowerLeg.${side}`, c.armor, { at: [0, -0.2, -0.045] });
    pb.add(G.box(0.1, 0.02, 0.044), `lowerLeg.${side}`, c.gold, { at: [0, -0.07, -0.047] });
    pb.add(G.box(0.105, 0.03, 0.28), `foot.${side}`, c.sole, { at: [0, -LEG.ankle + 0.015, -0.055] });
    pb.add(G.cap(0.043, 0.16, 6), `foot.${side}`, c.shoe, { at: [0, -LEG.ankle + 0.052, -0.05], r: [Math.PI / 2, 0, 0], s: [1.05, 1, 0.9] });
  }
  // 刀（左腰。柄は前上、鞘は後ろ下）: 骨 'sword' のローカル +Z が後ろ
  pb.add(G.cyl(0.02, 0.016, 0.78, 8), 'sword', c.saya, { at: [0, 0, 0.39], r: [Math.PI / 2, 0, 0] });
  pb.add(G.cyl(0.046, 0.046, 0.012, 12), 'sword', c.gold, { at: [0, 0, -0.01], r: [Math.PI / 2, 0, 0] });
  pb.add(G.cyl(0.019, 0.021, 0.24, 8), 'sword', c.tsuka, { at: [0, 0, -0.135], r: [Math.PI / 2, 0, 0] });
  pb.add(G.cyl(0.023, 0.023, 0.02, 8), 'sword', c.gold, { at: [0, 0, -0.26], r: [Math.PI / 2, 0, 0] });
  // ゼッケン（侍にも付ける）
  pb.add(G.box(0.14, 0.1, 0.01), 'chest', 0xf6f6f0, { at: [0, 0.03, -0.115] });
  return pb.build();
}

// 棒人間（「全員棒人間なのに。」）: 同じ骨に結ぶので同じ動きをする
export function buildStick(skel, color = 0xf4f4f4) {
  const pb = new PartBuilder(skel);
  const w = 0.028;
  pb.add(G.sph(0.13, 12, 8), 'head', color, { at: [0, 0.1, 0] });
  pb.limb('neck', 0.1, w, w, color, 5, [0, 0.08, 0]);
  pb.add(G.cyl(w, w, 0.55, 5), 'spine', color, { at: [0, 0.18, 0] });
  for (const side of ['L', 'R']) {
    pb.add(G.cyl(w, w, 0.2, 5), 'chest', color, { at: [side === 'L' ? -0.1 : 0.1, 0.235, 0], r: [0, 0, Math.PI / 2] });
    pb.limb(`upperArm.${side}`, ARM.upper, w, w, color, 5);
    pb.limb(`lowerArm.${side}`, ARM.lower, w, w, color, 5);
    pb.limb(`upperLeg.${side}`, LEG.thigh, w, w, color, 5);
    pb.limb(`lowerLeg.${side}`, LEG.shin, w, w, color, 5);
    pb.add(G.box(0.06, 0.02, 0.16), `foot.${side}`, color, { at: [0, -LEG.ankle + 0.01, -0.04] });
  }
  pb.add(G.cyl(w, w, 0.22, 5), 'pelvis', color, { at: [0, -0.04, 0], r: [0, 0, Math.PI / 2] });
  return pb.build();
}
