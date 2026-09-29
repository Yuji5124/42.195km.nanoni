# 800m、なのに。 ─ 設計

「2周だけなのに、何回ゲーム変わるの？」

一番大事な決まり: **RaceCore（レースの中身）は絶対に壊さない。壊すのは Presentation（見せ方）だけ。**
距離・速度・スタミナ・順位・タイムを書き換えてよいのは RaceCore だけ。Modifier はそれを読むことしかしない。

## 全体の流れ

```
入力 / Bot ─→ intents ─→ RaceCore.step(1/60 秒固定)  ← 決定的（seed + 入力が同じなら同じレース）
                              │ EventBus（RACE_START / DISTANCE / LAP_2 / FINAL_40 / FOOTSTEP …）
                              ├→ CrowdEnergy（CHEER）
                              ├→ ChaosDirector ─→ ModifierManager.start / clear
                              ├→ ModifierManager.step（寿命・フェード）
                              └→ TvDirector（中継の被写体）

毎フレーム:
  Presentation = DEFAULTS に戻す
  → ModifierManager.apply（カテゴリ順に重ね書き）→ finale（760m 以降の決まり）→ カメラの上書き
  → 描画（RunnerManager / Stadium / Camera / PostProcessing）・HUD・音・実況 は Presentation と RaceCore を「読むだけ」
```

- 固定ステップの中にあるものは全部決定的（`Math.random` / 実時間を使わない）。演出の順番も seed で決まる。
  `npm run race-test -- --determinism` が「速さを変えても同じ結果・同じ演出」になることを確かめる。
- Presentation は毎フレーム作り直すので、Modifier を止めた瞬間に元へ戻る（片付け忘れが起きない）。

## フォルダ

| フォルダ | 中身 |
| --- | --- |
| `src/core/` | Game（配線だけ）、Clock（1/60 固定）、EventBus、Input、seed、URL パラメータ、画質 |
| `src/race/` | **RaceCore**・論理トラック（400m、8 レーン）・体（速さ / スタミナ / リズム） |
| `src/runners/` | Bot（性格からの意図）、手続き的リグ（23 本の骨・SkinnedMesh）、走りのアニメ（IK・ばね）、侍と選手の見た目 |
| `src/stadium/` | トラック・スタンド・照明・スコアボード・3D 観客（Instanced）・CHEER・床（雲 / 海 / 宇宙）・見た目の変形 |
| `src/modifiers/` | Presentation の既定値、Modifier の登録簿と管理、ChaosDirector、なのに文、`library/`（Modifier 本体） |
| `src/camera/` | CameraRig（全カメラのポーズ）、TvDirector（InterestScore） |
| `src/fx/` | ポストエフェクト（1 パスにまとめた壊し方）、頂点スナップ、天気 |
| `src/audio/` | WebAudio の効果音・呼吸・歓声、距離で変わる音楽 |
| `src/ui/` | HUD（スキン 7 種）、実況、CSS |
| `src/data/` | 12 人の選手・12 の性格（データ） |
| `tools/` | smoke / race-test / filmstrip / gallery / benchmark / mobile（Playwright） |

## Modifier の足し方（これだけ）

`src/modifiers/library/` のどれか（または新しいファイル → `library/index.js` で import）に 1 つ書く:

```js
defineModifier({
  id: 'fisheye',                  // ?modifier=fisheye で呼べる
  category: 'VISUAL',             // VISUAL CAMERA WORLD PHYSICS RUNNER CROWD UI TIME AUDIO GENRE
  minDistance: 120, maxDistance: 745,
  duration: [5, 9],               // 秒（レース内の時間）
  intensity: [0.55, 1],           // 混沌度が高いほど強く出る
  weight: 1.3,                    // 出やすさ
  slots: [],                      // 同じスロット（camera / skin / pixel / sky / time …）は同時に 1 つ
  incompatible: [],               // 同時に起こさない相手
  synergy: ['firstPerson'],       // 一緒だと面白い相手（出やすくなる）
  nn: { name: '魚眼', end: '魚眼なのに。', te: '魚眼で', adv: '魚眼で', pred: '魚眼で映っている' },
  apply: (P, k) => (P.post.fisheye = Math.max(P.post.fisheye, 0.9 * k)),
});
```

