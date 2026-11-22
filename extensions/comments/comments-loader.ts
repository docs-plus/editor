import type { Editor } from "@tiptap/core";

import { COMMENTS_DEPS } from "@/extensions/comments/comments-deps";
import { setCommentGate } from "@/lib/editor-actions/comment-actions";
import { getUserIdentity } from "@/lib/user-identity";

import type { CommentsController } from "./comments-controller";
import type { CommentsHost, MountCommentsOptions } from "./comments-host";

export type { MountCommentsOptions } from "./comments-host";

export interface MountedComments {
  /** Loads the chunk and attaches once; `null` after unmount or a failed load. */
  controller(): Promise<CommentsController | null>;
  unmount(): void;
}

/**
 * Turns comments on for one editor whose document takes them (comments
 * design §6.3: a Local, library or live document; never the web sandbox
 * or the Playground). The host that knows the document's kind, role and
 * lineage calls it; nothing on the web does yet, so comments stay dark.
 *
 * Only this part is in the editor chunk: the `comment.add` gate, which
 * registers at once, and the deps the lazy chunks get from it. The rest
 * (`comments-host.ts`: when to load the controller, the author id) is a
 * small lazy chunk fetched here; it loads the controller as before.
 */
export function mountComments(
  editor: Editor,
  options: MountCommentsOptions,
): MountedComments {
  const unmarkGate = setCommentGate(editor, options.canComment);
  let host: Promise<CommentsHost | null> | null = null;
  let unmounted = false;
  const load = () =>
    (host ??= import("./comments-host").then(
      ({ hostComments }) =>
        unmounted
          ? null
          : hostComments(editor, options, {
              deps: COMMENTS_DEPS,
              identity: getUserIdentity,
            }),
      // Retried by the next `controller()`.
      () => (host = null),
    ));
  void load();
  return {
    controller: async () =>
      unmounted ? null : ((await load())?.controller() ?? null),
    unmount() {
      if (unmounted) return;
      unmounted = true;
      unmarkGate();
      void host?.then((mounted) => mounted?.unmount());
    },
  };
}
