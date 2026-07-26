# SPEC.md : 『花火と心模様』 (英名: Hanabi Canvas / repo: hanabi-canvas-app)

> **コンセプト**
> 1枚のこだわり抜いた2Dイラスト（キャンバス）の上に、コードで光・シェーダー・音のグラデーションを重ねるアンビエント空間プロダクト。
> SNSの数字や評価から完全に離れ、現実の時間や天気を飛び越えて自分の「心模様」に没入しつつ、画面の隅で「どこかで上がる全国の花火の気配」や「誰かが灯した小さな光」を静かに感じられる世界観を表現する。

## 1. 全体概要 & プロジェクト構成

* **日本語サービス名:** 『花火と心模様』
* **英語サービス名:** Hanabi Canvas
* **リポジトリ名:** hanabi-canvas-app
* **ディレクトリ名:** hanabi-canvas
* **動作環境:**
  * モバイル: PWA (スタンドアロン全画面表示)
  * PC: Web / Desktop (Electron 透過ウィンドウ) / Steam (Wallpaper Engine)
* **インフラ環境:** 契約中自前VPS (Nginx + Node.js ws サーバー + HTTPS) ※Supabase不使用

## 2. チーム役割分担 & モジュール構造

```text
hanabi-canvas/
├── src/
│   ├── graphics/          ◄── [担当: Fable 5 / Opus 5] (デザイン・シェーダー)
│   ├── ui/                ◄── [担当: Fable 5 / Opus 5] (UIレイアウト・見た目)
│   ├── audio/             ◄── [担当: GPT-5.6 Luna]     (Web Audio API)
│   ├── realtime/          ◄── [担当: GPT-5.6 Terra]    (WebSocket 接続)
│   ├── desktop/           ◄── [担当: GPT-5.6 Luna]     (Electron wrapper)
│   └── main.ts            ◄── [担当: GPT-5.6 Sol]      (コア制御・PWA)
└── server/                ◄── [担当: GPT-5.6 Terra]    (VPS用 WebSocket Server)
```

## 3. 【SECTION A】デザイン・ビジュアル演出仕様

**担当:** Fable 5 (サブエージェント: Fable / Opus 5)

### A-1. WebGL / Canvas 描画エンジン (src/graphics/)

* **ベースビジュアル:** 1枚の2Dイラストを正射影カメラ（OrthographicCamera）で全面配置。
* **ポストプロセス（Bloom / Glow）:**
  * Three.js EffectComposer + UnrealBloomPass を使用した光の滲み演出。
  * 高光度領域（手持ち花火の先端、街灯、星）のみを発光させる閾値（Threshold）調整。
  * フィルムノイズ（FilmGrain）やごく微細なレンズボケエフェクトの付与。
* **光の物理パーティクル (ParticleSystem.ts):**
  * タッチ/長押し位置から弾ける火花（重力・空気抵抗・減衰を考慮したパーティクル演算）。
  * 加算合成（THREE.AdditiveBlending）による重なり合う光の表現。

### A-2. ムードプロファイル (Mood Profiles)

* **Sparkle Mode（胸が高鳴る・嬉しい時）:**
  * 色調: 夕暮れ〜鮮やかなネイビー。
  * エフェクト: 発光強度強め（Strength: 1.8）、粒子が素早く元気に弾ける物理挙動。
* **Quiet Mode（静かに過ごしたい時）:**
  * 色調: シーンを深みのあるシアン・ダークネイビーへ補正。
  * エフェクト: 発光強度を抑え（Strength: 0.8）、水滴の反射や柔らかいボケ粒子による静寂感（雨や静けさは「不穏」ではなく「輝く静寂」として表現）。

### A-3. UI/UX ビジュアル・レイアウト (src/ui/)

* **ミニマルUI:** 画面の主役（キャンバス）を邪魔しないノンフレーム・半透明デザイン。
* **気配ウィジェット:** 全国花火日程のカウントダウンが画面の隅で静かに息づくレイアウト。
* **インタラクション視覚フィードバック:**
  * 画面長押し中に指の周囲にじわじわと光の溜まり（チャージ感）が広がるエフェクト。

## 4. 【SECTION B】システム・インフラ実装仕様

**担当:** GPT-5.6 (Sol / Terra / Luna)

### B-1. Sol 担当: コアアプリケーション & PWA (src/main.ts, vite.config.ts)

* **Vite + TypeScript ベースのセットアップ:**
  * vite-plugin-pwa を用いた Web App Manifest および Service Worker（オフラインキャッシュ）の構成。
* **状態管理 & 連携フック:**
  * ビジュアルエンジン、オーディオエンジン、リアルタイム通信の初期化とライフサイクル制御。
  * モバイルでの全画面表示（display: standalone）、ビューポート最適化（100vh問題の吸収）。

### B-2. Terra 担当: バックエンド & リアルタイム通信 (server/, src/realtime/)

* **VPS用 軽量WebSocketサーバー (server/server.js):**
  * Node.js + ws パッケージによるシンプルかつ超軽量なPub/Subサーバー。
  * 受信した「光の座標データ {x, y}」を、送信元以外の接続クライアント全体へ即座に転送（DB保存なし・個人識別なし）。
* **フロントエンド通信クライアント (src/realtime/PresenceClient.ts):**
  * 画面長押し/タップ時の座標送信（スロットリング処理付き）。
  * リモートからの気配受信時のイベント発火（「気配ON/OFF」トグルスイッチの制御含む）。
* **花火日程データ供給:**
  * JSON形式による日本全国の花火大会スケジュールデータの読み込みおよびカウントダウン計算ロジック。

### B-3. Luna 担当: 音響エンジン & デスクトップシェル (src/audio/, electron/)

* **Web Audio API 音響エンジン (src/audio/SoundEngine.ts):**
  * 環境音（パチパチ音、波、雨、虫の声）のマルチトラック・シームレスループ再生。
  * BiquadFilterNode（ローパスフィルタ）による「Quiet Mode」時の高音域カット（水中・しっとり感の再現）と音量のイージング切り替え。
* **Electron デスクトップアプリ (electron/main.ts):**
  * ウィンドウ枠削除（frame: false）、背景透過（transparent: true）、タスクトレイ常駐化。
  * マルチラップトップ・マルチディスプレイ対応のレスポンシブウィンドウサイズ調整。
* **Wallpaper Engine 互換ビルド構造:**
  * Steamワークショップ用に静的アセット（dist/）をそのまま壁紙として読み込めるプロジェクト設定。

## 5. 段階的検証ロードマップ (MVP Execution)

1. **Phase 1: Web Core MVP**
   * Fable 5 がつくった1枚絵＋シェーダー上に、Sol が全モジュールを結合。Webブラウザ上で光と音の基本体験を検証。
2. **Phase 2: Mobile & Realtime MVP**
   * Terra の WebSocket サーバーを VPS にデプロイ。Sol が PWA化とタッチレスポンスをモバイル実機で検証。
3. **Phase 3: Desktop & Steam MVP**
   * Luna が Electron アプリをビルド（.exe/.dmg）。ビルド成果物を Wallpaper Engine ワークショップへインポートして動作検証。
