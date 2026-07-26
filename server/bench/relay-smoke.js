'use strict';

// Operator-run capacity smoke test. It is intentionally not part of `npm test`.
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createSparkServer } = require('../server');

const clientCount = readPositiveInteger('CLIENTS', 100);
const messageCount = Math.min(readPositiveInteger('MESSAGES', 10), 10);
const timeoutMs = readPositiveInteger('TIMEOUT_MS', 15_000);

async function main() {
  const relay = createSparkServer({ port: 0, host: '127.0.0.1' });
  await relay.listen();
  const { port } = relay.httpServer.address();
  const url = `ws://127.0.0.1:${port}`;
  const clients = [];

  try {
    await Promise.all(
      Array.from({ length: clientCount }, async () => {
        const client = new WebSocket(url);
        await once(client, 'open');
        clients.push(client);
      })
    );

    const sender = clients[0];
    let received = 0;
    for (const receiver of clients.slice(1)) receiver.on('message', () => { received += 1; });

    const expected = (clientCount - 1) * messageCount;
    const startedAt = performance.now();
    for (let index = 0; index < messageCount; index += 1) {
      sender.send(JSON.stringify({ type: 'spark', x: index / messageCount, y: 0.5 }));
    }
    await waitFor(() => received === expected, timeoutMs);
    const elapsedMs = performance.now() - startedAt;
    process.stdout.write(
      `Relay smoke: ${clientCount} clients, ${messageCount} sparks, ${received}/${expected} deliveries in ${elapsedMs.toFixed(1)}ms\n`
    );
  } finally {
    for (const client of clients) client.terminate();
    await relay.close();
  }
}

function readPositiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function waitFor(predicate, timeout) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(interval);
        reject(new Error('Timed out before all expected relay messages arrived'));
      }
    }, 10);
  });
}

main().catch((error) => {
  process.stderr.write(`Relay smoke failed: ${error.message}\n`);
  process.exitCode = 1;
});
