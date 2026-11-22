/**
 * The lazy half of `mountComments` (`comments-loader.ts`): a small chunk
 * that decides when the comments controller loads and resolves this
 * browser's author id for the document. Like the controller, it imports
 * the editor chunk's modules as types only; what it needs at runtime comes
 * from the loader (contract A16).
 */
import type { Editor } from "@tiptap/core";
import type * as Y from "yjs";

import { authorIdFor } from "@/lib/comments/author-id";
import type { CommentsDeps } from "@/lib/comments/deps";
import { COMMENTS_ROOT } from "@/lib/comments/model";

import type {
  CommentIdentity,
  CommentsController,
} from "./comments-controller";

export interface MountCommentsOptions {
  /** The Y.Doc the editor's sync plugin is bound to. */
  doc: Y.Doc;
  /**
   * The document's frozen lineage (desktop `docs.lineage`, or a share's):
   * keys this browser's author id in it (SEC-002).
   */
  lineage: string;
  /** `canComment()` (`lib/comments/permissions.ts`); read at each write. */
  canComment: () => boolean;
  /** The sharer, or the owner of a Local or library document. */
  canManageAll?: () => boolean;
}

/** What the eager loader hands over: built in the editor chunk. */
export interface CommentsHostInput {
  deps: CommentsDeps;
  /** `getUserIdentity()`: this window's name and colour. */
  identity: () => Omit<CommentIdentity, "id">;
}

export interface CommentsHost {
  /** Loads the controller and attaches once; `null` after unmount or a failed load. */
  controller(): Promise<CommentsController | null>;
  unmount(): void;
}

const hasThread = (keys: Iterable<string>) => {
  for (const key of keys) if (key.startsWith("t:")) return true;
  return false;
};

/**
 * Loads the controller when the browser is idle if the document has
 * threads, when the first thread arrives, or on `controller()` (the first
 * Comment command, P4.10). A chunk that fails to load leaves the editor as
 * it was and retries on the next call.
 */
export function hostComments(
  editor: Editor,
  { doc, lineage, canComment, canManageAll }: MountCommentsOptions,
  { deps, identity }: CommentsHostInput,
): CommentsHost {
  const map = doc.getMap(COMMENTS_ROOT);
  let attached: CommentsController | null = null;
  let loading: Promise<CommentsController | null> | null = null;
  let unmounted = false;
  let cancelIdle: (() => void) | null = null;
  let observing = false;

  const controller = () => {
    if (unmounted) return Promise.resolve(null);
    loading ??= Promise.all([
      import("./comments-controller"),
      // Once per mount: the store reads the id synchronously at each write.
      authorIdFor(lineage),
    ])
      .then(([{ attachComments }, id]) => {
        if (unmounted || editor.isDestroyed) return null;
        attached ??= attachComments({
          editor,
          doc,
          deps,
          canComment,
          canManageAll,
          identity: () => ({ ...identity(), id }),
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
    // Within a second even on a busy main thread (the fallback's delay).
    const id = requestIdleCallback(() => void controller(), { timeout: 1000 });
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
    },
  };
}
