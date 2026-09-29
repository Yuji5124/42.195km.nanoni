import { TrampolineMode } from './TrampolineMode.js';

// 『トランポリン、なのに。』の入口。1500m / 42.195km のコード（../../src）の部品を読み込んで使うが、
// 1500m 側からは何も読み込まない（このページを消しても 1500m は変わらない）。
const mode = new TrampolineMode(document.getElementById('game'));
mode.init();
