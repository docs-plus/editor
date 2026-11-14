/**
 * The "/" menu's rows (lazy chunk): one more view of the action registry
 * (spec §2), so it adds no command of its own. Pure: the menu passes the
 * snapshot, the registry's actions and the remembered table size.
 *
 * Import rule: types, the registry gate and icons only. Never
 * `components/**` or the palette (its first Alt+/ has no room, A7).
 */
import { availability } from "@/lib/editor-actions/registry";
import type {
  ActionOption,
  AnyAction,
  Ctx,
  IconComponent,
} from "@/lib/editor-actions/types";
import {
  ArrowRightLeftIcon,
  BrainIcon,
  ChartPieIcon,
  CircleDotIcon,
  NetworkIcon,
  TypeIcon,
} from "@/lib/icons";
import type { TableSize } from "@/lib/remembered-choice";

export type SlashSection = "Text" | "Lists" | "Insert" | "Diagrams";

export interface SlashItem {
  /** `actionId`, or `actionId:<option value>` for a template. */
  key: string;
  actionId: string;
  arg?: unknown;
  label: string;
  /** Matched instead of `label` ("Sequence" for "Sequence diagram"). */
  name?: string;
  /** Leads its ties (the last used template, design pass §9). */
  lead?: boolean;
  keywords: readonly string[];
  /** The Markdown shortcut, trimmed ("##", ">"). */
  hint?: string;
  /** A short note after the label ("4 × 2", "Last used"). */
  note?: string;
  icon?: IconComponent;
  section: SlashSection;
  /** Listed only for a typed query (Heading 4–6 stay out of the first view). */
  searchOnly?: boolean;
  /** Why it cannot run here. Such items are never rows; see `slashEmptyNote`. */
  reason?: string;
}

const SECTION_OF: Readonly<Record<string, SlashSection>> = {
  style: "Text",
  list: "Lists",
};

/** Words people type for blocks whose registry entry has no keywords. */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  "style.paragraph": ["text", "paragraph", "plain", "body"],
  "list.bullet": ["bulleted", "unordered", "ul"],
  "list.ordered": ["ordered", "ol"],
  "list.task": ["todo", "to-do", "checklist", "checkbox"],
};

/** The Diagram ▸ submenu's icons (design pass §9). */
const TEMPLATE_ICON: Readonly<Record<string, IconComponent>> = {
  flowchart: NetworkIcon,
  sequence: ArrowRightLeftIcon,
  state: CircleDotIcon,
  mindmap: BrainIcon,
  pie: ChartPieIcon,
};

/** Outside the submenu, a bare "Sequence" or "State" says too little. */
const TEMPLATE_LABEL: Readonly<Record<string, string>> = {
  sequence: "Sequence diagram",
  state: "State diagram",
};

const DIAGRAM_KEYWORDS = ["diagram", "mermaid", "chart"];

/** Only H1–H3 in the unfiltered list, so Lists and Insert show at once. */
const SEARCH_ONLY = /^style\.heading[4-6]$/;

function aliases(action: AnyAction): readonly string[] {
  const level = /^style\.heading(\d)$/.exec(action.id)?.[1];
  return level ? [`h${level}`] : (ALIASES[action.id] ?? []);
}

function actionItem(
  action: AnyAction,
  section: SlashSection,
  extra?: Partial<SlashItem>,
): SlashItem {
  return {
    key: action.id,
    actionId: action.id,
    label: action.label,
    keywords: [...(action.keywords ?? []), ...aliases(action)],
    hint: action.markdownHint?.trim() || undefined,
    icon:
      action.icon ?? (action.id === "style.paragraph" ? TypeIcon : undefined),
    section,
    ...extra,
  };
}

function templateItem(
  action: AnyAction,
  option: ActionOption<unknown>,
): SlashItem {
  const id = String(option.value);
  return {
    key: `${action.id}:${id}`,
    actionId: action.id,
    arg: option.value,
    label: TEMPLATE_LABEL[id] ?? option.label,
    // All five tie on "/dia"; the last used one leads.
    name: option.label,
    lead: Boolean(option.note) || undefined,
    keywords: [...(option.keywords ?? []), ...DIAGRAM_KEYWORDS],
    note: option.note,
    icon: TEMPLATE_ICON[id],
    section: "Diagrams",
  };
}

