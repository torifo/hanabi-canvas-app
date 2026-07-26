import { describe, expect, it, vi } from 'vitest';
import { PresenceClient } from '../src/realtime/PresenceClient';

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>); }
}

describe('PresenceClient', () => {
  it('throttles sparks to one send per 200ms', () => {
    let now = 1_000;
    const socket = new FakeSocket();
    const client = new PresenceClient({ webSocketFactory: () => socket, now: () => now });
    client.connect('ws://example.test/ws');
    client.sendSpark(0.1, 0.2);
    now += 199;
    client.sendSpark(0.3, 0.4);
    now += 1;
    client.sendSpark(0.5, 0.6);
    expect(socket.sent).toEqual([
      '{"type":"spark","x":0.1,"y":0.2}',
      '{"type":"spark","x":0.5,"y":0.6}',
    ]);
  });

  it('reconnects with exponentially increasing delays after an unexpected close', () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const client = new PresenceClient({ webSocketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    } });
    client.connect('ws://example.test/ws');
    sockets[0].onclose?.();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1].onclose?.();
    vi.advanceTimersByTime(2_000);
    expect(sockets).toHaveLength(3);
    vi.useRealTimers();
  });

  it('stops both sending and receiving while disabled', () => {
    const socket = new FakeSocket();
    const callback = vi.fn();
    const client = new PresenceClient({ webSocketFactory: () => socket });
    client.connect('ws://example.test/ws');
    client.onRemoteSpark(callback);
    client.setEnabled(false);
    client.sendSpark(0.2, 0.3);
    socket.receive('{"type":"spark","x":0.2,"y":0.3}');
    expect(socket.sent).toEqual([]);
    expect(callback).not.toHaveBeenCalled();
  });
});
