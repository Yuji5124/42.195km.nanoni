import * as THREE from 'three';
import { moonTexture, glowTexture, cloudTexture } from '../stadium/textures.js';

// 夜空。撮影の対象として本気で作る（夜空だけを撮っても、場合によっては視聴率が上がる）。
//   ドーム: 天頂の濃紺 → 地平の街明かり（暖色）+ 手続きの星（またたく。望遠で寄っても点のまま = fwidth で画面のピクセル基準）
//   月: 円盤（海のもよう）+ ハロ。ゆっくり昇る（3 分で少しだけ誇張）。雲が前を通ると暗くなる
//   雲: 大きな板（fbm のかたまり）。ゆっくり流れる。下側はスタジアムの照明で暖色に照らされる
//   飛行機（赤・緑・白の点滅）/ 流れ星（まれ）
// 方角: カメラ（撮影台）から見て、バーの少し上に月が来るように置く（クライマックスの構図）。

const R = 880;

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const DOME_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform vec3 uMoonDir;
uniform float uMoonLight;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 zen = vec3(0.004, 0.008, 0.026);
  vec3 hor = vec3(0.022, 0.03, 0.055);
  vec3 col = mix(hor, zen, pow(h, 0.5));
  // 街明かり（地平の暖色）
  col += vec3(0.045, 0.026, 0.016) * exp(-h * 10.0);
  // 月のまわりの明るさ
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.05, 0.055, 0.075) * pow(md, 24.0) * uMoonLight;
  col += vec3(0.02, 0.022, 0.03) * pow(md, 4.0) * uMoonLight;
  // 星: 方向の格子（細かい）ごとに 1 つ。大きさは画面のピクセルで（寄っても点のまま）
  float sc = 360.0;
  vec3 g = d * sc;
  vec3 cell = floor(g);
  vec3 f = g - cell;
  float rnd = hash(cell);
  float star = 0.0;
  if (rnd > 0.975) {
    vec3 c = vec3(hash(cell + 1.7), hash(cell + 3.1), hash(cell + 5.3)) * 0.6 + 0.2;
    vec3 dd = (f - c);
    float px = max(fwidth(g.x) + fwidth(g.y), 1e-4);
    float r = length(dd) / px;
    float bright = pow((rnd - 0.975) / 0.025, 4.0) * 0.9 + 0.08;
    float tw = 0.75 + 0.25 * sin(uTime * (2.0 + rnd * 5.0) + rnd * 40.0);
    star = smoothstep(1.15, 0.15, r) * bright * tw;
  }
  star *= smoothstep(0.02, 0.18, d.y) * (1.0 - 0.6 * pow(md, 6.0) * uMoonLight);
  col += vec3(0.9, 0.95, 1.0) * star * 1.3;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function dirFromAzEl(az, el, out = new THREE.Vector3()) {
  // az: +X から +Z へ（ラジアン）、el: 地平からの高さ
  return out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
}

