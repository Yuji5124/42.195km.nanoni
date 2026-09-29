import marathonData from '../data/vertical-slice.json';
import m1500Data from '../data/mode-1500m.json';
import { Sections1500 } from './m1500/Sections1500.js';

// レースモードの定義。タイトル画面で選ぶ。
// 共通のシステム（道路・観客・カメラ・CHEER・音）はそのまま使い、距離のスケール・人数・演出データだけを差し替える。
//
//   metersPerUnit     … 1 ワールド単位 = 何レース m か（1500m は「短い距離に東京を全部詰め込む」ので小さい）
//   displayCruiseKmh  … 巡航時に表示する速度
//   ai                … CPU ランナーの人数と並び方
export const RACE_MODES = {
  marathon: {
    id: 'marathon',
    title: ['42.195km、', 'なのに。'],
    data: marathonData,
    metersPerUnit: 1.5,
    displayCruiseKmh: 20,
    fullKm: 42.195,
    distUnit: 'km',
    timeFormat: 'hms',
    startLine: { s: -1 - 9 * 1.35, x: 0 },
    ai: { count: 255, gridColumns: 12, gridRowSpacing: 1.35, playerRow: 9, layout: 'grid', rescoreAfter: 0 },
    countdown: null,
    note: 'VERTICAL SLICE ─ 西新宿〜浅草（0〜15km）<br />先頭を走るほど、観客を沸かせるほど CHEER が増える。',
  },
  '1500m': {
    id: '1500m',
    title: ['1500m、', 'なのに。'],
    data: m1500Data,
    // 1500m ≒ 5360 単位。ペースアップで約 4.8 分・巡航で約 5.6 分、全部のジャンルを通り抜ける
    // 時計は「ずっとペースアップ ≒ 3 分 30 秒前後」。世界記録（3:26.00）はダッシュを上手に使えば届く
    metersPerUnit: 0.28,
    displayCruiseKmh: 22,
    fullKm: 1.5,
    distUnit: 'm',
    timeFormat: 'ms',
    startLine: { s: -1, x: 0.53 },
    ai: { count: 11, layout: 'waterfall', rescoreAfter: 6, pacing: 'middle' },
    countdown: { 3: '位置について', 2: 'よーい', 1: '', go: 'START' },
    goalText: 'FINISH',
    tvTitle: '1500m 決勝 ─ FINAL<br /><small>TOKYO 生中継</small>',
    photoFinish: true,
    createSections: (game) => new Sections1500(game),
    lines: {
      start: 'スタートしました！ 1500m 決勝、12 人が一斉に飛び出します！',
      finish: (pos) =>
        pos === 1
          ? '侍ランナー、優勝！ …1500m しか走っていません！'
          : `侍ランナー、${pos}位でフィニッシュ！ …1500m しか走っていません！`,
    },
    note: '12 人で走る 1500m 決勝。5〜7 分。<br />…なのに、ジャンルが 10 回変わる。',
  },
};

export const MODE_ORDER = ['marathon', '1500m'];

export function getMode(id) {
  return RACE_MODES[id] ?? RACE_MODES.marathon;
}
