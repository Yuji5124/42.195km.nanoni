# 42.195km、なのに。 — 調査報告と設計

> 現在: 0〜5km（西新宿 → 飯田橋）。下の「0〜5km への拡張」を参照。

> 走るだけ。なのに、ゲームが全然落ち着かない。

## A. CURRENT STATE（着手時点）

- リポジトリにあったのは `README.md`（タイトル 1 行）のみ。コミットは 1 つ。
- `package.json` / src / assets / Three.js / シェーダー / 3D モデル / 音 / 参考コードは **いずれも無し**。
- → 壊してはいけない既存実装は無い。ゼロから Vertical Slice を構築した。

## B. REUSABLE ASSETS

- リポジトリ内に再利用できるコード・素材は無し。
- 画像・音・フォントファイルに依存しないよう、以下はすべて **コードで生成**:
  - 看板・横断幕・道路標識・巨大ビジョン・ドット絵背景・ゴールライン → Canvas テクスチャ（`src/world/textures.js`）
  - ランナー / 観客 → ボックス結合のローポリ人型 + 頂点シェーダーで手足を振る（`src/world/RunnerModel.js`）
  - BGM・歓声・効果音 → WebAudio 合成（`src/audio/AudioManager.js`）
- フォントは Google Fonts（Dela Gothic One / DotGothic16 / Chakra Petch）を優先し、オフライン時は OS の日本語フォントにフォールバック。

### 参考 GitHub リポジトリの扱い

「コードをコピーして統合するのではなく、設計パターン・アルゴリズム・表現方法を調査し、最小限で再実装する」方針。

| 参考 | このゲームでの使い方 | 実装先 |
| --- | --- | --- |
| mrdoob/three.js | 本体。InstancedMesh・EffectComposer・UnrealBloom・OutputPass を使用 | 全体 |
| pmndrs/postprocessing | Glitch / Chromatic Aberration / Pixelation / Noise / Scanline を **1 パスの自作シェーダー**に集約（依存追加なし） | `src/fx/DigitalShader.js` |
| yomotsu/camera-controls | 「ポーズ（位置・注視点・FOV）をブレンドして遷移」の考え方。被写体サイズを保つドリーズーム補間 | `src/director/CameraDirector.js` |
| Mugen87/yuka, ercang/boids-js | 前方ブロック時の横回避・速度合わせ・レーンの揺らぎ（簡易ステアリング） | `src/race/AIRunnerManager.js` |
| spite/THREE.MeshLine | カメラに正対する帯でネオン残像（どの視点でも見える） | `src/fx/Trail.js` |
| Alchemist0823/three.quarks, three-nebula | エミッター → リングバッファ → 一括アップロードの軽量パーティクル（火花・紙吹雪） | `src/fx/Particles.js` |
| jeromeetienne/threex.proceduralcity, thepearson/procedural-city | 決定的乱数によるチャンク単位の街生成、スロット再利用 | `src/world/TokyoChunkManager.js` |
| Rototu/procedural-skyscraper-… | 窓の明かり・ネオン帯をシェーダーで生成（テクスチャ不要） | 同上（building shader） |
| mrdoob/Starter-Kit-Racing, open-runner | 低いカメラ・速度で FOV を広げる・前方生成 / 後方破棄のループ | `CameraDirector` / `CourseManager` |
| yc62/GrayBox_Super_Mario_Bros | 3D 空間のまま「真横 2D」に見せる区間（望遠カメラ + レーン固定） | `CameraDirector` SIDE_2D |

第 2 陣以降（boids 大量群衆、ASCII / pixelation、Terrain / ocean、Portal、Rapier 重力反転など）はステージ追加時に 3〜8 本ずつ参照する。

## C. RISKS

| リスク | 対策 |
| --- | --- |
| 大量ランナー・観客・ビルの描画負荷 | すべて InstancedMesh。手足・観客の盛り上がりは頂点シェーダー（CPU 負荷ほぼ 0）。draw call は約 30 で固定 |
| 42km の座標精度 | `raceDistance` とワールド座標を分離。インスタンスは近傍のみ描画、道路は追従ストリップ |
| 真横 2D で手前の観客・ビルが被写体を隠す | 望遠カメラ（FOV 9.5°）+ near クリップで手前側を消す。プレイヤーはレーン固定、AI は奥側へ |
| カメラ演出で「どこへ行けばいいか」分からなくなる | 正面視点は短時間のみ。near はプレイヤーを絶対に切らない。常に前進すれば良い設計 |
| 日本語フォント不在 | Web フォント → OS フォントのフォールバック。フォント読込は最大 2.5 秒で打ち切り |
| 低スペック端末 | FPS 監視 → 自動で品質を段階的に下げる（ピクセル比 → ブルーム無効） |
| 依存の増加 | **依存は `three` と `vite` のみ**。物理（rapier）/ AI（yuka）/ パーティクル（quarks）は 0〜3km では不要なので未導入。重力反転や物理障害物が必要になった段階で理由を添えて追加する |

