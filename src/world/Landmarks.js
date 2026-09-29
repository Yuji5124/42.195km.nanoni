import * as THREE from 'three';
import {
  makeBannerTexture,
  makeRoadSignTexture,
  makeVisionTexture,
  makeBackdrop2DTexture,
  makeFinishLineTexture,
  makeGroundSectionTexture,
} from './textures.js';
import { CONFIG } from '../config.js';
import { stadiumBuilders } from './LandmarksStadium.js';

// 距離に紐づくランドマーク（スタート/km/ゴールアーチ、都庁、大ガード、巨大ビジョン…）。
// すべて「z = 0 が設置地点」のローカル座標で組み立て、TokyoChunkManager が配置する。

const steel = new THREE.MeshLambertMaterial({ color: 0x2a2d3a });
const darkSteel = new THREE.MeshLambertMaterial({ color: 0x15161d });

function glowBasic(tex, boost = 1.4, opts = {}) {
  const m = new THREE.MeshBasicMaterial({ map: tex, ...opts });
  m.color.setScalar(boost);
  return m;
}

function gantry(width, height, beamH, beamMat) {
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, height, 0.8), steel);
    p.position.set(side * (width / 2), height / 2, 0);
    g.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 0.8, beamH, 0.9), beamMat ?? darkSteel);
  beam.position.y = height + beamH / 2 - 0.2;
  g.add(beam);
  return g;
}

function bannerPlane(tex, w, h, y, boost) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowBasic(tex, boost));
  m.position.set(0, y, 0.47);
  return m;
}

const halfRoad = CONFIG.road.halfWidth;

