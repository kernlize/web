/** A key press, as the page's `KeyboardEvent` names its parts. */
export interface ShortcutKey {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}
