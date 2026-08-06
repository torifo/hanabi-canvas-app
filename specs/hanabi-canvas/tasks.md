# 『花火と心模様』(Hanabi Canvas) Tasks

担当略記: **[F]** Fable 5（graphics/ui）/ **[Sol]** GPT-5.6 Sol / **[Terra]** GPT-5.6 Terra / **[Luna]** GPT-5.6 Luna
※ 各担当への依頼プロンプト（prompts/）は統合完了に伴い削除済み（2026-07-26）。契約の現行版は design.md と src/types.ts

## Implementation Plan

### Wave 1（並列 — 依存なし: 足場とインターフェース確定）

- [x] **Task 1.1** [Sol]: プロジェクトセットアップ
  - What: Vite + TypeScript 雛形、`base: './'`、ディレクトリ構造（src/graphics, ui, audio, realtime, desktop / server / public/data）、design.md の Interface Contracts を `src/types.ts` として配置
  - Files: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/types.ts`
  - Done when: `npm run dev` で空キャンバスが表示され、`npm run build` が通る
  - Depends on: none

- [x] **Task 1.2** [F]: ベースイラスト制作（決定: コード生成・3案比較）
  - What: SVG/プロシージャル描画によるコード生成で、モチーフ3案（①夜の縁側＋手持ち花火 ②海辺の夜＋遠花火 ③夏祭りの帰り道）を試作し、比較の上1案に決定。**横長構図をベース**に制作し、縦（モバイル）はその派生アセットとして展開（縦横2アセット方式）。高光度領域（花火先端・街灯・星）を Bloom 閾値で拾える輝度設計にする
  - Files: `public/assets/canvas-base.png`（横・2560px級ブリード付きマスター）, `public/assets/canvas-base-portrait.png`（縦）, `public/assets/canvas-emitters.json`（光源座標マップ）＋ 生成ソース（`artwork/`）
  - 輝度設計: イラスト本体はLDR（最大 sRGB ≒ 200）、ハイライトのコアは `#FFF6E0` 系に脱彩（純色はリニア輝度が閾値に届かない）。発光はコード側の加算スプライトで行う
  - Done when: 3案の比較からユーザーが1案を選定し、横縦2アセット＋emitters.json が public/assets に配置される
  - Depends on: none

- [x] **Task 1.3** [Terra]: WebSocketサーバー
  - What: Node.js + ws の Pub/Sub 中継。SparkMessage 検証、送信元以外へ転送、メッセージ長・レート制限、DB/ログ永続化なし
  - Files: `server/server.js`, `server/package.json`
  - Done when: 統合テスト（複数クライアント接続で転送・黙殺・制限を検証）が通る
  - Depends on: none

- [x] **Task 1.4** [Terra]: 花火日程データ & カウントダウン
  - What: `HanabiEvent[]` の全国スケジュールJSON作成、`HanabiSchedule` 実装（load / nextEvent / countdown）
  - Files: `public/data/hanabi-schedule.json`, `src/realtime/HanabiSchedule.ts`
  - Done when: カウントダウン計算のユニットテスト（開催中・終了直後・空データ境界）が通る
  - Depends on: none

- [x] **Task 1.5** [Luna]: 環境音アセット準備
  - What: パチパチ音・波・雨・虫の声のループ音源（シームレス加工済み）＋火花ワンショット音の用意
  - Files: `public/audio/*.mp3`（または .ogg）
  - Done when: 各音源が単体でクリックノイズなくループ再生できる
  - Depends on: none

> **2026-07-26 更新**: ベースビジュアルは claude.ai/design「花火と橋 デザイン案」Turn 2 (2a) 常駐シーンに確定。
> Task 2.1/2.2 の Three.js + Bloom 前提は Canvas2D 移植（`src/graphics/GraphicsEngine.ts`・実装済み）に置換。
> Task 1.2 のイラスト選定（5案比較）はこのデザイン確定により終了。artwork/candidates は検討記録として残置。

### Wave 2（Wave 1 後 — 並列: 各エンジン実装）

- [x] **Task 2.1** [F]: GraphicsEngine（ベース描画 + Bloom）
  - What: OrthographicCamera でイラスト全面配置、EffectComposer + UnrealBloomPass（閾値調整）、FilmGrain・レンズボケ、resize 対応
  - Files: `src/graphics/GraphicsEngine.ts`, `src/graphics/postprocess/*`
  - Done when: `GraphicsEngine` インターフェースを満たし、イラストが Bloom 付きで60fps描画される
  - Depends on: Task 1.1, 1.2

- [x] **Task 2.2** [F]: ParticleSystem + ムードプロファイル + チャージ演出
  - What: 重力・空気抵抗・減衰の火花演算（AdditiveBlending）、`setMood`（Sparkle 1.8 / Quiet 0.8 と色調補正）、`beginCharge`/`endCharge`、`emitRemoteSpark`（控えめ演出）
  - Files: `src/graphics/ParticleSystem.ts`, `src/moods.ts`（scaffold 配置に合わせ移動済み）
  - Done when: タップ火花・長押しチャージ・ムード切替が動作しモバイル30fps以上
  - Depends on: Task 2.1

