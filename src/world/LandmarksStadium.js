import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CONFIG } from '../config.js';
import { makeBannerTexture, makeStandCrowdTexture, makeTrackLineTexture, makeCanvas, toTexture, FONT_JP } from './textures.js';
import { createHumanInstances, applyLook, randomSpectatorLook, writeYawMatrix } from './RunnerModel.js';
import { createRng } from '../core/math.js';

// 1500m モード用のランドマーク: スタジアム・トラックのライン・ゲート・鏡のゲート・歩道橋。
// Landmarks.js と同じく「z = 0 が設置地点・前方 = -Z」のローカル座標で組み立てる。
// スタジアムは直線区間に置く前提（コースデータ側でカーブを入れない）。

const HALF = CONFIG.road.halfWidth;
// 客席の段: x0 から外側へ depth ずつ、rise ずつ高くなる（CrowdManager の stadium 配置と共有）
export const STAND = { x0: HALF + CONFIG.road.sidewalk + 1, depth: 1.5, rise: 0.8, y0: 1.1, tiers: 14 };

// トランポリン会場（trampoline/）も同じ材質・部品を使う
export const concrete = new THREE.MeshLambertMaterial({ color: 0x5a5d6a });
export const darkMetal = new THREE.MeshLambertMaterial({ color: 0x1c1e28 });

export function glow(color, boost = 2) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.color.multiplyScalar(boost);
  return m;
}

// 客席の段（蹴上げ = 観客の板 / 踏面 = 座席）を 1 つのジオメトリに
function buildStandGeometry(side, length) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const groups = [[], []];
  const quad = (a, b, c, d, n, uvs, group) => {
    const base = pos.length / 3;
    for (const p of [a, b, c, d]) pos.push(...p);
    for (let k = 0; k < 4; k++) nor.push(...n);
    uv.push(...uvs);
    groups[group].push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const z0 = 0;
  const z1 = -length;
  const rep = length / 16;
  // トラック側を向いた縦の面（表面が内側を向くよう、左右で頂点の順番を変える）
  const wall = (x, ya, yb, group, u) => {
    if (side > 0) quad([x, ya, z0], [x, yb, z0], [x, yb, z1], [x, ya, z1], [-1, 0, 0], [u, 0, u, 1, 0, 1, 0, 0], group);
    else quad([x, ya, z1], [x, yb, z1], [x, yb, z0], [x, ya, z0], [1, 0, 0], [u, 0, u, 1, 0, 1, 0, 0], group);
  };
  for (let k = 0; k < STAND.tiers; k++) {
    const xa = side * (STAND.x0 + k * STAND.depth);
    const xb = side * (STAND.x0 + (k + 1) * STAND.depth);
    const yLow = k === 0 ? 0 : STAND.y0 + (k - 1) * STAND.rise;
    const yTop = STAND.y0 + k * STAND.rise;
    wall(xa, yLow, yTop, 0, rep); // 蹴上げ = 観客
    const lo = Math.min(xa, xb);
    const hi = Math.max(xa, xb);
    quad([lo, yTop, z0], [hi, yTop, z0], [hi, yTop, z1], [lo, yTop, z1], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], 1); // 踏面
  }
  // 最上段の背面の壁
  const yw = STAND.y0 + STAND.tiers * STAND.rise;
  wall(side * (STAND.x0 + STAND.tiers * STAND.depth), yw - STAND.rise, yw + 3, 1, 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([...groups[0], ...groups[1]]);
  geo.addGroup(0, groups[0].length, 0);
  geo.addGroup(groups[0].length, groups[1].length, 1);
  return geo;
}

// 板の観客: 人ごとに（テクスチャの 1/32 ずつ）ぴょこぴょこ跳ねる。盛り上がりは沿道の観客と同じ uniform
export function createStandCrowdMaterial(tex, uniforms) {
  const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x2a2a3a });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uExcite = uniforms.uExcite;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uExcite;')
      .replace(
        '#include <map_fragment>',
        `vec2 cuv = vMapUv;
        float pid = floor(cuv.x * 32.0);
        float hop = max(0.0, sin(uTime * (7.0 + fract(pid * 0.37) * 4.0) + pid * 1.7));
        cuv.y = clamp(cuv.y - hop * (0.06 + uExcite * 0.2), 0.0, 0.999);
        vec4 sampledDiffuseColor = texture2D(map, cuv);
        diffuseColor *= sampledDiffuseColor;`
      );
  };
  mat.customProgramCacheKey = () => 'stand-crowd-v1';
  return mat;
}

