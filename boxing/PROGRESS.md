# ボクシング、なのに。 — 進捗メモ（作業の再開用）

ブランチ: `claude/tender-turing-g4y1fb`（main から作り直し済み）。止まったら、このファイルの「次にやること」から続ける。

## 方針（確定）
- タイトル画面の 6 枚目のカード: `src/core/Game.js` の `EXTERNAL.boxing` + `index.html` のカード（NEW はボクシングへ移動）+ `vite.config.js` の入力 `boxing`
- `boxing/` は 800m / トランポリン / サッカーと同じ独立ページ（#from-main で「← タイトルへ」）
- 観客は `soccer/src/crowd/CrowdField.js` / `CrowdDirector.js` / `NearCrowd.js` を再利用（アリーナ用の座席配置 `boxing/src/arena/ArenaLayout.js` が同じ形のデータを出す）
- 画面効果は `src/fx/EffectManager.js`（DigitalShader: 8bit / 監視カメラ / 魚眼 / 縦動画）、音は `src/audio/AudioManager.js` + `soccer/src/audio/SoccerAudio.js`（群衆の声）
- 入力はずっと A/D（←/→）・J・K・L・Space

## 進み具合
- [x] カード・ページ・ビルドの配線
- [ ] アリーナ（リング・ロープ・コーナー・リングサイド・吊り下げビジョン・観客）
- [ ] ボクサー（関節モデル + 手続きポーズ + 腕の IK）
- [ ] FightCore（HP・行動・AI・ダウン・判定）+ 普通の 3D で遊べる
- [ ] ボクシングシステム 10 種以上 + SystemDirector（R1 時刻 / R2 慣れたら / FINAL 重ね）
- [ ] HYPE・観客の反応・実況・情報パネルの増殖
- [ ] リプレイ（2 → 4 → 8 → 16 分割）・TV / スマホの小窓
- [ ] 入場・インターバル・FINAL・KO / 判定・結果
- [ ] 音（ゴング・パンチ・群衆・リズム）
- [ ] スモークテスト・スクリーンショット・README / ARCHITECTURE

## 次にやること
アリーナとボクサーと FightCore を作って、普通の 3D で 1 ラウンド遊べるようにする。
