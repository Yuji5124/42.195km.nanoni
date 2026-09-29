import * as THREE from 'three';
import { createHumanMaterial, createHumanInstances, applyLook, writeYawMatrix } from '../../src/world/RunnerModel.js';
import { darkMetal } from '../../src/world/LandmarksStadium.js';
import { makeCanvas, toTexture } from '../../src/world/textures.js';

// 審判席（5 人）。何が起きても真面目。着地のあとで 10 点満点の札を上げる。
// 人形は観客と同じインスタンス人形（1 draw call）。盛り上がり（uExcite）は常に 0 → 腕を上げない。

export const JUDGES = { x: -6, z: 7.6, n: 5, gap: 1.05 };

export class TrampolineJudges {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const { x, z, n, gap } = JUDGES;
    // 机（正面の板に「JUDGES」）
    const [c, g] = makeCanvas(512, 64);
    g.fillStyle = '#0d1030';
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 58, 512, 6);
    g.fillStyle = '#fff';
    g.font = 'bold 40px "Chakra Petch", sans-serif';
    g.textAlign = 'center';
    g.fillText('JUDGES  ·  審判', 256, 44);
    const sign = new THREE.MeshBasicMaterial({ map: toTexture(c) });
    sign.color.setScalar(0.5); // 光りすぎない（ブルームで白飛びしない）
    const front = new THREE.Mesh(new THREE.BoxGeometry(n * gap + 0.6, 0.95, 0.12), [darkMetal, darkMetal, darkMetal, darkMetal, sign, darkMetal]);
    // 正面（+Z の面）を選手の側（-Z）へ向ける
    front.rotation.y = Math.PI;
    front.position.set(x, 0.48, z - 0.45);
    const top = new THREE.Mesh(new THREE.BoxGeometry(n * gap + 0.6, 0.06, 0.8), new THREE.MeshLambertMaterial({ color: 0x3a4058 }));
    top.position.set(x, 0.96, z - 0.1);
    this.group.add(front, top);
    // 審判（スーツ）
    const mat = createHumanMaterial({ mode: 'spectator', rim: 0.05 });
    mat.userData.uniforms.uPlayerXZ.value.set(9999, 9999);
    this.mat = mat;
    this.people = createHumanInstances(n, mat, 'high');
    const arr = this.people.instanceMatrix.array;
    this.seats = [];
    for (let i = 0; i < n; i++) {
      const px = x + (i - (n - 1) / 2) * gap;
      writeYawMatrix(arr, i, px, 0, z + 0.2, 0, 0.98); // 人形の前は -Z → yaw 0 で選手の方を向く
      applyLook(this.people, i, { shirt: 0x1d2233, pants: 0x14161f, skin: [0xf1c7a3, 0xe0ac86, 0xc98e6a, 0xf6d5b8, 0x9b6a4a][i], hat: [0x111111, 0x777777, 0x2b1a10, 0x111111, 0xc9c9c9][i], hatScale: 0 });
      this.people.geometry.attributes.iAnim.setXY(i, i * 0.37, 0);
      this.seats.push(new THREE.Vector3(px, 1.75, z + 0.2));
    }
    this.people.instanceMatrix.needsUpdate = true;
    this.group.add(this.people);
    // 札（1 人 1 枚の canvas）
    this.cards = [];
    for (let i = 0; i < n; i++) {
      const [cc, cg] = makeCanvas(128, 96);
      const tex = toTexture(cc);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.46), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      m.rotation.y = Math.PI;
      m.position.copy(this.seats[i]).add(new THREE.Vector3(0, 0.55, -0.25));
      m.visible = false;
      this.group.add(m);
      this.cards.push({ mesh: m, ctx: cg, tex, t: 0 });
    }
    this.time = 0;
    this.center = new THREE.Vector3(x, 1.6, z);
  }

  // 札を上げる（少しずつずらして）
  show(values) {
    values.forEach((v, i) => {
      const card = this.cards[i];
      const g = card.ctx;
      g.fillStyle = '#fbfbf6';
      g.fillRect(0, 0, 128, 96);
      g.fillStyle = '#0d1030';
      g.fillRect(0, 0, 128, 14);
      g.fillStyle = '#111';
      g.font = 'bold 58px "Chakra Petch", sans-serif';
      g.textAlign = 'center';
      g.fillText(v.toFixed(1), 64, 76);
      card.tex.needsUpdate = true;
      card.t = -i * 0.18;
      card.mesh.visible = false;
    });
    this.showing = true;
  }

  hide() {
    this.showing = false;
    for (const c of this.cards) c.mesh.visible = false;
  }

  update(realDt) {
    this.time += realDt;
    if (!this.showing) return;
    for (const c of this.cards) {
      c.t += realDt;
      if (c.t < 0) continue;
      c.mesh.visible = true;
      const k = Math.min(1, c.t / 0.25);
      c.mesh.scale.setScalar(0.3 + 0.7 * k);
    }
  }
}
