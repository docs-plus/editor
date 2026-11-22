import { isSqliteBusyError } from "@/lib/sqlite-open";

/**
 * Framework-free request helpers, shared by the Next.js routes (through
 * `http-route-guards`) and the Hocus process, which must not import
 * `next/server`.
 */

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