- `apply(P, k, inst, ctx)` は毎フレーム呼ばれる。`k` = 強さ × フェード（0〜1）。**P（Presentation）以外に書かない。**
- 重ね掛けで壊れない書き方にする（`Math.max`・掛け算・`put.minNonZero`・`put.sky`）。上書き（`=`）は切り替え式の値だけ。
- `nn` はなのに文の部品。`end` は必ず「のに。」で終わる（smoke テストが確認）。
  組み合わせの時は `subj`（〜が）+ `adv`（〜で / 〜に）+ `pred`（〜ている）+「のに。」で文になる。
- 見た目に必要な値が Presentation に無ければ `presentation.js` の DEFAULTS に足し、読む側（描画 / HUD / 音）を 1 か所直す。
- 確認: `npm run gallery -- --only=fisheye`（1 枚）、`--combo=fisheye+tv+giant`（組み合わせ）。

## ChaosDirector（いつ・何を・いくつ）

- 混沌度（chaosLevel）は距離の曲線: 0:0.05 → 200:0.25 → 400:0.55 → 600:0.85 → 700:1.0 → 750:0.65 → 780:0.25 → 800:0
- 同時に動く数 ≈ `floor(chaos × 4.4 + 0.25)`（600〜700m は +0.6）。足りなければ候補から 1 つ抽選
- 候補の重み: weight × 相性（synergy が動いていれば ×2.4）× 同じカテゴリが多いと減る × 距離の範囲。直近 5 個は出ない
- 節目: 80〜120m 最初の小さな異変 / 400m カメラ + 見た目 + 観客 / 600m 4〜5 個 / 720m 最大（`big: true` から）/ 760m 全消去
- LEGENDARY は 2%（`?legendary=1` で必ず）。決まった距離（`at`）で起きる

## 走り（RaceCore と体）

- 速さ = (5.2 + 3.6 × effort) × 疲労 × リズム効率 × ドラフト × その日の調子（seed）
- スタミナ: effort 0.6 を超えた分の 1.6 乗で減る。前半に飛ばすと 400〜650m が苦しい。スパートは 1m あたり約 0.9
- リズム（SPACE を接地に合わせる）: PERFECT が続くと効率 +1.2%・消費 −10% まで
- カーブの外側は損（進み = R / (R + 外への距離)）。前がふさがると抜くために外へ。後ろの選手が譲る（大外に押し付けない）
- CPU の終盤: 残り 1m あたりのスタミナで攻め / スパートを決める。最後の 40m は全員全力

## 画面・性能

- 選手は 1 人 1 draw call（リグ + 頂点カラー）、観客は InstancedMesh 1 つ + スタンドの板、影も Instanced
- ポストエフェクトは Bloom + 1 パス（魚眼・低解像度・減色・CRT・グリッチ・色調・黒帯 …）。疑似 Low FPS は「描かないフレーム」
- 画質: low / medium / high（`?quality=`、スマホは low）。medium で約 50 draw call・7.5 万三角形（4 分割でも約 120）

## AI が改善を続けるためのループ

1. 変更 → `npm run smoke`（起動・console error・Modifier 定義）
2. `npm run race-test -- --determinism`（完走・順位・演出の順番・再現性）
3. 見た目は `npm run gallery` / `npm run filmstrip` の一覧画像を見る
4. スマホは `npm run mobile`、重さは `npm run benchmark`
5. ブラウザでは `window.__nanoni`（`state()` / `events` / `result()` / `modifiers.start('tv')` …）で中から観察できる
