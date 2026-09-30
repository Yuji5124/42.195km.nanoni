# ボクシング、なのに。 — 進捗メモ（作業の再開用）

ブランチ: `claude/tender-turing-g4y1fb`（main から作り直し済み）。止まったら、このファイルの「次にやること」から続ける。

## 方針（確定）
- タイトル画面の 6 枚目のカード: `src/core/Game.js` の `EXTERNAL.boxing` + `index.html` のカード（NEW はボクシングへ移動）+ `vite.config.js` の入力 `boxing`
- `boxing/` は 800m / トランポリン / サッカーと同じ独立ページ（#from-main で「← タイトルへ」）
- 観客は `soccer/src/crowd/CrowdField.js` / `CrowdDirector.js` / `NearCrowd.js` を再利用（アリーナ用の座席配置 `boxing/src/arena/ArenaLayout.js` が同じ形のデータを出す）
- 画面効果は `src/fx/DigitalShader.js`（`boxing/src/view/BoxingFx.js` が 1 パスで使う）、音は `src/audio/AudioManager.js` + `soccer/src/audio/SoccerAudio.js`（群衆の声）+ `boxing/src/audio/BoxingAudio.js`
- 入力はずっと A/D（←/→）・J・K・L・Space

## 進み具合
- [x] カード・ページ・ビルドの配線
- [x] アリーナ（リング・ロープ・コーナー・リングサイド・吊り下げビジョン・観客 約 2 万人）
- [x] ボクサー（関節モデル + 手続きポーズ + 腕の IK）・レフェリー
- [x] FightCore（HP・行動・AI・ダウン・判定）+ 普通の 3D で遊べる
- [x] ボクシングシステム 13 種 + SystemDirector（R1 時刻 / R2 慣れたら / R3 中継系 / FINAL 重ね → ??? → 3D）
- [x] HYPE・観客の反応・実況（ドリフト）・情報パネルの増殖・テロップ・CM（L 字）
- [x] リプレイ（1 → 2 → 4 → 8 → 16 分割）・小窓の中継・吊り下げビジョン
- [x] 入場・インターバル・FINAL・KO / 判定・結果
- [x] 音（ゴング・パンチ・群衆・リズム・8bit）
- [x] スモークテスト（`node boxing/tools/smoke.mjs`）・システム一覧の撮影（`node boxing/tools/systems.mjs`）
- [x] README / ARCHITECTURE・package.json のスクリプト（boxing:smoke / boxing:systems / boxing:shot）
- [x] 仕上げ 1 回目（白飛び・各システムのカメラ・永久コンボ・難易度・入場の照明・インターバルの椅子・ポーズ解除・スマホの配置）
- [x] タイトル画面の 6 枚を PC 3 + 3 / スマホ縦 1 列 / スマホ横 3 + 3 に
- [x] 選手をなめらかに（筋肉の輪郭の回転体・丸い関節・なめらかな陰影・ポーズの平滑化・肘をしまう・膝の向き）
- [x] ROUND 1 のハプニング 9 種（show/Happenings.js）

## 次にやること
遊んだ人の感想を待つ。候補: 観客のボード（応援パネル）・入場曲・リプレイ中の実況・FINAL の ??? の演出を増やす・実機 GPU での FPS 計測。
main へ PR を出してマージ → GitHub Pages（https://yuji5124.github.io/42.195km.nanoni/boxing/）に公開。以後の修正は main から作り直したブランチで。
