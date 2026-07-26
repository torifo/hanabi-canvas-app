import type { IntroOverlay as IntroOverlayContract } from '../types';

const EXIT_DURATION_MS = 1800;
// タップがなくても自動で夜へ入る（音はその後の最初のタップで初期化される）
const AUTO_ENTER_MS = 5000;

export class IntroOverlay implements IntroOverlayContract {
  private readonly enterCallbacks: Array<() => void> = [];
  private element: HTMLButtonElement | null = null;
  private entered = false;
  private dismissPromise: Promise<void> | null = null;
  private autoEnterTimer = 0;

  show(root: HTMLElement): void {
    if (this.element) return;

    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'intro-overlay';
    element.setAttribute('aria-label', '花火と心模様へ入る');
    element.innerHTML = `
      <span class="intro-overlay__grain" aria-hidden="true"></span>
      <span class="intro-overlay__title" aria-hidden="true">
        <span class="intro-overlay__column intro-overlay__column--one">
          ${fireworkMark(52)}
          <span>花火と</span>
          <span class="intro-overlay__rule intro-overlay__rule--short"></span>
        </span>
        <span class="intro-overlay__column intro-overlay__column--two">
          ${fireworkMark(38)}
          <span>心模様</span>
          <span class="intro-overlay__rule intro-overlay__rule--long"></span>
        </span>
      </span>
    `;
    element.addEventListener('click', this.handleEnter);
    root.append(element);
    this.element = element;
    document.documentElement.dataset.entered = 'false';
    this.autoEnterTimer = window.setTimeout(this.handleEnter, AUTO_ENTER_MS);
  }

  onEnter(cb: () => void): void {
    this.enterCallbacks.push(cb);
  }

  dismiss(): Promise<void> {
    if (!this.element) return Promise.resolve();
    if (this.dismissPromise) return this.dismissPromise;

    const element = this.element;
    document.documentElement.dataset.entered = 'true';
    element.classList.add('is-leaving');
    this.dismissPromise = new Promise((resolve) => {
      let timeoutId = 0;
      const finish = () => {
        window.clearTimeout(timeoutId);
        element.removeEventListener('transitionend', onTransitionEnd);
        element.removeEventListener('click', this.handleEnter);
        element.remove();
        if (this.element === element) this.element = null;
        resolve();
      };
      const onTransitionEnd = (event: TransitionEvent) => {
        if (event.target === element && event.propertyName === 'opacity') finish();
      };
      element.addEventListener('transitionend', onTransitionEnd);
      timeoutId = window.setTimeout(finish, EXIT_DURATION_MS + 100);
    });
    return this.dismissPromise;
  }

  private handleEnter = (): void => {
    if (this.entered) return;
    this.entered = true;
    window.clearTimeout(this.autoEnterTimer);
    this.enterCallbacks.forEach((callback) => callback());
  };
}

function fireworkMark(size: number): string {
  return `
    <svg class="intro-overlay__firework" width="${size}" height="${size}" viewBox="0 0 52 52" aria-hidden="true">
      <g stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round">
        <path d="M26 26V6M26 26l14-16M26 26l20-4M26 26l18 10M26 26l8 18M26 26l-8 18M26 26L8 36M26 26L6 22M26 26L12 10"/>
      </g>
      <g fill="currentColor">
        <circle cx="26" cy="6" r="1.4"/><circle cx="40" cy="10" r="1.2"/>
        <circle cx="46" cy="22" r="1.2"/><circle cx="44" cy="36" r="1.2"/>
        <circle cx="34" cy="44" r="1.2"/><circle cx="18" cy="44" r="1.2"/>
        <circle cx="8" cy="36" r="1.2"/><circle cx="6" cy="22" r="1.2"/>
        <circle cx="12" cy="10" r="1.2"/>
      </g>
    </svg>
  `;
}
