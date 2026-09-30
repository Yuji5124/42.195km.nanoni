# トランポリン、なのに。 — 設計

「数秒しかない滞空時間に、ゲームを詰め込みすぎる。」
コアループは最後まで **踏む → 飛ぶ → 時間が伸びる → 入力する → 入力と偶然で世界が反応する → 着地する**。
すべてのイベントはこのループを壊さず、拡張するだけ。

## 1500m に影響しないための形

- `trampoline/` は独立したページ（`vite.config.js` の入力 `tramp`）。1500m / 42.195km のコード（`src/`）の部品を **読み込むだけ** で、`src/` からは何も読み込まない
- `src/` への変更は追加だけ:
  - `src/world/LandmarksStadium.js`: `concrete` / `darkMetal` / `glow` / `createStandCrowdMaterial` / `bigScreen` を export
  - `src/world/RunnerModel.js`: 観客の人形に `uHop`（全員が跳ぶ高さ。既定 0 = 今までどおり）
  - `src/core/Game.js` / `src/ui/UIManager.js` / `index.html`: タイトルの「別ページのモード」を 800m 専用から一般化（`EXTERNAL`）し、4 枚目のカードを追加
- 1500m のシェーダーを変える必要があるもの（観客ウェーブ）は、トランポリン側で `onBeforeCompile` を重ねて足す（`TrampolineArena.waveCrowdMaterial`）

## 再利用した部品

| 部品 | 元 | トランポリンでの使い方 |
| --- | --- | --- |
| 侍 `SamuraiModel` | 1500m の主人公 | 骨（腰・背骨・肩・肘・太腿・膝）をトランポリンの姿勢で動かす。髪・鉢巻・袴・刀のばねはそのまま |
| 脚の IK `solveLeg` | 同上 | ベッドの上で足を固定 → 沈むと膝が曲がる |
| 分身 `SamuraiModel({ ghost })` | 同上 | 速すぎる時の残像 |
| 板の観客 `createStandCrowdMaterial` | 国立競技場 | 360 度のボウルに貼る（数万人が 1 枚） |
| 観客の人形 `createHumanInstances` | 沿道・スタジアム | 手前 3 列（1 draw call）/ 審判 / 観客ドラマの 2 人 |
| 大型ビジョン `bigScreen` | 国立競技場 | 会場の 2 面 |
| `EffectManager` / `Particles` | 共通 | ブルーム・フラッシュ・紙吹雪・画面の残像。花火は別の `Particles`（世界の時間で動く） |
| `AudioManager` | 共通 | 観客のざわめき・拍手・BGM のシーケンサー・`tone` / `noiseHit`。トランポリンの効果音とワルツは `TrampolineAudio` |
| `CheerSystem` | 共通 | 会場の盛り上がり（`hype` → `excitement`） |
| `math.js` / `textures.js` | 共通 | 乱数・補間・Canvas テクスチャ |

1500m の `Input` は A/D/W/S/P/R/T/M を移動・ポーズに使うので、英単語を打つトランポリンには合わない → `TrampolineInput`（文字はすべて文字として受け取る）。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `TrampolineMode.js` | 状態の流れとループ。intro → ready → bounce → air → landed → result（× 10）→ final。天井 OPEN 後は bounce → super → sky → return |
| `TrampolineTime.js` | 2 つの時計（世界の時間 / UI の時間）。ヒットストップ・スロー |
| `TrampolinePhysics.js` | 疑似物理: ベッドのばね（沈む → 張る → 弾む）、踏み込み、脚の蹴り。1/120 秒に刻んで計算 |
| `TrampolineBed.js` | ベッドの頂点を毎フレーム変形（足の下が深く沈む皿）+ 周囲のばね（伸びる）+ フレーム・パッド |
| `TrampolineController.js` | 選手: 物理・回転（宙返り / ひねり / ピルエット）・姿勢の重み |
| `TrampolinePoser.js` | 姿勢の表（待機・踏み込み・上昇・空中・抱え込み・屈身・伸身・バレリーナ・大の字・落下・着地・着地失敗）を重みで混ぜる |
| `TrampolineTyping.js` | 単語 → 技。途中まででも回る、単語の連続 |
| `TrampolineScoring.js` / `TrampolineJudges.js` | 8 部門の内訳と審判 5 人（E スコア = 最高・最低を除いた平均） |
| `TrampolineCameraDirector.js` | ショット（WIDE / HIGH / JUDGE / FACE / ORBIT / CROWD / ROOF / LOOK / TELE / SKY / DOWN / SYNC / RESULT / INTRO）。UI の時間で動く |
| `TrampolineEventDirector.js` | `data/events.js` を読んで「いつ・どれを」起こすか。確率・重み・同時に 1 つ（group）・クールダウン・保証（guarantee）・カメラを握る（holdCamera） |
| `TrampolineEffects.js` | イベントの中身（ballet / faceLock / cameraLost / afterimage / invisible / crowdJump / flyer / drama / roofOpen …） |
| `TrampolineBackground.js` | 勝手に動く背景（花火・飛行機・鳥・ヘリ・照明・ウェーブ・フラッシュ）と「偶然の一致」の判定 |
| `TrampolineDrama.js` + `data/dramas.js` | 観客ドラマ（無声・字幕だけ・3〜8 秒） |
| `TrampolineArena.js` | 360 度の会場・屋根（左右にスライドするパネル）・照明・得点板・フラッシュ・ウェーブ |
| `TrampolineSkyJump.js` / `TrampolineSkyWorld.js` / `TrampolineSky.js` | 空の旅（高度・ゾーン・横風）/ 街・雲・帰る目印 / 夜空と地球 |
| `TrampolineHUD.js` + `style.css` | 中継の画面（PLAYER / ATTEMPT / HEIGHT / ROTATION / LANDING / SCORE / TOTAL）・内訳・実況・結果 |

