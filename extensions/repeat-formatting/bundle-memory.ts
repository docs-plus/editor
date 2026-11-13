/**
 * The remembered Repeat bundle (M7). Lives in the `repeatBundle` slot of
 * `tinydocy-choices` through the shared memory layer, so "Forget my
 * choices" clears it and the kill switch keeps it out of storage.
 *
 * A module variable is the in-page source of truth: with the kill switch
 * (`NEXT_PUBLIC_REMEMBER_CHOICES=0`) the bundle lives for the page only,
 * and it is dropped whenever the memory layer reports a change (Forget, or
 * another tab's write), so the next read comes from storage.
 */
import {
  type ChoiceSpec,
  readChoice,
  rememberChoice,
  subscribeChoices,
} from "@/lib/remembered-choice";

import { type FormatBundle, isEmptyBundle, isFormatBundle } from "./bundle";

const isStoredBundle = (value: unknown): value is FormatBundle | null =>
  value === null || isFormatBundle(value);

export const REPEAT_BUNDLE_CHOICE: ChoiceSpec<FormatBundle | null> = {
  slot: "repeatBundle",
  maxRecent: 0,
  validate: isStoredBundle,
  fallback: null,
};

/** `undefined` = not read yet (or invalidated): read from storage next. */
let current: FormatBundle | null | undefined;
const listeners = new Set<() => void>();
let unsubscribeChoices: (() => void) | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function watchChoices(): void {
  if (unsubscribeChoices || typeof window === "undefined") return;
  unsubscribeChoices = subscribeChoices(() => {
    current = undefined;
    notify();
  });
}

export function getRememberedBundle(): FormatBundle | null {
  watchChoices();
  if (current === undefined) {
    const stored = readChoice(REPEAT_BUNDLE_CHOICE).last;
    current = stored && isFormatBundle(stored) ? stored : null;
  }
  return current;
}

export function rememberBundle(bundle: FormatBundle): void {
  if (isEmptyBundle(bundle)) return;
  watchChoices();
  rememberChoice(REPEAT_BUNDLE_CHOICE, bundle);
  // After the write: a synchronous change notification from it must not
  // drop the value (the kill switch writes nothing).
  current = bundle;
  notify();
}

/** Change feed for surfaces (`useSyncExternalStore`). */
export function subscribeBundle(listener: () => void): () => void {
  watchChoices();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook: forget the in-page bundle. */
export function resetBundleMemoryForTests(): void {
  current = undefined;
  notify();
}