## D. ARCHITECTURE

```
src/
  main.js                  エントリ
  config.js                チューニング値（速度・スタミナ・距離スケール）
  core/
    Game.js                各システムを組み立て、EventBus でつなぐ薄い層
    EventBus.js            疎結合な通知
    Input.js               入力の「意味」への抽象化（キーボード / タッチ）
    math.js                決定的乱数・補間
  race/                    ── 普通のマラソン（壊れない層）
    RaceManager.js         タイトル → カウントダウン → レース → ゴール → リザルト、順位、記録
    DistanceManager.js     raceDistance ⇔ ワールド座標、表示速度、レース時計
    RunnerController.js    プレイヤー（侍ランナー）: 走る・跳ぶ・ダッシュ・転倒・スタミナ
    AIRunnerManager.js     255 人の AI ランナー + ライバル（忍者）
    CheerSystem.js         CHEER（声援）・コンボ・街の盛り上がり
  director/                ── 壊す層
    EventDirector.js       距離に応じて世界とゲームルールを変える（JSON データ駆動）
    CameraDirector.js      見え方を変える（通常 / TV 中継 / 真横 2D / ゴール）
  world/
    TokyoChunkManager.js   ローポリ × デジタル東京のチャンク生成・再利用、ランドマーク
    Landmarks.js           スタート / km / ゴールアーチ、都庁、大ガード + 山手線、巨大ビジョン
    CrowdManager.js        沿道の観客（リングバッファ、盛り上がりはシェーダー）
    CourseManager.js       障害物・アイテム・横スクロール区間のパターン
    RunnerModel.js         インスタンス化ローポリ人型 + アニメーションシェーダー
    textures.js            Canvas 生成テクスチャ
  fx/
    EffectManager.js       ポストエフェクト・パーティクル・残像・自動品質調整
    DigitalShader.js       Glitch / 色収差 / ピクセル化 / 走査線 / スピード線 / ビネット
    Particles.js           軽量パーティクル
    Trail.js               ネオン残像
  audio/AudioManager.js    WebAudio 合成の BGM（モードでジャンルが変わる）・歓声・効果音
  ui/                      HUD・キャプション・実況・TV テロップ・リザルト
  data/
    vertical-slice.json    0〜3km のイベント・ランドマーク定義
    areas.json             42.195km 全体の東京エリア定義（将来用）
```

**分離の原則**

- `RaceManager` … 普通のマラソン。カメラ・世界がどう変わっても順位・時計・ゴールは同じ。
- `CameraDirector` … 見え方だけを壊す。各モードは「ポーズ」を返すだけで、切替はブレンド or カット。
- `EventDirector` … 世界とルールを壊す。`paramAt(key, km)` で前方の生成物（観客密度・障害物・パターン）も距離から決まる。

**入力は増やさず、意味を変える**

| モード | ←→ | ↑↓ | SPACE | SHIFT |
| --- | --- | --- | --- | --- |
| 通常 3D / TV 中継 | 横移動 | ペース | ジャンプ | ダッシュ |
| 真横 2D | 加速 / 減速（画面基準） | ↑ もジャンプ | ジャンプ | ダッシュ |

## E. VERTICAL SLICE（0〜3km）

| km | イベント | 内容 |
| --- | --- | --- |
| 0.0 | START | 都庁前スタート。255 人と一斉スタート（中団から） |
| 0.18 | 障害物 ON | コーン・バリケード・バナナ、おにぎり（スタミナ）・シューズ（加速） |
| 0.8 | 声援増加 | 観客密度アップ。柵ぎりぎりを走るとハイタッチ |
| 1.2 | **TV 中継** | カットで切替。ヘリ / 沿道追走 / 正面望遠 / 定点 / 中継バイク。LIVE テロップ、CHEER ×2 |
| 1.55 | 新宿大ガード | 高架の下を通過、山手線が頭上を走る |
| 1.8 | 通常に戻る | |
| 2.2 | **真横 2D** | ドリーズームで真横へ。ピクセル化 + チップチューン BGM。ハードル・木箱・♪トークン |
| 2.7 | 3D に戻る | 「……戻った。」 |
| 2.86 | 最後の直線 | 障害物を撤去、観客最大、ギミック無し |
| 3.0 | 仮ゴール | 横一列の普通のゴール。スロー + 紙吹雪 → リザルト |

