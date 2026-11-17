/**
 * `DocSession`: the port the editor opens documents through (desktop
 * architecture §4, D-A4). `use-yjs-document` reads a `DocSession` from
 * context and never imports an adapter, so the editor chunk carries neither
 * the sandbox's `collab-session` nor the desktop or library storage code.
 *
 * Adapters:
 * - web sandbox: a wrapper over `acquireCollabSession` (`authoritative` =
 *   server synced, `readOnlyReason` = `rejectedReason`);
 * - desktop and the web library: `local-session` over a `DocStore`.
 *
 * Types and origin tokens only: no runtime imports.
 */
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

import type { DocStoreError } from "@/lib/platform/doc-store";

// Yjs transaction origins `local-session` uses. Updates in the first two
// come from storage, so they are never appended again.

/** Applying the stored snapshot and update rows when a document opens. */
export const HYDRATE_ORIGIN: unique symbol = Symbol("tinydocy-hydrate");
/** Applying content a `DocStore` merged in from another writer (`CompactResult.foreign`). */
export const STORAGE_ORIGIN: unique symbol = Symbol("tinydocy-storage");

/**
 * The origin of the open hook's forward migrations (architecture §5.1).
 * Their updates *are* appended, as `"migration"` with `schemaTo`, and stay
 * out of undo because no `UndoManager` tracks this origin.
 *
 * `local-session` maps every other transaction origin to a stored
 * `UpdateOrigin`: this one → `"migration"`, the provider (Live) →
 * `"remote"`, anything else (y-tiptap's binding, plain `transact`) →
 * `"local"`.
 */
export const MIGRATION_ORIGIN: unique symbol = Symbol("tinydocy-migration");

/**
 * Why a document can't be edited. Highest priority first in the desktop
 * reducer (architecture §6.1); the sandbox reasons are `collab-session`'s
 * refusals, so its adapter passes them through unchanged.
 */
export type ReadOnlyReason =
  // desktop and the web library
  | "library_too_new"
  | "doc_too_new"
  | "unrepairable"
  | "view_only"
  | "open_elsewhere"
  // the sandbox (collab-session)
  | "document_too_large"
  | "document_deleted"
  | "offline_budget"
  | "client_outdated"
  | "schema_rejected";

/** The changing part of an open document. Replaced, never mutated, on change. */
export type DocHandleState = {
  /** The content is loaded: the editor may mount and bind. */
  ready: boolean;
  /**
   * This copy is the authority, so an empty document may be seeded
   * (`serverSynced` today). Local documents become authoritative when hydrate
   * finishes; a server-backed one after its first server sync.
   */
  authoritative: boolean;
  /** Set when edits must be refused; the editor enforces it (`WriteGate`). */
  readOnlyReason: ReadOnlyReason | null;
  /**
   * Why the document could not be opened, if it could not (for example
   * `already_open`: another window holds it). Null while loading or once ready.
   */
  error: DocStoreError | null;
};

/** One open document, returned by `DocSession.open`. */
export interface DocHandle {
  readonly docId: string;
  /** Stable for the handle's lifetime. Empty until `ready`. */
  readonly doc: Y.Doc;
  /** One stable awareness per document, whether or not a provider is attached. */
  readonly awareness: Awareness;
  /** The sync provider, or null for a document with no server (every Local document). */
  readonly provider: HocuspocusProvider | null;
  /** The current state; the same object until something changes (fits `useSyncExternalStore`). */
  getState(): DocHandleState;
  /** Calls `listener` after every state change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Saves every edit made so far; resolves once they are durable. */
  flush(): Promise<void>;
  /**
   * Gives the handle back. The session is kept for a short delay, so a
   * release and a re-open in the same tick reuse it; then it flushes, compacts
   * and closes. Call once per `open`.
   */
  release(): void;
}

export interface DocSession {
  /**
   * Opens a document and returns at once: `ready` starts false and turns
   * true after the content loads. Opening a document that is already open
   * in this session returns a handle on the same Y.Doc.
   */
  open(docId: string): DocHandle;
  /** Saves every open document's edits (blur, hide, quit, update). */
  flush(): Promise<void>;
}
