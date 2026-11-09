import {
  isTabsDocumentId,
  PLAYGROUND_DOC,
} from "@/lib/security/doc-id-validator";
import {
  DOC_CREATION_RATE_LIMIT_PER_HOUR,
  MAX_DOC_SIZE_BYTES,
  MAX_PLAYGROUND_DOC_SIZE_BYTES,
  MAX_TABS_DOC_SIZE_BYTES,
  MAX_TOTAL_DOCUMENTS,
  RATE_LIMIT_MAX_KEYS,
  WS_CONNECTION_LIMIT_PER_IP,
} from "@/lib/security/guardrail-config";
import { createTimestampWindows } from "@/lib/security/rate-limit";

export type GuardrailDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

type WsGuardrailsConfig = {
  wsConnectionsPerIp: number;
  docCreationPerHour: number;
  maxTotalDocuments: number;
  maxDocSizeBytes: number;
  maxPlaygroundDocSizeBytes: number;
  maxTabsDocSizeBytes: number;
  maxKeys: number;
  now: () => number;
};

export type WsGuardrails = {
  /** Checks the per-IP limit without counting the attempt. */
  canConnect(ip: string): GuardrailDecision;
  /** Counts a connection once Hocuspocus has established it. */
  onConnected(ip: string): void;
  onDisconnect(ip: string): void;
  canCreateDocument(
    ip: string,
    totalNonSystemDocuments: number,
  ): GuardrailDecision;
  /** Byte cap for a document's encoded state. */
  maxDocumentBytes(name: string): number;
  canStoreDocument(name: string, sizeBytes: number): GuardrailDecision;
};

const HOUR_MS = 60 * 60 * 1000;

export function createWsGuardrails(
  config: Partial<WsGuardrailsConfig> = {},
): WsGuardrails {
  const settings: WsGuardrailsConfig = {
    wsConnectionsPerIp: config.wsConnectionsPerIp ?? WS_CONNECTION_LIMIT_PER_IP,
    docCreationPerHour:
      config.docCreationPerHour ?? DOC_CREATION_RATE_LIMIT_PER_HOUR,
    maxTotalDocuments: config.maxTotalDocuments ?? MAX_TOTAL_DOCUMENTS,
    maxDocSizeBytes: config.maxDocSizeBytes ?? MAX_DOC_SIZE_BYTES,
    maxPlaygroundDocSizeBytes:
      config.maxPlaygroundDocSizeBytes ?? MAX_PLAYGROUND_DOC_SIZE_BYTES,
    maxTabsDocSizeBytes: config.maxTabsDocSizeBytes ?? MAX_TABS_DOC_SIZE_BYTES,
    maxKeys: config.maxKeys ?? RATE_LIMIT_MAX_KEYS,
    now: config.now ?? Date.now,
  };
  const activeConnections = new Map<string, number>();
  const createEvents = createTimestampWindows(
    HOUR_MS,
    settings.now,
    settings.maxKeys,
  );

  function maxDocumentBytes(name: string): number {
    if (name === PLAYGROUND_DOC) return settings.maxPlaygroundDocSizeBytes;
    if (isTabsDocumentId(name)) return settings.maxTabsDocSizeBytes;
    return settings.maxDocSizeBytes;
  }

  return {
    canConnect(ip: string): GuardrailDecision {
      const active = activeConnections.get(ip) ?? 0;
      if (active >= settings.wsConnectionsPerIp) {
        return { allowed: false, reason: "ws_connection_limit_exceeded" };
      }
      return { allowed: true };
    },
    onConnected(ip: string): void {
      activeConnections.set(ip, (activeConnections.get(ip) ?? 0) + 1);
    },
    onDisconnect(ip: string): void {
      const active = activeConnections.get(ip) ?? 0;
      if (active <= 1) {
        activeConnections.delete(ip);
        return;
      }
      activeConnections.set(ip, active - 1);
    },
    canCreateDocument(
      ip: string,
      totalNonSystemDocuments: number,
    ): GuardrailDecision {
      if (totalNonSystemDocuments >= settings.maxTotalDocuments) {
        return { allowed: false, reason: "max_total_documents_exceeded" };
      }
      const recent = createEvents.recent(ip);
      if (!recent || recent.length >= settings.docCreationPerHour) {
        return { allowed: false, reason: "doc_creation_rate_limit_exceeded" };
      }
      recent.push(settings.now());
      return { allowed: true };
    },
    maxDocumentBytes,
    canStoreDocument(name: string, sizeBytes: number): GuardrailDecision {
      if (sizeBytes > maxDocumentBytes(name)) {
        return { allowed: false, reason: "max_document_size_exceeded" };
      }
      return { allowed: true };
    },
  };
}
