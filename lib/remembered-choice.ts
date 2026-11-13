import type { HighlightToken, TextColorToken } from "@/lib/text-style-tokens";

/**
 * The memory layer (spec §5). Local only: never Yjs, server, URLs or
 * analytics. Owned by PR D2; PR E writes its own slots through the same
 * API. SKELETON: the exported names, slots and keys are the contract; D2
 * replaces the bodies (versioned payload, try/catch around every storage
 * call, read-merge-write on every write, unknown versions discarded).
 */

/** localStorage keys. "Forget my choices" clears only `choices`. */
export const STORAGE_KEYS = {
  /** M1–M5, M7, M9–M11, M17 */
  choices: "tinydocy-choices",
  /** M6 outline state; survives Forget */
  ui: "tinydocy-ui",
  /** M14 saved formats (PR E, `lib/saved-formats.ts`); survives Forget */
  formats: "tinydocy-formats",
} as const;

/** Payload version stored with each key; other versions are discarded. */
export const STORAGE_VERSION = 1;

/** Every slot, with its key. E's slots are listed so E never edits this file. */
export const CHOICE_SLOTS = {
  textColor: "choices", // M1 (D2)
  highlight: "choices", // M2 (D2)
  recentColors: "choices", // M3 (D2)
  codeLanguage: "choices", // M4 (D1 slot reads, D1 run writes)
  listType: "choices", // M9 (D2)
  insertKind: "choices", // M10 (D2)
  tableSize: "choices", // M17a (D2)
  repeatBundle: "choices", // M7 (E)
  paletteRecent: "choices", // M11 (E)
  mermaidTemplate: "choices", // M17b (E)
  outlineOpen: "ui", // M6 (D2)
} as const satisfies Record<string, "choices" | "ui">;

export type ChoiceSlot = keyof typeof CHOICE_SLOTS;

/** Kill switch: `NEXT_PUBLIC_REMEMBER_CHOICES=0` reads fallbacks, writes nothing. */
export const REMEMBER_CHOICES_ENABLED =
  process.env.NEXT_PUBLIC_REMEMBER_CHOICES !== "0";

export interface ChoiceSpec<T> {
  slot: ChoiceSlot;
  /** 0 = remember only `last`. */
  maxRecent: number;
  /** Allowlist validator; stored values that fail are dropped. */
  validate: (value: unknown) => value is T;
  fallback: T;
}

export interface RememberedChoice<T> {
  /** False until storage was read in an effect (no hydration mismatch). */
  ready: boolean;
  /** Last remembered value, or `fallback`. */
  last: T;
  /** Newest first, ≤ maxRecent, deduplicated. */
  recent: readonly T[];
  /** Call only after a successful `run()`. */
  remember: (value: T) => void;
}

/** M3 entries: one mixed row of text and highlight colours. */
export type RecentColor =
  | { kind: "text"; token: TextColorToken }
  | { kind: "highlight"; token: HighlightToken };

/** M17a: last table grid size. */
export interface TableSize {
  rows: number;
  cols: number;
}

/** M1 face value incl. "default" (no colour); M2 incl. "none". */
export type TextColorChoice = TextColorToken | "default";
export type HighlightChoice = HighlightToken | "none";

/** Synchronous read for non-React callers (actions). */
export function readChoice<T>(spec: ChoiceSpec<T>): {
  last: T;
  recent: readonly T[];
} {
  return { last: spec.fallback, recent: [] };
}

/** Synchronous write for non-React callers (actions after `run()`). */
export function rememberChoice<T>(_spec: ChoiceSpec<T>, _value: T): void {}

/** "Forget my choices": clears `tinydocy-choices` only. */
export function forgetChoices(): void {}

/** React binding; reads in `useEffect` behind `ready`. */
export function useRememberedChoice<T>(
  spec: ChoiceSpec<T>,
): RememberedChoice<T> {
  return {
    ready: false,
    last: spec.fallback,
    recent: [],
    remember: (value) => rememberChoice(spec, value),
  };
}
