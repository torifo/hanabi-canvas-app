# 統合準備チェックリスト（GPT成果物の受け入れ）

GPT-5.6（Sol / Terra / Luna）の成果物を受け入れて Phase 1 結合（Task 3.1）へ進むための準備資料。
受け入れ時は本書の順で確認する。

## 1. プロンプト送付後に確定した契約差分（受け入れ時に要伝達・要確認）

各担当のコードが以下の**最新契約**に沿っているか確認する。沿っていない場合は該当差分のみ修正依頼。

| # | 差分 | 影響先 | 内容 |
|---|------|--------|------|
| D1 | 座標系の定義 | Terra / Sol | SparkMessage の x, y は「ウィンドウ座標」ではなく**横長ベースイラストのシーン座標系 (0,0)–(1,1)**。変換は GraphicsEngine.`toSceneCoords(clientX, clientY)`（Fable実装）が担い、Terra は 0–1 値を素通し、Sol は pointer 座標を変換してから `sendSpark` に渡す |
| D2 | GraphicsEngine 契約 | Sol | `toSceneCoords` メソッドが契約に追加済み（[design.md](design.md) 参照） |
| D3 | lowpassFreq の所有権 | Luna | 具体値は Luna が決定・更新権を持つ。現行値は quiet = 2000Hz（`src/moods.ts`） |
| D4 | 共有定数 | Sol / Luna | `MOOD_TRANSITION_MS = 1200` を `src/types.ts` に追加し、graphics / audio のイージング時間を統一 |
| D5 | メッセージサイズ | Terra | 実送信100B未満は目標値、サーバー受信上限256B（超過破棄）は防御値 — 両立で確定 |
| D6 | イントロ遷移 (FR-014) | Sol | `IntroOverlay`（Fable実装）の `onEnter` で `SoundEngine.init()` を呼ぶ配線が main.ts に必要。autoplay制約解除の起点をイントロタップに変更（従来の「初回 pointerdown」より前倒し） |

## 2. モジュール受け入れ確認（担当別）

### Sol（scaffold / main.ts / PWA）
- [ ] `npm run dev` / `npm run build` が通る
- [ ] `vite.config.ts` が `base: './'`（Wallpaper Engine 互換の相対パス）
- [ ] `src/types.ts` が design.md の Interface Contracts と一致（D2/D4 含む）
- [ ] ディレクトリ構造が [design.md](design.md) のArchitectureと一致（src/graphics, ui, audio, realtime / electron / server / public）
- [ ] スタブが `src/stubs/` に分離されており、Fable 実装（graphics/ui）で差し替え可能な構造

### Terra（server / realtime）
- [ ] server.js: 送信元以外への転送・不正メッセージ黙殺・256B上限・10msg/秒制限の統合テストが通る
- [ ] PresenceClient: 200ms スロットリング・指数バックオフ（1s→…→30s）・setEnabled のユニットテストが通る
- [ ] HanabiSchedule: 境界テスト（開催中・終了直後・データ空・全件終了済み→null）が通る
- [ ] DB・ログ永続化・個人識別情報が一切ないこと（コード確認）

### Luna（audio / electron）
- [ ] SoundEngine: ループの継ぎ目・Quiet遷移のイージング（1200ms）・playSparkle・setMuted
- [ ] `init()` がユーザー操作後呼び出し前提になっている（イントロタップ起点 = D6）
- [ ] Electron / Wallpaper Engine は Phase 3 のため受け入れは骨子確認のみ

### 共通
- [ ] コミット履歴に AI 帰属（Co-Authored-By 等）が含まれていない
- [ ] 依存パッケージが最小限（three / vite / vite-plugin-pwa / ws 系以外の大型追加は要相談）

## 3. Fable 側の持ち込み資産（統合時に配置）

| 資産 | 現在地 | 統合先 | 状態 |
|------|--------|--------|------|
| ベースイラスト | `artwork/candidates/`（5案） | `public/assets/canvas-base*.png` | **選定待ち**（ユーザー判断） |
| 光源マップ | `artwork/candidates/*.emitters.json` | `public/assets/canvas-emitters.json` | 選定後に採用案のものを配置 |
| イントロ遷移 | `artwork/intro-concept.html`（試作） | `src/ui/IntroOverlay.ts` | Task 2.6 で TS 化 |
| ムードプリセット | design.md の GraphicsMoodPreset 数値 | `src/graphics/moods.ts` | Task 2.2 で実装 |

## 4. 統合の順序（Phase 1）

1. Sol の scaffold をベースに取り込み（types.ts の契約一致を最初に確認 = D2/D4）
2. Terra / Luna のモジュールを配置し、スタブと差し替えられることを確認
3. Fable の graphics/ui 実装（Task 2.1/2.2/2.5/2.6）を進め、選定済みイラストを配置
4. main.ts 結合 → Phase 1 検証（ブラウザで光と音の基本体験）
