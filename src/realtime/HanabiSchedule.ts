import type {
  Countdown,
  HanabiEvent,
  HanabiEventStatus,
  HanabiSchedule as HanabiScheduleContract
} from '../types';

/** Loads and queries future event start times without retaining user data. */
export class HanabiSchedule implements HanabiScheduleContract {
  private events: HanabiEvent[];

  constructor(events: HanabiEvent[] = []) {
    this.events = sortEvents(events.filter(isHanabiEvent));
  }

  async load(url: string): Promise<HanabiEvent[]> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load hanabi schedule: ${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error('Hanabi schedule must be an array');
    this.events = sortEvents(payload.filter(isHanabiEvent));
    return [...this.events];
  }

  nextEvent(now: Date): HanabiEvent | null {
    const nowMs = now.getTime();
    if (Number.isNaN(nowMs)) return null;
    // 中止・延期が分かっている大会へカウントダウンしても意味がないため飛ばす
    return this.events.find((event) => Date.parse(event.date) > nowMs && isUpcoming(event)) ?? null;
  }

  /** その時点から先の開催予定。地域の一覧など、次の1件以外の用途に使う */
  upcoming(now: Date, limit?: number): HanabiEvent[] {
    const nowMs = now.getTime();
    if (Number.isNaN(nowMs)) return [];
    const future = this.events.filter((event) => Date.parse(event.date) > nowMs && isUpcoming(event));
    return typeof limit === 'number' ? future.slice(0, Math.max(0, limit)) : future;
  }

  countdown(now: Date): Countdown | null {
    const event = this.nextEvent(now);
    if (!event) return null;
    const remainingMinutes = Math.max(0, Math.floor((Date.parse(event.date) - now.getTime()) / 60_000));
    return {
      days: Math.floor(remainingMinutes / (24 * 60)),
      hours: Math.floor((remainingMinutes % (24 * 60)) / 60),
      minutes: remainingMinutes % 60,
    };
  }
}

const STATUSES: readonly HanabiEventStatus[] = ['announced', 'provisional', 'cancelled', 'postponed'];

function isUpcoming(event: HanabiEvent): boolean {
  const status = event.status ?? 'announced';
  return status !== 'cancelled' && status !== 'postponed';
}

function isHanabiEvent(value: unknown): value is HanabiEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<HanabiEvent>;
  // 任意フィールドは、型が違えば黙って無視するのではなくレコードごと落とす。
  // 壊れた1件が地域表示へ紛れ込むより、その1件が出ないほうが害が小さい
  const optionalStrings: Array<unknown> = [
    event.area,
    event.municipality,
    event.venue,
    event.officialUrl,
    event.source,
    event.sourceUrl
  ];
  return (
    typeof event.id === 'string' &&
    typeof event.name === 'string' &&
    typeof event.prefecture === 'string' &&
    typeof event.date === 'string' &&
    Number.isFinite(Date.parse(event.date)) &&
    optionalStrings.every((field) => field === undefined || typeof field === 'string') &&
    (event.status === undefined || STATUSES.includes(event.status)) &&
    (event.verified === undefined || typeof event.verified === 'boolean')
  );
}

function sortEvents(events: HanabiEvent[]): HanabiEvent[] {
  return [...events].sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}
