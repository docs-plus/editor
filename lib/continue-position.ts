import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/**
 * "Continue where you left off" (spec M15), lazy chunk only. Remembers,
 * per document and on this device only, the section the writer's caret was
 * in: the section heading's `data-toc-id`, a random id the document already
 * carries, never its text. Never Yjs, the server, URLs or analytics.
 *
 * Not in `STORAGE_KEYS` (pinned by the contract test), like the folds'
 * `tinydocy-folds-<id>`. View state, so "Forget my choices" keeps it. Every
 * storage call sits in try/catch and every read re-validates.
 *
 * Imports nothing from the editor chunk: a module both chunks import is
 * split out of the editor group and costs it bytes (the contract's continue
 * amendment).
 */

export const CONTINUE_STORAGE_KEY = "tinydocy-continue";
export const CONTINUE_MAX_DOCS = 30;
export const CONTINUE_MAX_AGE_DAYS = 14;
/** Sections whose heading is one of the first top-level blocks are skipped. */
export const CONTINUE_MIN_BLOCK = 3;

const VERSION = 1;
const MAX_AGE_MS = CONTINUE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const MAX_PAYLOAD_CHARS = 16 * 1024;
const MAX_ID_LENGTH = 64;

/** `REMEMBER_CHOICES_ENABLED`, read here so this chunk skips its module. */
const ENABLED = process.env.NEXT_PUBLIC_REMEMBER_CHOICES !== "0";

export interface ContinueEntry {
  /** The section heading's `data-toc-id`. */
  id: string;
  /** When it was recorded (epoch ms). */
  at: number;
}

type Entries = Map<string, ContinueEntry>;

function isEntry(value: unknown): value is ContinueEntry {
  if (typeof value !== "object" || value === null) return false;
  const { id, at } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= MAX_ID_LENGTH &&
    typeof at === "number" &&
    Number.isFinite(at)
  );
}

/** The stored entries younger than 14 days; anything malformed is dropped. */
function load(now: number): Entries {
  const entries: Entries = new Map();
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(CONTINUE_STORAGE_KEY);
    if (!raw || raw.length > MAX_PAYLOAD_CHARS) return entries;
    parsed = JSON.parse(raw);
  } catch {
    return entries;
  }
  if (typeof parsed !== "object" || parsed === null) return entries;
  const { v, docs } = parsed as Record<string, unknown>;
  if (v !== VERSION || typeof docs !== "object" || docs === null) {
    return entries;
  }
  for (const name of Object.keys(docs)) {
    if (name === "__proto__") continue;
    const entry = (docs as Record<string, unknown>)[name];
    if (isEntry(entry) && now - entry.at < MAX_AGE_MS) {
      entries.set(name, { id: entry.id, at: entry.at });
    }
  }
  return entries;
}

function save(entries: Entries): void {
  const newest = [...entries]
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, CONTINUE_MAX_DOCS);
  try {
    if (newest.length === 0) {
      localStorage.removeItem(CONTINUE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      CONTINUE_STORAGE_KEY,
      JSON.stringify({ v: VERSION, docs: Object.fromEntries(newest) }),
    );
  } catch {
    // Storage full or unavailable: nothing to continue next time.
  }
}

let killSwitchCleared = false;

/** Under the kill switch, removes what an earlier build stored, once. */
function enabled(): boolean {
  if (ENABLED) return true;
  if (!killSwitchCleared) {
    killSwitchCleared = true;
    try {
      localStorage.removeItem(CONTINUE_STORAGE_KEY);
    } catch {
      // Unavailable storage holds nothing to clear.
    }
  }
  return false;
}

export function readContinueEntry(
  documentName: string,
  now = Date.now(),
): ContinueEntry | null {
  if (!enabled()) return null;
  return load(now).get(documentName) ?? null;
}

export function writeContinueEntry(
  documentName: string,
  id: string,
  now = Date.now(),
): void {
  if (!enabled()) return;
  const entries = load(now);
  entries.set(documentName, { id, at: now });
  save(entries);
}

export function deleteContinueEntry(documentName: string): void {
  if (!enabled()) return;
  const entries = load(Date.now());
  if (entries.delete(documentName)) save(entries);
}

/**
 * The section `pos` is in: the nearest heading at or before it, other than
 * the title. Null when there is none, or when that heading is one of the
 * first `CONTINUE_MIN_BLOCK` top-level blocks (the writer is near the top).
 */
export function sectionHeadingAt(
  doc: PMNode,
  pos: number,
): { id: string; index: number } | null {
  const last = Math.min(doc.resolve(pos).index(0), doc.childCount - 1);
  for (let index = last; index >= 1; index--) {
    const node = doc.child(index);
    if (node.type.name !== "heading") continue;
    const id = node.attrs["data-toc-id"];
    if (typeof id !== "string" || id.length === 0) continue;
    return index >= CONTINUE_MIN_BLOCK ? { id, index } : null;
  }
  return null;
}

/**
 * Records the caret's section when the writer leaves the text: on editor
 * blur, and on `visibilitychange` (hidden), `pagehide` and the returned
 * release (a tab switch unmounts the chip) while the editor has focus.
 *
 * Only a place the writer chose counts: nothing is recorded until their
 * first selection or edit (or the text already has focus at install). Transactions nobody typed do not count: remote
 * ones (`isRemote`), appended ones (heading ids) and those kept out of
 * history (the seed). So opening a document, dismissing the chip (which
 * focuses the text where it was) and leaving keeps the old entry. A caret
 * near the top deletes it. The transaction listener goes at that first
 * selection or edit, so there is no work per keystroke. The release is
 * idempotent.
 */
export function installContinueRecorder(
  editor: Editor,
  documentName: string,
  isRemote: (transaction: Transaction) => boolean,
): () => void {
  // Focus before the chunk loaded came from the writer: nothing else
  // focuses the text that early (Go and Dismiss live in this chunk).
  let armed = editor.view.hasFocus();
  let lastWritten: string | null | undefined;

  const onTransaction = ({ transaction: tr }: { transaction: Transaction }) => {
    if (!tr.selectionSet && !tr.docChanged) return;
    if (
      isRemote(tr) ||
      tr.getMeta("appendedTransaction") ||
      tr.getMeta("addToHistory") === false
    ) {
      return;
    }
    armed = true;
    editor.off("transaction", onTransaction);
  };
  const record = () => {
    if (!armed || editor.isDestroyed) return;
    const { doc, selection } = editor.state;
    const id = sectionHeadingAt(doc, selection.head)?.id ?? null;
    if (id === lastWritten) return;
    lastWritten = id;
    if (id) writeContinueEntry(documentName, id);
    else deleteContinueEntry(documentName);
  };
  const recordIfFocused = () => {
    if (!editor.isDestroyed && editor.view.hasFocus()) record();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") recordIfFocused();
  };

  if (!armed) editor.on("transaction", onTransaction);
  editor.on("blur", record);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", recordIfFocused);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    recordIfFocused();
    editor.off("transaction", onTransaction);
    editor.off("blur", record);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", recordIfFocused);
  };
}
