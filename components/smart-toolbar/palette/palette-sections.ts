/**
 * Builds the palette's groups from the registry (spec §4.4, design pass
 * §8): Recent, Suggested here, Format, Your formats, Insert, Section,
 * View, History. Format opens with Repeat and Paint format; Your formats
 * lists the saved formats by name. An action shown under Suggested here is
 * not repeated in its home group. Disabled entries stay listed with their
 * reason, after the runnable ones of their group. Pure: tested without
 * React. After a format is removed, "Restore ‘X’" leads Suggested here
 * until the next removal or a reload, and shows nowhere else.
 */
import type { Swatch } from "@/components/smart-toolbar/color/swatch";
import type { FormatBundle } from "@/extensions/repeat-formatting/bundle";
import { availability } from "@/lib/editor-actions/registry";
import type {
  ActionGroup,
  AnyAction,
  Ctx,
  IconComponent,
} from "@/lib/editor-actions/types";

export type PaletteHeading =
  | "Recent"
  | "Suggested here"
  | "Format"
  | "Your formats"
  | "Insert"
  | "Section"
  | "View"
  | "History";

export const PALETTE_HEADINGS: readonly PaletteHeading[] = [
  "Recent",
  "Suggested here",
  "Format",
  "Your formats",
  "Insert",
  "Section",
  "View",
  "History",
];

type GroupHeading = Exclude<PaletteHeading, "Recent" | "Suggested here">;

/** A `Record`, so a new `ActionGroup` fails typecheck until it is placed. */
export const PALETTE_GROUP_OF: Readonly<Record<ActionGroup, GroupHeading>> = {
  history: "History",
  style: "Format",
  mark: "Format",
  color: "Format",
  size: "Format",
  list: "Format",
  align: "Format",
  indent: "Format",
  format: "Format",
  table: "Format",
  code: "Format",
  media: "Format",
  insert: "Insert",
  section: "Section",
  view: "View",
  memory: "View",
};

/** The context slot's groups (§4.2): Suggested holds copies of the slot. */
export const SUGGESTED_GROUPS: readonly ActionGroup[] = [
  "section",
  "code",
  "table",
  "media",
];
export const MAX_RECENT = 5;
export const MAX_SUGGESTED = 4;

/** The one id the palette never lists: itself. */
const HIDDEN = "palette.open";
/** First in Format, in this order; the rest keep registry order. */
const FORMAT_FIRST = ["repeat.apply", "repeat.copy"];
const formatRank = (action: AnyAction) => {
  const index = FORMAT_FIRST.indexOf(action.id);
  return index < 0 ? FORMAT_FIRST.length : index;
};
/**
 * Restore ‘X’ (`formats.restore`): offered only, first in Suggested. Its
 * key is no action id, so Recent (`isRecentKey`) never keeps a one-off.
 */
const RESTORE = "formats.restore";
/**
 * Saved formats and saving one, the other `formats.` actions, are the
 * "Your formats" group.
 */
const FORMATS = "formats.";

/**
 * Repeat: its `value()` is the row's second line (what it would apply),
 * and it shows in Suggested whenever it can run, unless what it would
 * apply is plain (`PLAIN_SET_LABEL`: it would strip the formatting).
 */
const REPEAT = "repeat.apply";
/**
 * The action whose `value()` describes its own target, so it belongs in the
 * row's name ("Merge cells"). Others (style, align) return the selection's
 * current state, which would misname every row of the group ("Heading 1:
 * Normal text"; WCAG 2.4.6).
 */
const VALUE_IN_LABEL = "table.mergeOrSplit";
/**
 * Groups whose option labels name themselves ("Orange text"), so the
 * action's label is not repeated before them (design pass §8). So do the
 * saved formats' options: a name, "Restore ‘X’".
 */
const BARE_OPTION_GROUPS: ReadonlySet<ActionGroup> = new Set(["color"]);
/** Groups of mutually exclusive choices: the active row is marked current. */
const CURRENT_GROUPS: ReadonlySet<ActionGroup> = new Set(["style", "align"]);

export interface PaletteItem {
  /** Unique per palette; also what Recent remembers. */
  key: string;
  actionId: string;
  arg?: unknown;
  label: string;
  keywords: string[];
  shortcut?: string;
  disabledReason?: string;
  /** A second line when runnable, such as what Repeat would apply. */
  detail?: string;
  /** The registry icon, for the row's leading slot. */
  icon?: IconComponent;
  /** A colour chip for the leading slot instead (colour rows). */
  swatch?: Swatch;
  /** A saved format's chip for the leading slot (Your formats rows). */
  bundle?: FormatBundle;
  /** The selection already has this choice (style and align groups). */
  current?: true;
}

export interface PaletteSection {
  heading: PaletteHeading;
  items: PaletteItem[];
}