export class NightSky {
  constructor(scene, camPos, { moonAz, moonEl, rng }) {
    this.scene = scene;
    this.camPos = new THREE.Vector3(camPos.x, camPos.y, camPos.z);
    this.rng = rng;
    this.time = 0;
    this.group = new THREE.Group();
    this.group.name = 'sky';
    scene.add(this.group);
    // ドーム（カメラについていく）
    this.domeU = { uTime: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonLight: { value: 1 } };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(R, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, uniforms: this.domeU, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.dome = dome;
    this.group.add(dome);

    // 月
    this.moonAz0 = moonAz;
    this.moonEl0 = moonEl;
    this.moonDir = new THREE.Vector3();
    this.moonSize = THREE.MathUtils.degToRad(0.85); // 少し大きめ（実際は 0.5°）
    const mt = moonTexture();
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: mt, transparent: true, fog: false, depthWrite: false, color: new THREE.Color(2.6, 2.5, 2.3) }));
    this.moon.renderOrder = -8;
    this.group.add(this.moon);
    const glow = glowTexture();
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(0.55, 0.6, 0.75), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    this.halo.renderOrder = -7;
    this.group.add(this.halo);

    // 雲
    this.clouds = [];
    const cloudMat = (seed) =>
      new THREE.MeshBasicMaterial({ map: cloudTexture(seed), transparent: true, depthWrite: false, fog: false, color: new THREE.Color(0.32, 0.33, 0.4) });
    const add = (az, el, w, speed, seed, opacity = 1) => {
      const m = cloudMat(seed);
      m.opacity = opacity;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), m);
      mesh.renderOrder = -6;
      this.group.add(mesh);
      this.clouds.push({ mesh, az, el, w, speed, tex: m.map, opacity });
    };
    // 月を最初に隠している雲（0:55〜1:05 に月から離れる）
    this.moonCloud = { start: moonAz - 0.004, el: moonEl + 0.01 };
    add(moonAz - 0.02, moonEl + 0.008, 0.22, 0.0021, 3, 1);
    for (let i = 0; i < 9; i++) {
      const az = moonAz + (rng.next() - 0.5) * 3.4;
      const el = 0.12 + rng.next() * 0.5;
      if (Math.abs(az - moonAz) < 0.25 && Math.abs(el - moonEl) < 0.15) continue;
      add(az, el, 0.18 + rng.next() * 0.3, 0.0008 + rng.next() * 0.0016, 10 + i, 0.6 + rng.next() * 0.35);
    }

    // 飛行機（点滅する光）
    this.plane = new THREE.Group();
    const pm = (c) => new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: c, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.planeLights = [pm(new THREE.Color(3, 0.2, 0.2)), pm(new THREE.Color(0.2, 3, 0.4)), pm(new THREE.Color(3, 3, 3))];
    this.planeLights[0].position.set(-1.2, 0, 0);
    this.planeLights[1].position.set(1.2, 0, 0);
    this.planeLights.forEach((s) => {
      s.scale.setScalar(2.2);
      this.plane.add(s);
    });
    this.plane.visible = false;
    this.group.add(this.plane);
    this.planeSched = null;

    // 流れ星（細い光の筋）
    const sg = new THREE.PlaneGeometry(1, 0.05);
    sg.translate(-0.5, 0, 0);
    this.meteor = new THREE.Mesh(
      sg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        uniforms: { uA: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float a = vUv.x * vUv.x * (1.0 - abs(vUv.y - 0.5) * 2.0) * uA; gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a * 3.0, 1.0); }',
      })
    );
    this.meteor.visible = false;
    this.meteor.renderOrder = -5;
    this.group.add(this.meteor);
    this.meteors = [];
    this.meteorNow = null;

    this.moonCover = 0;
    this.updateMoon(0);
  }

  // 予定: 飛行機（t0 秒から dur 秒）・流れ星
  schedulePlane(t0, dur, fromAz, toAz, el) {
    this.planeSched = { t0, dur, fromAz, toAz, el };
  }

  scheduleMeteor(t, az, el, len = 0.12, dir = -0.6) {
    this.meteors.push({ t, az, el, len, dir, done: false });
  }

  // 方向 → 空の点（カメラからの距離 dist）
  pointAt(az, el, dist = R * 0.9, out = new THREE.Vector3()) {
    return dirFromAzEl(az, el, out).multiplyScalar(dist).add(this.camPos);
  }

  updateMoon(t) {
    // 3 分で 0.04 rad ほど昇る（誇張）
    const k = Math.min(1, t / 180);
    this.moonAz = this.moonAz0 + 0.015 * k;
    this.moonEl = this.moonEl0 + 0.045 * k;
    dirFromAzEl(this.moonAz, this.moonEl, this.moonDir);
    const dist = R * 0.92;
    const size = 2 * dist * Math.tan(this.moonSize / 2);
    this.moon.position.copy(this.moonDir).multiplyScalar(dist).add(this.camPos);
    this.moon.scale.setScalar(size);
    this.moon.lookAt(this.camPos);
    this.halo.position.copy(this.moon.position);
    this.domeU.uMoonDir.value.copy(this.moonDir);
  }

  // 雲が月をどれだけ隠しているか（0〜1）: 雲の板のテクスチャのアルファを月の方向で読む
  cloudAlphaAt(az, el) {
    let a = 0;
    for (const c of this.clouds) {
      const du = (az - c.az) / c.w;
      const dv = (el - c.el) / (c.w * 0.5);
      if (Math.abs(du) > 0.5 || Math.abs(dv) > 0.5) continue;
      const img = c.tex.userData.image;
      const S = c.tex.userData.size;
      const x = Math.floor((0.5 + du) * (S - 1));
      const y = Math.floor((0.5 - dv) * (S - 1));
      const v = img.data[(y * S + x) * 4 + 3] / 255;
      a = Math.max(a, Math.min(1, v * 1.6 * c.opacity));
    }
    return a;
  }

  update(dt, t, camera) {
    this.time = t;
    this.domeU.uTime.value = t;
    this.dome.position.copy(camera.position);
    this.updateMoon(t);
    // 雲を流す（方位角がゆっくり増える）
    const dist = R * 0.82;
    for (const c of this.clouds) {
      c.az += c.speed * dt;
      const p = this.pointAt(c.az, c.el, dist);
      c.mesh.position.copy(p);
      const w = 2 * dist * Math.tan(c.w / 2);
      c.mesh.scale.set(w, w, 1);
      c.mesh.lookAt(this.camPos);
    }
    this.moonCover = this.cloudAlphaAt(this.moonAz, this.moonEl);
    const vis = 1 - this.moonCover * 0.85;
    // 望遠で月に寄ると露出が下がる（模様が見える）・ハロは小さく薄く
    const fov = camera?.fov ?? 46;
    const tele = Math.min(1, Math.max(0, (fov - 2) / 14));
    const ex = 0.55 + 0.45 * tele;
    this.moon.material.color.setRGB((2.6 * vis + 0.25) * ex, (2.5 * vis + 0.25) * ex, (2.3 * vis + 0.3) * ex);
    this.halo.material.opacity = (0.35 + 0.65 * vis) * (0.25 + 0.75 * tele);
    const hs = 2 * R * 0.92 * Math.tan(this.moonSize * (1.6 + (1.2 + 2.4 * vis) * tele));
    this.halo.scale.setScalar(hs);
    this.domeU.uMoonLight.value = 0.3 + 0.7 * vis;
    // 雲の色: 月の近くは明るく縁取られる / 下側は照明の暖色
    for (const c of this.clouds) {
      const near = Math.max(0, 1 - Math.hypot(c.az - this.moonAz, c.el - this.moonEl) / 0.6);
      c.mesh.material.color.setRGB(0.3 + near * 0.35 * vis, 0.3 + near * 0.35 * vis, 0.36 + near * 0.38 * vis);
    }
    // 飛行機
    const ps = this.planeSched;
    if (ps && t >= ps.t0 && t <= ps.t0 + ps.dur) {
      const k = (t - ps.t0) / ps.dur;
      this.plane.visible = true;
      this.plane.position.copy(this.pointAt(ps.fromAz + (ps.toAz - ps.fromAz) * k, ps.el + 0.03 * Math.sin(k * 3), R * 0.8));
      this.plane.lookAt(this.camPos);
      const blink = (t * 1.1) % 1 < 0.12;
      this.planeLights[2].visible = blink;
      this.planeLights[0].material.opacity = 0.7 + 0.3 * Math.sin(t * 6);
    } else this.plane.visible = false;
    // 流れ星
    if (!this.meteorNow) {
      const m = this.meteors.find((q) => !q.done && t >= q.t);
      if (m) {
        m.done = true;
        this.meteorNow = { ...m, age: 0 };
      }
    }
    if (this.meteorNow) {
      const m = this.meteorNow;
      m.age += dt;
      const k = m.age / 0.75;
      if (k >= 1) {
        this.meteorNow = null;
        this.meteor.visible = false;
      } else {
        this.meteor.visible = true;
        const head = this.pointAt(m.az + m.len * k, m.el + m.len * m.dir * k, R * 0.85);
        const tail = this.pointAt(m.az + m.len * Math.max(0, k - 0.35), m.el + m.len * m.dir * Math.max(0, k - 0.35), R * 0.85);
        this.meteor.position.copy(head);
        const len = head.distanceTo(tail);
        this.meteor.scale.set(Math.max(0.1, len), len * 0.9 + 1, 1);
        // 頭から尾の向きへ・板はカメラを向く
        const dir = tail.clone().sub(head).normalize();
        const toCam = this.camPos.clone().sub(head).normalize();
        const up = new THREE.Vector3().crossVectors(toCam, dir).normalize();
        const xAxis = dir.clone().negate();
        const zAxis = new THREE.Vector3().crossVectors(xAxis, up).normalize();
        this.meteor.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, up, zAxis));
        this.meteor.material.uniforms.uA.value = Math.sin(k * Math.PI);
      }
    }
  }

  get moonVisible() {
    return this.moonCover < 0.45;
  }

  get meteorActive() {
    return !!this.meteorNow;
  }

  meteorPoint(out = new THREE.Vector3()) {
    return out.copy(this.meteor.position);
  }
}