/**
 * Text styles, lists and Insert kinds, in registry order. Those that
 * cannot run here carry their `reason` and are never rows (the menu is
 * short and bound to the caret; the palette and the row list them with
 * their reasons): a query that matches only them says why
 * (`slashEmptyNote`). As in the Insert menu's Diagram ▸ submenu,
 * Diagram is either one row (before E's engine lists the templates) or
 * the templates, never both.
 */
export function buildSlashItems(
  ctx: Ctx,
  actions: readonly AnyAction[],
  tableSize: TableSize,
): SlashItem[] {
  const reason = (action: AnyAction) => {
    const enabled = availability(action, ctx);
    return enabled === true ? undefined : enabled.reason;
  };
  const template = actions.find((action) => action.id === "template.mermaid");
  const templates =
    template && !reason(template) ? (template.options?.(ctx) ?? []) : [];
  const items: SlashItem[] = [];
  const diagrams: SlashItem[] = [];
  for (const action of actions) {
    const section =
      SECTION_OF[action.group] ??
      (action.id.startsWith("insert.") ? "Insert" : null);
    if (!section) continue;
    if (template && action.id === "insert.mermaid" && templates.length) {
      diagrams.push(
        ...templates.map((option) => templateItem(template, option)),
      );
      continue;
    }
    items.push(
      actionItem(action, section, {
        reason: reason(action),
        searchOnly: SEARCH_ONLY.test(action.id) || undefined,
        ...(action.id === "insert.table"
          ? { arg: tableSize, note: `${tableSize.rows} × ${tableSize.cols}` }
          : {}),
      }),
    );
  }
  return [...items, ...diagrams];
}

const words = (text: string) => text.split(/\s+/);

/** Every query word is a prefix of some word of `text`. */
const wordPrefixes = (text: string, tokens: readonly string[]) => {
  const own = words(text);
  return tokens.every((token) => own.some((word) => word.startsWith(token)));
};

/** 0 label prefix, 1 label words, 2 keyword, 3 Markdown hint; -1 none. */
function rank(item: SlashItem, query: string, tokens: string[]): number {
  const label = (item.name ?? item.label).toLowerCase();
  if (label.startsWith(query)) return 0;
  if (wordPrefixes(label, tokens)) return 1;
  const keyword = item.keywords.some((value) => {
    const lower = value.toLowerCase();
    return lower.startsWith(query) || wordPrefixes(lower, tokens);
  });
  if (keyword) return 2;
  return item.hint?.startsWith(query) ? 3 : -1;
}

/**
 * Case-insensitive word-prefix match over labels, keywords and Markdown
 * hints, among the items that can run here. The best match leads; each
 * section stays together (in the order its best match ranks), so every
 * section heading shows once, and ↑ ↓ walk the rows as they are drawn.
 * An empty query keeps all but the `searchOnly` ones. Typography turns
 * a typed "--" into "—", so "/---" still finds Divider.
 */
export function matchSlashItems(
  items: readonly SlashItem[],
  query: string,
  { hidden = false }: { hidden?: boolean } = {},
): SlashItem[] {
  const pool = items.filter((item) => !item.reason !== hidden);
  const q = query.trim().toLowerCase().replaceAll("—", "--");
  if (!q) return pool.filter((item) => !item.searchOnly);
  const tokens = words(q);
  const ranked = pool
    .map((item, index) => ({ item, index, rank: rank(item, q, tokens) }))
    .filter((entry) => entry.rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(Boolean(b.item.lead)) - Number(Boolean(a.item.lead)) ||
        a.index - b.index,
    )
    .map((entry) => entry.item);
  const order = new Map<SlashSection, number>();
  for (const item of ranked) {
    if (!order.has(item.section)) order.set(item.section, order.size);
  }
  return ranked.sort(
    (a, b) => (order.get(a.section) ?? 0) - (order.get(b.section) ?? 0),
  );
}

/**
 * With no row matching `query`: why the best match that cannot run here
 * can't ("Quote: Already in a quote."), else "No matching blocks".
 */
export function slashEmptyNote(
  items: readonly SlashItem[],
  query: string,
): string {
  const [best] = query.trim()
    ? matchSlashItems(items, query, { hidden: true })
    : [];
  return best ? `${best.label}: ${best.reason}` : "No matching blocks";
}
