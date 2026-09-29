import * as THREE from 'three';

// 800m、なのに。の天気（雨・雪）を共有。1500m のツイスト「雪」で使う。

// 天気（雨・雪）。カメラの周りの箱の中だけに降らせる（粒は使い回し = 作ったり消したりしない）。
// 位置はシェーダーで計算: seed × 箱 − 落下 → 箱の中で折り返す。CPU は uniform を書くだけ。

const BOX = 36;
const COUNT = 1600;

function makeMaterial(kind, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; // xyz = 箱の中の位置, w = 0/1（雨の線の上端・下端）
      uniform vec3 uCam; uniform float uTime, uAmt, uWind, uPx;
      varying float vA;
      void main() {
        float fall = ${kind === 'rain' ? '22.0' : '1.6'};
        vec3 off = aSeed.xyz * ${BOX.toFixed(1)};
        off.y -= uTime * fall * (0.8 + 0.4 * fract(aSeed.x * 7.0));
        off.x += uTime * uWind * ${kind === 'rain' ? '6.0' : '4.0'};
        ${kind === 'snow' ? 'off.x += sin(uTime * 1.3 + aSeed.z * 30.0) * 0.6; off.z += cos(uTime * 1.1 + aSeed.x * 30.0) * 0.6;' : ''}
        vec3 p = uCam + mod(off - uCam, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
        ${kind === 'rain' ? 'p += aSeed.w * vec3(-uWind * 0.25, 0.9, 0.0);' : ''}
        // 量（uAmt）に応じて、一部の粒だけ見せる
        vA = step(fract(aSeed.x * 13.7 + aSeed.y * 3.1), uAmt);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * 0.09 / max(0.5, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        if (vA < 0.5) discard;
        ${kind === 'snow' ? 'vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, 0.9);' : 'gl_FragColor = vec4(0.75, 0.82, 1.0, 0.42);'}
      }`,
  });
}

export class Weather {
  constructor(scene) {
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uAmt: { value: 0 },
      uWind: { value: 0 },
      uPx: { value: 800 },
    };
    // 雨: 線（2 頂点ずつ）
    const rain = new Float32Array(COUNT * 2 * 4);
    const snow = new Float32Array(COUNT * 4);
    let s = 1234567;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < COUNT; i++) {
      const x = rnd();
      const y = rnd();
      const z = rnd();
      rain.set([x, y, z, 0, x, y, z, 1], i * 8);
      snow.set([x, y, z, 0], i * 4);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('aSeed', new THREE.BufferAttribute(rain, 4));
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 2 * 3), 3));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('aSeed', new THREE.BufferAttribute(snow, 4));
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    this.rain = new THREE.LineSegments(rg, makeMaterial('rain', this.uniforms));
    this.snow = new THREE.Points(sg, makeMaterial('snow', this.uniforms));
    for (const o of [this.rain, this.snow]) {
      o.frustumCulled = false;
      o.visible = false;
      o.renderOrder = 5;
      scene.add(o);
    }
  }

  update(dt, camera, kind, amt, wind, heightPx) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uAmt.value = amt;
    u.uWind.value = wind;
    u.uPx.value = heightPx;
    u.uCam.value.copy(camera.position);
    this.rain.visible = kind === 'rain' && amt > 0.01;
    this.snow.visible = kind === 'snow' && amt > 0.01;
  }
}
