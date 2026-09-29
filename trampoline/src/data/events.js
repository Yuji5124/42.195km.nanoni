// トランポリンのイベント（データ）。TrampolineEventDirector がこの表を読んで発生させる。
// 1 件 = 1 つの「なのに」。50〜100 件に増やしても、ここに足すだけで動く。
//
//   id        … 一意の名前（?event=ID で強制発生）
//   name      … 表示名（日本語）
//   kind      … on: 'sync' の時、どの背景か（'firework' / 'plane' / …）。guarantee の時はこの背景を頂点に合わせて出す
//   on        … いつ判定するか
//               'attempt'（試技の開始）/ 'takeoff'（跳んだ）/ 'word'（単語を打ち終えた）/ 'air'（空中で毎フレーム）
//               'descent'（落ち始め）/ 'sync'（背景と偶然一致）/ 'land'（着地）
//   level     … テンポ（0 普通 → 1 少し変 → 2 かなり変 → 3 意味不明 → 4 天井 OPEN・空）。これ未満では起きない
//   condition … (ctx) => bool
//   chance    … 起きる確率（1 回の判定ごと。'air' は 1 回の跳躍で 1 回だけ抽選）
//   weight    … 同じ group の候補が同時に来た時の選ばれやすさ
//   group     … 同時に 1 つだけ（'camera' = カメラの異常）
//   cooldown  … 起きた後、何試技のあいだ起きない
//   guarantee … この試技番号以降、まだ一度も起きていなければ必ず起きる（見せ場の保証）
//   once      … 1 ゲームで 1 回だけ
//   duration  … 秒（実時間）/ 'air'（着地まで）/ 'effect'（エフェクトが終わるまで）
//   cameraMode… カメラのショット（TrampolineCameraDirector）
//   timeScale … 空中のスローに掛ける倍率（バレリーナは世界がさらに遅くなる）
//   score     … { cat, label, points }（points は数値か (ctx) => 数値）。scoreOn: 'land' なら着地の時に
//   scoreIf   … 着地時に加点する条件（(ctx) => bool）
//   message   … 大きな「〜なのに、〜！」（無ければ内訳に流れるだけ）
//   comment   … 実況（真面目）
//   effects   … TrampolineEffects の名前の配列
//   block     … true の間は次の試技へ進まない（観客ドラマ）
//   holdCamera… true の間、他のイベントはカメラを切り替えない（観客ドラマ・FACE LOCK・見失い）

