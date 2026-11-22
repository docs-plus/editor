import type { CommentLimits } from "@/lib/comments/limits";
import { parseKey } from "@/lib/comments/model";

/**
 * The comment byte budget's measure (comments design §4.2), shared by the
 * client and the server so both count the same way. It counts the LIVE
 * values in the map: an overwrite replaces the old value's bytes and a
 * delete removes them, so a thousand re-anchors never grow the count (a
 * cumulative estimate would refuse an honest client whose own check
 * passes).
 */

/** UTF-8 length of `text` without allocating. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      // A surrogate pair is one 4-byte code point.
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

/** Bytes of one plain JSON value, `Uint8Array`s by their length. */
export function valueBytes(value: unknown): number {
  if (typeof value === "string") return utf8Length(value);
  if (typeof value === "number") return 8;
  if (typeof value === "boolean" || value === null) return 1;
  if (value instanceof Uint8Array) return value.byteLength;
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + valueBytes(item), 0);
  }
  if (typeof value === "object") {
    let bytes = 0;
    for (const [key, item] of Object.entries(value as object)) {
      if (item !== undefined) bytes += utf8Length(key) + valueBytes(item);
    }
    return bytes;
  }
  return 0;
}

/** One live entry: its key plus its value. */
export const entryBytes = (key: string, value: unknown): number =>
  utf8Length(key) + valueBytes(value);

/** Every live entry of the map (anything with `forEach(value, key)`). */
export function liveBytes(map: {
  forEach(fn: (value: unknown, key: string) => void): void;
}): number {
  let bytes = 0;
  map.forEach((value, key) => {
    bytes += entryBytes(key, value);
  });
  return bytes;
}

export interface CommentCounts {
  threads: number;
  messages: number;
  /** The largest number of messages in one thread. */
  maxPerThread: number;
  bytes: number;
}

/** Live counts of a comments map (anything with `forEach(value, key)`). */
export function countComments(map: {
  forEach(fn: (value: unknown, key: string) => void): void;
}): CommentCounts {
  let threads = 0;
  let messages = 0;
  let bytes = 0;
  const perThread = new Map<string, number>();
  map.forEach((value, key) => {
    bytes += entryBytes(key, value);
    const parsed = parseKey(key);
    if (parsed?.kind === "t") threads++;
    if (parsed?.kind === "m") {
      messages++;
      perThread.set(parsed.tid, (perThread.get(parsed.tid) ?? 0) + 1);
    }
  });
  return {
    threads,
    messages,
    maxPerThread: Math.max(0, ...perThread.values()),
    bytes,
  };
}

/** The first cap `counts` exceeds, or `null`. */
export function overCap(
  counts: CommentCounts,
  limits: CommentLimits,
): "threads" | "messages" | "messagesPerThread" | "bytes" | null {
  if (counts.threads > limits.threads) return "threads";
  if (counts.messages > limits.messages) return "messages";
  if (counts.maxPerThread > limits.messagesPerThread) {
    return "messagesPerThread";
  }
  if (counts.bytes > limits.bytes) return "bytes";
  return null;
}
