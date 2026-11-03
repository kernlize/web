/* global $state, $derived, $effect */
import type { Observable } from 'rxjs';

export interface Observed<T> {
  readonly value: T;
  stop(): void;
}

/** Mirror an observable into rune state. Call `stop()` from the effect cleanup that created it. */
export function observe<T>(source: Observable<T>, initial: T): Observed<T> {
  let value = $state.raw(initial);
  const subscription = source.subscribe((next) => {
    value = next;
  });
  return {
    get value() {
      return value;
    },
    stop: () => subscription.unsubscribe(),
  };
}
