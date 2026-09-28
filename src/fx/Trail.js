import * as THREE from 'three';

// ネオン残像（THREE.MeshLine の「カメラに正対する帯」の考え方を最小実装）。
// 過去の腰の位置から帯を作り、どの視点（真横 2D・ヘリ）からでも見えるようにする。
// 長さはフレーム数ではなく「時間」で決める（低 FPS でも長くなりすぎない）。

const N = 40;
const MAX_AGE = 0.4;
const VERT = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor * uIntensity, vAlpha * uIntensity);
}
`;

const tmpT = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();

export class Trail {
  constructor(scene) {
    this.points = Array.from({ length: N }, () => new THREE.Vector3());
    this.ages = new Float32Array(N).fill(MAX_AGE);
    this.count = 0;
    const geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(N * 2 * 3);
    this.alphaArr = new Float32Array(N * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    this.uniforms = { uColor: { value: new THREE.Color(0x39e6ff) }, uIntensity: { value: 0.5 } };
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  reset() {
    this.count = 0;
    this.ages.fill(MAX_AGE);
  }

  push(p) {
    for (let i = N - 1; i > 0; i--) {
      this.points[i].copy(this.points[i - 1]);
      this.ages[i] = this.ages[i - 1];
    }
    this.points[0].copy(p);
    this.ages[0] = 0;
    this.count = Math.min(N, this.count + 1);
  }

  update(dt, headPos, camera, width, intensity, color) {
    for (let i = 0; i < N; i++) this.ages[i] += dt;
    this.push(headPos);
    this.uniforms.uIntensity.value = intensity;
    if (color !== undefined) this.uniforms.uColor.value.set(color);
    for (let i = 0; i < N; i++) {
      const p = this.points[Math.min(i, this.count - 1)];
      const q = this.points[Math.min(i + 1, this.count - 1)];
      tmpT.subVectors(p, q);
      if (tmpT.lengthSq() < 1e-6) tmpT.set(0, 0, 1);
      tmpT.normalize();
      tmpV.subVectors(camera.position, p).normalize();
      tmpS.crossVectors(tmpT, tmpV).normalize();
      const f = i < this.count ? Math.max(0, 1 - this.ages[i] / MAX_AGE) : 0;
      const w = width * (0.2 + 0.8 * f);
      const o = i * 6;
      this.posArr[o] = p.x + tmpS.x * w;
      this.posArr[o + 1] = p.y + tmpS.y * w;
      this.posArr[o + 2] = p.z + tmpS.z * w;
      this.posArr[o + 3] = p.x - tmpS.x * w;
      this.posArr[o + 4] = p.y - tmpS.y * w;
      this.posArr[o + 5] = p.z - tmpS.z * w;
      this.alphaArr[i * 2] = this.alphaArr[i * 2 + 1] = f * f;
    }
    const g = this.mesh.geometry.attributes;
    g.position.needsUpdate = true;
    g.aAlpha.needsUpdate = true;
  }
}
