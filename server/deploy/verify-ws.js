'use strict';

// Runs from any machine with Node.js and this server package installed.
// It verifies the deployed edge path, including its Origin boundary, with two
// independent anonymous clients. No identifiers or payloads are persisted.
const { once } = require('node:events');
const { WebSocket } = require('ws');

const url = process.env.WS_URL;
const origin = process.env.ORIGIN;
const timeoutMs = Number.parseInt(process.env.TIMEOUT_MS ?? '5000', 10);

if (!url || !origin) {
  process.stderr.write('Set WS_URL=wss://<domain>/ws and ORIGIN=https://<domain>.\n');
  process.exitCode = 2;
} else {
  verify().catch((error) => {
    process.stderr.write(`WebSocket verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

async function verify() {
  let receiver = null;
  let sender = null;
  try {
    receiver = await connect();
    sender = await connect();
    const received = once(receiver, 'message');
    sender.send(JSON.stringify({ type: 'spark', x: 0.25, y: 0.75 }));
    const [payload] = await withTimeout(received, timeoutMs);
    const spark = JSON.parse(payload.toString());
    if (spark.type !== 'spark' || spark.x !== 0.25 || spark.y !== 0.75) {
      throw new Error('relay returned an unexpected SparkMessage');
    }
    process.stdout.write(`Verified ${url}: one spark reached the second anonymous client.\n`);
  } finally {
    receiver?.terminate();
    sender?.terminate();
  }
}

async function connect() {
  const socket = new WebSocket(url, { origin });
  await withTimeout(once(socket, 'open'), timeoutMs);
  return socket;
}

function withTimeout(promise, milliseconds) {
  let timeout;
  const timed = Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`timed out after ${milliseconds}ms`)), milliseconds);
    }),
  ]);
  return timed.finally(() => clearTimeout(timeout));
}
