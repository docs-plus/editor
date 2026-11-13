import type { Editor } from "@tiptap/core";

import type {
  ActionGroup,
  AnyAction,
  ContextKind,
  Ctx,
} from "@/lib/editor-actions/types";
import { computeContext } from "@/lib/editor-context/snapshot";

export interface ActionFilter {
  group?: ActionGroup;
  /** Keep actions offered in this kind (`contexts` is `"any"` or includes it). */
  context?: ContextKind;
}

export interface ActionRegistry {
  get(id: string): AnyAction | undefined;
  has(id: string): boolean;
  /** Registration order. Only the palette lists; other surfaces use id arrays. */
  list(filter?: ActionFilter): readonly AnyAction[];
}

export function isOfferedIn(action: AnyAction, kind: ContextKind): boolean {
  return action.contexts === "any" || action.contexts.includes(kind);
}

/**
 * Builds an immutable registry. Throws on a duplicate id: two tracks
 * claiming one id is a bug, never something to resolve silently.
 */
export function createRegistry(actions: readonly AnyAction[]): ActionRegistry {
  const byId = new Map<string, AnyAction>();
  for (const action of actions) {
    if (byId.has(action.id)) {
      throw new Error(`Duplicate editor action id: ${action.id}`);
    }
    byId.set(action.id, action);
  }
  const all = Object.freeze([...actions]);
  return {
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    list(filter) {
      if (!filter) return all;
      return all.filter(
        (action) =>
          (!filter.group || action.group === filter.group) &&
          (!filter.context || isOfferedIn(action, filter.context)),
      );
    },
  };
}

/** Whether `action` may run in `ctx`: offered there and `enabled()`. */
export function canRun(action: AnyAction, ctx: Ctx): boolean {
  return isOfferedIn(action, ctx.kind) && action.enabled(ctx) === true;
}

/**
 * Runs an action against the live document (never a held or stale
 * snapshot). Returns false, changing nothing, when it is not offered or
 * not enabled; otherwise returns what `run` returns.
 */
export function runAction(
  editor: Editor,
  action: AnyAction,
  arg?: unknown,
): boolean {
  if (!canRun(action, computeContext(editor))) return false;
  return action.run(editor, arg);
}
