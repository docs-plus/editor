/**
 * Page and writing preferences (preferences design §2.1, §5.2–§5.9): ids,
 * allowlists, defaults and the pure resolvers. No DOM and no React, so the
 * desktop main process, both stores, the boot script generator and tests
 * import it alike. Never imported by the editor chunk: eager editor code
 * reads the `<html>` attributes this module decides instead.
 *
 * Nothing here is ever written to the Y.Doc (details §1 rule 6).
 */

import {
  LOOK_STORAGE_KEY,
  PREFS_VERSION,
  UI_STORAGE_KEY,
} from "@/lib/prefs/keys";
import {
  LEGACY_KEY_PREFIX,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

export {
  LOOK_STORAGE_KEY,
  PREFS_VERSION,
  UI_STORAGE_KEY,
} from "@/lib/prefs/keys";
export const LOOK_MARKERS = ["classic", "new"] as const;
export type LookMarker = (typeof LOOK_MARKERS)[number];

/** Payloads larger than this are ignored unread (as `remembered-choice`). */
export const MAX_UI_PAYLOAD_CHARS = 64 * 1024;

/** Owner Q1: 14–32 px, default 16, applied in rem of the browser's size. */
export const TEXT_SIZES = [14, 16, 18, 20, 24, 28, 32] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
/** What the stepper shows in `classic` (today's paragraph size). */
export const CLASSIC_TEXT_SIZE = 15;

/** Line lengths in em of the text size; Full keeps text to 46 em. */
export const PAGE_WIDTHS = ["narrow", "standard", "wide", "full"] as const;
export type PageWidth = (typeof PAGE_WIDTHS)[number];
export const PAGE_MEASURES: Readonly<Record<PageWidth, number | null>> = {
  narrow: 30,
  standard: 33,
  wide: 46,
  full: null,
};
export const FULL_TEXT_MEASURE = 46;

export const SPACINGS = ["compact", "normal", "relaxed"] as const;
export type Spacing = (typeof SPACINGS)[number];

/** The knobs one style sets. P2.9c-2 adds font and letter spacing. */
export interface PageKnobs {
  size: TextSize;
  width: PageWidth;
  spacing: Spacing;
}
export type PageKnob = keyof PageKnobs;

/** P2.9c-2 adds Comfortable reading, Compact and High legibility. */
export const PAGE_STYLES = {
  default: { size: 16, width: "standard", spacing: "normal" },
} as const satisfies Record<string, PageKnobs>;
export type PageStyleId = keyof typeof PAGE_STYLES;
export const PAGE_STYLE_IDS = Object.keys(PAGE_STYLES) as PageStyleId[];

/**
 * The stored page slot: a style plus only the knobs that differ from it.
 * "Custom" is derived (any override); a future build can retune a style
 * without rewriting anyone's storage.
 */
export type PageSlot = { style: PageStyleId } & Partial<PageKnobs>;

/**
 * What a document looks like. `classic` is today's exact look, kept for
 * sandbox browsers that used TinyDocy before (§5.6). It is never stored and
 * never a fifth style: the first change leaves it for Default.
 */
export type PageState = PageSlot | { style: "classic" };

export const CONTRASTS = ["system", "more"] as const;
export type Contrast = (typeof CONTRASTS)[number];
export const MOTIONS = ["system", "reduce"] as const;
export type Motion = (typeof MOTIONS)[number];
export interface A11yPrefs {
  contrast: Contrast;
  motion: Motion;
}

/** Everything the web applies, after storage, fallbacks and the kill switch. */
export interface WebPrefs {
  page: PageState;
  a11y: A11yPrefs;
  spellcheck: boolean;
  smartQuotes: boolean;
  rememberPlace: boolean;
}

export const BOOLEAN_PREFS = [
  "spellcheck",
  "smartQuotes",
  "rememberPlace",
] as const;
export type BooleanPref = (typeof BOOLEAN_PREFS)[number];

export const PREF_DEFAULTS: Omit<WebPrefs, "page"> = {
  a11y: { contrast: "system", motion: "system" },
  spellcheck: true,
  smartQuotes: true,
  rememberPlace: true,
};

/** `tinydocy-ui` slots this module owns (each listed in `CHOICE_SLOTS`). */
export const PREF_SLOTS = ["page", "a11y", ...BOOLEAN_PREFS] as const;

/** Every `<html>` attribute the boot script and `applyPrefs` manage. */
export const PREF_ATTRIBUTES = [
  "data-page-style",
  "data-text-size",
  "data-page-width",
  "data-spacing",
  "data-contrast",
  "data-motion",
  "data-smart-quotes",
  "spellcheck",
  "data-prefs",
] as const;
export type PrefAttributes = Partial<
  Record<(typeof PREF_ATTRIBUTES)[number], string>
>;

/** The docked outline (270 px) plus its 32 px gutter, from `toc-sidebar.scss`. */
export const OUTLINE_DOCK_EXTRA_PX = 302;
/** The card's 3 rem padding on each side. */
export const CARD_PADDING_REM = 6;
/** Today's card, kept by `classic`: 648 + 302 docks at 950 px, as before. */
export const CLASSIC_CARD_PX = 648;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const oneOf =
  <T>(list: readonly T[]) =>
  (value: unknown): value is T =>
    list.includes(value as T);

export const isTextSize = oneOf(TEXT_SIZES);
export const isPageWidth = oneOf(PAGE_WIDTHS);
export const isSpacing = oneOf(SPACINGS);
export const isPageStyleId = oneOf(PAGE_STYLE_IDS);
const isContrast = oneOf(CONTRASTS);
const isMotion = oneOf(MOTIONS);
const isLookMarker = oneOf(LOOK_MARKERS);
const isThemePreference = oneOf(THEME_PREFERENCES);

const KNOB_CHECKS: { [K in PageKnob]: (value: unknown) => boolean } = {
  size: isTextSize,
  width: isPageWidth,
  spacing: isSpacing,
};
const KNOBS = Object.keys(KNOB_CHECKS) as PageKnob[];

/** A stored page slot, or null when its style is unknown. Bad knobs drop. */
export function parsePageSlot(value: unknown): PageSlot | null {
  if (!isRecord(value) || !isPageStyleId(value.style)) return null;
  const slot: Record<string, unknown> = { style: value.style };
  for (const knob of KNOBS) {
    if (KNOB_CHECKS[knob](value[knob])) slot[knob] = value[knob];
  }
  return slot as PageSlot;
}

/** Each field checked on its own; anything invalid reads its default. */
export function parseA11y(value: unknown): A11yPrefs {
  const record = isRecord(value) ? value : {};
  return {
    contrast: isContrast(record.contrast)
      ? record.contrast
      : PREF_DEFAULTS.a11y.contrast,
    motion: isMotion(record.motion) ? record.motion : PREF_DEFAULTS.a11y.motion,
  };
}

/** The `last` values of a `tinydocy-ui` payload (own properties only). */
export function parseUiSlots(raw: string | null): Record<string, unknown> {
  if (!raw || raw.length > MAX_UI_PAYLOAD_CHARS) return {};
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(payload) || payload.v !== PREFS_VERSION) return {};
  if (!isRecord(payload.slots)) return {};
  const values: Record<string, unknown> = {};
  for (const slot of PREF_SLOTS) {
    const entry = Object.hasOwn(payload.slots, slot)
      ? payload.slots[slot]
      : undefined;
    if (isRecord(entry) && Object.hasOwn(entry, "last")) {
      values[slot] = entry.last;
    }
  }
  return values;
}

