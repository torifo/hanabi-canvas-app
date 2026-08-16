import { describe, expect, it } from 'vitest';
// @ts-expect-error -- 収集スクリプトは実行用の .mjs で、型定義は持たない
import { buildId, mergeSchedule, parseRow, resolveDate } from '../scripts/collect-schedule.mjs';

describe('parseRow', () => {
  it('pulls the prefecture, city, name, date expression and official link out of a row', () => {
    const line =
      '|style="text-align:left"|{{Sort|01100|{{Flagicon2|北海道}}[[札幌市]]}}||' +
      '{{Sort|とうしんゆうえいちひい|[[道新・UHB花火大会]]}}||7月31日||4000発||||[https://example.jp/hanabi]';
    expect(parseRow(line)).toEqual({
      prefecture: '北海道',
      municipality: '札幌市',
      name: '道新・UHB花火大会',
      dateExpression: '7月31日',
      officialUrl: 'https://example.jp/hanabi'
    });
  });

  it('accepts a row without an official link', () => {
    const line =
      '|style="text-align:left"|{{Sort|01228|{{Flagicon2|北海道}}[[深川市]]}}||' +
      '{{Sort|ふかかわなつまつり|[[ふかがわ夏まつり花火大会]]}}||7月第4日曜日||2500発||||';
    expect(parseRow(line)?.officialUrl).toBeUndefined();
    expect(parseRow(line)?.dateExpression).toBe('7月第4日曜日');
  });

  it('ignores lines that are not table rows', () => {
    expect(parseRow('|-')).toBeNull();
    expect(parseRow('!開催地!!名称!!開催日')).toBeNull();
  });
});

describe('resolveDate', () => {
  it('resolves a fixed month and day', () => {
    expect(resolveDate('8月2日', 2026)).toBe('2026-08-02T19:30:00+09:00');
  });

  it('resolves the nth weekday of a month', () => {
    // 2026年8月の第1土曜日は8月1日
    expect(resolveDate('8月第1土曜日', 2026)).toBe('2026-08-01T19:30:00+09:00');
    // 2026年7月の第4日曜日は7月26日
    expect(resolveDate('7月第4日曜日', 2026)).toBe('2026-07-26T19:30:00+09:00');
  });

  it('resolves the last weekday of a month', () => {
    // 2026年7月の最終土曜日は7月25日
    expect(resolveDate('7月最終土曜日', 2026)).toBe('2026-07-25T19:30:00+09:00');
    expect(resolveDate('7月第5土曜日', 2026)).toBe('2026-07-25T19:30:00+09:00');
  });

  it('declines ranges and expressions it cannot pin to a day', () => {
    // 期間物は「次の1件」に向かないので取り込まない
    expect(resolveDate('4月下旬 - 10月', 2026)).toBeNull();
    expect(resolveDate('8月上旬', 2026)).toBeNull();
    expect(resolveDate('未定', 2026)).toBeNull();
  });

  it('rejects a day that does not exist in that month', () => {
    expect(resolveDate('2月30日', 2026)).toBeNull();
  });
});

describe('buildId', () => {
  it('is stable for the same event and year, and differs across years', () => {
    expect(buildId('隅田川花火大会', '東京都', 2026)).toBe(buildId('隅田川花火大会', '東京都', 2026));
    expect(buildId('隅田川花火大会', '東京都', 2026)).not.toBe(buildId('隅田川花火大会', '東京都', 2027));
  });
});

describe('mergeSchedule', () => {
  const collected = [
    { id: 'a', name: 'あ', prefecture: '東京都', date: '2026-08-01T19:30:00+09:00', source: 'wikipedia' }
  ];

  it('adds events that are not held yet', () => {
    const result = mergeSchedule([], collected);
    expect(result.added).toHaveLength(1);
    expect(result.events).toHaveLength(1);
  });

  it('never overwrites an entry a person has verified', () => {
    const existing = [
      { id: 'a', name: 'あ', prefecture: '東京都', date: '2026-08-02T19:00:00+09:00', verified: true }
    ];
    const result = mergeSchedule(existing, collected);
    expect(result.updated).toHaveLength(0);
    expect(result.events[0]?.date).toBe('2026-08-02T19:00:00+09:00');
  });

  it('updates an unverified entry when the collected date moves', () => {
    const existing = [{ id: 'a', name: 'あ', prefecture: '東京都', date: '2026-08-09T19:30:00+09:00' }];
    const result = mergeSchedule(existing, collected);
    expect(result.updated).toHaveLength(1);
    expect(result.events[0]?.date).toBe('2026-08-01T19:30:00+09:00');
  });

  it('leaves hand-written entries that the collector never saw', () => {
    const existing = [{ id: 'manual', name: '手入力', prefecture: '福岡県', date: '2026-08-05T19:00:00+09:00' }];
    const result = mergeSchedule(existing, collected);
    expect(result.events.map((event) => event.id).sort()).toEqual(['a', 'manual']);
  });

  it('keeps the result sorted by date', () => {
    const existing = [{ id: 'later', name: '後', prefecture: '東京都', date: '2026-09-01T19:00:00+09:00' }];
    const result = mergeSchedule(existing, collected);
    expect(result.events.map((event) => event.id)).toEqual(['a', 'later']);
  });
});
