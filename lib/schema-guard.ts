import type { Editor } from "@tiptap/core";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import type * as Y from "yjs";

import { trackEvent } from "@/lib/analytics";
import { findUnknownSchemaNames, repairKnownMisfit } from "@/lib/schema-repair";

/**
 * - `ok`: the shared document fits the schema (or is not ours to repair).
 * - `outdated`: it names nodes or marks this bundle does not know.
 * - `unrepairable`: a misfit of known names that the repair cannot fix.
 */
export type SchemaGuardState = "ok" | "outdated" | "unrepairable";

type GuardTarget = { editor: Editor; canWrite: () => boolean };

export type SchemaGuard = {
  /** For `ySyncOptions.onInvalidContent`: records, then evaluates later. */
  onInvalidContent(error: Error): void;
  /** Starts evaluating against `editor`; returns the cleanup. */
  bind(target: GuardTarget): () => void;
  getState(): SchemaGuardState;
  subscribe(listener: () => void): () => void;
};

type SchemaGuardOptions = {
  /** Delay before the repair, spread so collaborators rarely race it. */
  repairDelayMs?: () => number;
  onRepairFailed?: () => void;
};

const MAX_REPAIR_DELAY_MS = 500;

function randomRepairDelayMs(): number {
  return Math.random() * MAX_REPAIR_DELAY_MS;
}

function reportRepairFailed(): void {
  console.warn("Schema repair failed: the document stays read-only.");
  trackEvent("schema_repair_failed", {});
}

/**
 * Reacts to y-tiptap freezing the editor on content that does not fit the
 * schema (B1). Unknown names mean a newer bundle wrote them: stay frozen
 * and ask for a reload. A misfit of known names (a paragraph before the
 * title, an emptied fragment) is repaired in Yjs so one raw write cannot
 * lock a document.
 *
 * `onInvalidContent` fires inside the binding's projection (also during
 * plugin-view init), where Yjs writes are swallowed, so it only records and
 * the evaluation runs later, from a timer.
 */
export function createSchemaGuard(
  fragment: Y.XmlFragment,
  {
    repairDelayMs = randomRepairDelayMs,
    onRepairFailed = reportRepairFailed,
  }: SchemaGuardOptions = {},
): SchemaGuard {
  let state: SchemaGuardState = "ok";
  let target: GuardTarget | null = null;
  /** An evaluation was requested; it runs once bound. */
  let pending = false;
  let reportedFailure = false;
  let evaluateTimer: ReturnType<typeof setTimeout> | undefined;
  let recheckTimer: ReturnType<typeof setTimeout> | undefined;
  let watching = false;
  const listeners = new Set<() => void>();

  const binding = () =>
    target && !target.editor.isDestroyed
      ? ySyncPluginKey.getState(target.editor.state)?.binding
      : undefined;

  // Deferred: the binding's own fragment observer may run after this one.
  const onFragmentChange = () => {
    if (recheckTimer) return;
    recheckTimer = setTimeout(() => {
      recheckTimer = undefined;
      if (binding()?.invalidContentError === null) setState("ok");
    }, 0);
  };

  function watch(on: boolean): void {
    if (on === watching) return;
    watching = on;
    if (on) {
      fragment.observeDeep(onFragmentChange);
      return;
    }
    fragment.unobserveDeep(onFragmentChange);
    clearTimeout(recheckTimer);
    recheckTimer = undefined;
  }

  function setState(next: SchemaGuardState): void {
    if (next === state) return;
    state = next;
    watch(next !== "ok");
    for (const listener of listeners) listener();
  }

  /** The state after repairing what can be; null leaves it unchanged. */
  function judge(
    { editor, canWrite }: GuardTarget,
    current: { readonly invalidContentError: Error | null },
  ): SchemaGuardState | null {
    if (current.invalidContentError === null) return "ok";
    if (findUnknownSchemaNames(fragment, editor.schema, 1).length > 0) {
      return "outdated";
    }
    // A refused document shows its own notice and could not sync a repair.
    if (!canWrite()) return null;
    repairKnownMisfit(fragment);
    // A repair can leave the content invalid: trust the binding, not the result.
    return current.invalidContentError === null ? "ok" : "unrepairable";
  }

  function evaluate(): void {
    evaluateTimer = undefined;
    const current = binding();
    if (!target || !current) return;
    pending = false;
    const next = judge(target, current);
    if (next === null) return;
    setState(next);
    if (next !== "unrepairable" || reportedFailure) return;
    reportedFailure = true;
    onRepairFailed();
  }

  function schedule(): void {
    pending = true;
    if (!target || evaluateTimer) return;
    evaluateTimer = setTimeout(evaluate, repairDelayMs());
  }

  return {
    onInvalidContent: () => schedule(),
    bind(next) {
      target = next;
      if (state !== "ok") watch(true);
      if (pending || binding()?.invalidContentError) schedule();
      return () => {
        if (target !== next) return;
        target = null;
        clearTimeout(evaluateTimer);
        evaluateTimer = undefined;
        watch(false);
      };
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
