/**
 * Palette Recent (M11): the last five palette picks, in the
 * `paletteRecent` slot of `tinydocy-choices` (cleared by "Forget my
 * choices"; nothing stored under the kill switch). Written only by the
 * palette after `runAction` returned true (contract §6, exception 2).
 * Item keys are validated against the live registry when shown, so a
 * tampered entry is simply skipped.
 */
import {
  type ChoiceSpec,
  REMEMBER_CHOICES_ENABLED,
  readChoice,
  rememberChoice,
  subscribeChoices,
} from "@/lib/remembered-choice";

import { MAX_RECENT } from "./palette-sections";

const KEY_PATTERN = /^[a-z]+\.[A-Za-z0-9.]+(:[A-Za-z0-9:_|.-]{1,200})?$/;

const isRecentKey = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 240 && KEY_PATTERN.test(value);

export const PALETTE_RECENT_CHOICE: ChoiceSpec<string> = {
  slot: "paletteRecent",
  maxRecent: MAX_RECENT,
  validate: isRecentKey,
  fallback: "",
};

/** In-page list; dropped on any memory-layer change (Forget, other tabs). */
let recent: string[] | undefined;
let watching = false;

function watch(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  subscribeChoices(() => {
    recent = undefined;
  });
}

export function readPaletteRecent(): readonly string[] {
  if (!REMEMBER_CHOICES_ENABLED) return [];
  watch();
  if (recent === undefined) {
    recent = readChoice(PALETTE_RECENT_CHOICE).recent.filter(isRecentKey);
  }
  return recent;
}

export function rememberPaletteRecent(key: string): void {
  if (!REMEMBER_CHOICES_ENABLED || !isRecentKey(key)) return;
  const next = [key, ...readPaletteRecent().filter((k) => k !== key)].slice(
    0,
    MAX_RECENT,
  );
  rememberChoice(PALETTE_RECENT_CHOICE, key);
  recent = next;
}
