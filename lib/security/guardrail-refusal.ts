import { logAbuseEvent } from "@/lib/security/abuse-log";

export type GuardrailRefusal = { readonly reason: string };

/**
 * What a Hocuspocus hook throws to refuse a document: logged once as a
 * structured `ws_guardrail_rejected` abuse event. Hocuspocus sends `reason`
 * to the client as the permission-denied reason, and logs a hook error (with
 * Bun's code frame, which ignores `.stack`) only when it has a `message`, so
 * this is a plain value without one.
 */
export function guardrailRefusal(
  reason: string,
  details: Record<string, unknown>,
): GuardrailRefusal {
  logAbuseEvent("ws_guardrail_rejected", { reason, ...details });
  return { reason };
}
