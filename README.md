# 花火と心模様（Hanabi Canvas）

<!-- tech-stack:start (auto-generated) -->
<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Canvas%202D-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="Canvas 2D">
  <img src="https://img.shields.io/badge/PWA-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white" alt="PWA">
  <img src="https://img.shields.io/badge/Node.js-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white" alt="Vitest">
</p>
<!-- tech-stack:end -->

光と音に、心をほどく。

「花火と心模様」は、ひとつの夜の情景に、コードで描く光、火花、空気の揺らぎ、環境音を重ねたアンビエントプロダクトです。タスクを管理するためのツールでも、競争や評価を生むSNSでもありません。画面を開き、その日の自分の「心模様」に合う光と音を選び、ただ静かに雰囲気を味わうための空間です。

An ambient canvas that layers light, sparks, and sound over a single night scene — no accounts, no metrics, just a quiet place to be.

> 現在開発中です。Web/PWA、macOS向けElectronビルド、Wallpaper Engine互換ビルドを中心に検証しています。

<!-- 公開時に、イントロ画面と縦横の常駐シーン画像をここへ追加する -->

## ✦ こんな時に

### 自分の感情やテンションを整えたい時

嬉しい出来事の余韻に浸りたい夜や、静かに自分の世界へ入りたい時。その時の心模様に合わせた光と音へ没入できます。

### 一日の終わりに、小さな光を灯したい時

仕事や作業を終えた後、画面へ触れて自分の手で光を灯す。何かを達成した日も、何も起きなかった日も、自分だけの静かな区切りをつくります。

### 日常の喧騒から少しだけ離れたい時

現実の天気や時間に関係なく、画面を開けば夜空と花火の気配がある空間へ移れます。長時間の集中を要求せず、短い時間でも楽しめます。

## ✦ コンセプト

### ひとつの情景を、コードで育てる

多数の画面やコンテンツを切り替えるのではなく、ひとつの2D情景を中心に据えています。Canvas 2Dによる加算合成、火花、光の滲み、反射、粒子の動きを重ね、同じ夜景が静かに呼吸し続けるような表現を目指しています。

### 心模様に寄り添う、ふたつのムード

- **Sparkle / 高鳴り** — あたたかく、祝福するような光
- **Quiet / 静けさ** — 青く澄んだ、しっとりとした光

雨や暗さ、静けさを不穏なものとして扱わず、光がよく見えるための美しい余白として肯定します。

### 数字も評価もない「気配」の共有

いいね、フォロワー数、閲覧数、ランキングはありません。

自分が灯した火花は、接続中の誰かの画面で小さく弾けます。誰が灯したかは分からず、履歴にも残りません。存在を主張するのではなく、「今、どこかにも誰かがいる」と静かに感じるための一時的なつながりです。

### 全国の花火を待つ

画面の隅では、これから日本で開催される花火大会までの時間が静かに進みます。季節の移ろいと、まだ見ぬ夜への予感を添えるサブ機能です。

> 収録日程はシードデータです。公開リリース前に、各主催者の公式発表と開催日時を照合する必要があります。

## ✦ 操作

- 紙質感のイントロへ触れて、夜の空間に入る（触れなくても数秒で夜へ移ります）
- 画面をタップして、小さな火花を灯す
- 長押ししてから離し、少し大きな光を灯す
- 常駐する花火の上をなぞると、その輪が静かに応える
- 「高鳴り」と「静けさ」を切り替える
- 「誰かの気配」の送受信をいつでも止める

音声はブラウザの自動再生制約に合わせ、最初のユーザー操作後に開始します。

## ✦ 対応環境

| 環境 | 配布形式 | 現在の状態 |
|---|---|---|
| Web | Vite静的ビルド | ローカル検証済み |
| iOS / Android | PWA・スタンドアロン表示 | 構成済み、実機検証を継続中 |
| macOS | Electron・DMG | arm64 DMG生成済み、notarization未実施 |
| Windows | Electron・NSIS | ビルド構成済み、Windows上での生成・動作確認が必要 |
| Wallpaper Engine | Web壁紙互換ビルド | `project.json`同梱済み、アプリ本体での最終確認が必要 |

