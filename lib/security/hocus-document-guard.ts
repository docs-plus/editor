import type {
  afterLoadDocumentPayload,
  afterUnloadDocumentPayload,
  beforeHandleAwarenessPayload,
  beforeHandleMessagePayload,
  Extension,
  onChangePayload,
} from "@hocuspocus/server";
import * as decoding from "lib0/decoding";
import * as Y from "yjs";

import {
  isAllowedMarkKey,
  isAllowedNodeName,
  markNameFromKey,
} from "@/lib/schema-names";
import { logAbuseEvent } from "@/lib/security/abuse-log";
import { getPinnedClientIp } from "@/lib/security/client-ip";
import { isTabsDocumentId } from "@/lib/security/doc-id-validator";
import {
  decodeFrameHeader,
  HOCUS_SYNC_MESSAGE_TYPES,
} from "@/lib/security/hocus-frame";
import { repairTabsArray } from "@/lib/security/tabs-doc-repair";
import { EDITOR_FRAGMENT_NAME } from "@/lib/yjs-mark-migration";

/** Close code for an update that would push a document past its cap. */
export const DOCUMENT_TOO_LARGE = {
  code: 4413,
  reason: "document_too_large",
} as const;

/** Close for an update naming a node or mark outside the schema allowlist. */
export const SCHEMA_REJECTED = {
  code: 4422,
  reason: "schema_rejected",
} as const;

const MAX_LOGGED_NAME_LENGTH = 40;

type DocumentGuardOptions = {
  /** Byte cap for a document's encoded state. */
  maxDocumentBytes: (documentName: string) => number;
  /** Tombstoned (deleted) documents: dropped from tab lists on repair. */
  isDeletedDocument?: (documentName: string) => boolean;
  /** Largest JSON-encoded awareness state relayed per client. */
  maxAwarenessStateBytes: number;
  /** Delay before repairing a tab list after a change (coalesces bursts). */
  tabsRepairDelayMs?: number;
};

type SizeEstimate = { stored: number; pending: number };

const SYNC_STEP_1 = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;
/** An encoded Yjs update with no structs and no deletions is `[0, 0]`. */
const EMPTY_UPDATE_BYTES = 2;

/** A sync frame whose body cannot be decoded; it must never be applied. */
const MALFORMED = Symbol("malformed-sync-frame");

/**
 * The Yjs update carried by a Sync / SyncReply step 2 or update frame.
 * Null for frames that carry none (awareness, auth, step 1, stateless).
 * `MALFORMED` for a sync frame that does not decode. Decoded with lib0, as
 * Hocuspocus does, so padded varints and out-of-range lengths cannot make
 * the guard and the server disagree about what a frame contains.
 */
function readSyncUpdate(
  frame: Uint8Array,
): Uint8Array | null | typeof MALFORMED {
  try {
    const { decoder, messageType } = decodeFrameHeader(frame);
    if (!HOCUS_SYNC_MESSAGE_TYPES.has(messageType)) return null;
    const syncType = decoding.readVarUint(decoder);
    if (syncType === SYNC_STEP_1) return null;
    if (syncType !== SYNC_STEP_2 && syncType !== SYNC_UPDATE) return MALFORMED;
    return decoding.readVarUint8Array(decoder);
  } catch {
    return MALFORMED;
  }
}

/**
 * True when a Hocuspocus frame carries document content: a non-empty Sync
 * step 2 or update. Awareness, auth, step 1, stateless frames and the empty
 * step 2 every client sends when it connects do not grow the document, so
 * they never count toward its size (otherwise a document already over its
 * cap could not even be opened).
 */
export function isDocumentUpdateFrame(frame: Uint8Array): boolean {
  const update = readSyncUpdate(frame);
  return (
    update !== null &&
    update !== MALFORMED &&
    update.byteLength > EMPTY_UPDATE_BYTES
  );
}

/**
 * True when applying `update` to `document` adds no new items: it only
 * deletes, or repeats what the document already has. Such an update cannot
 * grow content, so a document at its cap can still be trimmed. Only called
 * on the over-cap path, where the decode cost is acceptable.
 */
export function addsNoItems(update: Uint8Array, document: Y.Doc): boolean {
  try {
    const missing = Y.diffUpdate(update, Y.encodeStateVector(document));
    return Y.decodeUpdate(missing).structs.length === 0;
  } catch {
    return false;
  }
}

/** Reported for content stored directly in the editor fragment. */
const ROOT_CONTENT_NAME = "#text";

/** A root type's name, `null` inside a nested type, `undefined` if not known yet. */
type RootName = string | null | undefined;

/**
 * Finds the root type each item of an update lands in. An item encodes its
 * parent only when it has no origin; otherwise it inherits the parent of its
 * left (or right) origin, found among the update's own items or, failing
 * that, in the server's document.
 */
