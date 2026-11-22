/**
 * The per-entry half of the comments validator (comments design §7.3):
 * whether one key and its plain value fit the model, and whether a map's
 * live counts fit the caps. Pure. The struct-level half (content types,
 * keys read through the origin chain, overwrite rules, counters) is the
 * server's `validate.ts` (P4.2f-2), which builds on this; the client tests
 * run every update the client produces through both halves.
 */
import * as Y from "yjs";

import { cleanBody, cleanLine } from "@/lib/comments/clean";
import {
  type CommentLimits,
  EARLIEST_TIME,
  MAX_CLOCK_SKEW_MS,
} from "@/lib/comments/limits";
import { ID_PATTERN, parseKey, THREAD_VERSION } from "@/lib/comments/model";
import { CARET_COLORS } from "@/lib/user-identity";

export interface EntryCheckOptions {
  limits: CommentLimits;
  /** The checker's clock, for the 24 h future bound. */
  now: number;
}

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Uint8Array);

/** Only `required` and `optional` fields, every required one present. */
function hasShape(
  value: Rec,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  for (const key of required) if (!(key in value)) return false;
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) return false;
  }
  return true;
}

function isTime(value: unknown, now: number): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= EARLIEST_TIME &&
    value <= now + MAX_CLOCK_SKEW_MS
  );
}

function isAuthor(value: unknown, limits: CommentLimits): boolean {
  if (!isRecord(value) || !hasShape(value, ["id", "n", "k"])) return false;
  const { id, n, k } = value;
  return (
    typeof id === "string" &&
    ID_PATTERN.test(id) &&
    typeof n === "string" &&
    n.length <= limits.name &&
    cleanLine(n) === n &&
    n !== "" &&
    CARET_COLORS.some((color) => color === k)
  );
}

/**
 * Item- or type-based, never name-based: resolving a `tname` position
 * calls `doc.get(tname)`, which would create a stray root.
 */
export function isSafeAnchor(value: unknown, limits: CommentLimits): boolean {
  if (!(value instanceof Uint8Array)) return false;
  if (value.byteLength === 0 || value.byteLength > limits.anchorBytes) {
    return false;
  }
  try {
    const position = Y.decodeRelativePosition(value);
    return position.tname === null && (!!position.item || !!position.type);
  } catch {
    return false;
  }
}

function isLine(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    value.length <= max &&
    cleanLine(value) === value
  );
}

function checkHead(value: Rec, options: EntryCheckOptions): string | null {
  const { limits, now } = options;
  if (!hasShape(value, ["v", "q", "c", "au"], ["sg"])) return "shape";
  if (value.v !== THREAD_VERSION) return "version";
  if (!isLine(value.q, limits.quote)) return "quote";
  if (!isTime(value.c, now)) return "time";
  if (!isAuthor(value.au, limits)) return "author";
  if ("sg" in value && !isLine(value.sg, limits.suggestion)) {
    return "suggestion";
  }
  return null;
}

function checkAnchors(value: Rec, limits: CommentLimits): string | null {
  if (!hasShape(value, ["s", "e"], ["ps", "pe"])) return "shape";
  if ("ps" in value !== "pe" in value) return "shape";
  for (const key of ["s", "e", "ps", "pe"]) {
    if (key in value && !isSafeAnchor(value[key], limits)) return "anchor";
  }
  return null;
}

function checkStatus(value: Rec, options: EntryCheckOptions): string | null {
  if (!hasShape(value, ["r", "at", "by"], ["ap"])) return "shape";
  if (typeof value.r !== "boolean") return "shape";
  if ("ap" in value && value.ap !== true) return "shape";
  if (!isTime(value.at, options.now)) return "time";
  if (!isAuthor(value.by, options.limits)) return "author";
  return null;
}

function checkMessage(value: Rec, options: EntryCheckOptions): string | null {
  const { limits, now } = options;
  const deleted = "del" in value;
  const shaped = deleted
    ? hasShape(value, ["au", "c", "del"]) && value.del === true
    : hasShape(value, ["au", "b", "c"], ["ed"]);
  if (!shaped) return "shape";
  if (!isAuthor(value.au, limits)) return "author";
  if (!isTime(value.c, now)) return "time";
  if (deleted) return null;
  const { b } = value;
  if (
    typeof b !== "string" ||
    b === "" ||
    b.length > limits.body ||
    cleanBody(b) !== b
  ) {
    return "body";
  }
  if ("ed" in value && !isTime(value.ed, now)) return "time";
  return null;
}

/** Why `key` and `value` don't fit the model, or `null` when they do. */
export function checkEntry(
  key: string,
  value: unknown,
  options: EntryCheckOptions,
): string | null {
  const parsed = parseKey(key);
  if (!parsed) return "key";
  if (!isRecord(value)) return "shape";
  switch (parsed.kind) {
    case "t":
      return checkHead(value, options);
    case "a":
      return checkAnchors(value, options.limits);
    case "s":
      return checkStatus(value, options);
    case "m":
      return checkMessage(value, options);
  }
}
