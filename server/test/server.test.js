'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const {
  MAX_PEER_BUFFERED_BYTES,
  broadcastSpark,
  createSparkServer,
  withinRateLimit,
} = require('../server');

async function withRelay(run, serverOptions = {}) {
  const relay = createSparkServer({ port: 0, host: '127.0.0.1', ...serverOptions });
  await relay.listen();
  const { port } = relay.httpServer.address();
  try {
    await run(`ws://127.0.0.1:${port}`);
  } finally {
    await relay.close();
  }
}

async function connect(url, options = {}) {
  const socket = new WebSocket(url, options);
  await once(socket, 'open');
  return socket;
}

function nextMessage(socket, timeoutMs = 200) {
  return Promise.race([
    once(socket, 'message').then(([payload]) => payload.toString()),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

test('forwards a valid spark to other clients but never echoes it', async () => {
  await withRelay(async (url) => {
    const sender = await connect(url);
    const receiver = await connect(url);
    try {
      const remote = nextMessage(receiver);
      const echoed = nextMessage(sender);
      sender.send(JSON.stringify({ type: 'spark', x: 0.25, y: 0.75 }));
      assert.deepEqual(JSON.parse(await remote), { type: 'spark', x: 0.25, y: 0.75 });
      assert.equal(await echoed, null);
    } finally {
      sender.close();
      receiver.close();
    }
  });
});

test('forwards a message firework and never adds coordinates or identity', async () => {
  await withRelay(async (url) => {
    const sender = await connect(url);
    const receiver = await connect(url);
    try {
      const remote = nextMessage(receiver);
      const echoed = nextMessage(sender);
      sender.send(JSON.stringify({ type: 'bloom', text: 'また明日' }));
      // Position is never transmitted: each client places the bloom in its own sky.
      assert.deepEqual(JSON.parse(await remote), { type: 'bloom', text: 'また明日' });
      assert.equal(await echoed, null);
    } finally {
      sender.close();
      receiver.close();
    }
  });
});

test('drops message fireworks that are empty, overlong, or the wrong shape', async () => {
  await withRelay(async (url) => {
    const sender = await connect(url);
    const receiver = await connect(url);
    try {
      const silent = nextMessage(receiver);
      sender.send(JSON.stringify({ type: 'bloom', text: '' }));
      sender.send(JSON.stringify({ type: 'bloom', text: 'あ'.repeat(31) }));
      sender.send(JSON.stringify({ type: 'bloom' }));
      sender.send(JSON.stringify({ type: 'bloom', text: 42 }));
      assert.equal(await silent, null);

      // A valid one still gets through afterwards.
      const accepted = nextMessage(receiver);
      sender.send(JSON.stringify({ type: 'bloom', text: 'あ'.repeat(30) }));
      assert.deepEqual(JSON.parse(await accepted), { type: 'bloom', text: 'あ'.repeat(30) });
    } finally {
      sender.close();
      receiver.close();
    }
  });
});

test('accepts only the configured production Origin on direct Node upgrades', async () => {
  const origin = 'https://hanabi.example.com';
  await withRelay(async (url) => {
    const accepted = await connect(url, { origin });
    try {
      await assert.rejects(
        connect(url, { origin: 'https://untrusted.example' }),
        /Unexpected server response: 403/
      );
    } finally {
      accepted.close();
    }
  }, { origin });
});

test('silently discards malformed, oversized, and out-of-range messages', async () => {
  await withRelay(async (url) => {
    const sender = await connect(url);
    const receiver = await connect(url);
    try {
      sender.send('{not-json');
      sender.send(JSON.stringify({ type: 'spark', x: -0.01, y: 0.5 }));
      sender.send(JSON.stringify({ type: 'spark', x: 0.5, y: 0.5, padding: 'x'.repeat(300) }));
      assert.equal(await nextMessage(receiver), null);
    } finally {
      sender.close();
      receiver.close();
    }
  });
});

test('allows ten sparks per second and drops later sparks in that window', async () => {
  await withRelay(async (url) => {
    const sender = await connect(url);
    const receiver = await connect(url);
    try {
      const received = [];
      receiver.on('message', (payload) => received.push(JSON.parse(payload.toString())));
      for (let index = 0; index < 12; index += 1) {
        sender.send(JSON.stringify({ type: 'spark', x: index / 12, y: 0.5 }));
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(received.length, 10);
    } finally {
      sender.close();
      receiver.close();
    }
  });
});

test('uses a sliding one-second window across a fixed-window boundary', () => {
  const rateTimestamps = new Map();
  const client = createPeer();

  for (let index = 0; index < 10; index += 1) {
    assert.equal(withinRateLimit(rateTimestamps, client, 999), true);
  }
  // A fixed 0–999 / 1000–1999 window would permit these immediately after
  // the boundary, yielding a 20-message burst in a continuous second.
  for (let index = 0; index < 10; index += 1) {
    assert.equal(withinRateLimit(rateTimestamps, client, 1000), false);
  }
  assert.equal(withinRateLimit(rateTimestamps, client, 2000), true);
});

test('terminates a backpressured peer without interrupting healthy recipients', () => {
  const sender = createPeer();
  const slowPeer = createPeer({ bufferedAmount: MAX_PEER_BUFFERED_BYTES });
  const healthyPeer = createPeer();
  const payload = JSON.stringify({ type: 'spark', x: 0.25, y: 0.75 });

  broadcastSpark(new Set([sender, slowPeer, healthyPeer]), sender, payload);

  assert.equal(slowPeer.terminated, true);
  assert.deepEqual(slowPeer.messages, []);
  assert.equal(healthyPeer.terminated, false);
  assert.deepEqual(healthyPeer.messages, [payload]);
});

test('contains a send failure to its peer and continues broadcasting', () => {
  const sender = createPeer();
  const brokenPeer = createPeer({ throwsOnSend: true });
  const healthyPeer = createPeer();
  const payload = JSON.stringify({ type: 'spark', x: 0.25, y: 0.75 });

  broadcastSpark(new Set([sender, brokenPeer, healthyPeer]), sender, payload);

  assert.equal(brokenPeer.terminated, true);
  assert.deepEqual(healthyPeer.messages, [payload]);
});

function createPeer({ bufferedAmount = 0, throwsOnSend = false } = {}) {
  return {
    bufferedAmount,
    messages: [],
    readyState: WebSocket.OPEN,
    terminated: false,
    send(payload, callback) {
      if (throwsOnSend) throw new Error('simulated send failure');
      this.messages.push(payload);
      callback?.();
    },
    terminate() {
      this.terminated = true;
    },
  };
}