- [x] **Task 2.3** [Luna]: SoundEngine
  - What: マルチトラックシームレスループ、BiquadFilterNode ローパス、`setMood` の音量/フィルタイージング、`playSparkle`、autoplay 制約対応（初回操作後 init）
  - Files: `src/audio/SoundEngine.ts`
  - Done when: `SoundEngine` インターフェースを満たし、Quiet 切替でしっとり感が滑らかに遷移する
  - Depends on: Task 1.1, 1.5

- [x] **Task 2.4** [Terra]: PresenceClient
  - What: wss 接続・指数バックオフ再接続、`sendSpark`（200msスロットリング・座標正規化）、`onRemoteSpark`、`setEnabled`（気配トグル）
  - Files: `src/realtime/PresenceClient.ts`
  - Done when: ローカルの server.js と往復し、スロットリング/再接続のユニットテストが通る
  - Depends on: Task 1.1, 1.3

- [x] **Task 2.5** [F]: ミニマルUI
  - What: 半透明ノンフレームUI（ムード切替・気配トグル・ミュート）、カウントダウン気配ウィジェット、`UIController` 実装
  - Files: `src/ui/*`
  - Done when: `UIController` インターフェースを満たし、キャンバスの主役性を損なわない見た目で操作できる
  - Depends on: Task 1.1

- [x] **Task 2.6** [F]: イントロ遷移（FR-014）— 統合で `src/ui/IntroOverlay.ts` として実装済み・ローカルで遷移検証済み
  - What: 紙質感の明るいイントロ画面（線画花火＋サービス名の淡い縦組み）→ タップで夜のキャンバスへイージング遷移する `IntroOverlay` 実装。コンセプト試作は `artwork/intro-concept.html`
  - Files: `src/ui/IntroOverlay.ts`
  - Done when: 初回表示→タップ→遷移が滑らかに動き、main.ts が onEnter で SoundEngine.init を呼べる
  - Depends on: Task 1.1

### Wave 3（Wave 2 後: 結合 = Phase 1 Web Core MVP）

- [x] **Task 3.1** [Sol]: AppCore 結合
  - What: main.ts で全エンジン初期化・イベント配線（pointer→graphics/audio/realtime、UI→ムード/トグル、Schedule→UI）、ライフサイクル管理（visibilitychange で省電力）
  - Files: `src/main.ts`
  - Done when: **Phase 1 検証** — ブラウザで光と音の基本体験（タップ火花＋音＋ムード切替＋カウントダウン）が成立する
  - Depends on: Task 2.1–2.5

### Wave 4（Wave 3 後 — 並列: Phase 2 Mobile & Realtime MVP）

> **2026-07-26 分担計画**: Phase 1 のローカル検証（375x812）で判明した課題を反映。
> 最重要は「16:9 cover クロップで常駐三輪が縦画面から見切れる」問題（Task 4.3 [F]）。

- [ ] **Task 4.1** [Terra]: VPSデプロイ
  - What: server.js を VPS へ配置（systemd）、Nginx の wss リバースプロキシ設定、Origin チェックの本番ドメイン設定
  - Files: `server/deploy/`（systemd/nginx/env/公開WSS検証資材とローカル検証コマンドを整備済み — 実ドメインへのデプロイと疎通が残り）
  - Done when: `wss://<domain>/ws` に外部から接続でき、2端末間で気配が届く
  - Depends on: Task 3.1

- [ ] **Task 4.2** [Sol]: PWA実機検証 + モバイル入力最適化
  - What: モバイル実機（iOS Safari / Android Chrome）でホーム追加→standalone起動、機内モードでのオフライン継続、タッチ遅延・スクロール抑止の確認。`VITE_PRESENCE_URL` の本番設定手順整備
  - Files: `vite.config.ts`, `src/main.ts`, `src/lifecycle.ts`, `docs/mobile-pwa-verification.md`（入力中断・動的viewport・WSS解決・iOSメタ情報・手順を整備し、iPhone 12相当で回転/オフラインを検証済み — 実機検証が残り）
  - Done when: **Phase 2 検証** — 実機でPWA起動・オフラインコア体験・気配送受信が成立
  - Depends on: Task 4.1, 4.3

- [ ] **Task 4.3** [F]: モバイル縦シーン適応（最重要）
  - What: GraphicsEngine にポートレートレイアウトを追加。縦比率（aspect < 1）では常駐三輪を縦積み再配置（例: 大玉2輪を上下に、小玉を間に）し、橋デッキ・水平線の位置も縦構図用に調整。cover クロップ前提のシーン座標系との整合（toSceneCoords の写像を維持したままレイアウトのみ切替）を保つ
  - Files: `src/graphics/GraphicsEngine.ts`
  - Done when: 375x812 で三輪が全て視認でき、タップ・気配の着弾位置が端末間でズレない
  - Depends on: Task 3.1

