import { MAX_MESSAGE_LENGTH, countChars, guardMessage } from '../messages/messageGuard';

/**
 * 打ち上げ前の玉から開く入力欄。
 *
 * 弾かれた文面はエラーを目立たせず、単に放てないだけに留める（世界観を壊さない）。
 */
export class ComposeOverlay {
  private element: HTMLFormElement | null = null;
  private input: HTMLInputElement | null = null;
  private counter: HTMLElement | null = null;
  private submitButton: HTMLButtonElement | null = null;
  private closeButton: HTMLButtonElement | null = null;
  private onSubmit: ((text: string) => void) | null = null;

  mount(root: HTMLElement): void {
    if (this.element) return;

    const form = document.createElement('form');
    form.className = 'compose';
    form.hidden = true;
    form.setAttribute('aria-label', '花火に言葉を込める');
    form.innerHTML = `
      <p class="compose__label">言葉を込めて、放つ</p>
      <div class="compose__row">
        <input class="compose__input" type="text" maxlength="${MAX_MESSAGE_LENGTH * 2}"
               autocomplete="off" enterkeyhint="send" placeholder="そっとひとこと" />
        <button class="compose__send" type="submit" disabled>放つ</button>
        <button class="compose__close" type="button" aria-label="閉じる">×</button>
      </div>
      <p class="compose__counter" aria-hidden="true">0 / ${MAX_MESSAGE_LENGTH}</p>
    `;

    this.input = form.querySelector('.compose__input');
    this.counter = form.querySelector('.compose__counter');
    this.submitButton = form.querySelector('.compose__send');

    this.closeButton = form.querySelector('.compose__close');
    this.input?.addEventListener('input', this.handleInput);
    this.closeButton?.addEventListener('click', this.handleClose);
    form.addEventListener('submit', this.handleSubmit);
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });

    root.append(form);
    this.element = form;
  }

  onLaunch(callback: (text: string) => void): void {
    this.onSubmit = callback;
  }

  get isOpen(): boolean {
    return this.element !== null && !this.element.hidden;
  }

  open(): void {
    if (!this.element) return;
    this.element.hidden = false;
    this.element.classList.add('is-open');
    this.input?.focus();
  }

  close(): void {
    if (!this.element) return;
    this.element.classList.remove('is-open');
    this.element.hidden = true;
    if (this.input) this.input.value = '';
    this.refresh();
  }

  dispose(): void {
    this.input?.removeEventListener('input', this.handleInput);
    this.closeButton?.removeEventListener('click', this.handleClose);
    this.element?.removeEventListener('submit', this.handleSubmit);
    this.element?.remove();
    this.element = null;
    this.input = null;
    this.counter = null;
    this.submitButton = null;
    this.closeButton = null;
    this.onSubmit = null;
  }

  private handleClose = (): void => {
    this.close();
  };

  private handleInput = (): void => {
    this.refresh();
  };

  private handleSubmit = (event: Event): void => {
    event.preventDefault();
    const raw = this.input?.value ?? '';
    const result = guardMessage(raw);
    if (!result.ok) return;
    this.onSubmit?.(result.text);
    this.close();
  };

  /** 送れる状態かを静かに反映する（拒否理由は表示しない） */
  private refresh(): void {
    const raw = this.input?.value ?? '';
    const result = guardMessage(raw);
    // 表示する文字数は、送信可否と同じ「正規化後」の値に揃える
    const count = result.ok ? countChars(result.text) : countChars(raw.replace(/[\r\n\t]+/g, ' ').replace(/[ 　]{2,}/g, ' ').trim());
    if (this.counter) {
      this.counter.textContent = `${count} / ${MAX_MESSAGE_LENGTH}`;
      this.counter.classList.toggle('is-over', count > MAX_MESSAGE_LENGTH);
    }
    if (this.submitButton) {
      this.submitButton.disabled = !result.ok;
    }
  }
}
