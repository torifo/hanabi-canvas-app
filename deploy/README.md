# Docker / GHCR deployment

Production uses two images:

- `hanabi-canvas-web`: the locally built Vite `dist/` served by Nginx
- `hanabi-canvas-realtime`: the stateless WebSocket relay

The VPS only pulls the images and starts Docker Compose. The web container
joins the existing `global-proxy-network`; the realtime container is reachable
only from the private Compose network.

## 1. Build the web application locally

Leave `VITE_PRESENCE_URL` unset so production uses the same-origin `/ws`
endpoint.

```sh
npm ci
npm run test
npm run build
```

## 2. Build and push Linux images

The VPS is `linux/amd64`. Use Buildx explicitly when building on an Apple
Silicon Mac.

```sh
export GHCR_OWNER=torifo
export IMAGE_TAG="$(date +%Y%m%d-%H%M)"

docker buildx build \
  --platform linux/amd64 \
  --file deploy/web.Dockerfile \
  --tag "ghcr.io/${GHCR_OWNER}/hanabi-canvas-web:${IMAGE_TAG}" \
  --push \
  .

docker buildx build \
  --platform linux/amd64 \
  --file server/Dockerfile \
  --tag "ghcr.io/${GHCR_OWNER}/hanabi-canvas-realtime:${IMAGE_TAG}" \
  --push \
  server
```

## 3. Start on the VPS after the domain is decided

Copy `deploy/compose.yml` and `deploy/.env.example` into
`/home/ubuntu/app/hanabi-canvas/deploy/`. Rename `.env.example` to `.env` and
replace all placeholders. The domain must already resolve to the VPS.

```sh
cd /home/ubuntu/app/hanabi-canvas/deploy
docker compose pull
docker compose up -d
docker compose ps
```

Validate the public WebSocket path from the local repository:

```sh
WS_URL=wss://hanabi.example.com/ws \
ORIGIN=https://hanabi.example.com \
npm run verify:deployment --prefix server
```

Do not use `latest` for production. Keeping an immutable `IMAGE_TAG` makes
rollback a `.env` change followed by `docker compose up -d`.
