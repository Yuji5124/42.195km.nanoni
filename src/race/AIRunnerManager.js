import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, createRng, damp } from '../core/math.js';
import { createHumanMaterial, createHumanInstances, applyLook, randomLook, LOOKS } from '../world/RunnerModel.js';
import { makeBlobTexture } from '../world/textures.js';

// AI ランナー群。全員を高精度 AI にはしない:
//   - 全員: 基本速度 + うねり（ペースの波）+ 前方ブロック時の横移動 / 速度合わせ（boids/yuka 的な簡易ステアリング）
//   - 障害物: 近ければ横に避ける、避けられなければジャンプ
//   - 描画: 1 つの InstancedMesh（手足はシェーダーで振る）+ 影 1 つ
// index 0 は「ライバル（忍者）」。プレイヤーの少し前を走り続け、競り合いを作る。

const LIMIT = CONFIG.road.runnerLimit;
const RIVAL = 0;

export class AIRunnerManager {
  constructor(scene, bus, distance, path) {
    this.path = path;
    this.bus = bus;
    this.distance = distance;
    const n = CONFIG.ai.count;
    this.n = n;
    this.s = new Float64Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.speed = new Float32Array(n);
    this.base = new Float32Array(n);
    this.targetX = new Float32Array(n);
    this.prefX = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.wave = new Float32Array(n);
    this.waveOff = new Float32Array(n);
    this.bump = new Float32Array(n);
    this.relSign = new Int8Array(n);
    this.passed = new Uint8Array(n);
    this.order = new Int32Array(n);
    this.looks = [];

    this.material = createHumanMaterial({ mode: 'runner', rim: 0.3, rimColor: 0x7a5cff });
    this.mesh = createHumanInstances(n, this.material);
    scene.add(this.mesh);

    const shadowGeo = new THREE.PlaneGeometry(1.1, 1.1);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({ map: makeBlobTexture(), transparent: true, depthWrite: false }),
      n + 1
    );
    this.shadows.frustumCulled = false;
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.renderOrder = 1;
    scene.add(this.shadows);

