import type { MessageRecord } from '../types';

export const STORAGE_KEY = 'hanabi.messages.v1';
export const MAX_RECORDS = 60;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface MessageStoreOptions {
  storage?: StorageLike | null;
  now?: () => number;
  maxRecords?: number;
}

/**
 * 端末内だけで完結するメッセージ花火の保管庫。
 *
 * サーバーは何も覚えないため、空に積もるのは「その端末が居合わせた分」だけ。
 * 位置は保存しない（起動のたびに自分の空へ配置し直す）。
 * ローカル時刻の正午を境に、それ以前のものを捨てる。
 */
export class MessageStore {
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly maxRecords: number;
  private records: MessageRecord[] = [];

  constructor(options: MessageStoreOptions = {}) {
    this.storage = options.storage !== undefined ? options.storage : safeLocalStorage();
    this.now = options.now ?? (() => Date.now());
    this.maxRecords = options.maxRecords ?? MAX_RECORDS;
    this.records = this.prune(this.read());
  }

  /** 表示対象（正午リセット済み・ミュート除外・古い順） */
  list(): MessageRecord[] {
    this.records = this.prune(this.records);
    return this.records.filter((record) => !record.dismissed);
  }

  add(text: string, mine: boolean): MessageRecord {
    const record: MessageRecord = {
      id: `${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      at: this.now(),
      mine
    };
    this.records = this.prune([...this.records, record]);
    this.write();
    return record;
  }

  /** 自分の空からその花火だけを黙らせる */
  dismiss(id: string): void {
    let changed = false;
    for (const record of this.records) {
      if (record.id === id && !record.dismissed) {
        record.dismissed = true;
        changed = true;
      }
    }
    if (changed) this.write();
  }

  /** 次に正午をまたぐ時刻（ミリ秒）。タイマーの再設定に使う */
  msUntilNextNoon(): number {
    return nextNoon(this.now()) - this.now();
  }

  /** 正午をまたいだ分を捨てる。捨てた件数を返す */
  sweep(): number {
    const before = this.records.length;
    this.records = this.prune(this.records);
    if (this.records.length !== before) this.write();
    return before - this.records.length;
  }

  private prune(records: readonly MessageRecord[]): MessageRecord[] {
    const boundary = previousNoon(this.now());
    const kept = records.filter((record) => isRecord(record) && record.at >= boundary);
    kept.sort((a, b) => a.at - b.at);
    // 上限を超えたら古い順に捨てる
    return kept.length > this.maxRecords ? kept.slice(kept.length - this.maxRecords) : kept;
  }

  private read(): MessageRecord[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch {
      // 容量超過や無効化。保存を諦めてメモリのみで続ける
    }
  }
}

/** 直近の正午（それより前のレコードは捨てる） */
export function previousNoon(now: number): number {
  const date = new Date(now);
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  if (noon.getTime() > now) noon.setDate(noon.getDate() - 1);
  return noon.getTime();
}

/** 次に来る正午 */
export function nextNoon(now: number): number {
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  if (noon.getTime() <= now) noon.setDate(noon.getDate() + 1);
  return noon.getTime();
}

function isRecord(value: unknown): value is MessageRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MessageRecord>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.at === 'number' &&
    Number.isFinite(candidate.at) &&
    typeof candidate.mine === 'boolean'
  );
}

function safeLocalStorage(): StorageLike | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    // Safari のプライベートモードなど、存在しても書けない環境がある
    const probe = `${STORAGE_KEY}.probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
