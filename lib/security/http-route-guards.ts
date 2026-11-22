import { NextResponse } from "next/server";

import { logAbuseEvent } from "@/lib/security/abuse-log";
import type { RateLimitDecision } from "@/lib/security/rate-limit";

/** 429 with `Retry-After`; logs `event` with the IP and route. */
export function rateLimitedResponse(
  decision: RateLimitDecision,
  fields: { ip: string; route: string; event: string },
): NextResponse {
  logAbuseEvent(fields.event, {
    ip: fields.ip,
    route: fields.route,
    retry_after_s: decision.retryAfterSeconds,
  });
  return NextResponse.json(
    { error: "Rate limit exceeded", retryAfter: decision.retryAfterSeconds },
    {
      status: 429,
      headers: { "Retry-After": String(decision.retryAfterSeconds) },
    },
  );
}

export { readJsonBody, withBusyRetry } from "@/lib/security/json-body";
