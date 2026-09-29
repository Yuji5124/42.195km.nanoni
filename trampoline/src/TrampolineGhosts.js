import * as THREE from 'three';
import { SamuraiModel } from '../../src/world/SamuraiModel.js';

// 残像（TOO FAST）: 侍の半透明の分身が、少し前の姿勢で後ろについてくる。
// 分身は SamuraiModel({ ghost: true })（1500m の「分身」と同じ見た目）。普段は非表示で描画しない。
// 姿勢の記録は世界の時間で取る → スロー中も「少し前の姿勢」が正しくずれる。

const HISTORY = 48;

function joints(model) {
  const list = [model.root, model.hips, model.spine, model.chest, model.neck, model.head, model.hakamaFront, model.hakamaBack, model.katana];
  for (const side of [-1, 1]) {
    list.push(model.arms[side].shoulder, model.arms[side].elbow);
    list.push(model.legs[side].thigh, model.legs[side].knee, model.legs[side].ankle);
  }
  list.push(...(model.hairJoints ?? []));
  for (const [t, t2] of model.bandTails ?? []) list.push(t, t2); // 鉢巻の尾は [根元, 先, side]
  return list.filter(Boolean);
}

export class TrampolineGhosts {
  constructor(scene, athlete, count = 4) {
    this.athlete = athlete;
    this.src = [athlete.pivot, athlete.body, ...joints(athlete.model)];
    this.ghosts = [];
    for (let k = 0; k < count; k++) {
      const model = new SamuraiModel({ ghost: true });
      model.material.opacity = 0.34 - k * 0.06;
      const pivot = new THREE.Group();
      const body = new THREE.Group();
      body.position.copy(athlete.body.position);
      model.root.position.copy(athlete.model.root.position);
      pivot.add(body);
      body.add(model.root);
      pivot.visible = false;
      scene.add(pivot);
      this.ghosts.push({ pivot, nodes: [pivot, body, ...joints(model)] });
    }
    this.n = this.src.length;
    this.stride = this.n * 7;
    this.buf = new Float32Array(HISTORY * this.stride);
    this.head = 0;
    this.filled = 0;
    this.acc = 0;
    this.active = false;
  }

  setActive(on) {
    this.active = on;
    this.filled = 0;
    for (const g of this.ghosts) g.pivot.visible = false;
  }

  record() {
    const o = this.head * this.stride;
    for (let i = 0; i < this.n; i++) {
      const s = this.src[i];
      const j = o + i * 7;
      this.buf[j] = s.position.x;
      this.buf[j + 1] = s.position.y;
      this.buf[j + 2] = s.position.z;
      this.buf[j + 3] = s.quaternion.x;
      this.buf[j + 4] = s.quaternion.y;
      this.buf[j + 5] = s.quaternion.z;
      this.buf[j + 6] = s.quaternion.w;
    }
    this.head = (this.head + 1) % HISTORY;
    this.filled = Math.min(HISTORY, this.filled + 1);
  }

  // gameDt: 世界の時間 / gap: 分身どうしの間隔（記録のコマ数）
  update(gameDt, gap = 3) {
    if (!this.active) return;
    this.acc += gameDt;
    // 世界の時間 1/90 秒ごとに記録（スロー中は記録もゆっくり）
    while (this.acc >= 1 / 90) {
      this.acc -= 1 / 90;
      this.record();
    }
    this.ghosts.forEach((g, k) => {
      const lag = (k + 1) * gap;
      if (lag >= this.filled) {
        g.pivot.visible = false;
        return;
      }
      g.pivot.visible = true;
      const o = ((this.head - 1 - lag + HISTORY * 2) % HISTORY) * this.stride;
      for (let i = 0; i < this.n; i++) {
        const d = g.nodes[i];
        const j = o + i * 7;
        d.position.set(this.buf[j], this.buf[j + 1], this.buf[j + 2]);
        d.quaternion.set(this.buf[j + 3], this.buf[j + 4], this.buf[j + 5], this.buf[j + 6]);
      }
    });
  }
}