    this.time = 0;
  }

  // スタートの整列: 前列ほど速い（エリート）。プレイヤーは中団。
  reset(playerStart) {
    const rng = createRng(20240301);
    const cols = CONFIG.ai.gridColumns;
    const colW = (LIMIT * 2) / (cols - 1);
    let k = 0;
    this.looks = [];
    for (let row = 0; k < this.n; row++) {
      for (let c = 0; c < cols && k < this.n; c++) {
        const x = -LIMIT + c * colW;
        const s = -1 - row * CONFIG.ai.gridRowSpacing;
        if (Math.abs(s - playerStart.s) < 0.7 && Math.abs(x - playerStart.x) < colW * 0.8) continue;
        const i = k;
        this.s[i] = s + rng.range(-0.2, 0.2);
        this.x[i] = x + rng.range(-0.15, 0.15);
        const rowFrac = Math.min(1, row / 21);
        // 先頭集団（≒18）はプレイヤーの持続可能な平均速度（巡航+ペース+ダッシュ ≒ 18〜19）とほぼ互角。
        // 1 位は「うまく走れば取れる」ご褒美にする
        this.base[i] = 17.8 - rowFrac * 5.0 + rng.range(-0.6, 0.3);
        k++;
      }
    }
    // ライバルはプレイヤーの隣
    this.s[RIVAL] = playerStart.s + 0.4;
    this.x[RIVAL] = playerStart.x + 1.3;
    this.base[RIVAL] = 16.4;

    for (let i = 0; i < this.n; i++) {
      this.y[i] = 0;
      this.vy[i] = 0;
      this.vx[i] = 0;
      this.speed[i] = 0;
      this.targetX[i] = this.x[i];
      this.prefX[i] = this.x[i];
      this.phase[i] = rng.range(0, Math.PI * 2);
      this.wave[i] = rng.range(0.15, 0.45);
      this.waveOff[i] = rng.range(0, 10);
      this.bump[i] = 0;
      this.relSign[i] = this.s[i] > playerStart.s ? 1 : -1;
      this.passed[i] = 0;
      this.order[i] = i;
      const look = i === RIVAL ? { ...LOOKS.ninja, costume: 'ninja' } : randomLook(rng, 0.22);
      this.looks.push(look);
      applyLook(this.mesh, i, look);
    }
    this.sortOrder();
    this.rng = rng;
    this.time = 0;
  }

  sortOrder() {
    const o = this.order;
    const s = this.s;
    for (let i = 1; i < o.length; i++) {
      const v = o[i];
      let j = i - 1;
      while (j >= 0 && s[o[j]] < s[v]) {
        o[j + 1] = o[j];
        j--;
      }
      o[j + 1] = v;
    }
  }

  // プレイヤーより前にいる AI の数 + 1
  rankOf(playerS) {
    let lo = 0;
    let hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.s[this.order[mid]] > playerS) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  }

  leaderS() {
    return this.s[this.order[0]];
  }

  get rivalS() {
    return this.s[RIVAL];
  }

  get rivalX() {
    return this.x[RIVAL];
  }

  // ctx: { running, player, rules, course, finalStretch, goalS }
  update(dt, ctx) {
    this.time += dt;
    const { player, rules = {}, course } = ctx;
    const maxX = typeof rules.aiMaxX === 'number' ? rules.aiMaxX : LIMIT;
    const s = this.s;
    const x = this.x;
    const o = this.order;
    this.sortOrder();

    for (let k = 0; k < this.n; k++) {
      const i = o[k];
      let target = 0;
      if (ctx.running) {
        target = this.base[i] * (1 + 0.035 * Math.sin(this.time * this.wave[i] + this.waveOff[i]));
        if (s[i] > ctx.goalS + 5) target = 6;
      }

      // ライバル: プレイヤーの少し前をキープ（ただし上限あり → ダッシュで振り切れる）
      if (i === RIVAL && ctx.running && s[i] < ctx.goalS) {
        const gap = s[i] - player.s;
        const cap = ctx.finalStretch ? 21.5 : 19;
        if (gap < -60) target = cap;
        else if (gap > 50) target = 14;
        else target = clamp(player.speed + (2.5 - gap) * 0.9, 13, cap);
        if (player.falling) target = 16;
      }

      // 赤信号: 停止線の手前で止まる（行儀のいいランナーたち）
      const stop = ctx.stopLine;
      if (stop?.active && s[i] < stop.s - 0.3 && s[i] > stop.s - 40) {
        // 停止線ぴったりに止まるよう、残り距離から許される速度に抑える
        const need = Math.max(0, stop.s - 0.9 - s[i]);
        target = Math.min(target, Math.sqrt(2 * 12 * need));
        this.speed[i] = Math.min(this.speed[i], Math.sqrt(2 * 22 * need));
      }

      // 前方の渋滞 → 横に避ける / 速度を合わせる
      let blocked = false;
      for (let a = k - 1; a >= Math.max(0, k - 4); a--) {
        const j = o[a];
        const gap = s[j] - s[i];
        if (gap > 2.6) break;
        if (Math.abs(x[j] - x[i]) < 0.8) {
          blocked = true;
          target = Math.min(target, this.speed[j] + gap * 0.6);
          if (this.bump[i] <= 0) {
            const dir = x[j] > x[i] ? -1 : 1;
            let tx = x[i] + dir * 1.1;
            if (tx < -LIMIT || tx > Math.min(LIMIT, maxX)) tx = x[i] - dir * 1.1;
            this.targetX[i] = tx;
          }
          break;
        }
      }
      // 後ろから速いプレイヤーが来たら、半分のランナーは少し道を譲る
      const behind = s[i] - player.s;
      if ((i & 1) === 0 && behind > 0 && behind < 3.5 && Math.abs(player.x - x[i]) < 0.9 && player.speed > this.speed[i] + 1 && this.bump[i] <= 0) {
        const tx = x[i] + (player.x > x[i] ? -1.0 : 1.0);
        if (tx > -LIMIT && tx < Math.min(LIMIT, maxX)) this.targetX[i] = tx;
      }

      // プレイヤーも障害物として扱う
      const pgap = player.s - s[i];
      if (pgap > 0 && pgap < 2.8 && Math.abs(player.x - x[i]) < 0.85 && player.y < 1.2) {
        target = Math.min(target, player.speed + pgap * 0.5);
        this.targetX[i] = x[i] + (player.x > x[i] ? -1.1 : 1.1);
        blocked = true;
      }

      // 障害物
      if (course && ctx.running) {
        const hz = course.hazardAhead(s[i], x[i], 8);
        if (hz) {
          const left = hz.x - hz.halfW - 0.7;
          const right = hz.x + hz.halfW + 0.7;
          const tx = Math.abs(left - x[i]) < Math.abs(right - x[i]) ? left : right;
          if (tx >= -LIMIT && tx <= Math.min(LIMIT, maxX)) this.targetX[i] = tx;
          if (hz.s - s[i] < 1.9 && this.y[i] === 0 && hz.jumpable) {
            this.vy[i] = 8.6;
            this.y[i] = 0.001;
          }
        }
      }

      if (!blocked && ctx.running && Math.abs(this.targetX[i] - this.prefX[i]) > 0.05 && this.rng.chance(dt * 0.3)) {
        this.targetX[i] = this.prefX[i];
      }
      if (ctx.running && this.rng.chance(dt * 0.05)) {
        this.prefX[i] = clamp(x[i] + this.rng.range(-2, 2), -LIMIT, Math.min(LIMIT, maxX));
      }
      if (x[i] > maxX) this.targetX[i] = Math.min(this.targetX[i], maxX - 0.3);

      // 積分
      const acc = target > this.speed[i] ? 5 : 9;
      this.speed[i] = damp(this.speed[i], target, acc * 0.35, dt);
      const tvx = clamp((this.targetX[i] - x[i]) * 3, -3.2, 3.2);
      this.vx[i] = damp(this.vx[i], tvx, 8, dt);
      x[i] = clamp(x[i] + this.vx[i] * dt, -LIMIT, LIMIT);
      s[i] += this.speed[i] * dt;
      if (this.y[i] > 0) {
        this.vy[i] -= CONFIG.player.gravity * dt;
        this.y[i] += this.vy[i] * dt;
        if (this.y[i] <= 0) {
          this.y[i] = 0;
          this.vy[i] = 0;
        }
      }
      this.bump[i] = Math.max(0, this.bump[i] - dt);
      this.phase[i] += dt * (4 + this.speed[i] * 0.62);
    }

    this.checkPlayer(player);
    this.writeInstances(player, ctx.excitement ?? 0);
  }

  // プレイヤーとの接触・追い抜き判定
  checkPlayer(player) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const rel = this.s[i] - player.s;
      const sign = rel > 0 ? 1 : -1;
      if (Math.abs(rel) < 1.0 && Math.abs(this.x[i] - player.x) < 0.6 && player.y < 1.1 && !player.falling && player.invuln <= 0) {
        if (rel > 0) {
          // プレイヤーが後ろから当たった（軽いよろけ。混雑で理不尽に止まらない程度）
          player.hitStagger(0.15, 0);
          this.vx[i] += player.x > this.x[i] ? -2.5 : 2.5;
          this.bump[i] = 0.6;
          this.targetX[i] = clamp(this.x[i] + (player.x > this.x[i] ? -1.2 : 1.2), -LIMIT, LIMIT);
        }
      }
      if (sign !== this.relSign[i] && Math.abs(rel) < 6) {
        if (sign < 0) {
          // 同じ相手との抜きつ抜かれつで CHEER が暴走しないよう、スコアは初回のみ
          this.bus.emit('overtake', {
            index: i,
            dx: Math.abs(this.x[i] - player.x),
            airborne: player.y > 0.9,
            rival: i === RIVAL,
            first: !this.passed[i],
            look: this.looks[i],
          });
          this.passed[i] = 1;
        } else {
          this.bus.emit('overtaken', { index: i, rival: i === RIVAL });
        }
      }
      this.relSign[i] = sign;
    }
  }

  writeInstances(player, excitement) {
    const arr = this.mesh.instanceMatrix.array;
    const sh = this.shadows.instanceMatrix.array;
    const anim = this.mesh.geometry.attributes.iAnim;
    for (let i = 0; i < this.n; i++) {
      const rel = this.s[i] - player.s;
      const visible = rel > -260 && rel < 420;
      const yaw = -this.vx[i] * 0.06;
      this.path.writeMatrix(arr, i, this.s[i], this.x[i], this.y[i], yaw, visible ? 1 : 0);
      const amp = this.speed[i] < 0.5 ? 0.12 : this.y[i] > 0 ? 0.35 : Math.min(1.2, 0.5 + this.speed[i] / 22);
      anim.setXY(i, this.speed[i] < 0.5 ? this.time * 3 + this.phase[i] : this.phase[i], amp);
      const shadowScale = visible ? Math.max(0.3, 1 - this.y[i] * 0.3) : 0;
      this.path.writeMatrix(sh, i, this.s[i], this.x[i], 0.04, 0, shadowScale);
    }
    this.path.writeMatrix(sh, this.n, player.s, player.x, 0.04, 0, Math.max(0.3, 1 - player.y * 0.3));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    anim.needsUpdate = true;
    this.material.userData.uniforms.uRim.value = 0.22 + excitement * 0.5;
  }
}
