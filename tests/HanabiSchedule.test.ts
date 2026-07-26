import { describe, expect, it } from 'vitest';
import { HanabiSchedule } from '../src/realtime/HanabiSchedule';

describe('HanabiSchedule', () => {
  it('returns the next future start and decomposes its countdown in JST-safe ISO time', () => {
    const schedule = new HanabiSchedule([
      { id: 'past', name: 'Past', prefecture: '東京都', date: '2026-07-25T19:00:00+09:00' },
      { id: 'next', name: 'Next', prefecture: '秋田県', date: '2026-07-27T20:05:00+09:00' },
    ]);
    const now = new Date('2026-07-25T19:00:00+09:00');
    expect(schedule.nextEvent(now)?.id).toBe('next');
    expect(schedule.countdown(now)).toEqual({ days: 2, hours: 1, minutes: 5 });
  });

  it('moves past an event as soon as its advertised start time is reached', () => {
    const schedule = new HanabiSchedule([
      { id: 'current', name: 'Current', prefecture: '東京都', date: '2026-07-25T19:00:00+09:00' },
      { id: 'later', name: 'Later', prefecture: '大阪府', date: '2026-07-25T20:00:00+09:00' },
    ]);
    expect(schedule.nextEvent(new Date('2026-07-25T19:00:00+09:00'))?.id).toBe('later');
    expect(schedule.countdown(new Date('2026-07-25T19:59:59+09:00'))).toEqual({ days: 0, hours: 0, minutes: 0 });
  });

  it('returns null when there is no future event', () => {
    const schedule = new HanabiSchedule([]);
    expect(schedule.nextEvent(new Date('2026-07-25T19:00:00+09:00'))).toBeNull();
    expect(schedule.countdown(new Date('2026-07-25T19:00:00+09:00'))).toBeNull();
  });
});
