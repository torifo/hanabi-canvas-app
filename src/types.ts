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

// FR-014: 静かな入口。タップで夜のキャンバスへ遷移し、SoundEngine.init の起点となる
export interface IntroOverlay {
  show(root: HTMLElement): void;
  onEnter(cb: () => void): void;
  dismiss(): Promise<void>;
}
