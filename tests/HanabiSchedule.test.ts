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

  it('carries area, municipality, venue and status through unchanged', () => {
    const schedule = new HanabiSchedule([
      {
        id: 'chofu',
        name: '調布花火',
        prefecture: '東京都',
        date: '2026-09-12T19:00:00+09:00',
        area: '東京多摩エリア',
        municipality: '調布市',
        venue: '多摩川',
        status: 'provisional'
      }
    ]);
    const next = schedule.nextEvent(new Date('2026-09-01T00:00:00+09:00'));
    expect(next?.area).toBe('東京多摩エリア');
    expect(next?.municipality).toBe('調布市');
    expect(next?.venue).toBe('多摩川');
    expect(next?.status).toBe('provisional');
  });

  it('skips cancelled and postponed events when counting down', () => {
    const schedule = new HanabiSchedule([
      { id: 'off', name: '中止', prefecture: '東京都', date: '2026-08-01T19:00:00+09:00', status: 'cancelled' },
      { id: 'later', name: '延期', prefecture: '東京都', date: '2026-08-05T19:00:00+09:00', status: 'postponed' },
      { id: 'live', name: '開催', prefecture: '東京都', date: '2026-08-10T19:00:00+09:00' }
    ]);
    const now = new Date('2026-07-01T00:00:00+09:00');
    expect(schedule.nextEvent(now)?.id).toBe('live');
    expect(schedule.upcoming(now).map((e) => e.id)).toEqual(['live']);
  });

  it('lists upcoming events so a regional view can be built', () => {
    const schedule = new HanabiSchedule([
      { id: 'a', name: 'あ', prefecture: '東京都', date: '2026-08-01T19:00:00+09:00', area: '東京多摩エリア' },
      { id: 'b', name: 'い', prefecture: '神奈川県', date: '2026-08-01T19:00:00+09:00', area: '東京多摩エリア' },
      { id: 'c', name: 'う', prefecture: '東京都', date: '2026-09-05T19:00:00+09:00', area: '東京多摩エリア' },
      { id: 'past', name: 'え', prefecture: '東京都', date: '2026-07-01T19:00:00+09:00' }
    ]);
    const now = new Date('2026-07-20T00:00:00+09:00');
    expect(schedule.upcoming(now).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(schedule.upcoming(now, 2).map((e) => e.id)).toEqual(['a', 'b']);
    // 同じ日に複数、県をまたぐ地域の括りも保持できる
    expect(schedule.upcoming(now).filter((e) => e.area === '東京多摩エリア')).toHaveLength(3);
  });

  it('drops a record whose optional field has the wrong type', () => {
    const schedule = new HanabiSchedule([
      { id: 'bad', name: '壊れ', prefecture: '東京都', date: '2026-08-01T19:00:00+09:00', area: 42 },
      { id: 'ok', name: '正常', prefecture: '東京都', date: '2026-08-02T19:00:00+09:00' }
    ] as never);
    expect(schedule.nextEvent(new Date('2026-07-01T00:00:00+09:00'))?.id).toBe('ok');
  });
});