## ✦ 技術構成

- **Application:** Vite, TypeScript（バニラ・フレームワーク不使用）
- **Graphics:** Canvas 2D, additive blending, procedural particles
- **PWA:** `vite-plugin-pwa`, Workbox
- **Audio:** Web Audio API, `BiquadFilterNode`, seamless multi-track loops
- **Realtime:** Node.js, `ws`, stateless WebSocket relay
- **Desktop:** Electron, electron-builder
- **Wallpaper:** Wallpaper Engine web wallpaper compatible build
- **Testing:** Vitest, Node.js test runner

WebSocketサーバーはDBを持たず、火花を接続中の他クライアントへ転送するだけの軽量な中継です。火花、ユーザー識別情報、通信履歴を永続化しません。

## ✦ ディレクトリ構成

```text
hanabi-canvas/
├── src/
│   ├── graphics/       # Canvas 2D常駐シーン、光、火花、ムード遷移
│   ├── ui/             # イントロ、ムード切替、気配、カウントダウン
│   ├── audio/          # Web Audio API音響エンジン
│   ├── realtime/       # 気配通信クライアント、花火日程
│   ├── types.ts        # 全モジュールが共有するインターフェース契約
│   ├── composition.ts  # 各実装の組み立て
│   ├── lifecycle.ts    # PWA・表示状態・接続URLの方針
│   └── main.ts         # アプリケーションのイベント配線
├── public/
│   ├── audio/          # 環境音と火花音
│   ├── data/           # 花火日程データ
│   └── icons/          # PWAアイコン
├── electron/           # デスクトップシェル（透過ウィンドウとトレイ）
├── server/             # DBレスWebSocket中継とVPSデプロイ資材
├── scripts/            # 音源検証・配布ビルド
├── wallpaper/          # Wallpaper Engine設定
├── artwork/            # デザイン検討・生成ソース
├── specs/              # 要件、設計、タスク
└── tests/              # Web、音響、通信、ライフサイクルのテスト
```

## ✦ ローカルで起動する

Node.js 22以降を推奨します。

```sh
npm install
npm install --prefix server
cp .env.example .env.local
npm run dev
```

リアルタイムの気配通信も試す場合は、別のターミナルで中継サーバーを起動します。

```sh
npm start --prefix server
```

`.env.local`の`VITE_PRESENCE_URL`を設定しなければ、通信を開始せずローカルの光と音だけを楽しめます。本番環境では同一ホストの`/ws`を自動的に利用します。

## ✦ 検証

```sh
npm test                             # Web/日程/通信/音源/WS統合テスト
npm run build                        # PWAを含むWeb本番ビルド
npm run bench:smoke --prefix server  # ローカルWS負荷スモーク（既定100接続）
```

テストには、花火日程、接続再試行、メッセージ検証、レート制限、音響復帰、PWAライフサイクル、音源形式の確認が含まれます。PWAはHTML、JS、CSS、画像、日程JSON、音源をprecacheし、オフライン時も描画と音響が動作して気配通信だけが停止します。

## ✦ 配布ビルド

```sh
npm run wallpaper:build  # dist/へWallpaper Engine設定を同梱
npm run electron:build   # macOS DMG（WindowsではNSIS）
```

`vite.config.ts`の`base: './'`は、Web、Electron、Wallpaper Engineで同じ静的ビルドを利用するための重要な設定です。変更しないでください。

実機・本番環境の確認手順:

- [Mobile PWA verification](docs/mobile-pwa-verification.md)
- [VPS deployment runbook](server/deploy/README.md)

## ✦ プライバシー

- アカウントを作成しません
- いいね、閲覧数、ランキングを設けません
- 気配通信の内容をDBへ保存しません
- 気配通信にユーザー識別子を付与しません
- 外部SaaSを前提としません

## License

<!-- 公開前にライセンスを決定し、このコメントを正式な記載へ置き換える -->

License to be determined.