/** §5.6: a browser that used TinyDocy before keeps today's look. */
export function fallbackPage(marker: LookMarker): PageState {
  return marker === "classic" ? { style: "classic" } : { style: "default" };
}

/** The knobs in effect, or null in `classic`. */
export function effectivePage(page: PageState): PageKnobs | null {
  if (page.style === "classic") return null;
  const { style, ...overrides } = page;
  return { ...PAGE_STYLES[style], ...overrides };
}

/**
 * The slot after one knob changes. Leaving `classic` starts from Default;
 * a value equal to the style's own drops the override.
 */
export function withKnob<K extends PageKnob>(
  page: PageState,
  knob: K,
  value: PageKnobs[K],
): PageSlot {
  const { style, ...knobs }: PageSlot =
    page.style === "classic" ? { style: "default" } : page;
  const overrides: Partial<PageKnobs> = knobs;
  if (PAGE_STYLES[style][knob] === value) delete overrides[knob];
  else overrides[knob] = value;
  return { style, ...overrides };
}

/** The next ladder step up or down; `classic` steps from 15 (to 16 or 14). */
export function stepTextSize(page: PageState, direction: 1 | -1): TextSize {
  const current = effectivePage(page)?.size ?? CLASSIC_TEXT_SIZE;
  const steps = direction > 0 ? TEXT_SIZES : [...TEXT_SIZES].reverse();
  return (
    steps.find((size) => (direction > 0 ? size > current : size < current)) ??
    steps[steps.length - 1]
  );
}

/** The `<html>` attributes for these preferences (absent = not set). */
export function prefsAttributes(prefs: WebPrefs): PrefAttributes {
  const { page } = prefs;
  const attributes: PrefAttributes = { "data-page-style": page.style };
  if (page.style !== "classic") {
    if (page.size !== undefined)
      attributes["data-text-size"] = String(page.size);
    if (page.width !== undefined) attributes["data-page-width"] = page.width;
    if (page.spacing !== undefined) attributes["data-spacing"] = page.spacing;
  }
  if (prefs.a11y.contrast === "more") attributes["data-contrast"] = "more";
  if (prefs.a11y.motion === "reduce") attributes["data-motion"] = "reduce";
  if (!prefs.smartQuotes) attributes["data-smart-quotes"] = "off";
  if (!prefs.spellcheck) attributes.spellcheck = "false";
  attributes["data-prefs"] = "1";
  return attributes;
}

