import type { Countdown, HanabiEvent, HanabiSchedule as HanabiScheduleContract } from '../types';

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
    return this.events.find((event) => Date.parse(event.date) > nowMs) ?? null;
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

function isHanabiEvent(value: unknown): value is HanabiEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<HanabiEvent>;
  return (
    typeof event.id === 'string' &&
    typeof event.name === 'string' &&
    typeof event.prefecture === 'string' &&
    typeof event.date === 'string' &&
    Number.isFinite(Date.parse(event.date))
  );
}

function sortEvents(events: HanabiEvent[]): HanabiEvent[] {
  return [...events].sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}
