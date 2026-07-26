import { registerSW } from 'virtual:pwa-register';
import { createDependencies, type AppDependencies } from './composition';
import { resolveMuted, resolvePresenceUrl, shouldDisposeOnPageHide } from './lifecycle';
import { guardMessage } from './messages/messageGuard';
import { MOOD_PROFILES } from './moods';
import type { MoodId } from './types';
import './style.css';

class AppCore {
  private readonly dependencies: AppDependencies;
  private readonly canvas: HTMLCanvasElement;
  private readonly uiRoot: HTMLElement;
  private readonly status: HTMLElement;
  private activePointerId: number | null = null;
  private soundReady: Promise<void> | null = null;
  private currentMood: MoodId = 'sparkle';
  private presenceEnabled = true;
  private userMuted = false;
  private countdownTimer = 0;
  private noonTimer = 0;
  private disposed = false;

  constructor(dependencies: AppDependencies) {
    this.dependencies = dependencies;
    this.canvas = requireElement<HTMLCanvasElement>('#hanabi-canvas');
    this.uiRoot = requireElement<HTMLElement>('#ui-root');
    this.status = requireElement<HTMLElement>('#status');
  }

  async init(): Promise<void> {
    const { compose, graphics, intro, messages, presence, schedule, ui } = this.dependencies;

    ui.init(this.uiRoot);
    intro.onEnter(() => {
      void this.ensureSound();
      void intro.dismiss();
    });
    intro.show(this.uiRoot);
    await graphics.init(this.canvas);
    this.resize();
    this.applyMood(this.currentMood);

    ui.onMoodChange((mood) => this.applyMood(mood));
    ui.onPresenceToggle((enabled) => {
      this.presenceEnabled = enabled;
      presence.setEnabled(enabled && !document.hidden);
    });
    presence.onRemoteSpark((x, y) => graphics.emitRemoteSpark(x, y));

    // --- メッセージ花火 ---
    compose.mount(this.uiRoot);
    compose.onLaunch((text) => {
      const record = messages.add(text, true);
      graphics.bloomMessage(record, true);
      presence.sendBloom(text);
    });
    presence.onRemoteBloom((raw) => {
      // サーバーは型と文字数しか見ない。細工されたクライアントに備え、
      // 受信側でも送信時と同じ検証を通してから空へ迎える
      const checked = guardMessage(raw);
      if (!checked.ok) return;
      // 受信側が自分の空の空き場所へ咲かせる（座標は通信しない）
      const record = messages.add(checked.text, false);
      graphics.bloomMessage(record, false);
    });
    graphics.setMessages(messages.list());
    this.scheduleNoonSweep();

    const presenceUrl = getPresenceUrl();
    if (presenceUrl) presence.connect(presenceUrl);

    await schedule.load(new URL('./data/hanabi-schedule.json', document.baseURI).href).catch(() => []);
    this.updateCountdown();
    this.countdownTimer = window.setInterval(() => this.updateCountdown(), 60_000);

    this.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    this.canvas.addEventListener('pointerup', this.onPointerUp, { passive: false });
    this.canvas.addEventListener('pointercancel', this.onPointerCancel, { passive: false });
    this.canvas.addEventListener('lostpointercapture', this.onLostPointerCapture);
    window.addEventListener('resize', this.resize, { passive: true });
    window.visualViewport?.addEventListener('resize', this.resize, { passive: true });
    window.addEventListener('hanabi:mute', this.onDesktopMute);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private applyMood(mood: MoodId): void {
    this.currentMood = mood;
    const profile = MOOD_PROFILES[mood];
    this.dependencies.graphics.setMood(profile);
    this.dependencies.sound.setMood(profile);
    document.documentElement.dataset.mood = mood;
    this.status.textContent = mood === 'sparkle' ? '高鳴りの心模様' : '静けさの心模様';
  }

  private ensureSound = (): Promise<void> => {
    this.soundReady ??= this.dependencies.sound
      .init()
      .then(() => {
        this.dependencies.sound.setMood(MOOD_PROFILES[this.currentMood]);
        this.dependencies.sound.setMuted(resolveMuted(this.userMuted, document.hidden));
      })
      .catch(() => {
        this.soundReady = null;
      });
    return this.soundReady;
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== null || event.button !== 0) return;
    event.preventDefault();

    const scene = this.dependencies.graphics.toSceneCoords(event.clientX, event.clientY);
    // 打ち上げ前の玉に触れたら、火花ではなく入力欄を開く
    if (this.dependencies.graphics.isShellAt(scene.x, scene.y)) {
      void this.ensureSound();
      this.dependencies.compose.open();
      return;
    }
    // 文面の「消す」に触れたら、その花火だけを自分の空から黙らせる
    const dismissId = this.dependencies.graphics.dismissAt(scene.x, scene.y);
    if (dismissId) {
      this.dependencies.messages.dismiss(dismissId);
      this.dependencies.graphics.removeMessage(dismissId);
      return;
    }
    // メッセージ花火に触れたら、火花は出さず読むだけにする
    if (this.dependencies.graphics.messageAt(scene.x, scene.y)) return;

    void this.ensureSound();
    this.activePointerId = event.pointerId;
    // 素早いタップ等でポインタが既に解放されていると NotFoundError になるため防御
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* capture は補助機能: 失敗してもチャージ・火花処理は続行する */
    }
    // 契約 D1: 座標はウィンドウ正規化ではなくシーン座標系 (GraphicsEngine が変換を提供)
    const { x, y } = this.dependencies.graphics.toSceneCoords(event.clientX, event.clientY);
    this.dependencies.graphics.beginCharge(x, y);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    const { x, y } = this.dependencies.graphics.toSceneCoords(event.clientX, event.clientY);
    const charge = this.dependencies.graphics.endCharge();
    // 自分の画面で火花にならなかったタップ（常駐の輪の上）は他の人へも送らない
    const launched = this.dependencies.graphics.emitSpark(x, y, charge);
    if (launched) this.dependencies.presence.sendSpark(x, y);
    void this.ensureSound().then(() => this.dependencies.sound.playSparkle());
    this.releasePointer(event.pointerId);
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    this.dependencies.graphics.endCharge();
    this.releasePointer(event.pointerId);
  };

  private onLostPointerCapture = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    this.dependencies.graphics.endCharge();
    this.activePointerId = null;
  };

  private releasePointer(pointerId: number): void {
    if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    this.activePointerId = null;
  }

  private resize = (): void => {
    if (document.hidden) return;
    const bounds = this.canvas.getBoundingClientRect();
    this.dependencies.graphics.resize(bounds.width, bounds.height);
  };

  private onDesktopMute = (event: Event): void => {
    const detail = event instanceof CustomEvent ? event.detail : undefined;
    if (typeof detail !== 'boolean') return;
    this.userMuted = detail;
    this.dependencies.sound.setMuted(resolveMuted(this.userMuted, document.hidden));
  };

  private onVisibilityChange = (): void => {
    const hidden = document.hidden;
    this.dependencies.sound.setMuted(resolveMuted(this.userMuted, hidden));
    this.dependencies.presence.setEnabled(this.presenceEnabled && !hidden);
    this.canvas.dataset.paused = String(hidden);
    if (hidden) {
      this.dependencies.graphics.resize(1, 1);
    } else {
      this.resize();
    }
  };

  private onPageHide = (event: PageTransitionEvent): void => {
    if (shouldDisposeOnPageHide(event.persisted)) this.dispose();
  };

  private onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) this.onVisibilityChange();
  };

  /** ローカル時刻の正午をまたいだら、貯まった花火を捨てて空を掃く */
  private scheduleNoonSweep(): void {
    const { graphics, messages } = this.dependencies;
    window.clearTimeout(this.noonTimer);
    const delay = Math.max(1000, Math.min(messages.msUntilNextNoon() + 1000, 2 ** 31 - 1));
    this.noonTimer = window.setTimeout(() => {
      messages.sweep();
      graphics.setMessages(messages.list());
      this.scheduleNoonSweep();
    }, delay);
  }

  private updateCountdown(): void {
    const now = new Date();
    this.dependencies.ui.updateCountdown(
      this.dependencies.schedule.nextEvent(now),
      this.dependencies.schedule.countdown(now)
    );
  }

  private dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    window.clearInterval(this.countdownTimer);
    window.clearTimeout(this.noonTimer);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture);
    window.removeEventListener('resize', this.resize);
    window.visualViewport?.removeEventListener('resize', this.resize);
    window.removeEventListener('hanabi:mute', this.onDesktopMute);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.dependencies.compose.dispose();
    this.dependencies.graphics.dispose();
    this.dependencies.sound.dispose();
    this.dependencies.presence.dispose();
  };
}

function normalizePointer(event: PointerEvent, target: HTMLElement): { x: number; y: number } {
  const rect = target.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  return {
    x: clamp((event.clientX - rect.left) / width),
    y: clamp((event.clientY - rect.top) / height)
  };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function getPresenceUrl(): string | null {
  return resolvePresenceUrl(
    import.meta.env.VITE_PRESENCE_URL,
    import.meta.env.PROD,
    location.protocol,
    location.host
  );
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

registerSW({ immediate: true });

void new AppCore(createDependencies()).init().catch((error: unknown) => {
  console.error('Hanabi Canvas failed to initialize.', error);
  document.documentElement.dataset.appState = 'error';
});

export { AppCore, clamp, getPresenceUrl, normalizePointer };
