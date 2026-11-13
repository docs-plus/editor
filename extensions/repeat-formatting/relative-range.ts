import type { EditorState, Selection, Transaction } from "@tiptap/pm/state";
import {
  absolutePositionToRelativePosition,
  type ProsemirrorBinding,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import type * as Y from "yjs";

export interface Range {
  anchor: number;
  head: number;
}

/**
 * The Repeat "extend" session range. Collaborative editors keep it as Yjs
 * relative positions, so a remote insert before or inside it never breaks
 * the session; editors without a binding map plain positions through each
 * local transaction instead.
 */
export type SessionRange =
  | { kind: "relative"; anchor: Y.RelativePosition; head: Y.RelativePosition }
  | { kind: "absolute"; anchor: number; head: number };

type Binding = ProsemirrorBinding;

function bindingOf(state: EditorState): Binding | null {
  const binding = ySyncPluginKey.getState(state)?.binding;
  return binding?.type && binding.mapping ? binding : null;
}

export function toSessionRange(
  state: EditorState,
  selection: Selection,
): SessionRange {
  const binding = bindingOf(state);
  if (binding) {
    try {
      return {
        kind: "relative",
        anchor: absolutePositionToRelativePosition(
          selection.anchor,
          binding.type,
          binding.mapping,
        ),
        head: absolutePositionToRelativePosition(
          selection.head,
          binding.type,
          binding.mapping,
        ),
      };
    } catch {
      // Fall through to plain positions (binding not synced yet).
    }
  }
  return { kind: "absolute", anchor: selection.anchor, head: selection.head };
}

export function fromSessionRange(
  state: EditorState,
  range: SessionRange,
): Range | null {
  if (range.kind === "absolute") return range;
  const binding = bindingOf(state);
  if (!binding) return null;
  const anchor = relativePositionToAbsolutePosition(
    binding.doc,
    binding.type,
    range.anchor,
    binding.mapping,
  );
  const head = relativePositionToAbsolutePosition(
    binding.doc,
    binding.type,
    range.head,
    binding.mapping,
  );
  return anchor === null || head === null ? null : { anchor, head };
}

/** Maps an absolute session through a local transaction. */
export function mapSessionRange(
  range: SessionRange,
  tr: Transaction,
): SessionRange {
  if (range.kind === "relative" || !tr.docChanged) return range;
  return {
    kind: "absolute",
    anchor: tr.mapping.map(range.anchor),
    head: tr.mapping.map(range.head),
  };
}

/** Same span regardless of direction; null never matches. */
export function sameRange(range: Range | null, selection: Selection): boolean {
  if (!range) return false;
  return (
    Math.min(range.anchor, range.head) === selection.from &&
    Math.max(range.anchor, range.head) === selection.to
  );
}
