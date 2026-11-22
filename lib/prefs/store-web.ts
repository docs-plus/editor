import {
  type A11yPrefs,
  type BooleanPref,
  type BootStorage,
  LOOK_STORAGE_KEY,
  MAX_UI_PAYLOAD_CHARS,
  type PageKnob,
  type PageKnobs,
  type PageSlot,
  parsePageSlot,
  resolveBoot,
  UI_STORAGE_KEY,
  UI_STORAGE_VERSION,
  type WebPrefs,
  withKnob,
} from "@/lib/prefs/schema";
import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * The web `PrefsStore` (preferences design §5.1, §5.2): the prefs slots of
 * `tinydocy-ui`, resolved exactly as the boot script resolves them. Loaded
 * by the root layout's `PrefsRuntime` and by lazy UI; never by the editor
 * chunk, which reads the `<html>` attributes instead.
 *
 * - This tab's choices win over storage until reload, so blocked storage
 *   or the kill switch still apply a choice for the session (R=0: "ses").
 * - Each write re-reads the key and keeps every other slot (the M6 outline
 *   and A15 density slots live in the same key), in the `{ last, recent }`
 *   entry shape `remembered-choice` reads.
 * - `subscribePrefs` hears this tab's writes and other tabs' `storage`
 *   events.
 */

/** `NEXT_PUBLIC_REMEMBER_CHOICES`: 0 keeps every choice in memory only. */
const REMEMBER = process.env.NEXT_PUBLIC_REMEMBER_CHOICES !== "0";
/** The continue position (M15) that `rememberPlace` gates. */
export const CONTINUE_STORAGE_KEY = "tinydocy-continue";

type Slot = "page" | "a11y" | BooleanPref;

const session: Partial<Record<Slot, unknown>> = {};
const listeners = new Set<() => void>();
let cached: WebPrefs | null = null;

function snapshot(): BootStorage | null {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key !== null) keys.push(key);
    }
    return {
      keys,
      theme: localStorage.getItem(THEME_STORAGE_KEY),
      ui: localStorage.getItem(UI_STORAGE_KEY),
      look: localStorage.getItem(LOOK_STORAGE_KEY),
    };
  } catch {
    return null;
  }
}

function resolve(): WebPrefs {
  const prefs = resolveBoot({
    storage: snapshot(),
    remember: REMEMBER,
    systemDark: false,
  }).prefs;
  const page = parsePageSlot(session.page);
  if (page) prefs.page = page;
  if (session.a11y) prefs.a11y = session.a11y as A11yPrefs;
  for (const name of ["spellcheck", "smartQuotes", "rememberPlace"] as const) {
    if (typeof session[name] === "boolean") prefs[name] = session[name];
  }
  if (!REMEMBER) prefs.rememberPlace = false;
  return prefs;
}

/** The preferences in effect in this tab (cached until the next change). */
export function getPrefs(): WebPrefs {
  cached ??= resolve();
  return cached;
}

function notify(): void {
  cached = null;
  for (const listener of [...listeners]) listener();
}

function onStorage(event: StorageEvent): void {
  if (
    event.key === null ||
    event.key === UI_STORAGE_KEY ||
    event.key === LOOK_STORAGE_KEY
  ) {
    notify();
  }
}

export function subscribePrefs(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    if (listeners.delete(listener) && listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
    }
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Stores one slot, keeping every other slot of the key. */
function writeSlot(slot: Slot, value: unknown): void {
  session[slot] = value;
  if (REMEMBER) {
    try {
      const raw = localStorage.getItem(UI_STORAGE_KEY);
      let slots: Record<string, unknown> = {};
      if (raw && raw.length <= MAX_UI_PAYLOAD_CHARS) {
        const payload: unknown = JSON.parse(raw);
        if (
          isRecord(payload) &&
          payload.v === UI_STORAGE_VERSION &&
          isRecord(payload.slots)
        ) {
          slots = payload.slots;
        }
      }
      const next: Record<string, unknown> = Object.create(null);
      for (const [name, entry] of Object.entries(slots)) {
        if (isRecord(entry)) next[name] = entry;
      }
      next[slot] = { last: value, recent: [] };
      localStorage.setItem(
        UI_STORAGE_KEY,
        JSON.stringify({ v: UI_STORAGE_VERSION, slots: next }),
      );
    } catch {
      // Unreadable or blocked storage: the choice lasts for this tab.
    }
  }
  notify();
}

/** Replaces the page slot (a style and its overrides). */
export function setPage(slot: PageSlot): void {
  writeSlot("page", slot);
}

/** Changes one knob; the first change leaves `classic` for Default. */
export function setPageKnob<K extends PageKnob>(
  knob: K,
  value: PageKnobs[K],
): void {
  setPage(withKnob(getPrefs().page, knob, value));
}

export function setA11y(next: Partial<A11yPrefs>): void {
  writeSlot("a11y", { ...getPrefs().a11y, ...next });
}

/** Turning `rememberPlace` off forgets every stored place (§2.1 row 18). */
export function setBooleanPref(name: BooleanPref, value: boolean): void {
  if (name === "rememberPlace" && !REMEMBER) return;
  writeSlot(name, value);
  if (name === "rememberPlace" && !value) {
    try {
      localStorage.removeItem(CONTINUE_STORAGE_KEY);
    } catch {
      // Nothing could be stored either.
    }
  }
}