export const EVENTS = [
  // ---------------------------------------------------------------- 技
  {
    id: 'BALLERINA',
    name: 'バレリーナ',
    on: 'word',
    level: 0,
    condition: (c) => c.word === 'BALLERINA',
    duration: 'air',
    cameraMode: 'ORBIT',
    timeScale: 0.45,
    score: { cat: 'NANONI', label: 'トランポリンなのに、バレリーナ', points: 2400 },
    message: 'トランポリンなのに、<br>バレリーナ！',
    comment: '……優雅です。審判団は通常どおり採点します。',
    effects: ['ballet', 'crowdCheer'],
  },
  {
    id: 'AIR_JUMP',
    name: '空中ジャンプ',
    on: 'word',
    level: 0,
    condition: (c) => c.word === 'HIGH',
    cooldown: 0,
    score: { cat: 'NANONI', label: '空中なのに、もう一度跳んだ', points: 600 },
    message: '空中なのに、<br>もう一度跳んだ！',
  },
  {
    id: 'SELF_SLOW',
    name: '自分でスロー',
    on: 'word',
    level: 0,
    condition: (c) => c.word === 'SLOW',
    score: { cat: 'NANONI', label: '自分で時間を遅くした', points: 400 },
    comment: '選手自身が時間を遅くしました。規定上、問題ありません。',
  },

  // ---------------------------------------------------------------- 背景との偶然の一致（背景は独立して動いている）
  {
    id: 'FIREWORK_SYNC',
    name: '花火と一致',
    on: 'sync',
    kind: 'firework',
    level: 1,
    guarantee: 4,
    condition: (c) => c.sync?.kind === 'firework',
    cooldown: 0,
    duration: 1.5,
    cameraMode: 'SYNC',
    score: { cat: 'BACKGROUND', label: '花火とタイミングが合った', points: 1200 },
    message: '花火とタイミングが合った！',
    effects: ['flash'],
  },
  {
    id: 'PLANE_SYNC',
    name: '飛行機と一致',
    on: 'sync',
    kind: 'plane',
    level: 2,
    guarantee: 6,
    condition: (c) => c.sync?.kind === 'plane',
    duration: 1.8,
    cameraMode: 'SYNC',
    score: { cat: 'BACKGROUND', label: '飛行機と重なった', points: 800 },
    message: '飛行機と重なった！',
  },
  {
    id: 'BIRD_SYNC',
    name: '鳥と一致',
    on: 'sync',
    kind: 'birds',
    level: 2,
    condition: (c) => c.sync?.kind === 'birds',
    duration: 1.6,
    cameraMode: 'SYNC',
    score: { cat: 'BACKGROUND', label: '鳥と一緒に飛んだ', points: 700 },
    message: '鳥と一緒に飛んだ！',
  },
  {
    id: 'HELI_SYNC',
    name: 'ヘリのライト',
    on: 'sync',
    kind: 'heli',
    level: 2,
    condition: (c) => c.sync?.kind === 'heli',
    duration: 1.6,
    cameraMode: 'SYNC',
    score: { cat: 'BACKGROUND', label: '取材ヘリのライトが当たった', points: 900 },
    message: '取材ヘリのライトが当たった！',
  },
  {
    id: 'LIGHT_SYNC',
    name: '照明と一致',
    on: 'sync',
    kind: 'lights',
    level: 1,
    condition: (c) => c.sync?.kind === 'lights',
    score: { cat: 'BACKGROUND', label: '照明の演出と完全に一致', points: 1000 },
    message: '照明の演出と完全に一致！',
  },
  {
    id: 'WAVE_SYNC',
    name: 'ウェーブと同期',
    on: 'sync',
    kind: 'wave',
    level: 1,
    guarantee: 5,
    condition: (c) => c.sync?.kind === 'wave',
    score: { cat: 'BACKGROUND', label: '観客ウェーブと完全同期', points: 1600 },
    message: '観客ウェーブと完全同期！',
  },
  {
    id: 'FLASH_SYNC',
    name: 'フラッシュ',
    on: 'sync',
    kind: 'flashes',
    level: 1,
    condition: (c) => c.sync?.kind === 'flashes',
    score: { cat: 'BACKGROUND', label: 'フラッシュが一斉に光った', points: 500 },
    effects: ['flash'],
  },

  // ---------------------------------------------------------------- カメラの異常（同時に 1 つ）
  {
    id: 'FACE_LOCK',
    name: 'FACE LOCK',
    on: 'takeoff',
    level: 1,
    group: 'camera',
    chance: 0.35,
    guarantee: 3,
    cooldown: 2,
    duration: 'air',
    cameraMode: 'FACE',
    holdCamera: true,
    effects: ['faceLock'],
    scoreOn: 'land',
    scoreIf: (c) => c.revs >= 0.75,
    score: { cat: 'CAMERA', label: '顔しか見えない', points: 600 },
    message: '顔しか見えない！',
    comment: '（カメラは選手の表情を追っています）',
  },
  {
    id: 'CAMERA_LOST',
    name: 'カメラが見失う',
    on: 'descent',
    level: 2,
    group: 'camera',
    chance: 0.35,
    guarantee: 6,
    cooldown: 2,
    duration: 'effect',
    cameraMode: 'LOOK',
    holdCamera: true,
    effects: ['cameraLost'],
    scoreOn: 'land',
    score: { cat: 'CAMERA', label: '間に合わなかった', points: 800 },
    message: '間に合わなかった！',
    comment: '……ただいまの着地、映像がありません。',
  },
  {
    id: 'TOO_FAST',
    name: '速すぎる',
    on: 'air',
    level: 2,
    condition: (c) => c.rotSpeed > 26,
    duration: 'air',
    effects: ['afterimage'],
    score: { cat: 'CAMERA', label: '速すぎて見えない', points: 2800 },
    message: '速すぎて見えない！',
  },
  {
    id: 'SLOW_BUT_FAST',
    name: 'スローなのに見えない',
    on: 'air',
    level: 2,
    condition: (c) => c.visualRotSpeed > 9 && c.timeScale < 0.4,
    duration: 'air',
    effects: ['afterimage', 'invisible'],
    score: { cat: 'NANONI', label: 'スローなのに見えない', points: 5000 },
    message: 'スローなのに、<br>見えない！',
    comment: 'スーパースローでお送りしています。',
  },

  // ---------------------------------------------------------------- 観客
  {
    id: 'AUDIENCE_JUMP',
    name: '観客も跳ぶ',
    on: 'land',
    level: 1,
    guarantee: 5,
    cooldown: 1,
    condition: (c) => !c.failed && c.attemptSum >= 9000,
    effects: ['crowdJump'],
    score: { cat: 'AUDIENCE', label: '観客も飛んだ', points: (c) => 400 + Math.min(2600, c.attemptSum * 0.08) },
    message: '観客も飛んだ！',
  },
  {
    id: 'AUDIENCE_FLYER',
    name: '一人だけ飛びすぎ',
    on: 'land',
    level: 2,
    chance: 0.6,
    guarantee: 8,
    condition: (c) => !c.failed && c.attemptSum >= 9000,
    effects: ['flyer'],
    score: { cat: 'AUDIENCE', label: '一人だけ飛びすぎ', points: 800 },
  },
  {
    id: 'AUDIENCE_DRAMA',
    name: '観客ドラマ',
    on: 'air',
    level: 3,
    chance: 0.3,
    guarantee: 7,
    cooldown: 1,
    condition: (c) => c.airT > 0.5 && c.ascending,
    duration: 'effect',
    block: true,
    cameraMode: 'CROWD',
    holdCamera: true,
    effects: ['drama'],
    comment: '（中継は競技の模様をお伝えしています）',
  },

  // ---------------------------------------------------------------- 失敗も点になる
  {
    id: 'LANDING_FAIL',
    name: '着地失敗',
    on: 'land',
    level: 0,
    condition: (c) => c.failed,
    score: { cat: 'NANONI', label: '着地失敗、なのに加点', points: 350 },
    message: '着地失敗、なのに。',
    comment: '着地は乱れました。審判の判断を待ちます。',
  },
  {
    id: 'DID_NOTHING',
    name: '何もしなかった',
    on: 'land',
    level: 0,
    condition: (c) => c.typedNothing,
    score: { cat: 'NANONI', label: 'ただ跳んだだけ、なのに', points: 150 },
    message: '何もしなかった、なのに。',
  },
];
