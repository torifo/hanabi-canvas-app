import type { Countdown, HanabiEvent, MoodId, UIController as UIControllerContract } from '../types';

export class UIController implements UIControllerContract {
  private moodCallbacks: Array<(mood: MoodId) => void> = [];
  private presenceCallbacks: Array<(enabled: boolean) => void> = [];
  private countdownElement: HTMLElement | null = null;
  private eventElement: HTMLElement | null = null;

  init(root: HTMLElement): void {
    root.innerHTML = `
      <section class="brand" aria-label="花火と心模様">
        <p class="brand__eyebrow">HANABI CANVAS</p>
        <h1>花火と<br />心模様</h1>
      </section>
      <section class="controls" aria-label="心模様の設定">
        <div class="mood-switch" role="group" aria-label="ムード">
          <button type="button" class="is-active" data-mood="sparkle" aria-pressed="true">高鳴り</button>
          <button type="button" data-mood="quiet" aria-pressed="false">静けさ</button>
        </div>
        <label class="presence-toggle">
          <input type="checkbox" checked />
          <span class="presence-toggle__light" aria-hidden="true"></span>
          <span>誰かの気配</span>
        </label>
      </section>
      <aside class="countdown" aria-live="polite">
        <p class="countdown__label">次の花火まで</p>
        <p class="countdown__time">静かに探しています</p>
        <p class="countdown__event"></p>
      </aside>
    `;

    this.countdownElement = root.querySelector('.countdown__time');
    this.eventElement = root.querySelector('.countdown__event');

    const buttons = root.querySelectorAll<HTMLButtonElement>('[data-mood]');
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const mood = button.dataset.mood as MoodId;
        for (const candidate of buttons) {
          const active = candidate === button;
          candidate.classList.toggle('is-active', active);
          candidate.setAttribute('aria-pressed', String(active));
        }
        this.moodCallbacks.forEach((callback) => callback(mood));
      });
    }

    root.querySelector<HTMLInputElement>('.presence-toggle input')?.addEventListener('change', (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      this.presenceCallbacks.forEach((callback) => callback(enabled));
    });
  }

  onMoodChange(cb: (mood: MoodId) => void): void {
    this.moodCallbacks.push(cb);
  }

  onPresenceToggle(cb: (enabled: boolean) => void): void {
    this.presenceCallbacks.push(cb);
  }

  updateCountdown(event: HanabiEvent | null, cd: Countdown | null): void {
    if (!this.countdownElement || !this.eventElement) return;
    if (!event || !cd) {
      this.countdownElement.textContent = 'また次の夜に';
      this.eventElement.textContent = '';
      return;
    }
    this.countdownElement.textContent = `${cd.days}日 ${cd.hours}時間 ${cd.minutes}分`;
    this.eventElement.textContent = `${event.prefecture}・${event.name}`;
  }
}