const builders = {
  startArch() {
    const g = gantry(halfRoad * 2 + 2.4, 7, 2.6);
    g.add(bannerPlane(makeBannerTexture(['START', '東京都庁前 ─ 42.195km、なのに。'], { accent: '#ff3d7f' }), 16.5, 2.3, 8.1, 1.5));
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(halfRoad * 2, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.03;
    g.add(line);
    return { group: g };
  },

  kmArch(lm) {
    const g = gantry(halfRoad * 2 + 1.6, 6.2, 1.8);
    g.add(bannerPlane(makeBannerTexture([lm.label], { accent: '#ffd23f', fg: '#ffd23f', width: 512, height: 128 }), 7, 1.75, 7.0, 1.6));
    return { group: g };
  },

  roadSign(lm) {
    const g = gantry(halfRoad * 2 + 1.2, 6.6, 0.4);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 2.5),
      new THREE.MeshLambertMaterial({ map: makeRoadSignTexture(lm.lines), emissive: 0x0a2a18 })
    );
    sign.position.set(0, 8.0, 0.5);
    g.add(sign);
    return { group: g };
  },

  goalArch(lm) {
    const g = gantry(halfRoad * 2 + 2.4, 7.5, 3.0);
    g.add(bannerPlane(makeBannerTexture(['FINISH', lm.label ?? '仮ゴール'], { accent: '#ffd23f' }), 16.5, 2.7, 8.8, 1.7));
    const lineMat = new THREE.MeshBasicMaterial({ map: makeFinishLineTexture() });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(halfRoad * 2, 1.2), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.03;
    g.add(line);
    // ゴールテープ
    const tape = new THREE.Mesh(
      new THREE.BoxGeometry(halfRoad * 2 + 1.6, 0.08, 0.04),
      new THREE.MeshBasicMaterial({ color: 0xff2a4a })
    );
    tape.position.y = 1.25;
    tape.name = 'tape';
    g.add(tape);
    // 横一列の係員（普通のゴールらしさ）
    const staffMat = new THREE.MeshLambertMaterial({ color: 0xffd23f });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.4), staffMat);
      s.position.set((i < 3 ? -1 : 1) * (halfRoad + 1.3 + (i % 3) * 0.9), 0.85, -6);
      g.add(s);
    }
    return {
      group: g,
      breakTape() {
        tape.visible = false;
      },
    };
  },

  tocho(lm) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x8c93a8, emissive: 0x141a2a });
    const lit = new THREE.MeshBasicMaterial({ color: 0xffe6a8 });
    for (const dz of [-14, 14]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(18, 170, 18), mat);
      t.position.set(0, 85, dz);
      g.add(t);
      const top = new THREE.Mesh(new THREE.BoxGeometry(12, 26, 12), mat);
      top.position.set(0, 183, dz);
      g.add(top);
      for (let y = 20; y < 170; y += 9) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(18.2, 0.8, 18.2), lit);
        band.position.set(0, y, dz);
        g.add(band);
      }
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(22, 60, 48), mat);
    base.position.set(0, 30, 0);
    g.add(base);
    g.position.x = (lm.side ?? -1) * 75;
    return { group: g };
  },

  vision(lm) {
    const g = new THREE.Group();
    const side = lm.side ?? 1;
    const b = new THREE.Mesh(new THREE.BoxGeometry(14, 34, 30), new THREE.MeshLambertMaterial({ color: 0x1b1a24 }));
    b.position.set(side * 19.5, 17, 0);
    g.add(b);
    const screenMat = glowBasic(makeVisionTexture(lm.text ?? '走れば\nなんとかなる。'), 1.3);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), screenMat);
    screen.position.set(side * 12.4, 18, 0);
    screen.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(screen);
    return {
      group: g,
      side,
      // 柴犬が画面から出ていったあと
      setAway() {
        screenMat.map.dispose();
        screenMat.map = makeVisionTexture('柴犬は\nただいま外出中', { away: true });
        screenMat.needsUpdate = true;
      },
    };
  },

  // 雲の上ステージ（ワールド座標で直接組む: コースのカーブに沿って雲と鳥居を並べる）
  sky(lm, { path, distance }) {
    const g = new THREE.Group();
    const a = distance.kmToUnits(lm.km);
    const b = distance.kmToUnits(lm.until);
    const v = new THREE.Vector3();
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // 雲: つぶした多面体を寄せ集める
    const n = 520;
    const clouds = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8a96b8 }),
      n
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const s = a - 80 + rnd() * (b - a + 160);
      const side = rnd() < 0.5 ? -1 : 1;
      const low = rnd() < 0.72;
      const lat = side * (low ? 11 + rnd() * 140 : 25 + rnd() * 180);
      const y = low ? -8 + rnd() * 6 : 12 + rnd() * 30;
      path.toWorld(s, lat, y, v);
      const size = low ? 5 + rnd() * 12 : 4 + rnd() * 9;
      sc.set(size * (1.2 + rnd()), size * (0.35 + rnd() * 0.3), size * (1 + rnd()));
      m.compose(v, q.identity(), sc);
      clouds.setMatrixAt(i, m);
    }
    g.add(clouds);
    // 空に浮かぶ鳥居
    const red = new THREE.MeshLambertMaterial({ color: 0xe8322a, emissive: 0x3a0806 });
    const black = new THREE.MeshLambertMaterial({ color: 0x151515 });
    for (let s = a + 50; s < b - 30; s += 75) {
      const torii = new THREE.Group();
      for (const x of [-8.6, 8.6]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 9, 10), red);
        post.position.set(x, 4.5, 0);
        torii.add(post);
      }
      const nuki = new THREE.Mesh(new THREE.BoxGeometry(19, 0.6, 0.6), red);
      nuki.position.y = 7.2;
      const kasagi = new THREE.Mesh(new THREE.BoxGeometry(22, 0.8, 1.2), black);
      kasagi.position.y = 9.2;
      const shimaki = new THREE.Mesh(new THREE.BoxGeometry(20.5, 0.6, 1.0), red);
      shimaki.position.y = 8.6;
      torii.add(nuki, kasagi, shimaki);
      path.toWorld(s, 0, 0, torii.position);
      torii.rotation.y = path.heading(s);
      g.add(torii);
    }
    // 飛行船「がんばれ」
    const blimp = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshLambertMaterial({ color: 0xf2f2f2, emissive: 0x333a48 }));
    hull.scale.set(4, 4, 13);
    blimp.add(hull);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.4), glowBasic(makeBannerTexture(['がんばれ 侍ランナー'], { accent: '#ff3d7f' }), 1.2, { side: THREE.DoubleSide }));
    banner.position.set(4.1, 0, 0);
    banner.rotation.y = Math.PI / 2;
    blimp.add(banner);
    const bs = a + (b - a) * 0.55;
    path.toWorld(bs, -34, 26, blimp.position);
    blimp.rotation.y = path.heading(bs);
    g.add(blimp);
    let t = 0;
    return {
      group: g,
      worldSpace: true,
      update(dt) {
        t += dt;
        blimp.position.y = 26 + Math.sin(t * 0.6) * 1.2;
      },
    };
  },

  // 浅草・雷門: 赤い門と大提灯（ランナーは提灯の下をくぐる）
  kaminarimon() {
    const g = new THREE.Group();
    const red = new THREE.MeshLambertMaterial({ color: 0xc8202a, emissive: 0x2a0406 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x2a2c33 });
    for (const x of [-9.6, 9.6]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 8, 1.4), red);
      p.position.set(x, 4, 0);
      g.add(p);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(20.6, 1, 1.4), red);
    lintel.position.y = 7.6;
    const roof1 = new THREE.Mesh(new THREE.BoxGeometry(25, 1.2, 7), roofMat);
    roof1.position.y = 8.7;
    const roof2 = new THREE.Mesh(new THREE.BoxGeometry(22, 1.0, 5.5), roofMat);
    roof2.position.y = 9.9;
    g.add(lintel, roof1, roof2);
    // 大提灯「雷門」
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const x2 = c.getContext('2d');
    x2.fillStyle = '#c41e26';
    x2.fillRect(0, 0, 1024, 512);
    x2.fillStyle = '#141414';
    x2.fillRect(0, 0, 1024, 36);
    x2.fillRect(0, 476, 1024, 36);
    x2.font = '220px "Dela Gothic One", "Hiragino Mincho ProN", serif';
    x2.textAlign = 'center';
    x2.textBaseline = 'middle';
    x2.fillText('雷門', 256, 262);
    x2.fillText('雷門', 768, 262);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const lanternMat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x551010 });
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 3.6, 24), lanternMat);
    lantern.position.y = 5.2;
    g.add(lantern);
    const capMat = new THREE.MeshLambertMaterial({ color: 0x151515 });
    for (const y of [3.35, 7.05]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.25, 20), capMat);
      cap.position.y = y;
      g.add(cap);
    }
    return { group: g };
  },

  // 東京ドーム（水道橋）: 白い屋根の低いドーム
  dome(lm) {
    const g = new THREE.Group();
    const side = lm.side ?? 1;
    const roof = new THREE.Mesh(
      new THREE.SphereGeometry(40, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xe8ecf4, emissive: 0x2a3348 })
    );
    roof.scale.set(1, 0.32, 1);
    roof.position.set(side * 70, 9, 0);
    g.add(roof);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 9, 28, 1, true), new THREE.MeshLambertMaterial({ color: 0x8a90a0, side: THREE.DoubleSide }));
    wall.position.set(side * 70, 4.5, 0);
    g.add(wall);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(40.2, 0.4, 6, 40), new THREE.MeshBasicMaterial({ color: 0x39e6ff }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(side * 70, 9, 0);
    g.add(ring);
    return { group: g };
  },

  // 交差点の信号（停止線 = z 0）。GagDirector が setLight で点灯を切り替える
  signal() {
    const g = new THREE.Group();
    const road = new THREE.Mesh(new THREE.PlaneGeometry(130, 12), new THREE.MeshLambertMaterial({ color: 0x1b1c22 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.015, -11);
    g.add(road);
    const stop = new THREE.Mesh(new THREE.PlaneGeometry(halfRoad * 2, 0.5), new THREE.MeshBasicMaterial({ color: 0xf0f0f0 }));
    stop.rotation.x = -Math.PI / 2;
    stop.position.set(0, 0.03, 0);
    g.add(stop);
    const tomare = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 3),
      new THREE.MeshBasicMaterial({ map: makeBannerTexture(['止まれ'], { width: 512, height: 256, bg: 'rgba(0,0,0,0)', accent: 'rgba(0,0,0,0)', fg: '#f4f4f4' }), transparent: true })
    );
    tomare.rotation.x = -Math.PI / 2;
    tomare.position.set(0, 0.03, 4.5);
    g.add(tomare);

    const frame = gantry(halfRoad * 2 + 1.6, 6.4, 0.5);
    frame.position.z = -3;
    g.add(frame);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.9, 0.9), darkSteel);
    housing.position.set(0, 8.0, -3);
    g.add(housing);
    const colors = { green: 0x19e07a, yellow: 0xffc21a, red: 0xff2a2a };
    const lamps = {};
    ['green', 'yellow', 'red'].forEach((name, i) => {
      const mat = new THREE.MeshBasicMaterial({ color: colors[name] });
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.72, 20), mat);
      lamp.position.set(-1.75 + i * 1.75, 8.0, -2.54);
      g.add(lamp);
      lamps[name] = mat;
    });
    const set = (state) => {
      for (const [name, mat] of Object.entries(lamps)) {
        mat.color.setHex(colors[name]).multiplyScalar(name === state ? 2.4 : 0.12);
      }
    };
    set('green');
    return { group: g, setLight: set };
  },

  overpass(lm) {
    const g = new THREE.Group();
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(70, 2.2, 9), darkSteel);
    bridge.position.y = 7.4;
    g.add(bridge);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(70.2, 0.5, 9.2), new THREE.MeshBasicMaterial({ color: 0x8a8f99 }));
    stripe.position.y = 6.6;
    g.add(stripe);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 1.6),
      glowBasic(makeBannerTexture([lm.label ?? '新宿大ガード'], { width: 512, height: 96, accent: '#39e6ff' }), 1.2)
    );
    label.position.set(0, 7.4, 4.52);
    g.add(label);
    for (const x of [-halfRoad - 2.2, halfRoad + 2.2]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(1.4, 6.4, 7), steel);
      pier.position.set(x, 3.2, 0);
      g.add(pier);
    }
    if (lm.highway) return overpassHighway(g);
    // 山手線（ウグイス色）
    const train = new THREE.Group();
    const carMat = new THREE.MeshLambertMaterial({ color: 0xc8ccd4 });
    const green = new THREE.MeshBasicMaterial({ color: 0x7ac943 });
    const win = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
    for (let i = 0; i < 4; i++) {
      const car = new THREE.Mesh(new THREE.BoxGeometry(19, 3, 3), carMat);
      car.position.x = i * 20;
      train.add(car);
      const band = new THREE.Mesh(new THREE.BoxGeometry(19.05, 0.4, 3.05), green);
      band.position.set(i * 20, -0.4, 0);
      train.add(band);
      const w = new THREE.Mesh(new THREE.BoxGeometry(17, 0.8, 3.08), win);
      w.position.set(i * 20, 0.6, 0);
      train.add(w);
    }
    train.position.set(-120, 10.1, 0);
    g.add(train);
    let tx = -120;
    return {
      group: g,
      update(dt) {
        tx += dt * 32;
        if (tx > 90) tx = -170;
        train.position.x = tx;
      },
    };
  },

  // 横スクロール区間: 遠景のドット絵 + 手前の「地面の断面」（2D 横スクロールの床）
  backdrop2d() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ map: makeBackdrop2DTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false });
    // 望遠カメラ（FOV 9.5°、距離 ≒ 250）から全体が見える大きさ
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(92, 30), mat);
    plane.rotation.y = Math.PI / 2;
    plane.position.set(-170, 10, 0);
    plane.renderOrder = -1;
    g.add(plane);

    const groundMat = new THREE.MeshBasicMaterial({ map: makeGroundSectionTexture(), transparent: true, opacity: 0, fog: false });
    groundMat.map.repeat.set(40, 4);
    // near クリップ面（プレイヤー + 3.2）のすぐ奥。地面より下だけを埋める
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 16), groundMat);
    ground.rotation.y = Math.PI / 2;
    ground.position.set(CONFIG.road.halfWidth - 0.2, -8, 0);
    g.add(ground);
    return {
      group: g,
      followsPlayer: true,
      setOpacity(a) {
        mat.opacity = a;
        groundMat.opacity = a;
        plane.visible = ground.visible = a > 0.01;
      },
    };
  },
};

// 日本橋の上を走る首都高: 高架の上を車が流れる
function overpassHighway(g) {
  const colors = [0xffc21a, 0xeeeeee, 0xd02030, 0x2050c0, 0x30a060];
  const cars = [];
  for (let i = 0; i < 8; i++) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.4, 1.8), new THREE.MeshLambertMaterial({ color: colors[i % colors.length], emissive: 0x111111 }));
    car.position.set(-70 + i * 18, 9.2, i % 2 ? 2 : -2);
    g.add(car);
    cars.push({ mesh: car, dir: i % 2 ? -1 : 1 });
  }
  return {
    group: g,
    update(dt) {
      for (const c of cars) {
        c.mesh.position.x += c.dir * 22 * dt;
        if (c.mesh.position.x > 75) c.mesh.position.x = -75;
        if (c.mesh.position.x < -75) c.mesh.position.x = 75;
      }
    },
  };
}

Object.assign(builders, stadiumBuilders);

export function buildLandmark(lm, ctx = {}) {
  const fn = builders[lm.type];
  if (!fn) {
    console.warn('unknown landmark', lm.type);
    return null;
  }
  return fn(lm, ctx);
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m === steel || m === darkSteel) continue;
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}