- [ ] **Task 4.4** [F]: モバイル描画パフォーマンス
  - What: DPR上限・粒子数の動的削減（フレーム時間ベースの tier 判定）、非表示時の完全停止確認
  - Files: `src/graphics/GraphicsEngine.ts`
  - Done when: 実機ミッドレンジ端末で 30fps 以上を維持
  - Depends on: Task 4.3

- [ ] **Task 4.5** [Luna]: モバイル音響検証
  - What: iOS の AudioContext interruption（電話・サイレントスイッチ・バックグラウンド復帰）での復帰確認、モバイルスピーカーでの音量バランス調整
  - Files: `src/audio/SoundEngine.ts`（interrupted/visibility復帰、resume競合抑止、0.78マスター調整と回帰テストを実装済み — iOS/Android実機試聴が残り）
  - Done when: 実機でイントロタップ→環境音再生、バックグラウンド往復後も音が復帰する
  - Depends on: Task 3.1
  - **音響品質の未解決課題（2026-07-27）**: 自己生成したノイズ／和音は「警告音」「送風機」「紙擦れ」「花火らしくないシュッシュ音」として受け取られたため、現在は再生を停止している。次回は、手持ち花火の火薬音を含む**許諾済みの実録素材**を選定し、Sparkle・Quietそれぞれの音量、ループ点、モバイル実機での聴感を確認してから再導入する。擬似合成音での代替はしない。


### Wave 7（メッセージ花火 — 設計: [message-fireworks-design.md](message-fireworks-design.md)）

- [x] **Task 7.1** [F]: 純ロジック — 検証・色の導出・空き場所の探索・保存
  - Files: `src/messages/{messageGuard,messageColor,placement,MessageStore}.ts`, `tests/messages.test.ts`
  - Done when: node環境のテストが通る（16件 通過済み）
- [x] **Task 7.2** [Terra]: `bloom` 種別の中継
  - Files: `server/server.js`, `src/realtime/PresenceClient.ts`, `src/types.ts`
  - Done when: 送受信・連投・文字数超過の破棄が実サーバーで確認できる（確認済み）
- [x] **Task 7.3** [F]: 打ち上げ玉・メッセージ花火の描画・文面表示
  - Files: `src/graphics/GraphicsEngine.ts`
  - Done when: 玉のホバー/クリック、開花、ホバーでの文面表示が動く
- [x] **Task 7.4** [F/Sol]: 入力欄と配線
  - Files: `src/ui/ComposeOverlay.ts`, `src/style.css`, `src/main.ts`, `src/composition.ts`
  - Done when: 玉→入力→打ち上げ→保存→他端末へ到達が通しで動く
- [ ] **Task 7.5** [F]: 使用感の調整（設計の「後で調整する」項目）
  - What: 古い花火の退き方（速度・最終的な大きさ・遠景の上限）、手前層の上限（横12・縦6）、単語群と色の対応表
  - Done when: 実際に触って違和感がなくなる

### Wave 5（Wave 3 後 — Wave 4 と並列着手可: Phase 3 Desktop & Steam MVP）
※ 検証の**完了宣言**は本書のロードマップ通り Phase 2 → Phase 3 の順で行うが、実装着手は Task 3.1 完了後から可能

- [ ] **Task 5.1** [Luna]: Electron アプリ
  - What: frame: false / transparent: true、トレイ常駐、マルチディスプレイ追従、.exe/.dmg ビルド（electron-builder）
  - Files: `electron/main.ts`, `electron/preload.ts`, ビルド設定
  - Done when: mac/Windows で透過デスクトップアプリとして起動しトレイから終了できる
  - Depends on: Task 3.1

- [ ] **Task 5.2** [Luna]: Wallpaper Engine 互換ビルド
  - What: dist/ に project.json を同梱するビルドスクリプト、相対パスのみで動作確認
  - Files: `scripts/build-wallpaper.ts`, `wallpaper/project.json`
  - Done when: **Phase 3 検証** — Wallpaper Engine にインポートして壁紙として動作する
  - Depends on: Task 3.1

### Wave 6（仕上げ）

- [ ] **Task 6.1** [Sol]: 統合テスト・パフォーマンス検証（60fps/30fps、WS 1,000接続想定の軽量性確認）
  - Depends on: Wave 4, Wave 5 完了
- [ ] **Task 6.2** [Sol]: README・セットアップドキュメント（EN+JA）
  - Depends on: Wave 5 完了

## Progress
- Total: 25 tasks | Completed: 16 (2.6 イントロ遷移、7.1–7.4 メッセージ花火) | In Progress: 3 (4.1 資材のみ / 5.1, 5.2 ビルド済み・検証待ち) | Phase 2 計画済み: 4.2–4.5 | 未着手: 6.1, 7.5
