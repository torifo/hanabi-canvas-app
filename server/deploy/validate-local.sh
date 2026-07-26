#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SERVER_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

node --check "$SERVER_DIR/server.js"
npm --prefix "$SERVER_DIR" test

if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify "$SCRIPT_DIR/hanabi-canvas-realtime.service"
else
  printf '%s\n' 'SKIP: systemd-analyze is unavailable; validate the unit on the target VPS.'
fi

printf '%s\n' 'Local server and systemd-template validation completed.'
