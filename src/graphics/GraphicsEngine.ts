import { messagePalette, type MessagePalette } from '../messages/messageColor';
import { findPlacement, type Circle, type Rect } from '../messages/placement';
import {
  MOOD_TRANSITION_MS,
  type GraphicsEngine as GraphicsEngineContract,
  type MessageRecord,
  type MoodProfile
} from '../types';

/**
 * Canvas2D 実装 — 「花火と橋 デザイン案」Turn 2 (2a) 常駐シーンの移植。
 *
 * デザインは 1440x810 の固定シーン空間で組まれている（PCサイズ確定版）。
 * 全ての描画は内部フレーム (1440x810) 上で行い、表示キャンバスへは cover で
 * ブリットする。SparkMessage のシーン座標系 (0-1) はこのフレームに対応する。
 *
 * 打ち上げ・開花アニメはなく、常駐する三輪の瞬き・落ちる金糸・数秒ごとの
 * 光の呼吸と橋上の閃光だけで「上がっている」気配を作る。タップは小さな
 * 火花のバーストと最寄りの輪のパルスにマップする。
 */

const W = 1440;
const H = 810;
const HORIZON = Math.round(H * 0.52);
const DECK_Y = 560;

// --- メッセージ花火 ---
// 空として使える帯。水平線(421)より上、上端のUIを避けた範囲
const SKY_TOP = 70;
const SKY_BOTTOM = 380;
const MESSAGE_RADIUS = 64;
// 気持ちよく重ならずに置ける数（空きは約24万px²、1発あたり約1.8万px²）
const NEAR_LIMIT_LANDSCAPE = 12;
const NEAR_LIMIT_PORTRAIT = 6;
// 縦画面の cover クロップで見えるシーン x 帯
const PORTRAIT_VISIBLE_X = { min: 533, max: 907 };
const RISE_DURATION_MS = 1150;
// 遠景に残す上限。これを超えた古いものは消す（描画コストの上限にもなる）
const FAR_LIMIT = 24;

// 橋のたもとに置かれた打ち上げ前の玉。x は可視範囲から毎回求める
// （固定座標だと画面比率によっては cover クロップで画面外へ出てしまう）
const SHELL_R = 18;
const SHELL_Y = DECK_Y - 34;
const SHELL_X_RATIO = 0.2;
// PCサイズ（横長）では、青と赤の大輪の外側に1つずつ対称に置く
const SHELL_FLANK_OFFSET = 150;

interface MessageBloom {
  record: MessageRecord;
  x: number;
  y: number;
  palette: MessagePalette;
  /** 手前層=1 → 遠景へ退くと 0 へ向かう */
  near: number;
  nearTarget: number;
  /** 玉から昇っている最中の進捗 (0-1)。1で開花済み */
  rise: number;
  bornAt: number;
  hoverA: number;
  parts: Array<{ dx: number; dy: number; r: number; size: number; tw: number; phase: number }>;
}

interface ScenePalette {
  sky: Array<[number, string]>;
  sea: Array<[number, string]>;
  hzGlow: string;
  lightColor: string;
}

// 2a (sparkle) — デザインの buildResidentScene 直書き値
const SPARKLE_PALETTE: ScenePalette = {
  sky: [[0, '#04060F'], [0.35, '#0D1834'], [0.62, '#1C2C51'], [0.85, '#2E3855'], [0.96, '#564851'], [1, '#66524F']],
  sea: [[0, '#3A3A52'], [0.08, '#222C4C'], [0.3, '#121C35'], [1, '#080D18']],
  hzGlow: 'rgba(188,149,115,0.34)',
  lightColor: '#FFC77D'
};

// 1b (quiet) カードの配色をムード切替先として使用
const QUIET_PALETTE: ScenePalette = {
  sky: [[0, '#03080F'], [0.35, '#071C29'], [0.62, '#0C2C3B'], [0.85, '#123441'], [1, '#1C4A50']],
  sea: [[0, '#12333E'], [0.08, '#0C2733'], [0.3, '#081A24'], [1, '#050D14']],
  hzGlow: 'rgba(102,189,205,0.2)',
  lightColor: '#8DE3E2'
};

const QUIET_SPEED = 0.62; // 1b カードの speed

interface CloudConfig {
  cx: number; cy: number; R: number; int: number;
  colors: [string, string, string, string];
  glit: string; flare: string; fx: number; trail?: boolean;
}

const CLOUD_CONFIGS: CloudConfig[] = [
  { cx: 372, cy: 216, R: 178, int: 1.0, colors: ['#F4FBFF', '#BFE4FA', '#7FC8FF', '#4A9BE8'], glit: '#F4DCB0', flare: '#5AA8FF', fx: 372 },
  { cx: 1068, cy: 216, R: 178, int: 1.0, colors: ['#FFF4E8', '#FFCDB8', '#FF8A80', '#E0485A'], glit: '#FFD9A0', flare: '#FF6E6E', fx: 1068 },
  { cx: 720, cy: 126, R: 86, int: 0.7, colors: ['#FFFFFF', '#FFF6E6', '#EDEFF4', '#C9D2E0'], glit: '#FFF2D8', flare: '#FFE9C0', fx: 720, trail: true }
];

// モバイル縦 (aspect < 1): cover クロップで見える中央帯 (x ≈ 533-907) に三輪を縦積み再配置。
// シーン座標系 (1440x810) 自体は変えないため、気配の着弾位置互換は保たれる。
// UIとの取り合い: タイトル (x<620, y<115)・ムードピル/気配 (x>730, y<115) を避け、
// 赤玉はアーチ越し (1c 大橋ごし) の構図としてデッキ (y560) より上に収める
const CLOUD_CONFIGS_PORTRAIT: CloudConfig[] = [
  { cx: 742, cy: 226, R: 112, int: 1.0, colors: ['#F4FBFF', '#BFE4FA', '#7FC8FF', '#4A9BE8'], glit: '#F4DCB0', flare: '#5AA8FF', fx: 742 },
  { cx: 800, cy: 420, R: 100, int: 1.0, colors: ['#FFF4E8', '#FFCDB8', '#FF8A80', '#E0485A'], glit: '#FFD9A0', flare: '#FF6E6E', fx: 800 },
  { cx: 686, cy: 122, R: 52, int: 0.7, colors: ['#FFFFFF', '#FFF6E6', '#EDEFF4', '#C9D2E0'], glit: '#FFF2D8', flare: '#FFE9C0', fx: 686, trail: true }
];

// タップ火花のシェル（1a sparkle / 1b quiet の先頭シェル）
const SPARK_SHELLS = {
  sparkle: { colors: ['#FFF6E0', '#FFE9C0', '#F4B96A'] as const, v0: 4.7, glitter: '#FFE9C0' },
  quiet: { colors: ['#F4FFFE', '#BFF3F1', '#5FC9C6'] as const, v0: 3.3, glitter: '#DFFAF8' }
};

interface CloudPart { dx: number; dy: number; r: number; size: number; sag: number; color: string; base: number; tw: number; phase: number; vr: number; }
interface CloudRay { ang: number; r0: number; r1: number; lw: number; tw: number; phase: number; color: string; head: boolean; }
interface CloudTail { ang: number; r: number; drop: number; out: number; bead: number; bv: number; tw: number; phase: number; }
interface CloudGlit { x: number; y: number; size: number; tw: number; phase: number; }
interface CloudStreak { x: number; y: number; vy: number; len: number; maxLen: number; life: number; }
interface CloudRiser { t: number; v: number; jx: number; size: number; phase: number; }

interface Cloud extends CloudConfig {
  fy: number;
  parts: CloudPart[]; rays: CloudRay[]; tails: CloudTail[]; glits: CloudGlit[]; streaks: CloudStreak[];
  risers?: CloudRiser[];
  pulseT0: number; nextPulse: number;
  cyc0?: number; burstDone?: boolean;
  bloomA: number; trailA: number; pe: number;
  hoverA: number; // ホバー/ドラッグ時の増光 (0-1, イージング)
}

interface Star { x: number; y: number; vx: number; vy: number; life: number; drag: number; size: number; color: string; phase: number; }
interface Flash { x: number; y: number; t0: number; color: string; }
interface DeckLight { x: number; y: number; size: number; tw: number; phase: number; a: number; }
interface Fly { x: number; y: number; ph: number; sp: number; }

