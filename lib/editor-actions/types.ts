/**
 * The action registry contract (spec §2). Every toolbar surface (row,
 * context slot, ⋯, bubble, phone bar, Aa sheet, Insert, palette) is a view
 * of these actions. Owned by PR D1; see
 * docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md.
 */
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { ComponentType, SVGProps } from "react";

/**
 * Context kinds in precedence order: the snapshot's `kind` is the first
 * that applies (readonly > media/mermaid > code > table > title > heading >
 * list > paragraph). Mermaid is tested before code.
 */
export const CONTEXT_KINDS = [
  "readonly",
  "media",
  "mermaid",
  "code",
  "table",
  "title",
  "heading",
  "list",
  "paragraph",
] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

/** Palette / menu grouping. Never drives row order (the row never reorders). */
export const ACTION_GROUPS = [
  "history",
  "style",
  "mark",
  "color",
  "size",
  "list",
  "align",
  "indent",
  "insert",
  "section",
  "table",
  "code",
  "media",
  "format",
  "view",
  "memory",
] as const;
export type ActionGroup = (typeof ACTION_GROUPS)[number];

/**
 * ProseMirror keymap notation, e.g. `"Mod-b"`, `"Mod-Alt-v"`, `"F4"`,
 * `"Mod-\\"`. Rendered with `formatKeyCombo` and `ariaKeyShortcuts`
 * (`lib/editor-actions/key-combo.ts`).
 */
export type KeyCombo = string;

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** `true`, or why not: rendered as `aria-disabled` + `aria-describedby`. */
export type Enabled = true | { reason: string };

/**
 * Selection snapshot, O(depth) to build. Memoized by store version; never
 * mutated. `memo` caches derived values for the lifetime of the snapshot's
 * `state.doc` (e.g. `can()` results, section lists, code-language counts).
 */
export interface Ctx {
  readonly kind: ContextKind;
  readonly state: EditorState;
  readonly editable: boolean;
  /** Selection is empty (a caret). */
  readonly empty: boolean;
  /** Type name of the selection head's parent node. */
  readonly parentType: string;
  readonly inTable: boolean;
  readonly inList: boolean;
  readonly inBlockquote: boolean;
  readonly inCodeBlock: boolean;
  /** Selection is in the first top-level heading (the document title). */
  readonly isTitle: boolean;
  /** Node type name of a NodeSelection, else null. */
  readonly nodeSelectionType: string | null;
  /** Heading level of the block containing the head, else null. */
  readonly headingLevel: number | null;
  /** `data-toc-id` / UniqueID of that heading, else null. */
  readonly headingId: string | null;
  /** Mark names active across the selection (or stored marks at a caret). */
  readonly activeMarks: ReadonlySet<string>;
  memo<T>(key: string, compute: () => T): T;
}

/** One option of an action with a value argument (submenus, palette rows). */
export interface ActionOption<Arg> {
  value: Arg;
  label: string;
  keywords?: readonly string[];
}

/**
 * One command. `run` is one transaction = one undo step, re-validates its
 * argument at runtime (palette and registry callers pass `unknown`) and
 * returns whether it changed anything. Only a `true` run may write memory.
 */
export interface Action<Arg = undefined> {
  /** `<prefix>.<name>`; the prefix names the owning track (contract §4). */
  readonly id: string;
  readonly label: string;
  readonly group: ActionGroup;
  /** Kinds where the action is offered; `"any"` = everywhere. */
  readonly contexts: readonly ContextKind[] | "any";
  readonly keywords?: readonly string[];
  readonly icon?: IconComponent;
  readonly shortcut?: KeyCombo;
  /** Markdown input hint, e.g. `"**text**"`, `"## "` (#346). */
  readonly markdownHint?: string;
  enabled(ctx: Ctx): Enabled;
  isActive?(ctx: Ctx): boolean;
  isMixed?(ctx: Ctx): boolean;
  /** Visible value for menu buttons (e.g. "Heading 2", "Red", "L"). */
  value?(ctx: Ctx): string | null;
  /** Value choices (colour swatches, table sizes, templates…). */
  options?(ctx: Ctx): readonly ActionOption<Arg>[];
  run(editor: Editor, arg: Arg): boolean;
}

/**
 * Registry element type. Methods are bivariant, so any `Action<Arg>` fits;
 * callers that only hold an id pass `unknown` and the action validates.
 */
export type AnyAction = Action<unknown>;

/**
 * What one control renders. `getView(id)` returns the same object while
 * every field is unchanged, so `useSyncExternalStore` re-renders only the
 * controls whose view changed.
 */
export interface ActionView {
  readonly id: string;
  readonly enabled: Enabled;
  readonly active: boolean;
  readonly mixed: boolean;
  readonly value: string | null;
}

/** Identity helper that keeps `Arg` inferred at the definition site. */
export function defineAction<Arg = undefined>(
  action: Action<Arg>,
): Action<Arg> {
  return action;
}