function createRootResolver(
  structs: readonly Y.Item[],
  document: Y.Doc | undefined,
): (item: Y.Item) => RootName {
  const byClient = new Map<number, Y.Item[]>();
  for (const struct of structs) {
    const items = byClient.get(struct.id.client) ?? [];
    items.push(struct);
    byClient.set(struct.id.client, items);
  }
  const memo = new Map<Y.Item, RootName>();

  /** Items of one client arrive in clock order: binary search the range. */
  function findInUpdate(id: Y.ID): Y.Item | undefined {
    const items = byClient.get(id.client);
    if (!items) return undefined;
    let low = 0;
    let high = items.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const item = items[middle];
      if (id.clock < item.id.clock) high = middle - 1;
      else if (id.clock >= item.id.clock + item.length) low = middle + 1;
      else return item;
    }
    return undefined;
  }

  function findInDocument(id: Y.ID): RootName {
    if (!document) return undefined;
    let found: Y.AbstractStruct;
    try {
      found = Y.getItem(document.store, id);
    } catch {
      return undefined;
    }
    // Yjs discards an item whose origin was garbage collected.
    if (!(found instanceof Y.Item)) return null;
    const parent = found.parent;
    if (!(parent instanceof Y.AbstractType)) return null;
    return parent._item === null ? Y.findRootTypeKey(parent) : null;
  }

  return (item) => {
    const path: Y.Item[] = [];
    // A Set, not `path.includes`: a hostile chain would make that quadratic.
    const seen = new Set<Y.Item>();
    let current = item;
    let root: RootName;
    for (;;) {
      if (memo.has(current)) {
        root = memo.get(current);
        break;
      }
      const parent = current.parent as unknown;
      if (typeof parent === "string") {
        root = parent;
        break;
      }
      // An ID: the parent is an item, so a nested type.
      if (parent !== null) {
        root = null;
        break;
      }
      path.push(current);
      seen.add(current);
      const origin = current.origin ?? current.rightOrigin;
      const next = origin ? findInUpdate(origin) : undefined;
      if (!origin || next === undefined || seen.has(next)) {
        root = origin ? findInDocument(origin) : undefined;
        break;
      }
      current = next;
    }
    for (const visited of path) memo.set(visited, root);
    return root;
  };
}

/** Countable content the editor fragment cannot hold (it holds elements). */
function isNonElementContent(item: Y.Item): boolean {
  const { content } = item;
  if (content instanceof Y.ContentDeleted) return false;
  if (content instanceof Y.ContentType) {
    return !(content.type instanceof Y.XmlElement);
  }
  return item.parentSub === null;
}

/**
 * Node and mark names in `update` that the schema allowlist does not know, at
 * most `limit` of them (truncated for logging). Null when the update cannot
 * be decoded, so callers fail closed.
 *
 * Content placed directly in the editor fragment (`default`) that is not an
 * element is reported as `#text`: y-tiptap cannot project it and throws. Its
 * position is resolved against `document`, the server's copy. Content whose
 * position is not there yet is allowed: a client resuming from its device
 * copy types before its sync step 2 arrives, and Yjs holds such content
 * pending. If it later lands in the fragment, the client repair strips it.
 *
 * Known gap: element attribute keys and marks on inline atom nodes are not
 * checked. y-prosemirror stores no marks on elements, and Tiptap drops
 * unknown attributes.
 */
export function findDisallowedSchemaNames(
  update: Uint8Array,
  limit = 3,
  document?: Y.Doc,
): string[] | null {
  const found: string[] = [];
  // A format run emits a start and an end item with the same key.
  const report = (name: string) => {
    const shown = name.slice(0, MAX_LOGGED_NAME_LENGTH);
    if (!found.includes(shown)) found.push(shown);
  };
  try {
    const items = Y.decodeUpdate(update).structs.filter(
      (struct): struct is Y.Item => struct instanceof Y.Item,
    );
    const rootOf = createRootResolver(items, document);
    for (const item of items) {
      if (found.length >= limit) break;
      const { content } = item;
      if (content instanceof Y.ContentType) {
        if (
          content.type instanceof Y.XmlElement &&
          !isAllowedNodeName(content.type.nodeName)
        )
          report(content.type.nodeName);
      } else if (
        content instanceof Y.ContentFormat &&
        !isAllowedMarkKey(content.key)
      ) {
        report(markNameFromKey(content.key));
      }
      if (!isNonElementContent(item)) continue;
      const root = rootOf(item);
      if (root === EDITOR_FRAGMENT_NAME) report(ROOT_CONTENT_NAME);
    }
  } catch {
    return null;
  }
  return found;
}

/**
 * Enforces document size while updates arrive, not only at save time.
 *
 * The estimate is the last known encoded size plus every update applied
 * since, reset whenever persistence stores the document. Updates only add
 * bytes until a store compacts them, so this overestimates and never lets a
 * document grow past `maxDocumentBytes` in memory between saves.
 */
