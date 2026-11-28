/* global $derived, $state */
import type { Ask } from './contract';
import { createAskQueue } from '@kernlize/ui-model';
import { observe } from './observe.svelte';

/** The linked applet review, separate from the firewall's permission to look it up. */
export class AppletLinkQueue {
  readonly model = createAskQueue<'link.open-applet'>();
  readonly #waiting = observe(this.model.current$, undefined);
  readonly current = $derived(this.#waiting.value);

  #busy = $state<Ask<'link.open-applet'> | undefined>();

  isBusy(request: Ask<'link.open-applet'>): boolean {
    return this.#busy === request;
  }

  setBusy(request: Ask<'link.open-applet'>, busy: boolean): void {
    if (busy) this.#busy = request;
    else if (this.#busy === request) this.#busy = undefined;
  }

  answer(request: Ask<'link.open-applet'>, opened: boolean): void {
    if (request === this.model.current()) this.model.answer(opened);
  }

  cancel(): void {
    const request = this.model.current();
    if (request && !this.isBusy(request)) this.answer(request, false);
  }
}
