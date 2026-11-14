import { useEffect, useState } from "react";

import {
  HIGHLIGHT_TOKENS,
  type HighlightToken,
  isTextColorToken,
  type TextColorToken,
} from "@/lib/text-style-tokens";

/**
 * The memory layer (spec §5). Local only: never Yjs, server, URLs or
 * analytics. Owned by PR D2; PR E writes its own slots through the same
 * API. Each key holds `{ v: STORAGE_VERSION, slots: { [slot]: { last,
 * recent } } }`: other versions are discarded, every storage call sits in
 * try/catch, every write re-reads and merges its own slot, and every read
 * re-validates (stored values are untrusted).
 *
 * One write path (contract §6): `rememberChoice` is called only inside an
 * action's `run()` after its command returned true, so the row, bubble,
 * phone bar, palette and shortcuts all remember the same way. Surfaces
 * only read. Two named exceptions: `outlineOpen` (the shell's
 * `setOutlineOpen`) and `paletteRecent` (the palette host, after
 * `runAction` returned true).
 */

/** localStorage keys. "Forget my choices" clears only `choices`. */
export const STORAGE_KEYS = {
  /** M1–M5, M7, M9–M11, M17 */
  choices: "tinydocy-choices",
  /** M6 outline state and the simplified toolbar; survive Forget */
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
  toolbarDensity: "ui", // simplified toolbar (A-next)
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

/** Payloads larger than this are discarded unread (tamper / quota abuse). */
const MAX_PAYLOAD_CHARS = 64 * 1024;
/** Stored `recent` entries looked at, before validation and `maxRecent`. */
const MAX_RECENT_SCAN = 50;

type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
type Slots = Record<string, unknown>;

const OUR_KEYS = new Set<string>(Object.values(STORAGE_KEYS));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const keyOf = (slot: ChoiceSlot): StorageKey =>
  STORAGE_KEYS[CHOICE_SLOTS[slot]];

/** The slots of one key, or none when missing, hostile or another version. */
function readSlots(key: StorageKey): Slots {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > MAX_PAYLOAD_CHARS) return {};
    const payload: unknown = JSON.parse(raw);
    if (!isRecord(payload) || payload.v !== STORAGE_VERSION) return {};
    return isRecord(payload.slots) ? payload.slots : {};
  } catch {
    return {};
  }
}

/** Own property only: a stored `__proto__` key is never a slot. */
const slotEntry = (slots: Slots, slot: ChoiceSlot): Record<string, unknown> => {
  const entry = Object.hasOwn(slots, slot) ? slots[slot] : undefined;
  return isRecord(entry) ? entry : {};
};

const sameValue = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

function validRecent<T>(spec: ChoiceSpec<T>, stored: unknown): T[] {
  if (!Array.isArray(stored) || spec.maxRecent <= 0) return [];
  const recent: T[] = [];
  for (const value of stored.slice(0, MAX_RECENT_SCAN)) {
    if (recent.length >= spec.maxRecent) break;
    if (spec.validate(value) && !recent.some((r) => sameValue(r, value))) {
      recent.push(value);
    }
  }
  return recent;
}

const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

function onStorage(event: StorageEvent) {
  // `key` is null when another tab called `localStorage.clear()`.
  if (event.key === null || OUR_KEYS.has(event.key)) notify();
}

/** Synchronous read for non-React callers (actions). */
export function readChoice<T>(spec: ChoiceSpec<T>): {
  last: T;
  recent: readonly T[];
} {
  if (!REMEMBER_CHOICES_ENABLED) return { last: spec.fallback, recent: [] };
  const entry = slotEntry(readSlots(keyOf(spec.slot)), spec.slot);
  return {
    last: spec.validate(entry.last) ? entry.last : spec.fallback,
    recent: validRecent(spec, entry.recent),
  };
}

/**
 * Synchronous write, only from an action's `run()` after its command
 * returned true (plus the two exceptions above). Re-reads the key and
 * merges its own slot, because several slots and tracks share one key.
 * Notifies `subscribeChoices` listeners in this tab; other tabs hear the
 * `storage` event.
 */
export function rememberChoice<T>(spec: ChoiceSpec<T>, value: T): void {
  if (!REMEMBER_CHOICES_ENABLED || !spec.validate(value)) return;
  const key = keyOf(spec.slot);
  const slots = readSlots(key);
  const previous = validRecent(spec, slotEntry(slots, spec.slot).recent);
  const recent = [value, ...previous.filter((r) => !sameValue(r, value))];
  const next: Slots = Object.create(null);
  for (const [name, entry] of Object.entries(slots)) {
    if (Object.hasOwn(CHOICE_SLOTS, name)) next[name] = entry;
  }
  next[spec.slot] = { last: value, recent: recent.slice(0, spec.maxRecent) };
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ v: STORAGE_VERSION, slots: next }),
    );
  } catch {
    return;
  }
  notify();
}

/** "Forget my choices": clears `tinydocy-choices` only; notifies like a write. */
export function forgetChoices(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.choices);
  } catch {
    // Storage blocked: nothing was stored either.
  }
  notify();
}

/**
 * Change feed for this tab's writes and Forget, plus other tabs' `storage`
 * events (which never fire in the writing tab). `useRememberedChoice`
 * reads through it, so a face updates right after its action runs.
 */
