'use strict';

const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');

const MAX_MESSAGE_BYTES = 256;
const MAX_MESSAGES_PER_SECOND = 10;
// A peer that cannot drain roughly 256 maximum-size relay frames is considered
// unavailable. Terminating it bounds one slow client's queued memory.
const MAX_PEER_BUFFERED_BYTES = 64 * 1024;

/**
 * A deliberately stateless relay: it never assigns an identifier, retains a
 * spark, or writes client data to disk.  It only forwards the validated
 * protocol shape to other clients that are open at the instant of receipt.
 *
 * @param {{port?: number, host?: string, origin?: string | undefined}} [options]
 */
function createSparkServer(options = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 8080);
  const allowedOrigin = options.origin ?? process.env.ALLOWED_ORIGIN;
  const requestListener = allowedOrigin
    ? (request, response) => {
        response.writeHead(404);
        response.end();
      }
    : undefined;
  const httpServer = http.createServer(requestListener);
  const wss = new WebSocketServer({ noServer: true });
  const rateTimestamps = new Map();

  httpServer.on('upgrade', (request, socket, head) => {
    // Nginx should be the public Origin boundary. This optional check protects
    // deployments that expose Node directly as well.
    if (allowedOrigin && request.headers.origin !== allowedOrigin) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  });

  wss.on('connection', (client) => {
    client.on('message', (raw, isBinary) => {
      if (isBinary || Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) return;
      if (!withinRateLimit(rateTimestamps, client)) return;

      const message = parseSparkMessage(raw);
      if (!message) return;

      // Re-serializing forwards only the public protocol fields, never any
      // accidental metadata a client included in its JSON object.
      broadcastSpark(wss.clients, client, JSON.stringify(message));
    });

    client.on('close', () => rateTimestamps.delete(client));
    client.on('error', () => {
      // `ws` emits errors for malformed/abrupt peers; there is no user data to log.
    });
  });

  return {
    httpServer,
    wss,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          httpServer.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          httpServer.off('error', onError);
          resolve();
        };
        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(port, options.host ?? '0.0.0.0');
      });
    },
    close() {
      for (const client of wss.clients) client.terminate();
      return new Promise((resolve, reject) => {
        wss.close((wssError) => {
          httpServer.close((serverError) => {
            if (wssError || serverError) reject(wssError ?? serverError);
            else resolve();
          });
        });
      });
    },
  };
}

/**
 * Forward an ephemeral spark only to peers that can accept it immediately.
 * There is deliberately no per-client retry queue: a remote spark is ambient
 * and transient, whereas an unbounded queue would let a stalled peer exhaust
 * the single VPS process. A terminated client reconnects through the browser
 * client's normal backoff path.
 *
 * @param {Iterable<WebSocket>} peers
 * @param {WebSocket} sender
 * @param {string} payload
 */
function broadcastSpark(peers, sender, payload) {
  const payloadBytes = Buffer.byteLength(payload);
  for (const peer of peers) {
    if (peer === sender || peer.readyState !== WebSocket.OPEN) continue;

    const queuedBytes = Number.isFinite(peer.bufferedAmount) ? peer.bufferedAmount : 0;
    if (queuedBytes + payloadBytes > MAX_PEER_BUFFERED_BYTES) {
      terminateQuietly(peer);
      continue;
    }

    try {
      peer.send(payload, (error) => {
        if (error) terminateQuietly(peer);
      });
    } catch {
      // A peer can close after its readyState check; never let it interrupt
      // delivery to the remaining clients.
      terminateQuietly(peer);
    }
  }
}

function terminateQuietly(peer) {
  try {
    peer.terminate();
  } catch {
    // The connection may already have finished closing.
  }
}

/**
 * Permit at most ten messages in every continuous one-second interval. Each
 * client stores no more than ten timestamps, so the limiter is bounded even
 * with thousands of active sockets.
 *
 * @param {Map<WebSocket, number[]>} rateTimestamps
 * @param {WebSocket} client
 * @param {number} [now]
 */
function withinRateLimit(rateTimestamps, client, now = Date.now()) {
  const timestamps = rateTimestamps.get(client) ?? [];
  const cutoff = now - 1000;
  while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift();
  if (timestamps.length >= MAX_MESSAGES_PER_SECOND) return false;
  timestamps.push(now);
  rateTimestamps.set(client, timestamps);
  return true;
}

function parseSparkMessage(raw) {
  let value;
  try {
    value = JSON.parse(raw.toString());
  } catch {
    return null;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    value.type !== 'spark' ||
    !isNormalizedCoordinate(value.x) ||
    !isNormalizedCoordinate(value.y)
  ) {
    return null;
  }
  return { type: 'spark', x: value.x, y: value.y };
}

function isNormalizedCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

if (require.main === module) {
  const server = createSparkServer();
  server.listen().catch((error) => {
    // Startup failure contains operational rather than client data.
    console.error('WebSocket relay could not start:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES_PER_SECOND,
  MAX_PEER_BUFFERED_BYTES,
  broadcastSpark,
  createSparkServer,
  parseSparkMessage,
  withinRateLimit,
};