function floodlight(side, z, height) {
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, height, 8), darkMetal);
  mast.position.y = height / 2;
  g.add(mast);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(5.5, 3.2, 0.5), darkMetal);
  panel.position.y = height + 1.2;
  g.add(panel);
  const lamps = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 2.7), glow(0xfff6e0, 3.2));
  lamps.position.set(0, height + 1.2, 0.27);
  g.add(lamps);
  g.position.set(side * (STAND.x0 + STAND.tiers * STAND.depth + 3), 0, z);
  // トラックの中央を向く
  g.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  panel.rotation.x = lamps.rotation.x = -0.35;
  return g;
}

export function bigScreen(lines) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(20, 9.5, 0.8), darkMetal);
  g.add(frame);
  const tex = makeBannerTexture(lines, { width: 1024, height: 460, accent: '#ff3d7f', bg: '#060818' });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(19, 8.6), new THREE.MeshBasicMaterial({ map: tex }));
  screen.material.color.setScalar(1.35);
  screen.position.z = 0.42;
  g.add(screen);
  return g;
}

export const stadiumBuilders = {
  // 国立競技場っぽいスタジアム: 両側の客席（板の観客）・屋根・照明塔・大型ビジョン
  stadium(lm, ctx) {
    const { distance } = ctx;
    const length = distance.kmToUnits(lm.until) - distance.kmToUnits(lm.km);
    const g = new THREE.Group();
    const uniforms = ctx.crowdMaterial?.userData.uniforms ?? { uTime: { value: 0 }, uExcite: { value: 0 } };
    const crowdMats = [
      createStandCrowdMaterial(makeStandCrowdTexture(3), uniforms),
      createStandCrowdMaterial(makeStandCrowdTexture(11), uniforms),
    ];
    const seatMat = new THREE.MeshLambertMaterial({ color: 0x33415e });
    for (const side of [-1, 1]) {
      const stand = new THREE.Mesh(buildStandGeometry(side, length), [crowdMats[side > 0 ? 1 : 0], seatMat]);
      stand.frustumCulled = false;
      g.add(stand);
      // 屋根（上の段を覆う、木の格子っぽい縞）
      const roofY = STAND.y0 + STAND.tiers * STAND.rise + 5.5;
      const roofW = STAND.tiers * STAND.depth * 0.8;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.5, length), new THREE.MeshLambertMaterial({ color: 0x3a2c22, emissive: 0x120a06 }));
      roof.position.set(side * (STAND.x0 + STAND.tiers * STAND.depth - roofW / 2 + 1), roofY, -length / 2);
      roof.rotation.z = side * 0.12;
      g.add(roof);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, length), glow(0xfff0d0, 2.4));
      strip.position.set(side * (STAND.x0 + STAND.tiers * STAND.depth * 0.25), roofY - 0.6, -length / 2);
      g.add(strip);
      for (let k = 0; k < 3; k++) g.add(floodlight(side, -((k + 0.5) / 3) * length, 34));
    }
    // 大型ビジョン（左の客席の上）
    const screen = bigScreen(lm.variant === 'finish' ? ['1500m 決勝', 'FINAL STRAIGHT'] : ['1500m 決勝', 'MEN\'S 1500m FINAL']);
    screen.position.set(-(STAND.x0 + STAND.tiers * STAND.depth * 0.55), STAND.y0 + STAND.tiers * STAND.rise + 12, -length * 0.55);
    screen.rotation.y = Math.PI / 2 - 0.25;
    g.add(screen);
    return { group: g };
  },

  // スタートライン（レーン番号つき） / フィニッシュライン（写真判定カメラ・時計つき）
  trackLine(lm, ctx) {
    const g = new THREE.Group();
    const kind = lm.variant === 'finish' ? 'finish' : 'start';
    const tex = makeTrackLineTexture(kind);
    const w = HALF * 2;
    const h = kind === 'finish' ? 3.2 : 2.4;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    line.rotation.x = -Math.PI / 2;
    // start: 画像の上端（線）が s = 0。finish: 画像の中央（線）が s = 0
    line.position.set(0, 0.035, kind === 'finish' ? 0 : h / 2 - 0.12);
    line.renderOrder = 2;
    g.add(line);
    if (kind === 'finish') {
      // 写真判定カメラの塔（右）
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), darkMetal);
      tower.position.set(HALF + 3.8, 3, 0);
      g.add(tower);
      const camBox = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.9), new THREE.MeshLambertMaterial({ color: 0xdadde6 }));
      camBox.position.set(HALF + 3.8, 6.3, 0);
      g.add(camBox);
      const redLamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), glow(0xff2030, 3));
      redLamp.position.set(HALF + 3.3, 6.5, 0);
      g.add(redLamp);
      // 時計（左）: レース時計をそのまま表示
      const [c, cg] = makeCanvas(512, 160);
      const clockTex = toTexture(c);
      const clock = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.6), new THREE.MeshBasicMaterial({ map: clockTex }));
      clock.material.color.setScalar(1.6);
      clock.position.set(-(HALF + 2.8), 3.6, 0.5);
      clock.rotation.y = 0.35;
      const post = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.0, 0.4), darkMetal);
      post.position.set(-(HALF + 2.8), 3.6, 0.25);
      post.rotation.y = 0.35;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), darkMetal);
      leg.position.set(-(HALF + 2.8), 1.3, 0.25);
      g.add(post, clock, leg);
      let acc = 1;
      let last = '';
      return {
        group: g,
        update(dt) {
          acc += dt;
          if (acc < 0.1) return;
          acc = 0;
          const t = ctx.raceTime?.() ?? 0;
          const m = Math.floor(t / 60);
          const s = (t % 60).toFixed(1).padStart(4, '0');
          const text = `${m}:${s}`;
          if (text === last) return;
          last = text;
          cg.fillStyle = '#05060c';
          cg.fillRect(0, 0, 512, 160);
          cg.fillStyle = '#ffcf3a';
          cg.font = 'bold 118px "Chakra Petch", Arial, sans-serif';
          cg.textAlign = 'center';
          cg.textBaseline = 'middle';
          cg.fillText(text, 256, 84);
          clockTex.needsUpdate = true;
        },
      };
    }
    return { group: g };
  },

  // スタジアムの出入口。トラックと公道の境目
  stadiumGate(lm) {
    const g = new THREE.Group();
    const w = (STAND.x0 + 1.5) * 2;
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(3, 11, 4), concrete);
      pillar.position.set(side * (w / 2 + 1.5), 5.5, 0);
      g.add(pillar);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(w + 6, 3.4, 4), concrete);
    lintel.position.y = 12.7;
    g.add(lintel);
    const tex = makeBannerTexture([lm.label ?? 'TOKYO', lm.sub ?? ''], { accent: lm.inbound ? '#ffd23f' : '#39e6ff' });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.0), new THREE.MeshBasicMaterial({ map: tex }));
    banner.material.color.setScalar(1.5);
    banner.position.set(0, 12.7, 2.02);
    g.add(banner);
    return { group: g };
  },

  // 巨大な鏡のゲート（本体は区間の演出側で使う。ここでは枠だけ）
  mirrorGate(lm, ctx) {
    const g = new THREE.Group();
    const w = HALF * 2 + 7;
    const h = 16;
    const gold = new THREE.MeshLambertMaterial({ color: 0xc9a040, emissive: 0x3a2808 });
    const frameParts = [
      [w + 2.4, 1.2, 1.2, 0, h + 0.6],
      [1.2, h + 1.2, 1.2, -w / 2 - 0.6, h / 2],
      [1.2, h + 1.2, 1.2, w / 2 + 0.6, h / 2],
    ];
    for (const [bw, bh, bd, x, y] of frameParts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), gold);
      m.position.set(x, y, 0);
      g.add(m);
    }
    const crest = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.35, 8, 20), gold);
    crest.position.set(0, h + 2.4, 0);
    g.add(crest);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 1.6),
      new THREE.MeshBasicMaterial({ map: makeBannerTexture([lm.exit ? '出口 ─ EXIT' : '鏡 ─ MIRROR'], { width: 1024, height: 180, accent: '#ffd23f' }) })
    );
    sign.material.color.setScalar(1.4);
    sign.position.set(0, h + 0.6, 0.65);
    g.add(sign);
    // 本物の鏡（近づいた時だけ映す。遠くでは銀色の板）
    const mirror = new Reflector(new THREE.PlaneGeometry(w, h), {
      textureWidth: 512,
      textureHeight: Math.round((512 * h) / w),
      color: 0xb4c2da,
      clipBias: 0.003,
    });
    mirror.position.y = h / 2;
    mirror.visible = false;
    g.add(mirror);
    const silverMat = new THREE.MeshBasicMaterial({ color: 0x6c7a98, transparent: true, opacity: 0.9 });
    silverMat.color.multiplyScalar(1.3);
    const silver = new THREE.Mesh(new THREE.PlaneGeometry(w, h), silverMat);
    silver.position.y = h / 2;
    g.add(silver);
    return {
      group: g,
      exit: !!lm.exit,
      // rel = プレイヤーの s − 鏡の s（手前がマイナス）。通り抜けたら消える
      update(dt, rel = -999) {
        const near = rel > -120 && rel < 0.3 && (ctx.quality?.() ?? 2) >= 1;
        mirror.visible = near;
        silver.visible = !near && rel < 0.3;
      },
    };
  },

  // 歩道橋。上にも観客がぎっしり（沿道と同じ人型・同じシェーダー）
  footbridge(lm, ctx) {
    const g = new THREE.Group();
    const span = (HALF + CONFIG.road.sidewalk) * 2 + 4;
    const deckY = 6.2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 0.5, 3.2), new THREE.MeshLambertMaterial({ color: 0x5c6a7a }));
    deck.position.y = deckY;
    g.add(deck);
    const railMat = new THREE.MeshLambertMaterial({ color: 0x8fa0b4, emissive: 0x101820 });
    for (const z of [-1.55, 1.55]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 1.0, 0.12), railMat);
      rail.position.set(0, deckY + 0.75, z);
      g.add(rail);
    }
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, deckY, 0.6), railMat);
      leg.position.set(side * (span / 2 - 1), deckY / 2, 0);
      g.add(leg);
      const stairs = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 9), railMat);
      stairs.position.set(side * (span / 2 + 0.6), deckY / 2, 4);
      stairs.rotation.x = -0.6;
      g.add(stairs);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 1.1),
      new THREE.MeshBasicMaterial({ map: makeBannerTexture(['がんばれ 侍ランナー!!'], { width: 1024, height: 128, accent: '#ff3d7f', font: FONT_JP }) })
    );
    sign.material.color.setScalar(1.3);
    sign.position.set(0, deckY + 0.8, 1.62);
    g.add(sign);
    // 歩道橋の上の観客（沿道と同じ人型・同じ盛り上がりのシェーダー）
    if (ctx.crowdMaterial) {
      const n = 34;
      const people = createHumanInstances(n, ctx.crowdMaterial, 'low');
      const rng = createRng(Math.round(lm.km * 1000));
      const arr = people.instanceMatrix.array;
      for (let i = 0; i < n; i++) {
        const row = i % 2;
        const x = -span / 2 + 1.2 + (i / n) * (span - 2.4) + rng.range(-0.2, 0.2);
        // ランナーが来る側（+z）を向いて手すりに並ぶ
        writeYawMatrix(arr, i, x, deckY + 0.25, 0.9 - row * 0.9, Math.PI + rng.range(-0.4, 0.4), rng.range(0.92, 1.05));
        applyLook(people, i, randomSpectatorLook(rng));
        people.geometry.attributes.iAnim.setXY(i, rng.next(), 1);
      }
      people.instanceMatrix.needsUpdate = true;
      people.frustumCulled = false;
      g.add(people);
    }
    return { group: g, deckY, span };
  },
};
