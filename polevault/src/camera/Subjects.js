import * as THREE from 'three';

// 撮影の対象（被写体）の名簿。選手・審判・物語の人・ただの観客・鳥・月・照明・飛行機・流れ星・猫・ウェーブ・大型ビジョン・バー。
//   被写体 = { id, kind, label, en, size（画面の大きさの計算に使う高さ m）, pos(out), angular（空の物: 見かけの大きさ rad）}
//   frame(): いまの画面に何がどれくらいの大きさで映っているか（ゲームの中の情報で判定する。画像認識だけに頼らない）

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Subjects {
  constructor() {
    this.list = [];
    this.byId = new Map();
  }

  add(s) {
    s.screen = 0; // 主役として映っていた時間（飽き）
    s.lastMain = -99;
    this.list.push(s);
    this.byId.set(s.id, s);
    return s;
  }

  get(id) {
    return this.byId.get(id);
  }

  // 画面の分析: camera（three）, cam（BroadcastCamera）, t
  frame(camera, cam, t) {
    const fovRad = cam.fovRad;
    const tanH = Math.tan(fovRad / 2);
    const aspect = camera.aspect;
    const items = [];
    const camPos = camera.position;
    camera.updateMatrixWorld();
    for (const s of this.list) {
      if (s.active && !s.active(t)) continue;
      const p = s.pos(_v);
      if (!p) continue;
      _d.copy(p).sub(camPos);
      const dist = _d.length();
      const ndc = p.clone().project(camera);
      if (ndc.z > 1 || ndc.z < -1) continue;
      const margin = 1.08;
      if (Math.abs(ndc.x) > margin || Math.abs(ndc.y) > margin) continue;
      // 画面の縦に対する大きさ
      let frac;
      if (s.angular) frac = s.angular() / fovRad;
      else frac = s.size / (2 * dist * tanH);
      if (frac < 0.004) continue;
      const cx = Math.abs(ndc.x);
      const cy = Math.abs(ndc.y);
      const center = 1 - Math.min(1, Math.hypot(cx * aspect, cy) / Math.hypot(aspect, 1));
      // 三分割の線に近い
      const thirds = 1 - Math.min(1, (Math.min(Math.abs(cx - 0.333), Math.abs(cx)) + Math.min(Math.abs(cy - 0.333), Math.abs(cy))) * 2.2);
      // ピント（PostFX と同じ式の CoC → 被写体の大きさに対するぼけ）
      const H = 720;
      const coc = 0.0016 * Math.pow(cam.zoom, 1.25) * Math.abs(1 / cam.focus - 1 / Math.max(0.5, dist)) * H;
      const sharp = s.angular ? (cam.focus > 120 || dist < 0 ? 1 : 1 / (1 + coc / 6)) : 1 / (1 + coc / Math.max(2.5, frac * H * 0.25));
      items.push({ s, ndc: { x: ndc.x, y: ndc.y }, frac, center, thirds, dist, sharp, coc });
    }
    items.sort((a, b) => b.frac * (0.5 + b.center) * (b.s.weight ?? 1) - a.frac * (0.5 + a.center) * (a.s.weight ?? 1));
    return items;
  }
}
