import * as THREE from 'three';
import { createSkeleton } from './proceduralRig.js';
import { buildSamurai, buildAthlete, buildStick } from './runnerBuilder.js';
import { RunnerAnimator } from './animation.js';
import { trackPoint, curvature } from '../race/trackLogic.js';
import { patchMaterial } from '../fx/materialPatch.js';
import { clamp } from '../core/mathx.js';

// 12 人の見た目。RaceCore の値を読んで置くだけ（書き換えない）。
// 見た目の変形（巨大化・頭だけ巨大・棒人間・透明・世界の変形）は Presentation（P.runner）から受け取る。

// 普段は不透明（depthWrite あり）。透明にする時だけ setOpacity で切り替える（シェーダーは同じ）
function makeMaterial({ rim = 0, rimColor = 0x39e6ff } = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uniforms = { uRim: { value: rim }, uRimColor: { value: new THREE.Color(rimColor) }, uOpacity: { value: 1 } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRView;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRView = -mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRView;\nuniform float uRim, uOpacity;\nuniform vec3 uRimColor;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimF = pow(1.0 - abs(dot(normalize(vRView), normal)), 3.2);
        totalEmissiveRadiance += uRimColor * rimF * uRim;`
      )
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= uOpacity;');
  };
  m.customProgramCacheKey = () => 'runner-800';
  return patchMaterial(m);
}

function setOpacity(m, a) {
  m.userData.uniforms.uOpacity.value = a;
  // 自分の体の前後関係が崩れないよう、深度は書いたまま半透明にする
  m.transparent = a < 0.999;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();

export class RunnerManager {
  constructor(scene, defs, deform) {
    this.scene = scene;
    this.deform = deform;
    this.playerMat = makeMaterial({ rim: 0.25, rimColor: 0x7fe8ff });
    this.otherMat = makeMaterial({ rim: 0.12, rimColor: 0x7a5cff });
    // カメラと主人公の間に入った選手は透かす（主役が見えなくならないように）
    this.fadeMat = makeMaterial({ rim: 0.12, rimColor: 0x7a5cff });
    setOpacity(this.fadeMat, 0.3);
    this.stickMat = makeMaterial({ rim: 0.6, rimColor: 0xffffff });
    this.views = defs.map((def, i) => this.createView(def, i));

    // 足元の丸い影（全員で 1 draw call）
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
      defs.length
    );
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    scene.add(this.shadows);
    this._m = new THREE.Matrix4();
  }

  createView(def, i) {
    const skel = createSkeleton();
    const samurai = !!def.look.samurai;
    const geo = samurai ? buildSamurai(skel) : buildAthlete(skel, def.look);
    const mesh = new THREE.SkinnedMesh(geo, def.isPlayer ? this.playerMat : this.otherMat);
    mesh.add(skel.bones.root);
    mesh.bind(new THREE.Skeleton(skel.list));
    mesh.frustumCulled = false;
    const stick = new THREE.SkinnedMesh(buildStick(skel), this.stickMat);
    stick.bind(mesh.skeleton, mesh.bindMatrix);
    stick.visible = false;
    stick.frustumCulled = false;
    const group = new THREE.Group();
    group.add(mesh, stick);
    this.scene.add(group);
    const height = def.look.height ?? 1;
    return {
      def,
      index: i,
      group,
      mesh,
      stick,
      bones: skel.bones,
      anim: new RunnerAnimator(skel.bones, { costume: samurai }),
      height,
      pos: new THREE.Vector3(),
      head: new THREE.Vector3(),
      heading: 0,
      roll: 0,
    };
  }

  reset() {
    for (const v of this.views) v.anim.reset();
  }

  // 変形後の世界で、(d, off) に立つ位置と地面の向き（法線）
  placeOnTrack(d, off, out, normal) {
    const pt = trackPoint(d, off, this._pt ?? (this._pt = {}));
    _a.set(pt.x, 0, pt.z);
    if (!this.deform.active) {
      out.copy(_a);
      normal.set(0, 1, 0);
      return pt;
    }
    this.deform.apply(_a, out);
    // 法線: 前と横に少しずらした 2 点から
    trackPoint(d + 0.5, off, this._pt2 ?? (this._pt2 = {}));
    this.deform.apply(_b.set(this._pt2.x, 0, this._pt2.z), _b);
    trackPoint(d, off + 0.5, this._pt3 ?? (this._pt3 = {}));
    this.deform.apply(_v.set(this._pt3.x, 0, this._pt3.z), _v);
    _b.sub(out);
    _v.sub(out);
    normal.crossVectors(_v, _b).normalize();
    if (normal.y < 0) normal.negate();
    return pt;
  }

  // core: RaceCore / P: Presentation（見た目の状態）/ state: 'marks' | 'set' | 'run'
  update(dt, core, P, raceState, camera = null, focusIndex = -1) {
    const R = P.runner;
    for (const view of this.views) {
      const r = core.runners[view.index];
      const pt = this.placeOnTrack(r.d, r.off, view.pos, _n);
      // 向き: 進行方向 + 地面の傾き + カーブで内側へ少し傾く
      const lateral = (r.targetOff - r.off) * 0.6;
      view.roll = clamp(curvature(r.d) * r.v * r.v * 0.025, 0, 0.18);
      _e.set(0, pt.heading - lateral * 0.05, view.roll, 'YXZ');
      _q.setFromEuler(_e);
      if (_n.y < 0.999) {
        _q2.setFromUnitVectors(_up, _n);
        _q.premultiply(_q2);
      }
      const g = view.group;
      g.position.copy(view.pos);
      g.quaternion.copy(_q);
      // 大きさ: 巨人・小人（プレイヤーだけ / 他だけ）
      let scale = view.height * (view.def.isPlayer ? R.playerScale : R.otherScale);
      g.scale.setScalar(scale);
      // 頭・足の大きさ
      view.bones.head.scale.setScalar(R.headScale);
      view.bones['foot.L'].scale.setScalar(R.footScale);
      view.bones['foot.R'].scale.setScalar(R.footScale);
      // 棒人間
      const stick = R.stick || (R.stickOthers && !view.def.isPlayer);
      view.mesh.visible = !stick;
      view.stick.visible = stick;
      const animState = raceState === 'marks' || raceState === 'set' ? raceState : 'run';
      view.anim.update({
        dt: dt * (view.def.isPlayer ? R.playerAnimSpeed : R.otherAnimSpeed),
        v: r.v,
        phase: r.phase,
        stepFreq: r.stepFreq,
        stamina: r.stamina,
        d: r.d,
        burst: r.bursting,
        lateral: lateral,
        state: animState,
        gravity: P.world.gravity,
        finished: r.finished,
        won: r.finished && core.finishOrder[0] === r.index,
      });
      // 頭の位置（カメラ・一人称用）
      view.bones.head.getWorldPosition(view.head);
      view.heading = pt.heading;
      this._m.compose(_a.copy(view.pos).addScaledVector(_n, 0.03), _q, _b.set(0.9 * scale, 1, 0.9 * scale));
      this.shadows.setMatrixAt(view.index, this._m);
    }
    this.shadows.instanceMatrix.needsUpdate = true;
    // 被写体の手前（カメラとの間）にいる選手を透かす
    if (camera && focusIndex >= 0) {
      const focus = this.views[focusIndex].pos;
      const cp = camera.position;
      const toF = _v.copy(focus).sub(cp);
      const distF = toF.length();
      toF.normalize();
      for (const view of this.views) {
        if (view.def.isPlayer) continue;
        const rel = _a.copy(view.pos).sub(cp);
        const along = rel.dot(toF);
        const perp = rel.addScaledVector(toF, -along).length();
        const blocking = along > 0 && along < distF - 0.3 && perp < 1.1 * view.group.scale.x;
        view.mesh.material = blocking ? this.fadeMat : this.otherMat;
      }
    }
    // 透明（「自分だけ透明なのに。」）と他人の残像
    setOpacity(this.playerMat, R.playerOpacity);
    setOpacity(this.otherMat, R.otherOpacity);
    this.playerMat.userData.uniforms.uRim.value = R.playerRim;
  }
}
