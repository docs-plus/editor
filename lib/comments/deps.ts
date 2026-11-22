/**
 * What the lazy comments chunk needs from modules the editor chunk already
 * holds (Yjs, y-tiptap, ProseMirror view, the shared helpers), handed over
 * as one object. A module both chunks import is split out of the editor
 * group, which costs it about 1.6 KB gz (contract A16), so the chunk
 * imports these as types only. `extensions/comments/comments-deps.ts`
 * builds the real object; tests build it the same way.
 */
import type { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { EditorState } from "@tiptap/pm/state";
import type {
  DecorationSet,
  Decoration as PMDecoration,
} from "@tiptap/pm/view";
import type {
  absolutePositionToRelativePosition,
  isStructuralTransaction,
  ProsemirrorBinding,
  relativePositionToAbsolutePosition,
} from "@tiptap/y-tiptap";
import type * as Y from "yjs";

import type { changedRanges } from "@/extensions/shared/changed-ranges";

export interface CommentsDeps {
  Y: Pick<
    typeof Y,
    | "createRelativePositionFromTypeIndex"
    | "createAbsolutePositionFromRelativePosition"
    | "encodeRelativePosition"
    | "decodeRelativePosition"
    | "getItem"
  >;
  absolutePositionToRelativePosition: typeof absolutePositionToRelativePosition;
  relativePositionToAbsolutePosition: typeof relativePositionToAbsolutePosition;
  isStructuralTransaction: typeof isStructuralTransaction;
  isChangeOrigin: typeof isChangeOrigin;
  changedRanges: typeof changedRanges;
  /** The y-sync binding of `state`, or `null` before it is ready. */
  syncBinding: (state: EditorState) => AnchorBinding | null;
  inlineDecoration: typeof PMDecoration.inline;
  createDecorationSet: typeof DecorationSet.create;
}

/** The y-sync binding's parts anchors read: its doc, fragment and mapping. */
export type AnchorBinding = Pick<
  ProsemirrorBinding,
  "doc" | "type" | "mapping"
>;
