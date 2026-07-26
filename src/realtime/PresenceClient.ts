import type { PresenceClient as PresenceClientContract, SparkMessage } from '../types';

const OPEN = 1;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const SPARK_THROTTLE_MS = 200;

interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

interface PresenceClientOptions {
  webSocketFactory?: (url: string) => SocketLike;
  now?: () => number;
  setTimeoutFn?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Ephemeral browser client for the anonymous spark relay. It deliberately
 * keeps no queue or history: a missed connection never replays a person's tap.
 */
export class PresenceClient implements PresenceClientContract {
  private readonly callbacks = new Set<(x: number, y: number) => void>();
  private readonly webSocketFactory: (url: string) => SocketLike;
  private readonly now: () => number;
  private readonly setTimeoutFn: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (timer: ReturnType<typeof setTimeout>) => void;
  private socket: SocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string | null = null;
  private enabled = true;
  private disposed = false;
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  private lastSparkAt = Number.NEGATIVE_INFINITY;

  constructor(options: PresenceClientOptions = {}) {
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((timer) => clearTimeout(timer));
  }

  connect(url: string): void {
    if (this.disposed || !url) return;
    this.url = url;
    this.cancelReconnect();
    this.closeSocket();
    if (this.enabled) this.open();
  }

  sendSpark(x: number, y: number): void {
    if (!this.enabled || !isNormalizedCoordinate(x) || !isNormalizedCoordinate(y)) return;
    const now = this.now();
    if (now - this.lastSparkAt < SPARK_THROTTLE_MS) return;
    if (!this.socket || this.socket.readyState !== OPEN) return;

    try {
      this.socket.send(JSON.stringify({ type: 'spark', x, y } satisfies SparkMessage));
      this.lastSparkAt = now;
    } catch {
      // A socket can close between readyState and send. The normal close path reconnects.
    }
  }

  onRemoteSpark(callback: (x: number, y: number) => void): void {
    this.callbacks.add(callback);
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.cancelReconnect();
      this.closeSocket();
      return;
    }
    this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    this.open();
  }

  dispose(): void {
    this.disposed = true;
    this.callbacks.clear();
    this.cancelReconnect();
    this.closeSocket();
    this.url = null;
  }

  private open(): void {
    if (!this.enabled || this.disposed || !this.url || this.socket) return;
    let socket: SocketLike;
    try {
      socket = this.webSocketFactory(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket === socket) this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    };
    socket.onmessage = (event) => this.handleMessage(socket, event.data);
    socket.onerror = () => {
      // onclose is the single reconnection path; errors are intentionally not surfaced.
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.enabled && !this.disposed) this.scheduleReconnect();
    };
  }

  private handleMessage(socket: SocketLike, raw: unknown): void {
    if (!this.enabled || this.socket !== socket || typeof raw !== 'string') return;
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isSparkMessage(message)) return;
    for (const callback of this.callbacks) callback(message.x, message.y);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.url || !this.enabled || this.disposed) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private cancelReconnect(): void {
    if (!this.reconnectTimer) return;
    this.clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onclose = null;
    socket.onmessage = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {
      // Ignore close races; the client has already forgotten the socket.
    }
  }
}

function isNormalizedCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isSparkMessage(value: unknown): value is SparkMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SparkMessage>;
  return candidate.type === 'spark' && isNormalizedCoordinate(candidate.x) && isNormalizedCoordinate(candidate.y);
}
