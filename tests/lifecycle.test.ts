import { describe, expect, it } from 'vitest';
import { resolveMuted, resolvePresenceUrl, shouldDisposeOnPageHide } from '../src/lifecycle';

describe('AppCore lifecycle policy', () => {
  it('keeps a user mute active after the document becomes visible again', () => {
    expect(resolveMuted(true, true)).toBe(true);
    expect(resolveMuted(true, false)).toBe(true);
  });

  it('uses a temporary mute while a non-muted document is hidden', () => {
    expect(resolveMuted(false, true)).toBe(true);
    expect(resolveMuted(false, false)).toBe(false);
  });

  it('preserves engines for bfcache and disposes on a real unload', () => {
    expect(shouldDisposeOnPageHide(true)).toBe(false);
    expect(shouldDisposeOnPageHide(false)).toBe(true);
  });

  it('uses a valid configured WebSocket URL and rejects other schemes', () => {
    expect(resolvePresenceUrl(' wss://presence.example.com/ws ', true, 'https:', 'app.example.com'))
      .toBe('wss://presence.example.com/ws');
    expect(resolvePresenceUrl('https://presence.example.com/ws', true, 'https:', 'app.example.com'))
      .toBeNull();
    expect(resolvePresenceUrl('not a url', true, 'https:', 'app.example.com')).toBeNull();
  });

  it('defaults production web builds to the same-host /ws endpoint', () => {
    expect(resolvePresenceUrl(undefined, true, 'https:', 'app.example.com'))
      .toBe('wss://app.example.com/ws');
    expect(resolvePresenceUrl(undefined, true, 'http:', 'localhost:5731'))
      .toBe('ws://localhost:5731/ws');
    expect(resolvePresenceUrl(undefined, false, 'http:', 'localhost:5731')).toBeNull();
    expect(resolvePresenceUrl(undefined, true, 'file:', '')).toBeNull();
  });
});
