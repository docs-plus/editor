/**
 * Your formats (spec §5 M14). Saved in `tinydocy-formats`, which survives
 * "Forget my choices" and the kill switch: these are things the user named
 * on purpose. Local only: never Yjs, the server, URLs or analytics.
 *
 * Each format is a bundle of tokens and mark names (validated on every
 * read) plus one free-text name of at most 40 code points with control and
 * bidi characters stripped. Every storage call sits inside try/catch.
 */
import {
  type FormatBundle,
  isEmptyBundle,
  setEntries,
  validateBundle,
} from "@/extensions/repeat-formatting/bundle";
import { STORAGE_KEYS, STORAGE_VERSION } from "@/lib/remembered-choice";

export interface SavedFormat {
  id: string;
  name: string;
  bundle: FormatBundle;
}

export type SaveFormatResult =
  /** `replaced`: the name of the format this save overwrote, if any. */
  | { ok: true; format: SavedFormat; replaced?: string }
  | { ok: false; reason: string };

export const FORMATS_STORAGE_KEY = STORAGE_KEYS.formats;
export const MAX_SAVED_FORMATS = 20;
export const MAX_FORMAT_NAME = 40;
export const FORMAT_REASONS = {
  name: "Use 1–40 characters.",
  cap: "You can keep up to 20 formats. Remove one first.",
  empty: "Select formatted text to save it.",
} as const;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
// Control, soft hyphen, Arabic letter mark, zero-width, line/paragraph
// separator, bidi embedding/override, word joiner and invisible operators,
// isolate characters and BOM, as code-point ranges.
const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const hex = (code: number) => `\\u${code.toString(16).padStart(4, "0")}`;
const UNSAFE_CHARS = new RegExp(
  `[${UNSAFE_RANGES.map(([from, to]) => `${hex(from)}-${hex(to)}`).join("")}]`,
  "g",
);

/** Strips control/bidi characters, collapses spaces, cuts to 40 code points. */
export function sanitizeFormatName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    .slice(0, 4 * MAX_FORMAT_NAME + 64)
    .replace(UNSAFE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, MAX_FORMAT_NAME).join("").trim();
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): SavedFormat[] {
  if (!raw || raw.length > 64 * 1024) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof payload !== "object" || payload === null) return [];
  const { v, formats } = payload as { v?: unknown; formats?: unknown };
  if (v !== STORAGE_VERSION || !Array.isArray(formats)) return [];
  const out: SavedFormat[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const entry of formats.slice(0, 200)) {
    if (out.length >= MAX_SAVED_FORMATS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name, bundle } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !ID_PATTERN.test(id) || ids.has(id)) {
      continue;
    }
    const cleanName = sanitizeFormatName(name);
    const valid = validateBundle(bundle);
    if (!cleanName || !valid || names.has(cleanName.toLowerCase())) continue;
    const kept = setEntries(valid);
    if (isEmptyBundle(kept)) continue;
    names.add(cleanName.toLowerCase());
    ids.add(id);
    out.push({ id, name: cleanName, bundle: kept });
  }
  return out;
}

let cache: SavedFormat[] | null = null;
const listeners = new Set<() => void>();
let storageListening = false;

/**
 * Other tabs' writes drop the cache. Attached once, on the first read or
 * subscription, and never removed (it holds no editor), so the cache is
 * fresh even while no component is subscribed (palette rows, apply, the
 * cap reason).
 */
function listenToStorage(): void {
  if (storageListening || typeof window === "undefined") return;
  window.addEventListener("storage", onStorage);
  storageListening = true;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== FORMATS_STORAGE_KEY) return;
  cache = null;
  notify();
}

/** Valid saved formats, at most 20, names unique (first wins). */
export function readSavedFormats(): readonly SavedFormat[] {
  listenToStorage();
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(FORMATS_STORAGE_KEY) ?? null;
  } catch {
    raw = null;
  }
  cache = parse(raw);
  return cache;
}

function write(formats: SavedFormat[]): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(
      FORMATS_STORAGE_KEY,
      JSON.stringify({ v: STORAGE_VERSION, formats }),
    );
  } catch {
    return false;
  }
  cache = null;
  notify();
  return true;
}

function newId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `f${Date.now().toString(36)}${random}`;
}

/**
 * Saves the set entries of `bundle` under `name`. A name that exists
 * (case-insensitive) is replaced in place, keeping its id.
 */
export function saveFormat(
  name: unknown,
  bundle: FormatBundle,
): SaveFormatResult {
  const cleanName = sanitizeFormatName(name);
  if (!cleanName) return { ok: false, reason: FORMAT_REASONS.name };
  const valid = validateBundle(bundle);
  const kept = valid ? setEntries(valid) : {};
  if (isEmptyBundle(kept)) return { ok: false, reason: FORMAT_REASONS.empty };
  cache = null;
  const formats = [...readSavedFormats()];
  const index = formats.findIndex(
    (format) => format.name.toLowerCase() === cleanName.toLowerCase(),
  );
  let format: SavedFormat;
  let replaced: string | undefined;
  if (index >= 0) {
    replaced = formats[index].name;
    format = { id: formats[index].id, name: cleanName, bundle: kept };
    formats[index] = format;
  } else {
    if (formats.length >= MAX_SAVED_FORMATS) {
      return { ok: false, reason: FORMAT_REASONS.cap };
    }
    format = { id: newId(), name: cleanName, bundle: kept };
    formats.push(format);
  }
  return write(formats)
    ? { ok: true, format, ...(replaced === undefined ? {} : { replaced }) }
    : { ok: false, reason: "Formats cannot be saved in this browser." };
}

/**
 * The last format removed in this tab and where it was, for "Restore ‘X’"
 * in the palette (design pass §4): the pill's Undo lasts 5 s, which a
 * keyboard user may not reach. Memory only: kept until the next removal,
 * a restore, or a reload.
 */
let removed: { format: SavedFormat; index: number } | null = null;

export const lastRemovedFormat = () => removed;

export function removeFormat(id: string): void {
  cache = null;
  const formats = [...readSavedFormats()];
  const index = formats.findIndex((format) => format.id === id);
  if (index < 0) return;
  removed = { format: formats[index], index };
  formats.splice(index, 1);
  write(formats);
}

/** Why `format` cannot come back now (its name is taken, or the cap). */
export function restoreReason(format: SavedFormat): string | null {
  const formats = readSavedFormats();
  const name = format.name.toLowerCase();
  if (formats.some((kept) => kept.name.toLowerCase() === name)) {
    return `‘${format.name}’ is in Your formats already.`;
  }
  return formats.length >= MAX_SAVED_FORMATS ? FORMAT_REASONS.cap : null;
}

/**
 * Undo of a removal: puts `format` back at `index`, unless its name or id
 * came back meanwhile (another tab) or the cap is reached. Restoring the
 * last removed format clears it.
 */
export function restoreFormat(format: SavedFormat, index: number): boolean {
  cache = null;
  const formats = [...readSavedFormats()];
  if (
    formats.some((kept) => kept.id === format.id) ||
    restoreReason(format) !== null
  ) {
    return false;
  }
  formats.splice(Math.min(Math.max(index, 0), formats.length), 0, format);
  if (!write(formats)) return false;
  if (removed?.format.id === format.id) removed = null;
  return true;
}

/** In-tab writes and other tabs' `storage` events. */
export function subscribeSavedFormats(listener: () => void): () => void {
  listenToStorage();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook: drop the parsed cache. */
export function resetSavedFormatsCacheForTests(): void {
  cache = null;
  removed = null;
}