/**
 * The page card's width in CSS px, computed from preferences, never
 * measured, so nothing changes on its own (§5.9). Null for Full.
 * `rootPx` is the root font size (the browser's default text size).
 */
export function cardWidthPx(page: PageState, rootPx = 16): number | null {
  const knobs = effectivePage(page);
  if (!knobs) return CLASSIC_CARD_PX;
  const measure = PAGE_MEASURES[knobs.width];
  if (measure === null) return null;
  return (measure * knobs.size * rootPx) / 16 + CARD_PADDING_REM * rootPx;
}

/** The narrowest main area that docks the outline; Full never docks. */
export function outlineDockMinPx(page: PageState, rootPx = 16): number {
  const card = cardWidthPx(page, rootPx);
  return card === null
    ? Number.POSITIVE_INFINITY
    : card + OUTLINE_DOCK_EXTRA_PX;
}

/** What the boot script reads, taken in one snapshot before any write. */
export interface BootStorage {
  keys: readonly string[];
  theme: string | null;
  ui: string | null;
  look: string | null;
}

export interface BootInput {
  /** Null when storage is blocked. */
  storage: BootStorage | null;
  /** `NEXT_PUBLIC_REMEMBER_CHOICES !== "0"`. */
  remember: boolean;
  /** `(prefers-color-scheme: dark)` matches. */
  systemDark: boolean;
}

export interface BootResult {
  theme: ThemePreference;
  dark: boolean;
  prefs: WebPrefs;
  attributes: PrefAttributes;
  /** The only boot-time writes (§5.6), made in the same task. */
  writes: Partial<Record<string, string>>;
}

/**
 * Everything the boot script decides, as data (§5.3, §5.6). The inline
 * string in `boot-script.ts` must produce exactly this; the parity test
 * runs both over the same table.
 * - The theme and the look marker are decided from one snapshot, so a new
 *   visitor's own theme write never makes them look like a returning one.
 * - Blocked storage follows the OS theme and keeps today's look.
 * - The kill switch shows `classic` every load and ignores the slots.
 */
export function resolveBoot({
  storage,
  remember,
  systemDark,
}: BootInput): BootResult {
  const writes: BootResult["writes"] = {};
  let theme: ThemePreference = "system";
  let marker: LookMarker = "classic";
  let slots: Record<string, unknown> = {};
  if (storage) {
    const used = (except: string) =>
      storage.keys.some(
        (key) => key !== except && key.startsWith(LEGACY_KEY_PREFIX),
      );
    if (isThemePreference(storage.theme)) theme = storage.theme;
    else {
      theme = used(THEME_STORAGE_KEY) ? "light" : "system";
      writes[THEME_STORAGE_KEY] = theme;
    }
    if (isLookMarker(storage.look)) marker = storage.look;
    else {
      marker = used(LOOK_STORAGE_KEY) ? "classic" : "new";
      if (remember) writes[LOOK_STORAGE_KEY] = marker;
    }
    if (remember) slots = parseUiSlots(storage.ui);
  }
  const prefs = parsePrefs(slots, remember ? marker : "classic");
  // The kill switch forces the continue position off, as before (C10).
  if (!remember) prefs.rememberPlace = false;
  return {
    theme,
    dark: theme === "dark" || (theme === "system" && systemDark),
    prefs,
    attributes: prefsAttributes(prefs),
    writes,
  };
}

/**
 * The one validator for stored preference values, shared by every store:
 * the web store passes the `tinydocy-ui` slots' `last` values, and desktop
 * main will pass its `meta('prefs')` JSON (the same fields at the top
 * level, beside `v`; a newer `v` is read field by field, `keys.ts`).
 * Unknown fields are ignored; an invalid value reads
 * its default; a missing page falls back by the look marker (desktop and
 * the library are new installs, so `new`).
 */
export function parsePrefs(
  record: unknown,
  marker: LookMarker = "new",
): WebPrefs {
  const values: Record<string, unknown> = isRecord(record) ? record : {};
  const bool = (name: BooleanPref) =>
    typeof values[name] === "boolean"
      ? (values[name] as boolean)
      : PREF_DEFAULTS[name];
  return {
    page: parsePageSlot(values.page) ?? fallbackPage(marker),
    a11y: parseA11y(values.a11y),
    spellcheck: bool("spellcheck"),
    smartQuotes: bool("smartQuotes"),
    rememberPlace: bool("rememberPlace"),
  };
}