/** The chip of a colour row: `color.text.apply` + "red" → red text. */
function swatchOf(action: AnyAction, token: unknown): Swatch | undefined {
  if (action.group !== "color") return undefined;
  const kind = action.id.startsWith("color.text") ? "text" : "highlight";
  return { kind, token: typeof token === "string" ? token : null } as Swatch;
}

function itemsOf(action: AnyAction, ctx: Ctx): PaletteItem[] {
  const enabled = availability(action, ctx);
  const disabledReason = enabled === true ? undefined : enabled.reason;
  const base = {
    actionId: action.id,
    shortcut: action.shortcut,
    disabledReason,
    icon: action.icon,
  };
  const keywords = [...(action.keywords ?? [])];
  const options = action.options?.(ctx) ?? [];
  const bare =
    BARE_OPTION_GROUPS.has(action.group) || action.id.startsWith(FORMATS);
  if (options.length > 0) {
    return options.map((option) => ({
      ...base,
      key: `${action.id}:${String(option.value)}`,
      arg: option.value,
      label: bare ? option.label : `${action.label}: ${option.label}`,
      keywords: [...keywords, ...(option.keywords ?? [])],
      shortcut: undefined,
      swatch: swatchOf(action, option.value),
      bundle: option.bundle,
    }));
  }
  const value =
    action.id === VALUE_IN_LABEL || action.id === REPEAT
      ? action.value?.(ctx)
      : null;
  const inLabel = value && action.id === VALUE_IN_LABEL;
  const current =
    CURRENT_GROUPS.has(action.group) && action.isActive?.(ctx) === true;
  return [
    {
      ...base,
      key: action.id,
      label: inLabel ? `${action.label}: ${value}` : action.label,
      keywords,
      swatch: swatchOf(action, null),
      ...(value && !inLabel ? { detail: value } : {}),
      ...(current ? { current: true as const } : {}),
    },
  ];
}

/**
 * Runnable entries before unavailable ones (stable), so cmdk's default
 * highlight, the first item, is one Enter can run (spec §6.5).
 */
function runnableFirst(items: PaletteItem[]): PaletteItem[] {
  return [
    ...items.filter((item) => !item.disabledReason),
    ...items.filter((item) => item.disabledReason),
  ];
}

export function buildPaletteSections(input: {
  ctx: Ctx;
  actions: readonly AnyAction[];
  recentKeys: readonly string[];
}): PaletteSection[] {
  const { ctx, actions, recentKeys } = input;
  const byHeading = new Map<PaletteHeading, PaletteItem[]>();
  const all = new Map<string, PaletteItem>();
  const offered: PaletteItem[] = [];
  const ordered = [...actions].sort((a, b) => formatRank(a) - formatRank(b));
  for (const action of ordered) {
    if (action.id === HIDDEN) continue;
    const items = itemsOf(action, ctx);
    if (action.id === RESTORE) {
      if (items[0].arg) offered.unshift({ ...items[0], key: "restore" });
      continue;
    }
    const heading = action.id.startsWith(FORMATS)
      ? "Your formats"
      : PALETTE_GROUP_OF[action.group];
    const list = byHeading.get(heading) ?? [];
    for (const item of items) {
      if (all.has(item.key)) continue;
      all.set(item.key, item);
      list.push(item);
    }
    byHeading.set(heading, list);
    const offeredHere =
      action.contexts !== "any" &&
      action.contexts.includes(ctx.kind) &&
      SUGGESTED_GROUPS.includes(action.group);
    const always =
      action.id === REPEAT &&
      items.some((i) => !i.disabledReason && !i.detail?.startsWith("Plain"));
    if (offeredHere || always) offered.push(...items);
  }
  // Only the runnable ones are worth suggesting; each shows once.
  const suggested = runnableFirst(offered).slice(0, MAX_SUGGESTED);
  const shown = new Set(suggested);
  const recent: PaletteItem[] = [];
  for (const key of recentKeys) {
    const item = all.get(key);
    if (item && !recent.includes(item)) recent.push(item);
    if (recent.length >= MAX_RECENT) break;
  }
  const sections: PaletteSection[] = [];
  const prefixed = (prefix: string, items: PaletteItem[]) =>
    items.map((item) => ({ ...item, key: `${prefix}:${item.key}` }));
  for (const heading of PALETTE_HEADINGS) {
    let items: PaletteItem[];
    if (heading === "Recent") items = prefixed("recent", recent);
    else if (heading === "Suggested here") {
      items = prefixed("suggested", suggested);
    } else {
      items = (byHeading.get(heading) ?? []).filter((i) => !shown.has(i));
    }
    if (items.length > 0)
      sections.push({ heading, items: runnableFirst(items) });
  }
  return sections;
}

/** The item key Recent stores, from a possibly prefixed display key. */
export function recentKeyOf(item: PaletteItem): string {
  return item.key.replace(/^(recent|suggested):/, "");
}