export class DocumentGuard implements Extension {
  extensionName = "DocumentGuard";
  /** Runs before Logger and persistence so rejected input is never logged or stored. */
  priority = 1000;

  private readonly sizes = new Map<string, SizeEstimate>();
  private readonly repairTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(private readonly options: DocumentGuardOptions) {}

  /** Call after persistence writes `sizeBytes` for `documentName`. */
  recordStored(documentName: string, sizeBytes: number): void {
    this.sizes.set(documentName, { stored: sizeBytes, pending: 0 });
  }

  async afterLoadDocument({
    document,
    documentName,
  }: afterLoadDocumentPayload): Promise<void> {
    if (isTabsDocumentId(documentName)) {
      const removed = repairTabsArray(
        document.getArray("tabs"),
        this.options.isDeletedDocument,
      );
      if (removed > 0) {
        logAbuseEvent("tabs_doc_repaired", { documentName, removed });
      }
    }
    this.recordStored(documentName, Y.encodeStateAsUpdate(document).byteLength);
  }

  async beforeHandleMessage({
    documentName,
    update,
    requestHeaders,
    document,
  }: beforeHandleMessagePayload): Promise<void> {
    const payload = readSyncUpdate(update);
    if (payload === null) return;
    if (payload === MALFORMED) {
      this.refuseSchema(requestHeaders, documentName, null);
    }
    if (payload.byteLength <= EMPTY_UPDATE_BYTES) return;
    // Size first: arithmetic, and a delete-only update decodes to no structs.
    this.refuseOverCap(payload, update, document, documentName, requestHeaders);
    const names = findDisallowedSchemaNames(payload, undefined, document);
    if (names === null || names.length > 0) {
      this.refuseSchema(requestHeaders, documentName, names);
    }
  }

  /** Closes with `schema_rejected`; undecodable input logs `names: []`. */
  private refuseSchema(
    requestHeaders: beforeHandleMessagePayload["requestHeaders"],
    documentName: string,
    names: string[] | null,
  ): never {
    logAbuseEvent("ws_unknown_schema_name", {
      ip: getPinnedClientIp(requestHeaders),
      documentName,
      names: names ?? [],
    });
    throw SCHEMA_REJECTED;
  }

  /** Closes with `document_too_large` when `payload` would pass the cap. */
  private refuseOverCap(
    payload: Uint8Array,
    frame: Uint8Array,
    document: Y.Doc,
    documentName: string,
    requestHeaders: beforeHandleMessagePayload["requestHeaders"],
  ): void {
    const size = this.sizes.get(documentName);
    if (!size) return;
    const limit = this.options.maxDocumentBytes(documentName);
    const estimatedBytes = size.stored + size.pending + frame.byteLength;
    if (estimatedBytes <= limit) return;
    if (addsNoItems(payload, document)) return;
    logAbuseEvent("ws_update_too_large", {
      ip: getPinnedClientIp(requestHeaders),
      documentName,
      estimatedBytes,
      limit,
    });
    throw DOCUMENT_TOO_LARGE;
  }

  async onChange({
    document,
    documentName,
    update,
  }: onChangePayload): Promise<void> {
    const size = this.sizes.get(documentName);
    if (size) size.pending += update.byteLength;
    if (isTabsDocumentId(documentName))
      this.scheduleTabsRepair(documentName, document);
  }

  async beforeHandleAwareness({
    states,
    documentName,
    requestHeaders,
  }: beforeHandleAwarenessPayload): Promise<void> {
    for (const [clientId, state] of states) {
      const bytes = JSON.stringify(state ?? null).length;
      if (bytes <= this.options.maxAwarenessStateBytes) continue;
      states.delete(clientId);
      logAbuseEvent("ws_awareness_too_large", {
        ip: getPinnedClientIp(requestHeaders),
        documentName,
        bytes,
      });
    }
  }

  async afterUnloadDocument({
    documentName,
  }: afterUnloadDocumentPayload): Promise<void> {
    this.sizes.delete(documentName);
    clearTimeout(this.repairTimers.get(documentName));
    this.repairTimers.delete(documentName);
  }

  async onDestroy(): Promise<void> {
    for (const timer of this.repairTimers.values()) clearTimeout(timer);
    this.repairTimers.clear();
  }

  private scheduleTabsRepair(documentName: string, document: Y.Doc): void {
    if (this.repairTimers.has(documentName)) return;
    const timer = setTimeout(() => {
      this.repairTimers.delete(documentName);
      const removed = repairTabsArray(
        document.getArray("tabs"),
        this.options.isDeletedDocument,
      );
      if (removed > 0) {
        logAbuseEvent("tabs_doc_repaired", { documentName, removed });
      }
    }, this.options.tabsRepairDelayMs ?? 100);
    this.repairTimers.set(documentName, timer);
  }
}
