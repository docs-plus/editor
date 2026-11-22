import type { Editor } from "@tiptap/core";
import type * as Y from "yjs";

import { COMMENTS_DEPS } from "@/extensions/comments/comments-deps";
import { setCommentGate } from "@/lib/editor-actions/comment-actions";
import { getUserIdentity } from "@/lib/user-identity";

import type { CommentsController } from "./comments-controller";

export interface MountCommentsOptions {
  /** The Y.Doc the editor's sync plugin is bound to. */
  doc: Y.Doc;
  /** `canComment()` (`lib/comments/permissions.ts`); read at each write. */
  canComment: () => boolean;
  /** The sharer, or the owner of a Local or library document. */
  canManageAll?: () => boolean;
}

export interface MountedComments {
  /** Loads the chunk and attaches once; `null` after unmount or a failed load. */
  controller(): Promise<CommentsController | null>;
  unmount(): void;
}

/** The root map's name (`COMMENTS_ROOT`), a literal so nothing is shared. */
const ROOT = "comments";

const hasThread = (keys: Iterable<string>) => {
  for (const key of keys) if (key.startsWith("t:")) return true;
  return false;
};

/**
 * Turns comments on for one editor whose document takes them (comments
 * design §6.3: a Local, library or live document; never the web sandbox
 * or the Playground). The host that knows the document's kind and role
 * calls it; nothing on the web does yet, so comments stay dark there.
 *
 * Registers the `comment.add` gate at once. The comments chunk loads when
 * the browser is idle if the document has threads, when the first thread
 * arrives, or on `controller()` (the first Comment command, P4.10); a
 * chunk that fails to load leaves the editor as it was and retries on the
 * next call.
 */
export function mountComments(
  editor: Editor,
  { doc, canComment, canManageAll }: MountCommentsOptions,
): MountedComments {
  const unmarkGate = setCommentGate(editor, canComment);
  const map = doc.getMap(ROOT);
  let attached: CommentsController | null = null;
  let loading: Promise<CommentsController | null> | null = null;
  let unmounted = false;
  let cancelIdle: (() => void) | null = null;
  let observing = false;

  const controller = () => {
    if (unmounted) return Promise.resolve(null);
    loading ??= import("./comments-controller")
      .then(({ attachComments }) => {
        if (unmounted || editor.isDestroyed) return null;
        attached ??= attachComments({
          editor,
          doc,
          deps: COMMENTS_DEPS,
          canComment,
          canManageAll,
          identity: getUserIdentity,
        });
        return attached;
      })
      .catch(() => {
        loading = null;
        return null;
      });
    return loading;
  };

  const stopObserving = () => {
    if (observing) map.unobserve(onFirstThread);
    observing = false;
  };

  const onFirstThread = (event: Y.YMapEvent<unknown>) => {
    if (!hasThread(event.keysChanged)) return;
    stopObserving();
    void controller();
  };

  if (!hasThread(map.keys())) {
    map.observe(onFirstThread);
    observing = true;
  } else if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(() => void controller());
    cancelIdle = () => cancelIdleCallback(id);
  } else {
    const id = window.setTimeout(() => void controller(), 1000);
    cancelIdle = () => window.clearTimeout(id);
  }

  return {
    controller,
    unmount() {
      if (unmounted) return;
      unmounted = true;
      cancelIdle?.();
      stopObserving();
      attached?.destroy();
      unmarkGate();
    },
  };
}
