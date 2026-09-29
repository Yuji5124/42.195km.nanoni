// すべての Modifier を登録する（import するだけで REGISTRY に入る）
import './visual.js';
import './camera.js';
import './world.js';
import './runner.js';
import './crowd.js';
import './ui.js';
import './time.js';
import './genre.js';
import './audio.js';
import './legendary.js';

import { REGISTRY } from '../registry.js';

// 定義の食い違い（存在しない相手の id など）を探す。smoke テストが空であることを確かめる
export function validateRegistry() {
  const problems = [];
  for (const d of REGISTRY.values()) {
    for (const key of ['synergy', 'incompatible']) for (const id of d[key]) if (!REGISTRY.has(id)) problems.push(`${d.id}.${key}: unknown ${id}`);
    if (d.minDistance >= d.maxDistance) problems.push(`${d.id}: distance range`);
    if (!d.nn.name || !d.nn.end?.endsWith('のに。')) problems.push(`${d.id}: nn.end must end with のに。`);
    if (d.duration[0] > d.duration[1]) problems.push(`${d.id}: duration`);
  }
  return problems;
}

export { REGISTRY };
