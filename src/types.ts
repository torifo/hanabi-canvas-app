export type MoodId = 'sparkle' | 'quiet';

// ムード遷移時間の共有定数 (graphics のグレード補間と audio のイージングで共用)
export const MOOD_TRANSITION_MS = 1200;

export interface MoodProfile {
  id: MoodId;
  bloomStrength: number;
  colorGrade: 'sunset-navy' | 'cyan-darknavy';
  particleSpeed: number;
  lowpassFreq: number | null;
}

export interface GraphicsEngine {
  init(canvas: HTMLCanvasElement): Promise<void>;
  // スクリーン座標 → シーン座標系 (横長ベースイラスト全体を 0-1 とする)。
  // SparkMessage の x, y はこの座標系で送受信する
  toSceneCoords(clientX: number, clientY: number): { x: number; y: number };
  setMood(profile: MoodProfile): void;
  // 火花を放てたら true。常駐の輪の上など、火花にならなかった場合は false
  // （呼び出し側はこの結果を見て気配の送信可否を決める）
  emitSpark(x: number, y: number, charge: number): boolean;
  emitRemoteSpark(x: number, y: number): void;
  beginCharge(x: number, y: number): void;
  endCharge(): number;
  resize(w: number, h: number): void;
  dispose(): void;

  // --- メッセージ花火 ---
  /** その座標が打ち上げ前の玉の上か（クリックで入力欄を開く判定に使う） */
  isShellAt(x: number, y: number): boolean;
  /** 保存済みのメッセージ花火を自分の空へ配置し直す（起動時・画面回転時） */
  setMessages(records: readonly MessageRecord[]): void;
  /** 1発を空いている場所へ咲かせる。玉から昇るのは自分が放ったときだけ */
  bloomMessage(record: MessageRecord, launched: boolean): void;
  /** その座標のメッセージ花火（シーン正規化座標）。触れると文面が読める */
  messageAt(x: number, y: number): MessageRecord | null;
  /** 文面ラベルの「消す」に触れたか。触れていればその花火のID */
  dismissAt(x: number, y: number): string | null;
  /** 黙らせた花火を空から外す */
  removeMessage(id: string): void;
}

export interface SoundEngine {
  init(): Promise<void>;
  setMood(profile: MoodProfile): void;
  playSparkle(): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export interface PresenceClient {
  connect(url: string): void;
  sendSpark(x: number, y: number): void;
  onRemoteSpark(cb: (x: number, y: number) => void): void;
  // メッセージ花火。火花と違いスロットリングしない（連投を許容する）
  sendBloom(text: string): void;
  onRemoteBloom(cb: (text: string) => void): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface HanabiEvent {
  id: string;
  name: string;
  prefecture: string;
  date: string;
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
}

export interface HanabiSchedule {
  load(url: string): Promise<HanabiEvent[]>;
  nextEvent(now: Date): HanabiEvent | null;
  countdown(now: Date): Countdown | null;
}

export interface UIController {
  init(root: HTMLElement): void;
  onMoodChange(cb: (mood: MoodId) => void): void;
  onPresenceToggle(cb: (enabled: boolean) => void): void;
  updateCountdown(event: HanabiEvent | null, cd: Countdown | null): void;
}

export interface SparkMessage {
  type: 'spark';
  x: number;
  y: number;
}

// メッセージ花火。座標は含めない — 位置に利用者の意図が乗らないため、
// 受信した各端末が自分の空の空き場所へ咲かせる
export interface BloomMessage {
  type: 'bloom';
  text: string;
}

export type RelayMessage = SparkMessage | BloomMessage;

// 端末内だけに残るメッセージ花火。位置は保存せず起動のたびに配置し直す
export interface MessageRecord {
  id: string;
  text: string;
  at: number;
  mine: boolean;
  dismissed?: boolean;
}

// FR-014: 静かな入口。タップで夜のキャンバスへ遷移し、SoundEngine.init の起点となる
export interface IntroOverlay {
  show(root: HTMLElement): void;
  onEnter(cb: () => void): void;
  dismiss(): Promise<void>;
}
