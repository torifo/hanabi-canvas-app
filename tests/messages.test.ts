import { describe, expect, it } from 'vitest';
import { MessageStore, nextNoon, previousNoon } from '../src/messages/MessageStore';
import { hashText, messagePalette } from '../src/messages/messageColor';
import { MAX_MESSAGE_LENGTH, guardMessage } from '../src/messages/messageGuard';
import { clearance, distanceToRect, findPlacement } from '../src/messages/placement';
import type { MessageRecord } from '../src/types';

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('guardMessage', () => {
  it('accepts a short phrase and collapses surrounding whitespace', () => {
    const result = guardMessage('  そっと  ひとこと \n ');
    expect(result).toEqual({ ok: true, text: 'そっと ひとこと' });
  });

  it('rejects text longer than the limit, counting emoji as one character', () => {
    const withinLimit = '🎆'.repeat(MAX_MESSAGE_LENGTH);
    expect(guardMessage(withinLimit).ok).toBe(true);
    expect(guardMessage('🎆'.repeat(MAX_MESSAGE_LENGTH + 1))).toEqual({ ok: false, reason: 'too-long' });
  });

  it('rejects empty input, links, control characters, and blocked words', () => {
    expect(guardMessage('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(guardMessage('https://example.com')).toEqual({ ok: false, reason: 'url' });
    expect(guardMessage('example.jp をみて')).toEqual({ ok: false, reason: 'url' });
    expect(guardMessage('ひとこと​')).toEqual({ ok: false, reason: 'control' });
    expect(guardMessage('死ね')).toEqual({ ok: false, reason: 'blocked' });
  });
});

describe('messagePalette', () => {
  it('returns the same palette for the same text so every device agrees', () => {
    // 色は通信しない。各端末が文面から独立に導いても一致する必要がある
    expect(messagePalette('また明日')).toEqual(messagePalette('また明日'));
    expect(hashText('また明日')).toBe(hashText('また明日'));
  });

  it('maps known words to their palette and falls back to a hash otherwise', () => {
    expect(messagePalette('おめでとう').outer).toBe('#F0B460');
    expect(messagePalette('静かな夜に').outer).toBe('#5FC9C6');
    const fallback = messagePalette('あいうえお');
    expect(fallback.core).toBeTruthy();
  });

  it('always keeps a desaturated core so bloom can pick it up', () => {
    // 正本のコア #FFF6E0 は最小チャンネル 0xE0。純彩色のコアはリニア輝度が
    // 低く加算合成で光って見えないため、どの色でもここを下回らせない
    for (const text of ['おめでとう', '静か', '好き', '空', '夢', '元気', '明日', 'ランダム']) {
      const palette = messagePalette(text);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(palette.core.slice(i, i + 2), 16));
      expect(Math.min(r!, g!, b!)).toBeGreaterThanOrEqual(0xe0);
    }
  });
});

describe('placement', () => {
  const area = { minX: 0, maxX: 1440, minY: 70, maxY: 380 };

  it('keeps clear of existing blooms', () => {
    const occupied = [
      { x: 372, y: 216, r: 178 },
      { x: 1068, y: 216, r: 178 }
    ];
    const spot = findPlacement({ area, radius: 64, occupied, avoidRects: [], samples: 200 });
    for (const circle of occupied) {
      expect(Math.hypot(spot.x - circle.x, spot.y - circle.y)).toBeGreaterThan(circle.r);
    }
  });

  it('avoids UI rectangles', () => {
    const rect = { x: 0, y: 70, w: 700, h: 310 };
    const spot = findPlacement({ area, radius: 64, occupied: [], avoidRects: [rect], samples: 200 });
    expect(distanceToRect(spot.x, spot.y, rect)).toBeGreaterThan(0);
  });

  it('still returns a point when the sky is full', () => {
    const packed = Array.from({ length: 40 }, (_, i) => ({ x: (i % 8) * 180, y: 100 + Math.floor(i / 8) * 70, r: 160 }));
    const spot = findPlacement({ area, radius: 64, occupied: packed, avoidRects: [], samples: 12 });
    expect(Number.isFinite(spot.x)).toBe(true);
    expect(Number.isFinite(spot.y)).toBe(true);
  });

  it('reports negative clearance inside an occupied circle', () => {
    expect(clearance(372, 216, 64, [{ x: 372, y: 216, r: 178 }], [])).toBeLessThan(0);
  });
});

describe('MessageStore', () => {
  const noonJul26 = new Date(2026, 6, 26, 12, 0, 0, 0).getTime();

  it('finds the noon boundary on either side of midday', () => {
    const morning = new Date(2026, 6, 26, 9, 0, 0, 0).getTime();
    expect(previousNoon(morning)).toBe(new Date(2026, 6, 25, 12, 0, 0, 0).getTime());
    expect(nextNoon(morning)).toBe(noonJul26);

    const evening = new Date(2026, 6, 26, 21, 0, 0, 0).getTime();
    expect(previousNoon(evening)).toBe(noonJul26);
    expect(nextNoon(evening)).toBe(new Date(2026, 6, 27, 12, 0, 0, 0).getTime());
  });

  it('drops records from before the most recent noon', () => {
    const storage = new MemoryStorage();
    const beforeNoon: MessageRecord = { id: 'old', text: '昨夜', at: noonJul26 - 60_000, mine: false };
    const afterNoon: MessageRecord = { id: 'new', text: '今夜', at: noonJul26 + 60_000, mine: true };
    storage.setItem('hanabi.messages.v1', JSON.stringify([beforeNoon, afterNoon]));

    const evening = new Date(2026, 6, 26, 21, 0, 0, 0).getTime();
    const store = new MessageStore({ storage, now: () => evening });
    expect(store.list().map((r) => r.id)).toEqual(['new']);
  });

  it('keeps only the newest records once the cap is reached', () => {
    const evening = new Date(2026, 6, 26, 21, 0, 0, 0).getTime();
    let clock = evening;
    const store = new MessageStore({ storage: new MemoryStorage(), now: () => clock++, maxRecords: 3 });
    for (const text of ['一', '二', '三', '四']) store.add(text, true);
    expect(store.list().map((r) => r.text)).toEqual(['二', '三', '四']);
  });

  it('hides a dismissed record but keeps it out of the way permanently', () => {
    const evening = new Date(2026, 6, 26, 21, 0, 0, 0).getTime();
    const storage = new MemoryStorage();
    const store = new MessageStore({ storage, now: () => evening });
    const record = store.add('ひとこと', false);
    store.dismiss(record.id);
    expect(store.list()).toEqual([]);

    const reopened = new MessageStore({ storage, now: () => evening });
    expect(reopened.list()).toEqual([]);
  });

  it('works without storage and ignores corrupt data', () => {
    const evening = new Date(2026, 6, 26, 21, 0, 0, 0).getTime();
    const store = new MessageStore({ storage: null, now: () => evening });
    store.add('保存できなくても灯る', true);
    expect(store.list()).toHaveLength(1);

    const broken = new MemoryStorage();
    broken.setItem('hanabi.messages.v1', '{ not json');
    expect(new MessageStore({ storage: broken, now: () => evening }).list()).toEqual([]);
  });

  it('sweeps records once noon has passed', () => {
    const storage = new MemoryStorage();
    let clock = new Date(2026, 6, 26, 21, 0, 0, 0).getTime();
    const store = new MessageStore({ storage, now: () => clock });
    store.add('今夜', true);
    expect(store.list()).toHaveLength(1);

    clock = new Date(2026, 6, 27, 13, 0, 0, 0).getTime(); // 翌日の正午すぎ
    expect(store.sweep()).toBe(1);
    expect(store.list()).toEqual([]);
  });
});
