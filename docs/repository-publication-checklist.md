# Repository publication checklist

公開リポジトリを作成する前の確認項目です。この文書は作業用であり、公開READMEへそのまま掲載する必要はありません。

## 必須

- [ ] プロジェクトのライセンスを決定し、`LICENSE`を用意する
- [ ] `README.draft.md`を最終確認して`README.md`へ反映する
- [ ] イントロ、縦画面、横画面のスクリーンショットを用意する
- [ ] `.env*`、証明書、トークン、署名情報が追跡対象に含まれないことを確認する
- [ ] `.gitignore`が`node_modules/`、`dist/`、`release/`、ローカル環境変数を除外していることを確認する
- [ ] 花火大会の日程を主催者の公式発表と照合する
- [ ] READMEの対応環境表を、公開時点の実機検証結果へ更新する
- [ ] 公開WebSocketのドメインとプライバシー方針を確定する
- [ ] リポジトリ説明文とTopicsを決める

## 推奨するリポジトリ説明文

> 光・火花・環境音を重ねた、数字も評価もない静かなアンビエントキャンバス。Vite / TypeScript / Canvas 2D / Web Audio / PWA / Electron.

## Topics候補

```text
ambient
canvas-2d
electron
fireworks
pwa
typescript
vite
web-audio
websocket
wallpaper-engine
```

## 公開前の最終コマンド

```sh
npm test
npm run build
npm audit --omit=dev
npm run validate:local --prefix server
CLIENTS=1000 MESSAGES=10 TIMEOUT_MS=30000 npm run bench:smoke --prefix server
```

## 公開後に別途行う確認

- iOS Safari / Android Chromeでのホーム画面追加とオフライン起動
- 公開`wss://`への2クライアント疎通
- 2台の実機間での気配送受信
- macOS notarization
- Windows NSIS生成・起動
- Wallpaper Engineへの実インポート
