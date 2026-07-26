# 『花火と心模様』(Hanabi Canvas) Requirements

## Overview

1枚の2Dイラストの上に光・シェーダー・音のグラデーションを重ねるアンビエント空間プロダクト。SNSの数字や評価から離れ、自分の「心模様」に没入しつつ、全国の花火の気配や誰かが灯した光を静かに感じられる体験を提供する。動作環境はモバイルPWA / Web / Electron / Wallpaper Engine、インフラは自前VPS（Nginx + Node.js ws + HTTPS）。

原本仕様: [SPEC.md](../../SPEC.md)
検証は3段階（Phase 1: Web Core → Phase 2: Mobile & Realtime → Phase 3: Desktop & Steam）で行う。段階詳細は [tasks.md](tasks.md) の Wave 構成を参照。

## User Stories

### US-001: 心模様への没入
**As a** 日常に疲れたユーザー **I want to** 気分に合わせたムード（Sparkle / Quiet）でキャンバスを眺める **So that** SNSの評価や現実の時間から離れて自分の内面に没入できる

**Acceptance Criteria:**
- WHEN ユーザーがムードを Sparkle Mode に切り替えた THE SYSTEM SHALL 色調を夕暮れ〜鮮やかなネイビーに変化させ、Bloom発光強度を 1.8 に設定する
- WHEN ユーザーがムードを Quiet Mode に切り替えた THE SYSTEM SHALL 色調を深みのあるシアン・ダークネイビーに補正し、Bloom発光強度を 0.8 に設定する
- WHEN ムードが切り替わった THE SYSTEM SHALL 音響エンジンの音量・フィルタを即時カットではなくイージングで遷移させる
- THE SYSTEM SHALL いいね数・閲覧数・ランキング等の評価指標を一切表示しない

### US-002: 光を灯すインタラクション
**As a** ユーザー **I want to** 画面をタッチ・長押しして火花を弾けさせる **So that** 自分の手で光を灯す感覚を味わえる

**Acceptance Criteria:**
- WHEN ユーザーが画面をタップした THE SYSTEM SHALL タップ位置から重力・空気抵抗・減衰を考慮したパーティクル火花を放出する
- WHILE ユーザーが画面を長押ししている THE SYSTEM SHALL 指の周囲に光の溜まり（チャージ感）をじわじわと広げる
- WHEN 長押しが解放された THE SYSTEM SHALL チャージ量に応じた火花を放出する

### US-003: 誰かの気配を感じる
**As a** ユーザー **I want to** どこかの誰かが灯した光を自分の画面でも感じる **So that** 孤独ではない静かなつながりを感じられる

**Acceptance Criteria:**
- WHEN 他のクライアントが光を灯した THE SYSTEM SHALL その座標にリモート由来の控えめな光を表示する
- WHEN ユーザーが気配トグルを OFF にした THE SYSTEM SHALL リモートの光の送受信を停止する
- THE SYSTEM SHALL 気配データにユーザー識別情報を含めない（座標のみ）

### US-004: 全国の花火の気配
**As a** ユーザー **I want to** 全国の花火大会までのカウントダウンを画面の隅で感じる **So that** 現実のどこかで上がる花火に思いを馳せられる

**Acceptance Criteria:**
- WHEN アプリが起動した THE SYSTEM SHALL 花火大会スケジュールJSONを読み込み、直近の大会までのカウントダウンを表示する
- THE SYSTEM SHALL カウントダウンウィジェットをキャンバスの主役性を損なわない半透明ミニマルUIとして画面隅に配置する

### US-005: どこでも同じ体験
**As a** ユーザー **I want to** スマホ・PC・デスクトップ壁紙で同じ空間を開く **So that** 生活のあらゆる場面でこの空間に浸れる

**Acceptance Criteria:**
- WHEN モバイルでPWAとしてインストールされた THE SYSTEM SHALL スタンドアロン全画面（display: standalone）で起動する
- WHEN Electronアプリとして起動された THE SYSTEM SHALL 枠なし（frame: false）・背景透過（transparent: true）ウィンドウで表示し、タスクトレイに常駐する
- WHEN dist/ が Wallpaper Engine に読み込まれた THE SYSTEM SHALL 追加ビルドなしで壁紙として動作する

### US-006: 静かな入口
**As a** ユーザー **I want to** アプリを開いたとき、いきなり夜のキャンバスではなく紙のように静かなタイトル画面から入る **So that** 日常から心模様の世界へ気持ちを切り替える「間」を持てる

**Acceptance Criteria:**
- WHEN アプリに最初にアクセスした THE SYSTEM SHALL 紙の質感を持つ明るい背景に、細い線画の花火とサービス名を淡く配したイントロ画面を表示する
- WHEN ユーザーがイントロ画面に触れた THE SYSTEM SHALL 夜のメインキャンバスへ滑らかに遷移し、この操作を起点に音響エンジンを初期化する（autoplay制約の解除を兼ねる）
- IF ユーザーが触れないまま一定時間が経過した THEN THE SYSTEM SHALL 触れて入ることを示す控えめな誘導を淡く表示する

## Functional Requirements

### FR-001: 描画エンジン（ベースビジュアル）
**Priority:** P0　**Persona:** 全ユーザー　**担当:** Fable 5（src/graphics/）
THE SYSTEM SHALL 1枚の2Dイラストを Three.js の OrthographicCamera で画面全面に配置する。
**Rationale:** 「1枚のこだわり抜いたイラスト」がプロダクトの主役であるため。

### FR-002: ポストプロセス（Bloom / Glow）
**Priority:** P0　**担当:** Fable 5（src/graphics/）
THE SYSTEM SHALL EffectComposer + UnrealBloomPass により高光度領域（花火の先端・街灯・星）のみを閾値制御で発光させ、FilmGrain と微細なレンズボケを付与する。
**Rationale:** 光の滲みが「アンビエント空間」の質感を決定づけるため。