export class GraphicsEngine implements GraphicsEngineContract {
  private canvas: HTMLCanvasElement | null = null;
  private display: CanvasRenderingContext2D | null = null;
  private frame: HTMLCanvasElement | null = null;
  private mctx: CanvasRenderingContext2D | null = null;
  private bgSparkle: HTMLCanvasElement | null = null;
  private bgQuiet: HTMLCanvasElement | null = null;
  private fg: HTMLCanvasElement | null = null;
  private fx: HTMLCanvasElement | null = null;
  private fctx: CanvasRenderingContext2D | null = null;

  private clouds: Cloud[] = [];
  private deckLights: DeckLight[] = [];
  private flies: Fly[] = [];
  private stars: Star[] = [];
  private flashes: Flash[] = [];
  private readonly sprites = new Map<string, HTMLCanvasElement>();

  private moodMix = 0;          // 0 = sparkle, 1 = quiet
  private moodTarget = 0;
  private speedFactor = 1;

  private charge: { x: number; y: number; t0: number } | null = null;
  private displayW = 1;
  private displayH = 1;
  private portrait = false;
  private hover: { x: number; y: number; dragging: boolean } | null = null;
  private messages: MessageBloom[] = [];
  private shellHoverA: number[] = [];
  // タップ端末では pointermove が来ないため、触れた花火のラベルを一定時間出す
  private pinned: { id: string; until: number } | null = null;
  private dismissHit: { x: number; y: number; w: number; h: number; id: string } | null = null;
  private rafId = 0;
  private last = 0;

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.toSceneCoords(e.clientX, e.clientY);
    this.hover = { x: p.x * W, y: p.y * H, dragging: e.buttons > 0 };
  };

  private readonly onPointerLeave = (): void => {
    this.hover = null;
  };

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    this.display = canvas.getContext('2d', { alpha: false });

    this.frame = createLayer();
    this.mctx = this.frame.getContext('2d', { alpha: false });
    this.fx = createLayer();
    this.fctx = this.fx.getContext('2d');

    this.bgSparkle = createLayer();
    this.paintBackground(this.bgSparkle.getContext('2d')!, SPARKLE_PALETTE, 71);
    this.bgQuiet = createLayer();
    this.paintBackground(this.bgQuiet.getContext('2d')!, QUIET_PALETTE, 71);
    this.fg = createLayer();
    this.paintForeground(this.fg.getContext('2d')!);

    const rnd = mulberry(97);
    this.deckLights = [];
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W;
      const d = Math.pow(rnd(), 1.5);
      this.deckLights.push({ x, y: DECK_Y + 8 + d * 68, size: 0.9 + rnd() * 1.9, tw: 0.5 + rnd() * 1.8, phase: rnd() * 9, a: 0.3 + rnd() * 0.6 });
    }
    this.flies = [];
    for (let i = 0; i < 8; i++) {
      this.flies.push({ x: rnd() * W, y: DECK_Y + 130 + rnd() * (H - DECK_Y - 165), ph: rnd() * 9, sp: 0.3 + rnd() * 0.7 });
    }

    this.clouds = (this.portrait ? CLOUD_CONFIGS_PORTRAIT : CLOUD_CONFIGS).map((cfg) => this.buildCloud(cfg));
    for (const c of this.clouds) {
      for (const col of c.colors) this.sprite(col);
      this.sprite(c.glit);
    }
    canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
    canvas.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    for (const s of Object.values(SPARK_SHELLS)) {
      for (const col of s.colors) this.sprite(col);
      this.sprite(s.glitter);
    }

    this.last = performance.now();
    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      if (document.hidden) { this.last = now; return; }
      const dtf = Math.min((now - this.last) / 16.7, 2.5);
      this.last = now;
      this.step(now, dtf);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  toSceneCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return { x: 0.5, y: 0.5 };
    const { scale, offX, offY } = this.coverMapping(rect.width, rect.height);
    const x = (clientX - rect.left - offX) / (W * scale);
    const y = (clientY - rect.top - offY) / (H * scale);
    return { x: clamp01(x), y: clamp01(y) };
  }

  setMood(profile: MoodProfile): void {
    this.moodTarget = profile.id === 'quiet' ? 1 : 0;
  }

  emitSpark(x: number, y: number, charge: number): boolean {
    const sx = x * W;
    const sy = y * H;
    // 常駐輪の上では火花を出さない（かぶり防止）。代わりにその輪をパルスさせる
    const hit = this.cloudAt(sx, sy);
    if (hit) {
      hit.pulseT0 = performance.now();
      return false;
    }
    this.burst(sx, sy, 0.35 + charge * 0.65, false);
    return true;
  }

  emitRemoteSpark(x: number, y: number): void {
    const sx = x * W;
    const sy = y * H;
    const hit = this.cloudAt(sx, sy);
    if (hit) {
      hit.pulseT0 = performance.now();
      return;
    }
    // リモートの気配は控えめに
    this.burst(sx, sy, 0.22, true);
  }

  beginCharge(x: number, y: number): void {
    const sx = x * W;
    const sy = y * H;
    // 常駐輪の上ではチャージの光を出さない（emitSpark 側でもパルスに変換される）
    if (this.cloudAt(sx, sy)) {
      this.charge = null;
      return;
    }
    this.charge = { x: sx, y: sy, t0: performance.now() };
  }

  endCharge(): number {
    if (!this.charge) return 0;
    const charge = Math.min((performance.now() - this.charge.t0) / 1400, 1);
    this.charge = null;
    return charge;
  }

  resize(w: number, h: number): void {
    if (!this.canvas) return;
    this.displayW = Math.max(w, 1);
    this.displayH = Math.max(h, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(this.displayW * dpr));
    this.canvas.height = Math.max(1, Math.round(this.displayH * dpr));
    // 縦横切替でシーンレイアウト（三輪の配置）を差し替える
    // ※ visibilitychange の resize(1,1) は 1x1 の正方形 → portrait 扱いにしない
    const portrait = this.displayW < this.displayH;
    if (portrait !== this.portrait && this.displayW + this.displayH > 4) {
      this.portrait = portrait;
      if (this.clouds.length) {
        this.clouds = (portrait ? CLOUD_CONFIGS_PORTRAIT : CLOUD_CONFIGS).map((cfg) => this.buildCloud(cfg));
      }
      // 可視帯と手前層の上限が変わるため、メッセージ花火を置き直す
      if (this.messages.length) {
        this.setMessages(this.messages.map((bloom) => bloom.record));
      }
    }
  }

  // ---- メッセージ花火 ----

  /**
   * 打ち上げ前の玉。横長では青と赤の大輪の外側へ1つずつ対称に置き、
   * 縦では帯が狭いため1つだけにする。x は可視範囲から求める
   * （固定座標だと画面比率によっては cover クロップで画面外へ出てしまう）
   */
  private get shells(): Array<{ x: number; y: number; r: number; tint: string }> {
    const view = this.visibleScene();
    const margin = SHELL_R * 2.4;
    const clampX = (x: number) => Math.min(Math.max(x, view.minX + margin), view.maxX - margin);
    const y = Math.min(Math.max(SHELL_Y, view.minY + margin), view.maxY - margin);
    const moodTint = this.moodMix > 0.5 ? '#8DE3E2' : null;

    if (this.portrait) {
      const x = clampX(view.minX + (view.maxX - view.minX) * SHELL_X_RATIO);
      return [{ x, y, r: SHELL_R, tint: moodTint ?? '#FFA487' }];
    }

    // 左右それぞれ、隣り合う大輪の色を淡く帯びさせて対に見せる
    const blue = this.clouds[0];
    const red = this.clouds[1];
    const leftX = clampX((blue?.fx ?? 372) - SHELL_FLANK_OFFSET);
    const rightX = clampX((red?.fx ?? 1068) + SHELL_FLANK_OFFSET);
    const pair = [
      { x: leftX, y, r: SHELL_R, tint: moodTint ?? (blue?.flare ?? '#5AA8FF') },
      { x: rightX, y, r: SHELL_R, tint: moodTint ?? (red?.flare ?? '#FF6E6E') }
    ];
    // 可視範囲が狭くて重なる場合は1つに畳む
    return Math.abs(rightX - leftX) < SHELL_R * 5 ? [pair[0]!] : pair;
  }

  /** cover クロップで実際に見えているシーン座標の範囲 */
  private visibleScene(): { minX: number; maxX: number; minY: number; maxY: number } {
    const { scale, offX, offY } = this.coverMapping(this.displayW, this.displayH);
    return {
      minX: Math.max(0, -offX / scale),
      maxX: Math.min(W, (this.displayW - offX) / scale),
      minY: Math.max(0, -offY / scale),
      maxY: Math.min(H, (this.displayH - offY) / scale)
    };
  }

  isShellAt(x: number, y: number): boolean {
    // 指でも押しやすいよう、見た目より広めに取る
    return this.shells.some((shell) => Math.hypot(x * W - shell.x, y * H - shell.y) <= shell.r * 2.6);
  }

  setMessages(records: readonly MessageRecord[]): void {
    const limit = this.nearLimit();
    const capped = records.slice(Math.max(0, records.length - (limit + FAR_LIMIT)));
    this.messages = [];
    for (const record of capped) {
      this.messages.push(this.createBloom(record, false));
    }
    // 新しいものから順に手前へ。あふれた分は遠景へ
    this.messages.forEach((bloom, index) => {
      const fromNewest = this.messages.length - 1 - index;
      const near = fromNewest < limit ? 1 : 0;
      bloom.near = near;
      bloom.nearTarget = near;
    });
  }

  bloomMessage(record: MessageRecord, launched: boolean): void {
    const bloom = this.createBloom(record, launched);
    this.messages.push(bloom);
    this.trimMessages();
    this.reflowMessages();
  }

  /** 手前層＋遠景層の合計に上限を設け、描画コストを頭打ちにする */
  private trimMessages(): void {
    const limit = this.nearLimit() + FAR_LIMIT;
    if (this.messages.length > limit) {
      this.messages.splice(0, this.messages.length - limit);
    }
  }

  messageAt(x: number, y: number): MessageRecord | null {
    const sx = x * W;
    const sy = y * H;
    // 手前層だけが読める。遠景の光には触れられない
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const bloom = this.messages[i]!;
      if (bloom.near < 0.6 || bloom.rise < 1) continue;
      const r = MESSAGE_RADIUS * bloom.near;
      if (Math.hypot(sx - bloom.x, (sy - bloom.y) / 0.94) <= r) {
        // タップでも読めるよう、しばらくラベルを出したままにする
        this.pinned = { id: bloom.record.id, until: performance.now() + 4200 };
        return bloom.record;
      }
    }
    return null;
  }

  /** ラベル内の「消す」に触れたか。触れていればその花火のIDを返す */
  dismissAt(x: number, y: number): string | null {
    const hit = this.dismissHit;
    if (!hit) return null;
    const sx = x * W;
    const sy = y * H;
    if (sx < hit.x || sx > hit.x + hit.w || sy < hit.y || sy > hit.y + hit.h) return null;
    this.pinned = null;
    this.dismissHit = null;
    return hit.id;
  }

  /** 黙らせた花火を空から外す */
  removeMessage(id: string): void {
    this.messages = this.messages.filter((bloom) => bloom.record.id !== id);
    this.reflowMessages();
  }

  /** 手前層の上限。あふれた古いものは遠景へ退く */
  private nearLimit(): number {
    return this.portrait ? NEAR_LIMIT_PORTRAIT : NEAR_LIMIT_LANDSCAPE;
  }

  private reflowMessages(): void {
    const limit = this.nearLimit();
    this.messages.forEach((bloom, index) => {
      const fromNewest = this.messages.length - 1 - index;
      bloom.nearTarget = fromNewest < limit ? 1 : 0;
    });
  }

  /** 空いている場所を選んで1発ぶんの状態を作る */
  private createBloom(record: MessageRecord, launched: boolean): MessageBloom {
    const area = this.portrait
      ? { minX: PORTRAIT_VISIBLE_X.min, maxX: PORTRAIT_VISIBLE_X.max, minY: SKY_TOP, maxY: SKY_BOTTOM }
      : { minX: 40, maxX: W - 40, minY: SKY_TOP, maxY: SKY_BOTTOM };

    const occupied: Circle[] = [
      ...this.clouds.map((c) => ({ x: c.cx, y: c.cy, r: c.R })),
      ...this.messages.filter((m) => m.near > 0.5).map((m) => ({ x: m.x, y: m.y, r: MESSAGE_RADIUS }))
    ];
    const spot = findPlacement({
      area,
      radius: MESSAGE_RADIUS,
      occupied,
      avoidRects: this.uiAvoidRects()
    });

    const palette = messagePalette(record.text);
    const parts: MessageBloom['parts'] = [];
    for (let i = 0; i < 190; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.pow(Math.random(), 0.45);
      parts.push({
        dx: Math.cos(ang),
        dy: Math.sin(ang) * 0.94,
        r: rr,
        size: Math.random() < 0.16 ? 3.4 + Math.random() * 2.6 : 1.2 + Math.random() * 2.2,
        tw: 0.5 + Math.random() * 1.5,
        phase: Math.random() * 9
      });
    }
    return {
      record,
      x: spot.x,
      y: spot.y,
      palette,
      near: 1,
      nearTarget: 1,
      rise: launched ? 0 : 1,
      bornAt: performance.now(),
      hoverA: 0,
      parts
    };
  }

  /**
   * UIの占有域をシーン座標へ投影する。
   * UI要素はビューポート基準で配置されるため、シーン空間での位置は画面比率で
   * 変わる。固定値では持てないので、配置のたびに実際の矩形から求める。
   */
  private uiAvoidRects(): Rect[] {
    const canvas = this.canvas;
    if (!canvas || typeof document === 'undefined') return [];
    const rects: Rect[] = [];
    for (const selector of ['.brand', '.controls', '.countdown']) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      const topLeft = this.toSceneCoords(box.left, box.top);
      const bottomRight = this.toSceneCoords(box.right, box.bottom);
      rects.push({
        x: topLeft.x * W,
        y: topLeft.y * H,
        w: Math.max((bottomRight.x - topLeft.x) * W, 1),
        h: Math.max((bottomRight.y - topLeft.y) * H, 1)
      });
    }
    return rects;
  }

  /** 常駐輪との当たり判定（楕円: dy は 0.94 圧縮）。ヒットした輪を返す */
  private cloudAt(sx: number, sy: number): Cloud | null {
    for (const c of this.clouds) {
      const dx = sx - c.cx;
      const dy = (sy - c.cy) / 0.94;
      if (dx * dx + dy * dy <= (c.R * 1.12) ** 2) return c;
    }
    return null;
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.canvas?.removeEventListener('pointermove', this.onPointerMove);
    this.canvas?.removeEventListener('pointerleave', this.onPointerLeave);
    this.stars = [];
    this.flashes = [];
    this.clouds = [];
    this.messages = [];
    this.hover = null;
    this.charge = null;
    this.sprites.clear();
    this.canvas = null;
    this.display = null;
    this.frame = null;
    this.mctx = null;
    this.fx = null;
    this.fctx = null;
    this.bgSparkle = null;
    this.bgQuiet = null;
    this.fg = null;
  }

  // ---- 内部実装（デザインコードの忠実移植） ----

  private coverMapping(dispW: number, dispH: number): { scale: number; offX: number; offY: number } {
    const scale = Math.max(dispW / W, dispH / H);
    return { scale, offX: (dispW - W * scale) / 2, offY: (dispH - H * scale) / 2 };
  }

  private sprite(color: string): HTMLCanvasElement {
    let cached = this.sprites.get(color);
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(24, 24, 0, 24, 24, 24);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, color);
    g.addColorStop(0.55, rgba(color, 0.28));
    g.addColorStop(1, rgba(color, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, 48, 48);
    this.sprites.set(color, c);
    return c;
  }

  private buildCloud(cfg: CloudConfig): Cloud {
    const c: Cloud = {
      ...cfg,
      fy: DECK_Y - 8,
      parts: [], rays: [], tails: [], glits: [], streaks: [],
      pulseT0: performance.now() - 9000,
      nextPulse: performance.now() + 1500 + Math.random() * 4000,
      bloomA: 1, trailA: 1, pe: 0, hoverA: 0
    };
    const n = Math.round((c.int >= 1 ? 430 : 340) * c.int);
    for (let i = 0; i < n; i++) c.parts.push(spawnPart(c));
    const rn = Math.round(62 * c.int);
    for (let i = 0; i < rn; i++) {
      const gold = Math.random() < 0.45;
      c.rays.push({
        ang: Math.random() * Math.PI * 2,
        r0: c.R * (0.08 + Math.random() * 0.1),
        r1: c.R * (0.5 + Math.random() * 0.78),
        lw: 0.5 + Math.random() * 0.7,
        tw: 0.4 + Math.random() * 1.4,
        phase: Math.random() * 9,
        color: gold ? c.glit : c.colors[1],
        head: Math.random() < 0.22
      });
    }
    const tn = Math.round(34 * c.int);
    for (let i = 0; i < tn; i++) {
      c.tails.push({
        ang: Math.random() * Math.PI * 2,
        r: c.R * (0.86 + Math.random() * 0.22),
        drop: 30 + Math.random() * 95,
        out: 10 + Math.random() * 26,
        bead: Math.random(),
        bv: 0.002 + Math.random() * 0.003,
        tw: 0.5 + Math.random(),
        phase: Math.random() * 9
      });
    }
    const gn = Math.round(140 * c.int);
    for (let i = 0; i < gn; i++) {
      const ga = Math.random() * Math.PI * 2;
      const gr = c.R * Math.sqrt(Math.random()) * 0.88;
      c.glits.push({ x: Math.cos(ga) * gr, y: Math.sin(ga) * gr * 0.94, size: 0.6 + Math.random(), tw: 1.8 + Math.random() * 2.4, phase: Math.random() * 9 });
    }
    if (c.trail) {
      c.risers = [];
      for (let i = 0; i < 16; i++) {
        c.risers.push({ t: Math.random(), v: 0.0011 + Math.random() * 0.0016, jx: (Math.random() - 0.5) * 7, size: 1.2 + Math.random() * 2.2, phase: Math.random() * 9 });
      }
    }
    return c;
  }

  private burst(x: number, y: number, intensity: number, remote: boolean): void {
    const shell = this.moodMix > 0.5 ? SPARK_SHELLS.quiet : SPARK_SHELLS.sparkle;
    const n = Math.round(140 * intensity);
    const v0 = shell.v0 * (0.55 + 0.45 * intensity);
    const dim = remote ? 0.5 : 1;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.pow(Math.random(), 0.42);
      const v = v0 * (0.22 + 0.78 * rr);
      const color = rr > 0.72 ? shell.colors[2] : rr > 0.34 ? shell.colors[1] : shell.colors[0];
      this.stars.push({
        x, y,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v * 0.96,
        life: (0.85 + Math.random() * 0.55) * dim,
        drag: 0.964 + Math.random() * 0.012,
        size: (2.2 + Math.random() * 3.4) * (remote ? 0.7 : 1),
        color,
        phase: Math.random() * 9
      });
    }
    const gl = Math.round(45 * intensity);
    for (let i = 0; i < gl; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = v0 * (0.1 + 0.5 * Math.random());
      this.stars.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: (0.5 + Math.random() * 0.9) * dim, drag: 0.955, size: 1 + Math.random() * 1.6, color: shell.glitter, phase: Math.random() * 9 });
    }
    if (!remote) {
      this.flashes.push({ x, y, t0: performance.now(), color: shell.colors[1] });
      // 最寄りの常駐輪をパルスさせる
      let nearest: Cloud | null = null;
      let best = Infinity;
      for (const c of this.clouds) {
        const d = (c.cx - x) ** 2 + (c.cy - y) ** 2;
        if (d < best) { best = d; nearest = c; }
      }
      if (nearest) nearest.pulseT0 = performance.now();
    }
  }

  private step(now: number, dtf: number): void {
    if (!this.display || !this.mctx || !this.fctx || !this.frame || !this.fx || !this.fg || !this.bgSparkle || !this.bgQuiet || !this.canvas) return;

    // ムード遷移 (MOOD_TRANSITION_MS で palette / speed をイージング)
    const mixStep = (dtf * 16.7) / MOOD_TRANSITION_MS;
    if (this.moodMix < this.moodTarget) this.moodMix = Math.min(this.moodTarget, this.moodMix + mixStep);
    else if (this.moodMix > this.moodTarget) this.moodMix = Math.max(this.moodTarget, this.moodMix - mixStep);
    this.speedFactor = 1 + (QUIET_SPEED - 1) * this.moodMix;

    const speedProp = this.speedFactor;
    const ctx = this.fctx;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    for (const c of this.clouds) {
      let bloomA = 1;
      let trailA = 1;
      if (c.trail) {
        const T = 9500 / speedProp;
        const burst = 2300 / speedProp;
        const fadeD = 1500 / speedProp;
        if (!c.cyc0) { c.cyc0 = now - burst; c.burstDone = false; }
        let ph = now - c.cyc0;
        if (ph > T) { c.cyc0 = now; ph = 0; c.burstDone = false; }
        if (ph < burst) { bloomA = 0; trailA = Math.min(1, ph / 250); }
        else {
          if (!c.burstDone) { c.burstDone = true; c.pulseT0 = now; }
          bloomA = Math.min(1, (ph - burst) / 320);
          if (ph > T - fadeD) bloomA *= Math.max(0, (T - ph) / fadeD);
          trailA = Math.max(0, 1 - (ph - burst) / 420);
        }
      } else if (now > c.nextPulse) {
        c.pulseT0 = now;
        c.nextPulse = now + (3800 + Math.random() * 4200) / speedProp;
      }
      c.bloomA = bloomA;
      c.trailA = trailA;
      // ホバー/ドラッグで輪が静かに光る（イージングで滑らかに）
      const hovering = this.hover ? this.cloudAt(this.hover.x, this.hover.y) === c : false;
      const hoverTarget = hovering ? (this.hover!.dragging ? 1 : 0.55) : 0;
      c.hoverA += (hoverTarget - c.hoverA) * Math.min(1, dtf * 0.09);
      const pe = Math.exp(-(now - c.pulseT0) / 620);
      const bright = (1 + 1.05 * pe) * (1 + 0.7 * c.hoverA);
      const breathe = 0.1 + 0.05 * Math.sin(now * 0.0006 * speedProp + c.cx) + 0.07 * c.hoverA;

      if (bloomA > 0.02) {
        ctx.globalAlpha = bloomA;
        const haloR = c.R * (1.45 + 0.06 * Math.sin(now * 0.0004 + c.cy));
        const g = ctx.createRadialGradient(c.cx, c.cy, 0, c.cx, c.cy, haloR);
        g.addColorStop(0, rgba(c.colors[1], (breathe + 0.16 * pe) * c.int));
        g.addColorStop(0.5, rgba(c.colors[2], (breathe * 0.5 + 0.07 * pe) * c.int));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(c.cx - haloR, c.cy - haloR, haloR * 2, haloR * 2);

        const cg = ctx.createRadialGradient(c.cx, c.cy, 0, c.cx, c.cy, c.R * 0.24);
        cg.addColorStop(0, rgba('#FFFFFF', (0.22 + 0.3 * pe) * c.int));
        cg.addColorStop(0.55, rgba(c.colors[0], (0.1 + 0.14 * pe) * c.int));
        cg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, c.R * 0.24, 0, Math.PI * 2);
        ctx.fill();

        for (const ry of c.rays) {
          const tw = Math.sin(now * 0.0014 * ry.tw * speedProp + ry.phase);
          const a = (0.1 + 0.24 * tw * tw) * bright * c.int;
          const dx = Math.cos(ry.ang);
          const dy = Math.sin(ry.ang) * 0.94;
          const sag = Math.pow(ry.r1 / c.R, 2) * 16;
          const x0 = c.cx + dx * ry.r0;
          const y0 = c.cy + dy * ry.r0;
          const x1 = c.cx + dx * ry.r1;
          const y1 = c.cy + dy * ry.r1 + sag;
          const lg = ctx.createLinearGradient(x0, y0, x1, y1);
          lg.addColorStop(0, 'rgba(0,0,0,0)');
          lg.addColorStop(0.55, rgba(ry.color, a));
          lg.addColorStop(1, rgba(ry.color, a * 0.25));
          ctx.strokeStyle = lg;
          ctx.lineWidth = ry.lw;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - sag * 0.3, x1, y1);
          ctx.stroke();
          if (ry.head) {
            ctx.globalAlpha = Math.min(a * 1.7, 1) * bloomA;
            ctx.drawImage(this.sprite(ry.color), x1 - 2, y1 - 2, 4, 4);
            ctx.globalAlpha = bloomA;
          }
        }

        const goldSpr = this.sprite(c.glit);
        for (const gp of c.glits) {
          const tw = Math.sin(now * 0.0035 * gp.tw * speedProp + gp.phase);
          ctx.globalAlpha = Math.min((0.1 + 0.55 * tw * tw * tw * tw) * bright * c.int * bloomA, 1);
          ctx.drawImage(goldSpr, c.cx + gp.x - gp.size, c.cy + gp.y - gp.size, gp.size * 2, gp.size * 2);
        }
        ctx.globalAlpha = bloomA;

        for (const tl of c.tails) {
          const dx = Math.cos(tl.ang);
          const dy = Math.sin(tl.ang) * 0.94;
          const x0 = c.cx + dx * tl.r;
          const y0 = c.cy + dy * tl.r;
          const x1 = x0 + dx * tl.out;
          const y1 = y0 + Math.abs(dy) * 8 + tl.drop;
          const cxq = x0 + dx * tl.out * 0.9;
          const cyq = y0 + tl.drop * 0.28;
          const tw = Math.sin(now * 0.0012 * tl.tw * speedProp + tl.phase);
          const a = (0.1 + 0.22 * tw * tw) * bright * c.int;
          const lg = ctx.createLinearGradient(x0, y0, x1, y1);
          lg.addColorStop(0, rgba(c.glit, a));
          lg.addColorStop(1, rgba(c.glit, a * 0.15));
          ctx.strokeStyle = lg;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(cxq, cyq, x1, y1);
          ctx.stroke();
          tl.bead += tl.bv * dtf * speedProp;
          if (tl.bead >= 1) tl.bead = 0;
          const bt = tl.bead;
          const mt = 1 - bt;
          const bx = mt * mt * x0 + 2 * mt * bt * cxq + bt * bt * x1;
          const by = mt * mt * y0 + 2 * mt * bt * cyq + bt * bt * y1;
          ctx.globalAlpha = Math.min(a * 2.2 * (1 - bt * 0.5), 1);
          const bs = 1.6;
          ctx.drawImage(this.sprite(c.glit), bx - bs, by - bs, bs * 2, bs * 2);
          ctx.globalAlpha = bloomA;
        }

        for (let i = 0; i < c.parts.length; i++) {
          const p = c.parts[i]!;
          p.r += p.vr * dtf * speedProp;
          p.sag += 0.011 * dtf * speedProp * (c.R / 188);
          if (p.r > c.R * 1.12) { c.parts[i] = spawnPart(c); continue; }
          const tw = Math.sin(now * 0.0018 * p.tw * speedProp + p.phase);
          const a = p.base * (0.38 + 0.62 * tw * tw) * bright * Math.max(0, 1 - (p.r / c.R) * 0.3);
          const x = c.cx + p.dx * p.r;
          const y = c.cy + p.dy * p.r + p.sag;
          const s = p.size;
          ctx.globalAlpha = Math.min(a * bloomA, 1);
          ctx.drawImage(this.sprite(p.color), x - s, y - s, s * 2, s * 2);
        }

        if (c.streaks.length < 9 && Math.random() < 0.013 * c.int * dtf * speedProp) {
          const rx = (Math.random() * 2 - 1) * c.R * 0.7;
          c.streaks.push({ x: c.cx + rx, y: c.cy + Math.abs(Math.random() * 0.6 + 0.2) * c.R, vy: 0.35 + Math.random() * 0.55, len: 0, maxLen: 26 + Math.random() * 44, life: 1 });
        }
        const keptS: CloudStreak[] = [];
        for (const st of c.streaks) {
          st.y += st.vy * dtf * speedProp;
          st.len = Math.min(st.len + st.vy * dtf * speedProp, st.maxLen);
          st.life -= 0.004 * dtf * speedProp;
          if (st.life <= 0) continue;
          keptS.push(st);
          const a = Math.min(st.life * 1.4, 1) * 0.7 * c.int;
          const lg = ctx.createLinearGradient(st.x, st.y - st.len, st.x, st.y);
          lg.addColorStop(0, 'rgba(0,0,0,0)');
          lg.addColorStop(1, rgba(c.glit, a));
          ctx.strokeStyle = lg;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(st.x, st.y - st.len);
          ctx.lineTo(st.x, st.y);
          ctx.stroke();
          ctx.globalAlpha = a;
          ctx.drawImage(this.sprite(c.glit), st.x - 2.4, st.y - 2.4, 4.8, 4.8);
        }
        c.streaks = keptS;
      }
      ctx.globalAlpha = 1;

      if (c.trail && trailA > 0.02) {
        const y0 = DECK_Y - 4;
        const y1 = c.cy + c.R * 0.75;
        const ta = (0.28 + 0.3 * pe) * c.int * trailA;
        const tg = ctx.createLinearGradient(c.fx, y1, c.fx, y0);
        tg.addColorStop(0, rgba(c.glit, ta * 0.25));
        tg.addColorStop(0.65, rgba(c.glit, ta));
        tg.addColorStop(1, rgba('#FFFFFF', ta * 1.2));
        ctx.strokeStyle = tg;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(c.fx, y1);
        ctx.lineTo(c.fx, y0);
        ctx.stroke();
        const spr = this.sprite(c.glit);
        for (const r of c.risers ?? []) {
          r.t += r.v * dtf * 16.7 * speedProp * 0.06;
          if (r.t >= 1) { r.t = 0; r.jx = (Math.random() - 0.5) * 7; }
          const ry = y0 + (y1 - y0) * r.t;
          const rx = c.fx + r.jx + Math.sin(r.t * 14 + r.phase) * 2.5;
          const tw = Math.sin(now * 0.004 + r.phase);
          ctx.globalAlpha = Math.min((0.35 + 0.65 * tw * tw) * (0.5 + pe) * (1 - r.t * 0.4) * c.int * trailA, 1);
          ctx.drawImage(spr, rx - r.size, ry - r.size, r.size * 2, r.size * 2);
        }
        ctx.globalAlpha = 1;
      }
      c.pe = pe;
    }

    // メッセージ花火（加算合成の層に描く）
    this.drawMessages(ctx, now, dtf, speedProp);

    // タップ火花（物理パーティクル）
    const keptStars: Star[] = [];
    for (const p of this.stars) {
      p.life -= dtf * 0.0155 * speedProp;
      if (p.life <= 0) continue;
      keptStars.push(p);
      p.vx *= Math.pow(p.drag, dtf);
      p.vy = p.vy * Math.pow(p.drag, dtf) + 0.022 * dtf * speedProp;
      p.x += p.vx * dtf * speedProp;
      p.y += p.vy * dtf * speedProp;
      let a = Math.pow(p.life, 1.4) * (0.72 + 0.28 * Math.sin(now * 0.02 + p.phase));
      if (p.life < 0.38 && Math.sin(now * 0.045 + p.phase * 7) < -0.1) a *= 0.15;
      const s = p.size * (0.7 + 0.3 * p.life);
      ctx.globalAlpha = Math.max(a, 0);
      ctx.drawImage(this.sprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
    }
    this.stars = keptStars;

    // 長押しチャージの光の溜まり
    if (this.charge) {
      const t = Math.min((now - this.charge.t0) / 1400, 1);
      const shell = this.moodMix > 0.5 ? SPARK_SHELLS.quiet : SPARK_SHELLS.sparkle;
      const r = 14 + Math.sin(now / 130) * 4 + t * 52;
      const g = ctx.createRadialGradient(this.charge.x, this.charge.y, 0, this.charge.x, this.charge.y, r);
      g.addColorStop(0, rgba(shell.colors[0], 0.3 + t * 0.4));
      g.addColorStop(0.5, rgba(shell.colors[1], 0.14 + t * 0.2));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.charge.x, this.charge.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // ---- コンポジット ----
    const mctx = this.mctx;
    mctx.globalCompositeOperation = 'source-over';
    mctx.globalAlpha = 1;
    mctx.drawImage(this.bgSparkle, 0, 0);
    if (this.moodMix > 0.001) {
      mctx.globalAlpha = this.moodMix;
      mctx.drawImage(this.bgQuiet, 0, 0);
      mctx.globalAlpha = 1;
    }

    mctx.globalCompositeOperation = 'lighter';
    for (const f of [...this.flashes]) {
      const e = (now - f.t0) / 420;
      if (e >= 1) { this.flashes.splice(this.flashes.indexOf(f), 1); continue; }
      const rad = 200 + e * 140;
      const g = mctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
      g.addColorStop(0, rgba('#FFFFFF', 0.32 * (1 - e)));
      g.addColorStop(0.3, rgba(f.color, 0.16 * (1 - e)));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      mctx.fillStyle = g;
      mctx.fillRect(f.x - rad, f.y - rad, rad * 2, rad * 2);
    }
    mctx.drawImage(this.fx, 0, 0);

    const refl = 0.18;
    mctx.save();
    mctx.beginPath();
    mctx.rect(0, HORIZON, W, H - HORIZON);
    mctx.clip();
    mctx.globalAlpha = refl;
    mctx.translate(0, HORIZON * 1.55);
    mctx.scale(1, -0.55);
    mctx.drawImage(this.fx, 0, 0);
    mctx.restore();
    mctx.globalAlpha = 1;

    mctx.globalCompositeOperation = 'source-over';
    mctx.drawImage(this.fg, 0, 0);

    mctx.globalCompositeOperation = 'lighter';
    const breatheEdge = 0.85 + 0.15 * Math.sin(now * 0.001 * speedProp);
    for (const [lw, la] of [[2, 0.75], [9, 0.14], [22, 0.05]] as const) {
      // 赤い大輪と同系のあたたかい色に揃える
      mctx.strokeStyle = rgba('#FFA487', la * breatheEdge);
      mctx.lineWidth = lw;
      mctx.beginPath();
      mctx.moveTo(0, DECK_Y);
      mctx.lineTo(W, DECK_Y);
      mctx.stroke();
    }
    const gold = this.sprite(this.clouds[0]?.glit ?? '#F4DCB0');
    for (const dl of this.deckLights) {
      const tw = Math.sin(now * 0.002 * dl.tw * speedProp + dl.phase);
      mctx.globalAlpha = dl.a * (0.25 + 0.75 * tw * tw);
      mctx.drawImage(gold, dl.x - dl.size, dl.y - dl.size, dl.size * 2, dl.size * 2);
    }
    for (const f of this.flies) {
      const bx = f.x + Math.sin(now * 0.0004 * f.sp + f.ph) * 28;
      const by = f.y + Math.sin(now * 0.0006 * f.sp + f.ph * 2) * 11;
      const bl = Math.max(0, Math.sin(now * 0.0023 * f.sp + f.ph));
      mctx.globalAlpha = bl * bl * 0.7;
      mctx.drawImage(gold, bx - 1.7, by - 1.7, 3.4, 3.4);
    }
    for (const c of this.clouds) {
      const flick = 0.5 + 0.5 * Math.abs(Math.sin(now * 0.021 + c.fx) * Math.sin(now * 0.0073 + c.cy));
      const fa = c.int * (0.35 + 0.65 * flick) * (0.55 + 1.15 * c.pe) * (c.trail ? 0.45 + 0.85 * c.trailA : 1);
      // 芯は各大輪の色で描く。金色＋大きすぎる芯は白飛びして、
      // どの花火の明かりなのか見分けがつかなくなる
      const core = this.sprite(c.flare);
      mctx.globalAlpha = Math.min(fa * 0.8, 1);
      const cs = 6 + 4 * c.pe;
      mctx.drawImage(core, c.fx - cs, c.fy - cs, cs * 2, cs * 2);
      const hw = (76 + 96 * c.pe) * c.int;
      const hg = mctx.createLinearGradient(c.fx - hw, c.fy, c.fx + hw, c.fy);
      hg.addColorStop(0, 'rgba(0,0,0,0)');
      hg.addColorStop(0.5, rgba(c.flare, 0.72 * fa));
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      mctx.strokeStyle = hg;
      mctx.lineWidth = 1.8;
      mctx.beginPath();
      mctx.moveTo(c.fx - hw, c.fy);
      mctx.lineTo(c.fx + hw, c.fy);
      mctx.stroke();
      const vh = 18 + 26 * c.pe;
      const vg = mctx.createLinearGradient(c.fx, c.fy - vh, c.fx, c.fy + 4);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, rgba(c.flare, 0.5 * fa));
      mctx.strokeStyle = vg;
      mctx.lineWidth = 1.6;
      mctx.beginPath();
      mctx.moveTo(c.fx, c.fy - vh);
      mctx.lineTo(c.fx, c.fy + 2);
      mctx.stroke();
      const rgR = 46 + 34 * c.pe;
      const rg = mctx.createRadialGradient(c.fx, c.fy, 0, c.fx, c.fy, rgR);
      rg.addColorStop(0, rgba(c.flare, 0.58 * fa));
      rg.addColorStop(0.45, rgba(c.flare, 0.3 * fa));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      mctx.fillStyle = rg;
      mctx.beginPath();
      mctx.arc(c.fx, c.fy, rgR, 0, Math.PI * 2);
      mctx.fill();
    }
    // 打ち上げ前の玉（橋のたもと・控えめ）
    this.drawShell(mctx, now, dtf);
    mctx.globalAlpha = 1;
    mctx.globalCompositeOperation = 'source-over';

    // ホバー中のメッセージ花火の文面
    this.drawMessageLabel(mctx);

    // ---- 表示キャンバスへ cover ブリット ----
    const disp = this.display;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dw = this.canvas.width;
    const dh = this.canvas.height;
    const { scale, offX, offY } = this.coverMapping(this.displayW, this.displayH);
    disp.imageSmoothingEnabled = true;
    disp.imageSmoothingQuality = 'high';
    disp.fillStyle = '#04060F';
    disp.fillRect(0, 0, dw, dh);
    disp.drawImage(this.frame, offX * dpr, offY * dpr, W * scale * dpr, H * scale * dpr);
  }

  /** メッセージ花火。手前層は読めるように、古いものは遠景の小さな光へ退く */
  private drawMessages(ctx: CanvasRenderingContext2D, now: number, dtf: number, speedProp: number): void {
    const hover = this.hover;
    for (const bloom of this.messages) {
      // 玉から昇っている最中
      if (bloom.rise < 1) {
        bloom.rise = Math.min(1, bloom.rise + (dtf * 16.7) / RISE_DURATION_MS);
        // 昇りきった瞬間を開花の起点にする（そうしないと自分の1発だけ開花が省かれる）
        if (bloom.rise >= 1) bloom.bornAt = now;
        const shells = this.shells;
        let shell = shells[0]!;
        for (const candidate of shells) {
          if (Math.abs(candidate.x - bloom.x) < Math.abs(shell.x - bloom.x)) shell = candidate;
        }
        const e = 1 - Math.pow(1 - bloom.rise, 3);
        const rx = shell.x + (bloom.x - shell.x) * e;
        const ry = shell.y + (bloom.y - shell.y) * e;
        const spr = this.sprite(bloom.palette.glitter);
        ctx.globalAlpha = 0.85;
        ctx.drawImage(spr, rx - 5, ry - 5, 10, 10);
        if (Math.random() < 0.7) {
          ctx.globalAlpha = 0.4;
          ctx.drawImage(spr, rx - 2 + (Math.random() - 0.5) * 6, ry + 4 + Math.random() * 9, 4, 4);
        }
        ctx.globalAlpha = 1;
        continue;
      }

      // 手前 ↔ 遠景の遷移
      bloom.near += (bloom.nearTarget - bloom.near) * Math.min(1, dtf * 0.02);

      const pointerOver = hover
        ? Math.hypot(hover.x - bloom.x, (hover.y - bloom.y) / 0.94) <= MESSAGE_RADIUS * bloom.near
        : false;
      const isPinned = this.pinned !== null && this.pinned.id === bloom.record.id && now < this.pinned.until;
      const revealing = (pointerOver || isPinned) && bloom.near > 0.6;
      bloom.hoverA += ((revealing ? 1 : 0) - bloom.hoverA) * Math.min(1, dtf * 0.09);

      const age = (now - bloom.bornAt) / 1000;
      // 開花直後の閃きが落ち着き、以降は静かに瞬き続ける
      const settle = Math.min(1, age / 1.2);
      const scale = (0.28 + 0.72 * bloom.near) * (0.6 + 0.4 * settle);
      const radius = MESSAGE_RADIUS * scale;
      const brightness = (0.5 + 0.5 * bloom.near) * (1 + 0.8 * bloom.hoverA);

      // ハロー
      const haloR = radius * 1.8;
      const halo = ctx.createRadialGradient(bloom.x, bloom.y, 0, bloom.x, bloom.y, haloR);
      halo.addColorStop(0, rgba(bloom.palette.mid, 0.1 * brightness));
      halo.addColorStop(0.5, rgba(bloom.palette.outer, 0.05 * brightness));
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = halo;
      ctx.fillRect(bloom.x - haloR, bloom.y - haloR, haloR * 2, haloR * 2);

      // コア
      const coreR = radius * 0.3;
      const core = ctx.createRadialGradient(bloom.x, bloom.y, 0, bloom.x, bloom.y, coreR);
      core.addColorStop(0, rgba(bloom.palette.core, 0.24 * brightness));
      core.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(bloom.x, bloom.y, coreR, 0, Math.PI * 2);
      ctx.fill();

      // 粒
      for (const p of bloom.parts) {
        const tw = Math.sin(now * 0.0018 * p.tw * speedProp + p.phase);
        const a = (0.3 + 0.7 * tw * tw) * brightness * 0.75;
        const px = bloom.x + p.dx * p.r * radius;
        const py = bloom.y + p.dy * p.r * radius;
        const color = p.r > 0.72 ? bloom.palette.outer : p.r > 0.34 ? bloom.palette.mid : bloom.palette.core;
        const size = p.size * scale;
        ctx.globalAlpha = Math.min(a, 1);
        ctx.drawImage(this.sprite(color), px - size, py - size, size * 2, size * 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** 打ち上げ前の玉。玉貼りの紙を貼り重ねた球＋提げ紐 */
  private drawShell(ctx: CanvasRenderingContext2D, now: number, dtf: number): void {
    const shells = this.shells;
    const hover = this.hover;
    if (this.shellHoverA.length !== shells.length) {
      this.shellHoverA = shells.map((_, index) => this.shellHoverA[index] ?? 0);
    }
    shells.forEach((shell, index) => {
      const over = hover ? Math.hypot(hover.x - shell.x, hover.y - shell.y) <= shell.r * 2.6 : false;
      const eased = (this.shellHoverA[index] ?? 0) + ((over ? 1 : 0) - (this.shellHoverA[index] ?? 0)) * Math.min(1, dtf * 0.1);
      this.shellHoverA[index] = eased;
      this.paintShell(ctx, shell, eased, now);
    });
  }

  private paintShell(
    ctx: CanvasRenderingContext2D,
    shell: { x: number; y: number; r: number; tint: string },
    hoverA: number,
    now: number
  ): void {
    const lift = hoverA * 7;
    const y = shell.y - lift;
    const r = shell.r;
    const breathe = 0.55 + 0.45 * Math.sin(now * 0.0015 + shell.x);

    // 直前の描画が残した合成状態を必ず断ち切る（これを怠ると玉が沈む）
    ctx.save();
    ctx.globalAlpha = 1;

    // 接地の影
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(3,6,12,0.55)';
    ctx.beginPath();
    ctx.ellipse(shell.x, shell.y + r * 0.9, r * (0.95 - hoverA * 0.18), r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    // 隣り合う大輪の色をまとった、触れられると分かる程度の光
    ctx.globalCompositeOperation = 'lighter';
    const haloR = r * (2.9 + hoverA * 1.5);
    const halo = ctx.createRadialGradient(shell.x, y, r * 0.7, shell.x, y, haloR);
    halo.addColorStop(0, rgba(shell.tint, 0.1 + 0.06 * breathe + 0.24 * hoverA));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(shell.x - haloR, y - haloR, haloR * 2, haloR * 2);

    ctx.globalCompositeOperation = 'source-over';

    // 導火線（右上へ細く伸びる）
    ctx.strokeStyle = '#6E5B3E';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shell.x + r * 0.52, y - r * 0.78);
    ctx.quadraticCurveTo(shell.x + r * 1.0, y - r * 1.24, shell.x + r * 1.16, y - r * 1.5);
    ctx.stroke();

    // 提げ紐
    ctx.strokeStyle = '#C2B08C';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(shell.x - r * 0.06, y - r - 4, r * 0.32, r * 0.3, 0, Math.PI * 0.12, Math.PI * 1.88);
    ctx.stroke();

    // 球本体（左上からの光。マットな紙の陰影）
    const body = ctx.createRadialGradient(
      shell.x - r * 0.4, y - r * 0.44, r * 0.08,
      shell.x, y, r * 1.06
    );
    body.addColorStop(0, '#EBD9B6');
    body.addColorStop(0.3, '#DCC49B');
    body.addColorStop(0.62, '#C0A175');
    body.addColorStop(0.86, '#94764C');
    body.addColorStop(1, '#5F4830');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(shell.x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // 貼り重ねた紙の継ぎ目。球面に沿う経線として描く
    ctx.save();
    ctx.beginPath();
    ctx.arc(shell.x, y, r - 0.4, 0, Math.PI * 2);
    ctx.clip();
    ctx.lineWidth = 0.8;
    for (const [offset, alpha] of [[-0.62, 0.16], [-0.22, 0.2], [0.2, 0.18], [0.6, 0.13]] as const) {
      ctx.strokeStyle = `rgba(94,72,46,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(shell.x + r * offset * 0.34, y, Math.abs(r * offset), r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 赤道まわりの巻き
    ctx.strokeStyle = 'rgba(238,222,190,0.22)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(shell.x, y + r * 0.06, r, r * 0.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(94,72,46,0.16)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.ellipse(shell.x, y + r * 0.24, r * 0.98, r * 0.16, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 縁の締まり（球に見せるための暗い外周）
    ctx.strokeStyle = 'rgba(58,42,26,0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(shell.x, y, r - 0.5, 0, Math.PI * 2);
    ctx.stroke();

    // 紙らしい広く弱いハイライト
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16 + 0.16 * hoverA;
    const gloss = ctx.createRadialGradient(shell.x - r * 0.36, y - r * 0.42, 0, shell.x - r * 0.36, y - r * 0.42, r * 0.82);
    gloss.addColorStop(0, 'rgba(255,246,224,0.85)');
    gloss.addColorStop(1, 'rgba(255,246,224,0)');
    ctx.fillStyle = gloss;
    ctx.beginPath();
    ctx.arc(shell.x - r * 0.36, y - r * 0.42, r * 0.82, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** ホバー中のメッセージ花火の文面を、その傍らに静かに置く */
  private drawMessageLabel(ctx: CanvasRenderingContext2D): void {
    // messageAt と同じ「最新優先」で選ぶ（重なったときにずれないため）
    let target: MessageBloom | null = null;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const bloom = this.messages[i]!;
      if (bloom.hoverA > 0.15 && bloom.near > 0.6) { target = bloom; break; }
    }
    if (!target) { this.dismissHit = null; return; }

    // 縦画面では可視帯にしか置けないので、その幅に収まるまで文字を小さくする
    const band = this.portrait
      ? { min: PORTRAIT_VISIBLE_X.min, max: PORTRAIT_VISIBLE_X.max }
      : { min: 0, max: W };
    const bandW = band.max - band.min;
    const padX = 18;
    const padY = 12;
    const dismissW = 58;

    let fontSize = 26;
    let width = 0;
    for (;;) {
      ctx.font = `${fontSize}px "Yu Mincho", "Hiragino Mincho ProN", serif`;
      width = ctx.measureText(target.record.text).width;
      if (width + padX * 2 + dismissW <= bandW - 32 || fontSize <= 13) break;
      fontSize -= 1;
    }

    const alpha = Math.min(1, target.hoverA * 1.4);
    const boxW = Math.min(width + padX * 2 + dismissW, bandW - 24);
    const boxH = fontSize + padY * 2;
    let bx = target.x - boxW / 2;
    let by = target.y + MESSAGE_RADIUS * target.near + 18;
    bx = Math.min(Math.max(bx, band.min + 12), band.max - boxW - 12);
    by = Math.min(by, H - boxH - 16);

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = alpha * 0.72;
    ctx.fillStyle = 'rgba(7,17,31,0.62)';
    roundRect(ctx, bx, by, boxW, boxH, 4);
    ctx.fill();
    ctx.globalAlpha = alpha * 0.5;
    ctx.strokeStyle = rgba(target.palette.mid, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,248,226,0.92)';
    ctx.fillText(target.record.text, bx + padX, by + boxH / 2);

    // 受け取った側がその花火だけを黙らせるための控えめな出口
    const dx = bx + boxW - dismissW;
    ctx.globalAlpha = alpha * 0.62;
    ctx.font = '13px "Hiragino Kaku Gothic ProN", sans-serif';
    ctx.fillStyle = 'rgba(229,235,232,0.72)';
    ctx.fillText('消す', dx + 14, by + boxH / 2);
    ctx.restore();
    ctx.globalAlpha = 1;

    this.dismissHit = { x: dx, y: by, w: dismissW, h: boxH, id: target.record.id };
  }

  private paintBackground(ctx: CanvasRenderingContext2D, pal: ScenePalette, seed: number): void {
    const rand = mulberry(seed);
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
    for (const [o, c] of pal.sky) sky.addColorStop(o, c);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, HORIZON);
    const gl = ctx.createLinearGradient(0, HORIZON - 160, 0, HORIZON);
    gl.addColorStop(0, 'rgba(0,0,0,0)');
    gl.addColorStop(1, pal.hzGlow);
    ctx.fillStyle = gl;
    ctx.fillRect(0, HORIZON - 160, W, 160);
    for (let i = 0; i < 110; i++) {
      const y = rand() * HORIZON * 0.92;
      ctx.fillStyle = `rgba(234,240,248,${(0.08 + rand() * 0.55) * (1 - y / HORIZON)})`;
      ctx.beginPath();
      ctx.arc(rand() * W, y, 0.5 + rand() * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    const sea = ctx.createLinearGradient(0, HORIZON, 0, H);
    for (const [o, c] of pal.sea) sea.addColorStop(o, c);
    ctx.fillStyle = sea;
    ctx.fillRect(0, HORIZON, W, H - HORIZON);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const y = HORIZON + 8 + Math.pow(rand(), 1.6) * (H - HORIZON - 20);
      const x0 = rand() * W;
      const len = 40 + rand() * 260;
      ctx.globalAlpha = 0.3 + rand() * 0.5;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.bezierCurveTo(x0 + len * 0.3, y - 2, x0 + len * 0.7, y + 2, x0 + len, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 左手の岬と灯り
    ctx.fillStyle = '#0A0F1C';
    ctx.beginPath();
    ctx.moveTo(-20, HORIZON);
    ctx.quadraticCurveTo(W * 0.06, HORIZON - 34, W * 0.13, HORIZON - 12);
    ctx.quadraticCurveTo(W * 0.17, HORIZON - 4, W * 0.2, HORIZON);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = rgba(pal.lightColor, 0.5 + rand() * 0.4);
      ctx.beginPath();
      ctx.arc(W * (0.03 + rand() * 0.14), HORIZON - 4 - rand() * 14, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    const vig = ctx.createRadialGradient(W * 0.5, H * 0.46, W * 0.3, W * 0.5, H * 0.46, W * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(1,3,9,0.5)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  private paintForeground(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#050A14';
    g.fillRect(0, DECK_Y, W, H - DECK_Y);
    const brnd = mulberry(53);
    const hz = g.createLinearGradient(0, DECK_Y + 62, 0, DECK_Y + 130);
    hz.addColorStop(0, 'rgba(96,148,158,0)');
    hz.addColorStop(0.55, 'rgba(96,148,158,0.09)');
    hz.addColorStop(1, 'rgba(96,148,158,0)');
    g.fillStyle = hz;
    g.fillRect(0, DECK_Y + 62, W, 68);

    const bankLayer = (baseY: number, amp: number, c0: string, c1: string, tuftH: number, rim: string | null) => {
      const grad = g.createLinearGradient(0, baseY - amp, 0, H);
      grad.addColorStop(0, c0);
      grad.addColorStop(1, c1);
      const pts: Array<[number, number]> = [[0, baseY]];
      let x = 0;
      while (x < W + 60) {
        const nx = x + 26 + brnd() * 62;
        pts.push([nx, baseY + (brnd() - 0.5) * amp]);
        x = nx;
      }
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, H);
      g.lineTo(0, baseY);
      for (let i = 1; i < pts.length; i++) {
        const [px, py] = pts[i - 1]!;
        const [qx, qy] = pts[i]!;
        g.quadraticCurveTo((px + qx) / 2, Math.min(py, qy) - amp * 0.35, qx, qy);
      }
      g.lineTo(W, H);
      g.closePath();
      g.fill();
      for (let i = 0; i < pts.length; i += 2) {
        if (brnd() < 0.62) {
          const [bx, by] = pts[i]!;
          const cw = 20 + brnd() * 50;
          const ch = 9 + brnd() * 20;
          for (let k = 0; k < 4; k++) {
            g.beginPath();
            g.ellipse(bx + (brnd() - 0.5) * cw, by - ch * 0.35 - brnd() * ch * 0.5, cw * (0.22 + brnd() * 0.3), ch * (0.38 + brnd() * 0.5), 0, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      g.beginPath();
      for (let tx = 3; tx < W; tx += 4 + brnd() * 8) {
        const ty = baseY + (brnd() - 0.5) * amp * 0.8;
        const th = tuftH * (0.4 + brnd());
        const lean = (brnd() - 0.5) * 5;
        g.moveTo(tx, ty + 2);
        g.quadraticCurveTo(tx + lean, ty - th * 0.6, tx + lean + 1.2, ty - th);
        g.lineTo(tx + 3 + brnd() * 2.5, ty + 2);
      }
      g.fill();
      if (rim) {
        g.strokeStyle = rim;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(pts[0]![0], pts[0]![1] - 1);
        for (let i = 1; i < pts.length; i++) {
          const [px, py] = pts[i - 1]!;
          const [qx, qy] = pts[i]!;
          g.quadraticCurveTo((px + qx) / 2, Math.min(py, qy) - amp * 0.35 - 1, qx, qy - 1);
        }
        g.stroke();
      }
    };
    bankLayer(DECK_Y + 96, 28, '#0A1713', '#071009', 10, 'rgba(88,138,120,0.16)');
    bankLayer(DECK_Y + 170, 22, '#07110D', '#040A07', 15, 'rgba(88,138,120,0.1)');

    g.strokeStyle = '#050A14';
    for (let x = 10; x < W; x += 38) {
      g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(x, DECK_Y + 1);
      g.lineTo(x, DECK_Y - 30);
      g.stroke();
    }
    const aL = 64;
    const aR = W - 64;
    const cy = DECK_Y - 2 * 205;
    const archY = (x: number) => {
      const t = (x - aL) / (aR - aL);
      return (1 - t) * (1 - t) * DECK_Y + 2 * (1 - t) * t * cy + t * t * DECK_Y;
    };
    g.lineWidth = 2.4;
    for (let x = aL + 56; x < aR - 40; x += 56) {
      const ay = archY(x);
      if (ay < DECK_Y - 34) {
        g.beginPath();
        g.moveTo(x, ay);
        g.lineTo(x, DECK_Y - 28);
        g.stroke();
      }
    }
    g.lineWidth = 11;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(aL, DECK_Y + 8);
    g.quadraticCurveTo(W / 2, cy, aR, DECK_Y + 8);
    g.stroke();
    g.lineCap = 'butt';
    for (const [off, lw] of [[30, 3.4], [18, 1.8]] as const) {
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(0, DECK_Y - off);
      g.lineTo(W, DECK_Y - off);
      g.stroke();
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function createLayer(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

function spawnPart(c: CloudConfig): CloudPart {
  const ang = Math.random() * Math.PI * 2;
  let rr = Math.pow(Math.random(), 0.45);
  if (Math.random() < 0.26) rr = 0.3 + Math.random() * 0.16;
  const big = Math.random() < 0.16;
  return {
    dx: Math.cos(ang),
    dy: Math.sin(ang) * 0.94,
    r: c.R * rr,
    size: big ? 5 + Math.random() * 4 : 1.7 + Math.random() * 3.2,
    sag: 0,
    color: c.colors[Math.min(c.colors.length - 1, Math.floor(rr * c.colors.length))] ?? c.colors[0],
    base: (0.6 + Math.random() * 0.4) * c.int,
    tw: 0.5 + Math.random() * 1.5,
    phase: Math.random() * 9,
    vr: 0.015 + Math.random() * 0.05
  };
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