export function subscribeChoices(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    if (!listeners.delete(listener)) return;
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

const EMPTY: readonly never[] = Object.freeze([]);

/**
 * React binding, read only. Reads in `useEffect` behind `ready`, so the
 * first render matches the server. Pass a module-level spec: a new spec
 * object per render re-subscribes every render.
 */
export function useRememberedChoice<T>(
  spec: ChoiceSpec<T>,
): RememberedChoice<T> {
  const [choice, setChoice] = useState<RememberedChoice<T>>(() => ({
    ready: false,
    last: spec.fallback,
    recent: EMPTY,
  }));
  useEffect(() => {
    const read = () => {
      const next = readChoice(spec);
      setChoice((current) =>
        current.ready &&
        sameValue(current.last, next.last) &&
        sameValue(current.recent, next.recent)
          ? current
          : { ready: true, ...next },
      );
    };
    read();
    return subscribeChoices(read);
  }, [spec]);
  return choice;
}

/* ------------------------------------------------------------------ */
/* D2's specs. Action files import these; D1's `list.*` run() writes   */
/* `LIST_TYPE_CHOICE`.                                                  */
/* ------------------------------------------------------------------ */

const isHighlightToken = (value: unknown): value is HighlightToken =>
  typeof value === "string" &&
  (HIGHLIGHT_TOKENS as readonly string[]).includes(value);

export function isRecentColor(value: unknown): value is RecentColor {
  if (!isRecord(value)) return false;
  if (value.kind === "text") return isTextColorToken(value.token);
  if (value.kind === "highlight") return isHighlightToken(value.token);
  return false;
}

/** Largest table the grid offers (and the largest size remembered). */
export const MAX_TABLE_SIZE = 8;

const isTableDimension = (value: unknown) =>
  Number.isInteger(value) &&
  (value as number) >= 1 &&
  (value as number) <= MAX_TABLE_SIZE;

export function isTableSize(value: unknown): value is TableSize {
  return (
    isRecord(value) &&
    isTableDimension(value.rows) &&
    isTableDimension(value.cols)
  );
}

export const LIST_TYPES = ["bulletList", "orderedList", "taskList"] as const;
export type ListType = (typeof LIST_TYPES)[number];
export const isListType = (value: unknown): value is ListType =>
  typeof value === "string" &&
  (LIST_TYPES as readonly string[]).includes(value);

export const INSERT_KINDS = [
  "image",
  "embed",
  "table",
  "quote",
  "codeBlock",
  "mermaid",
  "divider",
] as const;
export type InsertKind = (typeof INSERT_KINDS)[number];
export const isInsertKind = (value: unknown): value is InsertKind =>
  typeof value === "string" &&
  (INSERT_KINDS as readonly string[]).includes(value);

/** Recent colours shown in the popover (M3: one mixed row of ≤ 5). */
export const MAX_RECENT_COLORS = 5;

/** M1: the text colour face. Only tokens are remembered, never "default". */
export const TEXT_COLOR_CHOICE: ChoiceSpec<TextColorToken> = {
  slot: "textColor",
  maxRecent: 0,
  validate: isTextColorToken,
  fallback: "red",
};

/** M2: the highlight face. Only tokens are remembered, never "none". */
export const HIGHLIGHT_CHOICE: ChoiceSpec<HighlightToken> = {
  slot: "highlight",
  maxRecent: 0,
  validate: isHighlightToken,
  fallback: "yellow",
};

/** M3: one mixed row of recent text and highlight colours. */
export const RECENT_COLORS_CHOICE: ChoiceSpec<RecentColor> = {
  slot: "recentColors",
  maxRecent: MAX_RECENT_COLORS,
  validate: isRecentColor,
  fallback: { kind: "text", token: "red" },
};

/** M9: the list face. */
export const LIST_TYPE_CHOICE: ChoiceSpec<ListType> = {
  slot: "listType",
  maxRecent: 0,
  validate: isListType,
  fallback: "bulletList",
};

/** M10: the last inserted kind (the T1 face; pre-highlighted in the menu). */
export const INSERT_KIND_CHOICE: ChoiceSpec<InsertKind | null> = {
  slot: "insertKind",
  maxRecent: 0,
  validate: isInsertKind,
  // Nothing remembered: the Insert face stays "+ Insert" (D2 Decision 1).
  fallback: null,
};

/** M17a: the table grid opens at the last size. */
export const TABLE_SIZE_CHOICE: ChoiceSpec<TableSize> = {
  slot: "tableSize",
  maxRecent: 0,
  validate: isTableSize,
  fallback: { rows: 3, cols: 3 },
};

/** M6: outline open state; under `tinydocy-ui`, so Forget keeps it. */
export const OUTLINE_OPEN_CHOICE: ChoiceSpec<boolean> = {
  slot: "outlineOpen",
  maxRecent: 0,
  validate: (value: unknown): value is boolean => typeof value === "boolean",
  fallback: true,
};

export type ToolbarDensity = "full" | "simple";

/**
 * Simplified toolbar (A-next): the row shows its compact set at every width.
 * Under `tinydocy-ui`, so Forget keeps it: a layout preference, not a
 * remembered formatting choice.
 */
export const TOOLBAR_DENSITY_CHOICE: ChoiceSpec<ToolbarDensity> = {
  slot: "toolbarDensity",
  maxRecent: 0,
  validate: (value: unknown): value is ToolbarDensity =>
    value === "full" || value === "simple",
  fallback: "full",
};