### FR-003: 物理パーティクル・チャージ演出
**Priority:** P0　**担当:** Fable 5（src/graphics/ParticleSystem.ts）
WHEN タッチ/長押し位置が与えられた THE SYSTEM SHALL 重力・空気抵抗・減衰を計算した火花パーティクルを THREE.AdditiveBlending で加算合成描画する。
WHILE 長押しが継続している THE SYSTEM SHALL 指の周囲に光の溜まり（チャージ感）を漸増表示し、解放時に蓄積量に応じた火花を放出する。

### FR-004: ムードプロファイル
**Priority:** P0　**担当:** Fable 5（graphics）+ Luna（audio）
WHEN ムード（Sparkle / Quiet）が指定された THE SYSTEM SHALL 色調・Bloom強度・パーティクル挙動・音響フィルタをプロファイル値に従い一括変更する。
**Rationale:** Quiet は「不穏」ではなく「輝く静寂」として表現する（仕様A-2）。

### FR-005: ミニマルUI・気配ウィジェット
**Priority:** P1　**担当:** Fable 5（src/ui/）
THE SYSTEM SHALL ノンフレーム・半透明のUIのみを表示し、花火日程カウントダウンを画面隅に配置する。

### FR-014: イントロ遷移（静かな入口）
**Priority:** P1　**担当:** Fable 5（src/ui/IntroOverlay）+ Sol（main.ts 配線）
WHEN アプリが起動した THE SYSTEM SHALL 紙質感の明るいイントロ画面（線画の花火＋サービス名の淡い表示）を最前面に表示する。
WHEN イントロ画面がタップされた THE SYSTEM SHALL メインキャンバスへイージング遷移し、SoundEngine.init を呼び出す。
**Rationale:** 世界観への没入の「間」を作ると同時に、Web Audio の autoplay 制約解除に必要な初回ユーザー操作を自然な形で獲得する。

### FR-006: コア制御・ライフサイクル
**Priority:** P0　**担当:** GPT-5.6 Sol（src/main.ts）
WHEN アプリが起動した THE SYSTEM SHALL graphics / audio / realtime / ui の各エンジンを初期化し、ムード変更・タッチ入力等のイベントを各エンジンへ配線する。

### FR-007: PWA対応
**Priority:** P1　**担当:** GPT-5.6 Sol（vite.config.ts）
THE SYSTEM SHALL vite-plugin-pwa により Web App Manifest と Service Worker（オフラインキャッシュ）を構成し、100vh問題を吸収したビューポートで全画面表示する。

### FR-008: WebSocket Pub/Subサーバー
**Priority:** P1　**担当:** GPT-5.6 Terra（server/server.js）
WHEN クライアントから光の座標データ {x, y} を受信した THE SYSTEM SHALL 送信元以外の全接続クライアントへ即座に転送する。
THE SYSTEM SHALL 受信データをDBに保存せず、個人識別情報を扱わない。

### FR-009: リアルタイムクライアント
**Priority:** P1　**担当:** GPT-5.6 Terra（src/realtime/PresenceClient.ts）
WHEN ユーザーが長押し/タップした THE SYSTEM SHALL スロットリングを適用して座標をサーバーへ送信する。
WHEN リモートの気配を受信した THE SYSTEM SHALL イベントを発火し、気配ON/OFFトグルが OFF の場合は送受信を行わない。

### FR-010: 花火日程データ供給
**Priority:** P2　**担当:** GPT-5.6 Terra
THE SYSTEM SHALL 日本全国の花火大会スケジュールをJSONから読み込み、直近大会までの残り時間を計算して提供する。

### FR-011: 音響エンジン
**Priority:** P0　**担当:** GPT-5.6 Luna（src/audio/SoundEngine.ts）
THE SYSTEM SHALL 環境音（パチパチ音・波・雨・虫の声）をマルチトラックでシームレスループ再生する。
WHEN Quiet Mode に切り替わった THE SYSTEM SHALL BiquadFilterNode（ローパス）で高音域をカットし、音量をイージングで遷移させる。

### FR-012: Electronデスクトップシェル
**Priority:** P2　**担当:** GPT-5.6 Luna（electron/main.ts）
THE SYSTEM SHALL frame: false / transparent: true のウィンドウで起動し、タスクトレイに常駐し、マルチディスプレイに応じたウィンドウサイズ調整を行う。

### FR-013: Wallpaper Engine互換ビルド
**Priority:** P2　**担当:** GPT-5.6 Luna
THE SYSTEM SHALL dist/ の静的アセットをそのまま Wallpaper Engine の壁紙プロジェクトとして読み込める構成でビルドする。

## Non-Functional Requirements

- **Performance:** デスクトップで60fps、モバイルで30fps以上を維持する。パーティクル数はフレームレートに応じて動的に制限する
- **Performance（音響）:** ループ再生の継ぎ目を無音・クリックノイズなしで実現する
- **Network:** WSメッセージは座標＋種別のみの軽量JSON（実送信サイズは100バイト未満が目標。サーバー側の受信許容上限は256バイトで、超過は破棄）とし、送信は200ms間隔以上にスロットリングする
- **Privacy:** サーバーはユーザー識別子・IPログ・履歴を永続化しない（DB不使用）
- **Offline:** PWAはネットワーク切断時も描画・音響のコア体験を継続する（気配機能のみ停止）
- **Security:** WS接続はHTTPS（wss://）経由、Nginxリバースプロキシ配下で終端する
- **Scalability:** 単一VPS・単一Nodeプロセスで同時接続 1,000 クライアントを処理できる軽量実装とする
