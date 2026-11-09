import type {
  afterLoadDocumentPayload,
  afterUnloadDocumentPayload,
  beforeHandleAwarenessPayload,
  beforeHandleMessagePayload,
  Extension,
  onChangePayload,
} from "@hocuspocus/server";
import * as Y from "yjs";

import { logAbuseEvent } from "@/lib/security/abuse-log";
import { getPinnedClientIp } from "@/lib/security/client-ip";
import { isTabsDocumentId } from "@/lib/security/doc-id-validator";
import { repairTabsArray } from "@/lib/security/tabs-doc-repair";

/** Close code for an update that would push a document past its cap. */
export const DOCUMENT_TOO_LARGE = {
  code: 4413,
  reason: "document_too_large",
} as const;

type DocumentGuardOptions = {
  /** Byte cap for a document's encoded state. */
  maxDocumentBytes: (documentName: string) => number;
  /** Largest JSON-encoded awareness state relayed per client. */
  maxAwarenessStateBytes: number;
  /** Delay before repairing a tab list after a change (coalesces bursts). */
  tabsRepairDelayMs?: number;
};

type SizeEstimate = { stored: number; pending: number };

const MESSAGE_SYNC = 0;
const SYNC_STEP_1 = 0;
/** An encoded Yjs update with no structs and no deletions is `[0, 0]`. */
const EMPTY_UPDATE_BYTES = 2;

/** Reads a lib0 varUint at `offset`; returns [value, nextOffset] or null. */
function readVarUint(
  bytes: Uint8Array,
  offset: number,
): [number, number] | null {
  let value = 0;
  let shift = 0;
  for (let i = offset; i < bytes.length && shift < 35; i++) {
    const byte = bytes[i] ?? 0;
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [value, i + 1];
    shift += 7;
  }
  return null;
}

/**
 * True when a Hocuspocus frame carries document content: a non-empty Sync
 * step 2 or update. Awareness, auth, step 1, stateless frames and the empty
 * step 2 every client sends when it connects do not grow the document, so
 * they never count toward its size (otherwise a document already over its
 * cap could not even be opened).
 */
export function isDocumentUpdateFrame(frame: Uint8Array): boolean {
  const nameLength = readVarUint(frame, 0);
  if (!nameLength) return false;
  const messageType = readVarUint(frame, nameLength[1] + nameLength[0]);
  if (!messageType || messageType[0] !== MESSAGE_SYNC) return false;
  const syncType = readVarUint(frame, messageType[1]);
  if (!syncType || syncType[0] === SYNC_STEP_1) return false;
  const updateLength = readVarUint(frame, syncType[1]);
  return updateLength !== null && updateLength[0] > EMPTY_UPDATE_BYTES;
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
      const removed = repairTabsArray(document.getArray("tabs"));
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
  }: beforeHandleMessagePayload): Promise<void> {
    const size = this.sizes.get(documentName);
    if (!size || !isDocumentUpdateFrame(update)) return;
    const limit = this.options.maxDocumentBytes(documentName);
    if (size.stored + size.pending + update.byteLength <= limit) return;
    logAbuseEvent("ws_update_too_large", {
      ip: getPinnedClientIp(requestHeaders),
      documentName,
      estimatedBytes: size.stored + size.pending + update.byteLength,
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
      const removed = repairTabsArray(document.getArray("tabs"));
      if (removed > 0) {
        logAbuseEvent("tabs_doc_repaired", { documentName, removed });
      }
    }, this.options.tabsRepairDelayMs ?? 100);
    this.repairTimers.set(documentName, timer);
  }
}
