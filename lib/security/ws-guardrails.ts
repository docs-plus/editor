import { isSystemDocumentId } from "@/lib/security/doc-id-validator";
import {
  DOC_CREATION_RATE_LIMIT_PER_HOUR,
  MAX_DOC_SIZE_BYTES,
  MAX_TOTAL_DOCUMENTS,
  WS_CONNECTION_LIMIT_PER_IP,
} from "@/lib/security/guardrail-config";

export type GuardrailDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

type WsGuardrailsConfig = {
  wsConnectionsPerIp: number;
  docCreationPerHour: number;
  maxTotalDocuments: number;
  maxDocSizeBytes: number;
  now: () => number;
};

export type WsGuardrails = {
  onConnect(ip: string): GuardrailDecision;
  onDisconnect(ip: string): void;
  canCreateDocument(
    ip: string,
    totalNonSystemDocuments: number,
  ): GuardrailDecision;
  canStoreDocument(name: string, sizeBytes: number): GuardrailDecision;
};

function cleanupWindow(events: number[], cutoffMs: number): number[] {
  return events.filter((timestamp) => timestamp > cutoffMs);
}

export function createWsGuardrails(
  config: Partial<WsGuardrailsConfig> = {},
): WsGuardrails {
  const settings: WsGuardrailsConfig = {
    wsConnectionsPerIp: config.wsConnectionsPerIp ?? WS_CONNECTION_LIMIT_PER_IP,
    docCreationPerHour:
      config.docCreationPerHour ?? DOC_CREATION_RATE_LIMIT_PER_HOUR,
    maxTotalDocuments: config.maxTotalDocuments ?? MAX_TOTAL_DOCUMENTS,
    maxDocSizeBytes: config.maxDocSizeBytes ?? MAX_DOC_SIZE_BYTES,
    now: config.now ?? Date.now,
  };
  const activeConnections = new Map<string, number>();
  const createEvents = new Map<string, number[]>();

  return {
    onConnect(ip: string): GuardrailDecision {
      const active = activeConnections.get(ip) ?? 0;
      if (active >= settings.wsConnectionsPerIp) {
        return { allowed: false, reason: "ws_connection_limit_exceeded" };
      }
      activeConnections.set(ip, active + 1);
      return { allowed: true };
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
      const hourMs = 60 * 60 * 1000;
      const now = settings.now();
      const existing = createEvents.get(ip) ?? [];
      const recent = cleanupWindow(existing, now - hourMs);
      if (recent.length >= settings.docCreationPerHour) {
        createEvents.set(ip, recent);
        return { allowed: false, reason: "doc_creation_rate_limit_exceeded" };
      }
      recent.push(now);
      createEvents.set(ip, recent);
      return { allowed: true };
    },
    canStoreDocument(name: string, sizeBytes: number): GuardrailDecision {
      if (isSystemDocumentId(name)) return { allowed: true };
      if (sizeBytes > settings.maxDocSizeBytes) {
        return { allowed: false, reason: "max_document_size_exceeded" };
      }
      return { allowed: true };
    },
  };
}
