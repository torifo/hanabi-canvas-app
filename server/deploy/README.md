# VPS deployment runbook

This directory is a deployment template. It does not contain a real domain,
certificate, SSH target, or credentials; replace every `hanabi.example.com`
placeholder before installing it. The relay is an anonymous, memory-only
process: it stores neither SparkMessage data nor user identifiers.

## Prerequisites

- A Linux VPS with Node.js 20+ and Nginx.
- A DNS record and an already issued TLS certificate for the production domain.
- A non-login `hanabi` system user and at least 8,192 available file
  descriptors for the service's expected 1,000 persistent connections.
- Port 8080 firewalled from the public Internet. Only Nginx on the VPS should
  reach `127.0.0.1:8080`.

## Install or update

Run the following as an administrator on the VPS, after replacing the example
domain and paths where necessary. Confirm `command -v node` is `/usr/bin/node`
or adjust `ExecStart` in the unit before installing it.

```sh
useradd --system --user-group --home-dir /opt/hanabi-canvas --shell /usr/sbin/nologin hanabi
install -d -o hanabi -g hanabi /opt/hanabi-canvas/server
# Copy the contents of this repository's server/ directory into that directory.
cd /opt/hanabi-canvas/server
npm ci --omit=dev

install -d -o root -g hanabi -m 0750 /etc/hanabi-canvas
install -o root -g hanabi -m 0640 deploy/realtime.env.example /etc/hanabi-canvas/realtime.env
# Edit /etc/hanabi-canvas/realtime.env and set the real HTTPS app origin.

install -o root -g root -m 0644 deploy/hanabi-canvas-realtime.service /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/hanabi-canvas-realtime.service
systemctl daemon-reload
systemctl enable --now hanabi-canvas-realtime
systemctl status --no-pager hanabi-canvas-realtime
```

Install `nginx-hanabi-canvas.conf` as the HTTPS virtual host after replacing
its domain and certificate paths. If the web app already has a TLS virtual
host, merge only its `location = /ws` block; do not create a duplicate
`server_name`. Verify and reload only after the real certificate paths exist:

```sh
nginx -t
systemctl reload nginx
```

The Node process independently checks `ALLOWED_ORIGIN`, so the same exact app
origin must be configured in both `/etc/hanabi-canvas/realtime.env` and Nginx.
Browser WebSocket clients must use `wss://<domain>/ws`; the Node service is
intentionally plain `ws://127.0.0.1:8080` behind the TLS proxy.

## Validation

Before copying assets to the VPS, run local checks:

```sh
npm run validate:local
npm run bench:smoke
```

`validate:local` validates Node syntax, the relay's integration tests, and the
systemd unit when `systemd-analyze` is available. Nginx configuration is tested
on the target only because its certificate paths are production-specific.

After Nginx is reloaded, run a two-client end-to-end probe from a machine that
can reach the production domain:

```sh
WS_URL=wss://hanabi.example.com/ws ORIGIN=https://hanabi.example.com npm run verify:deployment
```

It succeeds only when both connections pass the Origin checks and the sender's
spark reaches the other client. Then manually verify two different mobile
devices in the PWA: turn presence on, tap once on one device, and confirm the
other displays the quiet remote spark. Also confirm presence-off stops both
sending and receiving.

## Capacity and operations

The relay does not queue remote sparks for stalled peers. A client whose
outbound buffer would exceed 64 KiB is terminated and reconnects through the
browser client's exponential backoff. This bounds one slow client's memory
impact; it intentionally drops ambient, non-durable events.

The smoke benchmark is operator-run, never CI. Its default is lightweight; to
exercise the single-process 1,000-connection assumption locally:

```sh
CLIENTS=1000 MESSAGES=10 TIMEOUT_MS=30000 npm run bench:smoke
```

During a production-like test, monitor `systemctl status`, process RSS/CPU,
`LimitNOFILE`, Nginx connection limits, and network loss/latency. Do not log
SparkMessage payloads or client identifiers while diagnosing. A deployment
cannot be declared complete until a public `wss://` probe and two-device test
have succeeded.

For rollback, restore the prior server release, run `npm ci --omit=dev`, then
`systemctl restart hanabi-canvas-realtime`. Use `systemctl stop
hanabi-canvas-realtime` to disable presence immediately; local canvas and audio
remain usable without it.
