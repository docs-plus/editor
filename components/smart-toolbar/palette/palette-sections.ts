/**
 * Builds the palette's groups from the registry (spec §4.4): Recent,
 * Suggested here, Format, Insert, Section, View. Disabled entries stay
 * listed with their reason. Pure: tested without React.
 */
import { availability } from "@/lib/editor-actions/registry";
import type { ActionGroup, AnyAction, Ctx } from "@/lib/editor-actions/types";

export type PaletteHeading =
  | "Recent"
  | "Suggested here"
  | "Format"
  | "Insert"
  | "Section"
  | "View";

export const PALETTE_HEADINGS: readonly PaletteHeading[] = [
  "Recent",
  "Suggested here",
  "Format",
  "Insert",
  "Section",
  "View",
];

type GroupHeading = Exclude<PaletteHeading, "Recent" | "Suggested here">;

/** A `Record`, so a new `ActionGroup` fails typecheck until it is placed. */
export const PALETTE_GROUP_OF: Readonly<Record<ActionGroup, GroupHeading>> = {
  history: "Format",
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
export const MAX_SUGGESTED = 6;

/** Ids the palette never lists (itself) or lists through a custom flow. */
const HIDDEN_IDS = new Set(["palette.open"]);
/** Shown in Suggested whenever they can run. */
const ALWAYS_SUGGESTED = new Set(["repeat.apply"]);

export interface PaletteItem {
  /** Unique per palette; also what Recent remembers. */
  key: string;
  actionId: string;
  arg?: unknown;
  label: string;
  keywords: string[];
  shortcut?: string;
  disabledReason?: string;
}

export interface PaletteSection {
  heading: PaletteHeading;
  items: PaletteItem[];
}

function itemsOf(action: AnyAction, ctx: Ctx): PaletteItem[] {
  const enabled = availability(action, ctx);
  const disabledReason = enabled === true ? undefined : enabled.reason;
  const base = {
    actionId: action.id,
    shortcut: action.shortcut,
    disabledReason,
  };
  const keywords = [...(action.keywords ?? [])];
  const options = action.options?.(ctx) ?? [];
  if (options.length > 0) {
    return options.map((option) => ({
      ...base,
      key: `${action.id}:${String(option.value)}`,
      arg: option.value,
      label: `${action.label}: ${option.label}`,
      keywords: [...keywords, ...(option.keywords ?? [])],
      shortcut: undefined,
    }));
  }
  const value = action.value?.(ctx);
  return [
    {
      ...base,
      key: action.id,
      label: value ? `${action.label}: ${value}` : action.label,
      keywords,
    },
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
  const suggested: PaletteItem[] = [];
  for (const action of actions) {
    if (HIDDEN_IDS.has(action.id)) continue;
    const items = itemsOf(action, ctx);
    const heading = PALETTE_GROUP_OF[action.group];
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
      ALWAYS_SUGGESTED.has(action.id) && items.some((i) => !i.disabledReason);
    if (offeredHere || always) suggested.push(...items);
  }
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
      items = prefixed("suggested", suggested.slice(0, MAX_SUGGESTED));
    } else items = byHeading.get(heading) ?? [];
    if (items.length > 0) sections.push({ heading, items });
  }
  return sections;
}

/** The item key Recent stores, from a possibly prefixed display key. */
export function recentKeyOf(item: PaletteItem): string {
  return item.key.replace(/^(recent|suggested):/, "");
}
