import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  absolutePositionToRelativePosition,
  isStructuralTransaction,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import {
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromTypeIndex,
  decodeRelativePosition,
  encodeRelativePosition,
  getItem,
} from "yjs";

import { changedRanges } from "@/extensions/shared/changed-ranges";
import type { CommentsDeps } from "@/lib/comments/deps";

/**
 * The real `CommentsDeps`, built on the editor side and handed to the lazy
 * comments chunk, which imports these modules as types only (a shared
 * module would split the editor group, contract A16).
 */
export const COMMENTS_DEPS: CommentsDeps = {
  Y: {
    createAbsolutePositionFromRelativePosition,
    createRelativePositionFromTypeIndex,
    decodeRelativePosition,
    encodeRelativePosition,
    getItem,
  },
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  isStructuralTransaction,
  isChangeOrigin,
  changedRanges,
  syncBinding: (state) => {
    const binding = ySyncPluginKey.getState(state)?.binding;
    return binding?.type && binding.mapping ? binding : null;
  },
  inlineDecoration: Decoration.inline,
  createDecorationSet: DecorationSet.create,
};
