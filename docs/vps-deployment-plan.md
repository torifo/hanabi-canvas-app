# VPS 公開計画（GHCR 経由）

調査日: 2026-07-27　対象: X-VPS (162.43.88.107, Ubuntu 22.04.5)
本書は**読み取り専用の調査結果と計画**であり、この時点でVPS上には何も作成していない。

## 調査でわかった既存の型

VPSは **nginx-proxy + acme-companion** による自動リバースプロキシ構成で動いている。各アプリはコンテナの環境変数でドメインを宣言するだけで、証明書の取得と更新まで自動で行われる。

- 全アプリが外部ネットワーク `global-proxy-network` に参加する
- 公開したいコンテナに `VIRTUAL_HOST` / `VIRTUAL_PORT` / `LETSENCRYPT_HOST` / `LETSENCRYPT_EMAIL` を与える
- 公開不要のコンテナ（例: `shikuty-api`）は環境変数を持たず、内部ネットワークからのみ到達できる
- イメージはほぼ全て `ghcr.io/torifo/*`、`docker login ghcr.io` 済み
- compose は `/home/ubuntu/<分類>/<アプリ>/deploy/` に `compose.yml` と `.env` を置く形
  - 例: `/home/ubuntu/app/reachtrail/deploy/`、`/home/ubuntu/app/frelocator/deploy/`
- **nginx-proxy は WebSocket の Upgrade を既定で通す**（`proxy_set_header Upgrade $http_upgrade` を確認済み）
- ディスク残 19GB、`/home/ubuntu/app/hanabi-canvas` は**空のディレクトリとして既に存在**する

## ドメインは1つでよい

**`hanabi-canvas.riumu.net` の1つで足りる。** バックエンドを `api.` として分ける必要はない。

理由は、クライアントが本番で接続先を `wss://<現在のホスト>/ws` と自動的に組み立てるため（[src/lifecycle.ts](../src/lifecycle.ts) の `resolvePresenceUrl`）。同一オリジンの `/ws` に中継が居れば、ビルド時の環境変数は不要で、Originチェックも「自分自身」で完結する。

ドメインを2つに割ると `VITE_PRESENCE_URL` をビルド時に焼き込む必要が生じ、CORS/Origin の設定も増える。得るものがないため採らない。

既存の `app.reachtrail` / `api.reachtrail` のような分割は、APIが独立して他からも叩かれる設計だから意味を持つ。こちらの中継は**このアプリ専用で、DBも識別情報も持たない**ため、分ける理由がない。

### DNS（先に必要な作業）

`hanabi-canvas.riumu.net` は**未登録**。riumu.net にワイルドカードは無いため、A レコードを1件追加する。

```
hanabi-canvas.riumu.net.  A  162.43.88.107
```

acme-companion が証明書を取るのは、このDNSが解決するようになってから。

## 構成

2つのイメージを GHCR へ送り、VPS では compose が引くだけにする。

| コンテナ | イメージ | 役割 | 公開 |
|---|---|---|---|
| `hanabi-canvas-web` | `ghcr.io/torifo/hanabi-canvas-web` | `dist/` を配信し、`/ws` を中継へ渡す nginx | `hanabi-canvas.riumu.net` |
| `hanabi-canvas-relay` | `ghcr.io/torifo/hanabi-canvas-relay` | Node + ws の匿名中継 | 内部のみ（`expose: 8080`） |

中継を外に出さないのが要点。`/ws` は web コンテナの nginx が内部ネットワーク越しに渡すため、中継は `VIRTUAL_HOST` を持たない（`shikuty-api` と同じ扱い）。

```
ブラウザ ──443──▶ global-nginx-proxy ──▶ hanabi-canvas-web (nginx)
                                            ├─ /        → dist/ の静的ファイル
                                            └─ /ws      → hanabi-canvas-relay:8080
```

### web イメージ

`nginx:alpine` に `dist/` を焼き込み、次を持つ設定を同梱する。

- `/` は静的配信。`index.html` はキャッシュさせず、ハッシュ付きアセットは長期キャッシュ
- `/ws` を `hanabi-canvas-relay:8080` へ `proxy_pass`（Upgrade / Connection / 長いタイムアウト / `proxy_buffering off`）
- Origin チェックは中継側の `ALLOWED_ORIGIN` に任せ、nginx では素通しにする（二重管理を避ける）

既存の [server/deploy/nginx-hanabi-canvas.conf](../server/deploy/nginx-hanabi-canvas.conf) はホストのnginxに直接置く前提で書かれているため、**コンテナ内nginx用に書き直す**必要がある（`listen 443 ssl` と証明書の記述は不要。TLSは nginx-proxy が終端する）。

### relay イメージ

`server/Dockerfile` は既に存在し、`node:20-alpine` に `server.js` だけを入れて非rootで動かす最小構成になっている（そのまま使える）。

環境変数は `PORT=8080` と `ALLOWED_ORIGIN`。中継は `ALLOWED_ORIGIN` が設定されているときだけ Origin を照合し、一致しない接続を拒否する（[server/server.js:22,36](../server/server.js)）。**未設定だと誰からでも繋がる**ため、本番では必ず与える。

## 置き場所と compose

```
/home/ubuntu/app/hanabi-canvas/deploy/
├── compose.yml
└── .env            # イメージのタグ・ドメイン・メールアドレス
```

`compose.yml` の骨子（reachtrail と同じ書き方に揃える）:

```yaml
services:
  hanabi-canvas-web:
    image: ${WEB_IMAGE}
    container_name: hanabi-canvas-web
    restart: unless-stopped
    environment:
      - VIRTUAL_HOST=${APP_DOMAIN}
      - VIRTUAL_PORT=80
      - LETSENCRYPT_HOST=${APP_DOMAIN}
      - LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL}
    depends_on:
      - hanabi-canvas-relay
    networks: [proxy-net]

  hanabi-canvas-relay:
    image: ${RELAY_IMAGE}
    container_name: hanabi-canvas-relay
    restart: unless-stopped
    expose: ["8080"]
    environment:
      - PORT=8080
      - ALLOWED_ORIGIN=https://${APP_DOMAIN}
    networks: [proxy-net]

networks:
  proxy-net:
    name: global-proxy-network
    external: true
```

## 進める順序

1. **DNS**: `hanabi-canvas.riumu.net` の A レコードを追加する（人手）
2. **イメージ**: web / relay の Dockerfile を用意し、GHCR へ push できる形にする
3. **VPS**: `deploy/` を作り `compose.yml` と `.env` を置いて `docker compose up -d`
4. **確認**: HTTPS で開けること、`wss://hanabi-canvas.riumu.net/ws` に繋がること、2端末間で気配とメッセージ花火が届くこと

いまはドキュメントのみで、1〜3のいずれにも着手していない。

## 公開前に決めるべきこと

- **ライセンス** — README が未定のまま。GHCR のイメージは公開範囲を private にするか要判断
- **花火日程データ** — シードデータのままなので、[docs/research/hanabi-schedule-data-strategy.md](research/hanabi-schedule-data-strategy.md) の方針で実データへ差し替える
- **GHCR のパッケージ公開範囲** — リポジトリが private のため、イメージも private にするならVPS側の `docker login ghcr.io`（済）で引ける。public にするかは判断が要る
