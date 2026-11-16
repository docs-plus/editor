import { NextResponse } from "next/server";

import { logAbuseEvent } from "@/lib/security/abuse-log";
import type { RateLimitDecision } from "@/lib/security/rate-limit";
import { isSqliteBusyError } from "@/lib/sqlite-open";

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

/** Runs `run`, retrying when another process holds the SQLite write lock. */
export function withBusyRetry<T>(run: () => T, attempts = 3): T {
  for (let attempt = 1; ; attempt++) {
    try {
      return run();
    } catch (error) {
      if (isSqliteBusyError(error) && attempt < attempts) continue;
      throw error;
    }
  }
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/**
 * Parses a small JSON body. `undefined` unless the content type is
 * `application/json`, the body stays within `maxBytes` and it parses. Bytes
 * are counted while reading, so a chunked body without `content-length`
 * cannot exceed the limit; the stream is cancelled past it.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<unknown | undefined> {
  if (!isJsonContentType(request.headers.get("content-type"))) return undefined;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes || !request.body) return undefined;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return undefined;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}
