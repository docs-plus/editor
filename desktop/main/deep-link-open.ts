/**
 * Opening a document from `tinydocy://local/<uuid>` (SEC-005; architecture
 * §6.2). Electron-free; `index.ts` passes the window and storage functions.
 *
 * 1. A window already holds it: focus that window.
 * 2. Throttle the existence checks themselves (`DEEP_LINK_PROBES` per
 *    `DEEP_LINK_WINDOW_MS`), so a flood of links to unknown ids can't keep
 *    the storage worker busy (N4). Then ask storage, read-only, whether the
 *    document exists. Unknown, or the library can't answer: open nothing.
 * 3. Throttle: at most `DEEP_LINK_WINDOWS` new windows per
 *    `DEEP_LINK_WINDOW_MS` from links, so a flood of links can't open
 *    windows without end.
 * 4. Open the window and claim the document for it. If another window took
 *    it while storage answered, focus that one and discard the new window.
 */

import type { FixedWindowLimiter } from "./rate-limit";
import type { OpenDocRegistry } from "./registry";

export const DEEP_LINK_WINDOWS = 5;
/** Existence checks allowed per window of time (N4). */
export const DEEP_LINK_PROBES = 20;
export const DEEP_LINK_WINDOW_MS = 10_000;

export type DocExists = "yes" | "no" | "unknown";

export type DeepLinkOutcome =
  | "focused"
  | "opened"
  | "unknown_doc"
  | "unverified"
  | "throttled";

export type DeepLinkDeps = {
  registry: OpenDocRegistry;
  isOurs: (windowId: number) => boolean;
  focus: (windowId: number) => void;
  create: (docId: string) => { id: number };
  discard: (windowId: number) => void;
  docExists: (docId: string) => Promise<DocExists>;
  /** Before the storage check (N4). */
  probeLimiter: FixedWindowLimiter;
  /** Before a new window. */
  limiter: FixedWindowLimiter;
  log: (event: string, fields?: Record<string, number>) => void;
};

function focusHolder(docId: string, deps: DeepLinkDeps): boolean {
  const holder = deps.registry.holder(docId);
  if (holder === undefined || !deps.isOurs(holder)) return false;
  deps.log("open_focused_existing", { window: holder });
  deps.focus(holder);
  return true;
}

export async function openDocFromLink(
  docId: string,
  deps: DeepLinkDeps,
): Promise<DeepLinkOutcome> {
  if (focusHolder(docId, deps)) return "focused";

  const probe = deps.probeLimiter.take("deep_link_probe");
  if (probe !== "ok") {
    if (probe === "first_drop") deps.log("deep_link_throttled");
    return "throttled";
  }
  const exists = await deps.docExists(docId);
  if (exists === "no") {
    deps.log("deep_link_unknown_doc");
    return "unknown_doc";
  }
  if (exists === "unknown") {
    deps.log("deep_link_unverified");
    return "unverified";
  }
  // Storage answered asynchronously: another window may have opened it.
  if (focusHolder(docId, deps)) return "focused";

  const verdict = deps.limiter.take("deep_link");
  if (verdict !== "ok") {
    if (verdict === "first_drop") deps.log("deep_link_throttled");
    return "throttled";
  }

  const window = deps.create(docId);
  const claim = deps.registry.claim(docId, window.id);
  if (!claim.ok) {
    deps.discard(window.id);
    deps.log("open_focused_existing", { window: claim.holder });
    deps.focus(claim.holder);
    return "focused";
  }
  return "opened";
}