**リザルト**: TIME / POSITION / CHEER / MAX SPEED / OVERTAKES / FALLS / CHEER COMBO / CAMERA CHANGES。
盛り上げ度（S〜C）は順位ではなく CHEER で決まる。

## 検証（ヘッドレス Chromium / SwiftShader）

`npm run build` 後に `vite preview` を立て、Playwright で確認した内容。

| 確認項目 | 結果 |
| --- | --- |
| ビルド | `vite build` 成功（依存: three 0.186 / vite 8） |
| 0〜3km 通しプレイ（`?auto&fast=4`） | START → NORMAL → TV_BROADCAST → NORMAL → SIDE_2D → NORMAL → GOAL → リザルトまで到達。pageerror なし |
| 転倒 → 起き上がり | 転倒 → COMEBACK! の CHEER → 復帰。エラーなし |
| 描画負荷 | draw call 約 30〜60、約 21 万ポリゴン（観客は低ポリ版の人型） |
| スマホ（iPhone 13 相当・縦） | HUD の重なりなし、タッチボタン表示、縦画面では FOV を自動で広げる |

ソフトウェアレンダリングでは 20fps 程度のため自動で品質が下がる（実機 GPU では通常 60fps を想定）。
サンドボックスでは Google Fonts が証明書エラーで読めず OS フォントにフォールバックしたが、動作に影響はない。

### バランス（自動操縦での目安）

- 自動操縦（そこそこの腕前）で 20〜40 位、CHEER 6,000〜7,000（B）
- 先頭集団は約 18 u/s。プレイヤーが持続できる平均速度（巡航・ペースアップ・ダッシュの配分）とほぼ互角で、
  **声援の後押し（段階 × 0.22）やシューズで先頭に届く**設計。1 位になると CHEER が毎秒 55 入る
- 盛り上げ度: S ≥ 12,000 / A ≥ 8,000 / B ≥ 4,500

## 0〜5km への拡張（カーブ・動物・ギャグ）

### カーブ（`src/world/CoursePath.js`）

- コースは中心線 1 本。`curves: [{ fromKm, toKm, turnDeg }]` から曲率を sin 形で与え、1 単位刻みで向き θ と位置を積分した表を持つ。
- すべての物体は **(s = 前進量, x = 横ずれ)** のまま扱い、描画のときだけ `toWorld(s, x, y)` / `writeMatrix()` でワールドに変換する。
  → 順位・衝突・距離判定はカーブがあっても直線のときと同じコードで動く。
- 道路・歩道・柵・お堀はチャンクごとに中心線へ沿わせたリボンメッシュ。ビル・看板・街灯・観客・ランナー・障害物は同じ変換で配置。
- カメラのポーズもコース座標で書き、先の地点を注視する → 自然にカーブの先を見る。カーブでは少しだけ内側に傾く。
- カーブでは速いほど外側へふくらむ（曲率 × 速度² のドリフト）。ダッシュ中は内側への操作が必要になる。

### 動物（`src/world/AnimalModel.js`）

- 猫・柴犬もランナーと同じく「箱の結合 + 頂点シェーダーで脚・しっぽを動かす」InstancedMesh。
- 猫はコース上のハザード（`CourseManager`）。歩道で待ち、プレイヤーが近づくと横切る → 位置が毎回変わる。

### ギャグ（`src/director/GagDirector.js`）

EventDirector のイベントに `"gag": "<名前>"` を書くと起動し、プレイヤーとの距離で進行する。

| gag | 内容 | 遊びとしての意味 |
| --- | --- | --- |
| `trainRace` | 外濠沿いを総武線が並走 | ダッシュ配分で電車を抜く（勝てば +400） |
| `dogPacer` | 柴犬 3 匹が伴走 | そばを走り続けると WAN! が連続 |
| `signal` | 赤信号。AI は停止線に並んで止まる | 止まれば MANNERS、無視すると順位は上がるが減点 + 横断する車 |
| `giantDog` | 巨大柴犬がコースをまたぐ | 見せ場（CHEER の盛り上がりが上がる） |

データ側では `cats`（猫の出現率）、`pattern: "catStampede"`、`world: "wireframe"`、`fx: "glitch"` も使える。

## 次の実装候補

1. 実プレイでの難易度調整（AI 速度・障害物密度・スタミナ）
2. 3〜10km: 真上シューティング（TOP_DOWN）、レースゲーム視点（RACING_CAMERA）
3. 観客の旗・スマホ撮影モデル、実況音声（WebSpeech 等）
4. 鏡世界（MIRROR）、監視カメラ（CCTV）、重力 90°（GRAVITY_SHIFT：ここで Rapier を検討）
5. 42km 以降の「異常が消えていく」演出と、本番のゴール（丸の内）