## 時間を 2 つに分ける

`gameDt = realDt × scale`（ヒットストップ中は 0）。

- 世界の時間（`gameDt`）: 選手・ベッド・観客・花火・飛行機・背景の予定・残像の記録
- UI の時間（`realDt`）: タイピング・カメラ・HUD・実況・観客ドラマ・屋根の開閉・空の旅の台本

跳んだ瞬間のスローの強さは「ゆっくりな部分が実時間で約 4〜7 秒になる」ように踏み込みの良さから決める（= 入力できる時間）。
バレリーナ（×0.45）と SLOW（×0.55）はさらに掛け算。長くなりすぎたら（7 秒 / バレリーナ 9 秒）少しずつ普通の速さへ戻す。

## イベントの足し方

`data/events.js` に 1 行足すだけ。例:

```js
{
  id: 'PIGEON_SYNC',          // ?event=PIGEON_SYNC で強制発生
  name: 'ハトと一致',
  on: 'sync',                 // attempt / takeoff / word / air / descent / sync / land / super / sky
  kind: 'birds',              // sync の時: どの背景か
  level: 2,                   // テンポ（0 普通 → 3 意味不明）
  condition: (c) => c.sync?.moment === 'apex',
  chance: 0.5, cooldown: 1, guarantee: 7,
  duration: 1.5, cameraMode: 'SYNC',
  score: { cat: 'BACKGROUND', label: 'ハトと重なった', points: 900 },
  message: 'ハトと重なった！',  // 大きな文字（無ければ内訳に流れるだけ）
  comment: '（ハトです）',       // 実況
  effects: ['flash'],          // TrampolineEffects の名前
}
```

新しい動きが要る時は `TrampolineEffects.js` に `{ start, update, end }` を足す。
`npm run tramp:smoke` が表の食い違い（id の重複・無いエフェクト・知らない on・点の形）を検査する。

## 空の旅（SKY JUMP）

選手は高さ 60m に止めたまま、会場まるごと（`world` グループ）を縮めて下へずらす:

```
k = min(1, 600 / 高度)   world.scale = k   world.y = 60 − 高度 × k
```

見かけの大きさ（角度）は本物どおりで、数値はいつも数百 m 以内 → 120km 上空でも描画が安定する。
高度 400m より上では会場の中身（観客席・観客・審判・トランポリン）を描画しない。
地平線の下がり方（`acos(R / (R + h))`）と地球の街あかりは空のシェーダーで描く。
帰り道は横風に流され、`←` `→` で会場の真上に戻す（ずれ 1.3m 未満で PERFECT RETURN）。

## 軽さ

- 観客: 奥は板 1 枚、手前 3 列はインスタンス 1 draw call（スマホ 700 人 / PC 1400 人）。人ごとの SkinnedMesh は使わない
- 花火は 1 つの `Particles`（上限 3,200 粒）。フラッシュは `Points` 1 つ
- 分身（残像）は TOO FAST の間だけ表示
- 画面の品質は `EffectManager` がフレームレートを見て自動で下げる
- 通常 60〜90 draw call（空の上では 35〜60）
