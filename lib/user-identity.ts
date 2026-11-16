import { cleanText } from "@/lib/clean-text";

export type UserIdentity = {
  name: string;
  color: string;
};

export const CARET_COLORS = [
  "#E57373",
  "#F06292",
  "#BA68C8",
  "#64B5F6",
  "#4DB6AC",
  "#81C784",
  "#FFB74D",
  "#A1887F",
] as const;

const STORAGE_KEY = "tinydocy-user";

/** Longest display name, in user-perceived characters (graphemes). */
export const NAME_MAX_GRAPHEMES = 32;
/** Drawn for a collaborator whose colour is not a `#rrggbb` value. */
export const UNKNOWN_CARET_COLOR = "#9E9E9E";
/** A remote name is cut to this many code units before it is cleaned. */
const REMOTE_NAME_MAX_CODE_UNITS = 1024;

export type NameResult =
  | { ok: true; name: string }
  | { ok: false; error: "empty" | "too_long" };

type CaretColor = (typeof CARET_COLORS)[number];

const ADJECTIVES = [
  "Bold",
  "Brave",
  "Bright",
  "Calm",
  "Clever",
  "Cool",
  "Curious",
  "Daring",
  "Eager",
  "Gentle",
  "Happy",
  "Keen",
  "Kind",
  "Lively",
  "Lucky",
  "Noble",
  "Quick",
  "Sharp",
  "Swift",
  "Wise",
];

const ANIMALS = [
  "Bear",
  "Crane",
  "Dolphin",
  "Eagle",
  "Falcon",
  "Fox",
  "Hawk",
  "Koala",
  "Lion",
  "Lynx",
  "Otter",
  "Owl",
  "Panda",
  "Raven",
  "Robin",
  "Seal",
  "Swan",
  "Tiger",
  "Wolf",
  "Wren",
];

function randomItem<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomName(): string {
  return `${randomItem(ADJECTIVES)} ${randomItem(ANIMALS)}`;
}

function randomIdentity(): UserIdentity {
  return { name: generateRandomName(), color: randomItem(CARET_COLORS) };
}

let segmenter: Intl.Segmenter | null = null;

function graphemes(text: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** Cleans a display name and checks it holds 1–32 graphemes. */
export function normalizeName(raw: unknown): NameResult {
  if (typeof raw !== "string") return { ok: false, error: "empty" };
  const name = cleanText(raw);
  if (name === "") return { ok: false, error: "empty" };
  if (graphemes(name).length > NAME_MAX_GRAPHEMES) {
    return { ok: false, error: "too_long" };
  }
  return { ok: true, name };
}

/**
 * A collaborator's name as drawn on their caret: cleaned and cut to 32
 * graphemes. May return `""`, which renders an empty label.
 */
export function clampRemoteName(raw: string): string {
  const name = cleanText(raw.slice(0, REMOTE_NAME_MAX_CODE_UNITS));
  return graphemes(name).slice(0, NAME_MAX_GRAPHEMES).join("");
}

/** The palette entry matching `raw` (case-insensitive), else `null`. */
export function toCaretColor(raw: unknown): CaretColor | null {
  if (typeof raw !== "string") return null;
  const upper = raw.toUpperCase();
  return CARET_COLORS.find((color) => color === upper) ?? null;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * A collaborator's caret colour: a palette entry in its canonical form, any
 * other `#rrggbb` as sent (so a real caret never disappears), else grey.
 */
export function toRemoteCaretColor(raw: unknown): string {
  const palette = toCaretColor(raw);
  if (palette) return palette;
  return typeof raw === "string" && HEX_COLOR.test(raw)
    ? raw
    : UNKNOWN_CARET_COLOR;
}

/**
 * Parses the stored identity, repairing each invalid field from `fallback`.
 * Never throws.
 */
export function parseStoredIdentity(
  raw: string | null,
  fallback: UserIdentity,
): UserIdentity {
  let parsed: unknown = null;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    /* repaired below */
  }
  const record =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const name = normalizeName(record.name);
  return {
    name: name.ok ? name.name : fallback.name,
    color: toCaretColor(record.color) ?? fallback.color,
  };
}

/**
 * The session's identity when storage is blocked, empty or not writable, so
 * every caller sees the same one. Updated by every successful read and save.
 */
let memory: UserIdentity | null = null;
/**
 * Set while the last write failed (blocked or full storage): storage then
 * holds an older identity than `memory`, so reads return `memory`.
 */
let writeFailed = false;

function sessionIdentity(): UserIdentity {
  memory ??= randomIdentity();
  return memory;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(identity: UserIdentity): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    writeFailed = false;
  } catch {
    // Blocked or full: the in-memory identity lasts for the session.
    writeFailed = true;
  }
}

export function getUserIdentity(): UserIdentity {
  if (typeof window === "undefined") return randomIdentity();

  const fallback = sessionIdentity();
  if (writeFailed) return fallback;
  const raw = readStored();
  if (raw === null) {
    writeStored(fallback);
    return fallback;
  }

  const identity = parseStoredIdentity(raw, fallback);
  if (JSON.stringify(identity) !== raw) writeStored(identity);
  memory = identity;
  return identity;
}

/**
 * Validates and stores the identity. An invalid name is refused and nothing
 * changes; a colour outside the palette keeps the current one. Never throws.
 */
export function saveUserIdentity(identity: UserIdentity): NameResult {
  const result = normalizeName(identity.name);
  if (!result.ok) return result;
  const next: UserIdentity = {
    name: result.name,
    color: toCaretColor(identity.color) ?? sessionIdentity().color,
  };
  memory = next;
  writeStored(next);
  return result;
}
