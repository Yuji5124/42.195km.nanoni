import * as THREE from 'three';

// トラックの外側の床。競技場（スタンド・照明・観客）が消えた時だけ見える。
//   clouds … 雲の海（トラックは浮かぶ島）
//   sea    … 海（波とキラキラ）
//   space  … 足もとの遠くに地球（星空は空のシェーダー）
// 1 枚の板 + シェーダー。種類は uniform を変えるだけ（作り直さない）

const KIND = { clouds: 1, sea: 2 };

export class Floors {
  constructor(scene) {
    this.uniforms = {
      uKind: { value: 0 },
      uTime: { value: 0 },
      uFade: { value: new THREE.Color(0xffffff) },
      uCam: { value: new THREE.Vector3() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uKind, uTime; uniform vec3 uFade, uCam; varying vec3 vW;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
        void main() {
          vec2 p = vW.xz;
          float dist = length(vW - uCam);
          vec3 col; float a = 1.0;
          if (uKind < 1.5) {
            // 雲の海: ゆっくり流れるもこもこ
            float c = fbm(p * 0.018 + vec2(uTime * 0.02, uTime * 0.012));
            float c2 = fbm(p * 0.05 - vec2(uTime * 0.03, 0.0));
            float m = smoothstep(0.35, 0.75, c * 0.75 + c2 * 0.35);
            col = mix(vec3(0.62, 0.74, 0.92), vec3(1.0), m);
            a = 0.35 + 0.65 * m;
          } else {
            // 海: 波の模様 + 太陽のきらめき
            float w = fbm(p * 0.06 + vec2(uTime * 0.25, uTime * 0.1)) + 0.5 * fbm(p * 0.2 - vec2(uTime * 0.4, 0.0));
            col = mix(vec3(0.03, 0.2, 0.42), vec3(0.1, 0.45, 0.7), w * 0.8);
            float sp = step(0.93, n(p * 1.3 + uTime * 1.5)) * smoothstep(0.6, 1.0, w);
            col += sp * 0.8;
          }
          col = mix(col, uFade, smoothstep(250.0, 1100.0, dist));
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600, 1, 1).rotateX(-Math.PI / 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    this.mesh.visible = false;
    scene.add(this.mesh);

    // 宇宙: 足もとの遠くに地球（海・大陸・雲・大気の縁）
    this.planet = new THREE.Mesh(
      new THREE.SphereGeometry(420, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: { uTime: this.uniforms.uTime },
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vP; varying vec3 vV;
          void main() {
            vN = normalize(normalMatrix * normal); vP = position;
            vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; varying vec3 vN; varying vec3 vP; varying vec3 vV;
          float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float n(vec3 p) {
            vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
          }
          void main() {
            vec3 p = normalize(vP) * 3.0;
            float land = n(p) * 0.6 + n(p * 2.3) * 0.3 + n(p * 5.0) * 0.1;
            vec3 col = mix(vec3(0.05, 0.22, 0.55), vec3(0.2, 0.5, 0.22), smoothstep(0.52, 0.56, land));
            float cl = n(normalize(vP) * 6.0 + vec3(uTime * 0.02, 0.0, 0.0));
            col = mix(col, vec3(1.0), smoothstep(0.62, 0.8, cl) * 0.8);
            float light = clamp(dot(vN, normalize(vec3(0.4, 0.6, 0.7))) * 0.9 + 0.25, 0.08, 1.0);
            col *= light;
            float rim = pow(1.0 - max(0.0, dot(vN, vV)), 3.0);
            col += vec3(0.35, 0.6, 1.0) * rim * 0.9;
            gl_FragColor = vec4(col, 1.0);
          }`,
      })
    );
    this.planet.position.set(120, -360, -980);
    this.planet.visible = false;
    this.planet.frustumCulled = false;
    scene.add(this.planet);
  }

  // kind: null | 'clouds' | 'sea' | 'space'
  update(dt, kind, camera, horizon) {
    const k = KIND[kind] ?? 0;
    this.mesh.visible = k > 0;
    this.planet.visible = kind === 'space';
    if (kind === 'space') this.uniforms.uTime.value += dt;
    if (!k) return;
    const u = this.uniforms;
    u.uKind.value = k;
    u.uTime.value += dt;
    u.uCam.value.copy(camera.position);
    if (horizon) u.uFade.value.copy(horizon);
    this.mesh.position.y = k === 1 ? -9 : -2.2;
  }
}
