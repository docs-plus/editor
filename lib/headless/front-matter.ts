/**
 * Markdown front matter (onboarding design §4.2, details spec §3): written
 * on export, read back on import.
 *
 * The reader is deliberately restricted: string scalars and flat lists
 * only. Anchors, aliases, tags, block scalars and nested maps are refused
 * per property, so no YAML bomb or type trick gets through and no YAML
 * dependency is needed.
 */

/** Largest front matter block read, in UTF-8 bytes (onboarding §4.7). */
export const FRONT_MATTER_MAX_BYTES = 64 * 1024;

export type FrontMatterValue = string | string[] | null;

export interface FrontMatterInput {
  title: string;
  tags: readonly string[];
  /** Epoch milliseconds or a Date; left out when unknown. */
  createdAt?: number | Date | null;
  modifiedAt?: number | Date | null;
}

export interface FrontMatterRead {
  /** Properties in file order. A Map, so no key can reach a prototype. */
  data: Map<string, FrontMatterValue>;
  /** The text after the block (all of it when there is no block). */
  body: string;
  /** Keys whose values the restricted reader refused. */
  rejected: string[];
  /** The block was over `FRONT_MATTER_MAX_BYTES` and was skipped. */
  tooLarge: boolean;
}

/** Characters YAML does not allow unescaped; JSON leaves them as they are. */
const YAML_UNPRINTABLE = /[\u007F-\u009F﻿]/g;

/**
 * A YAML double-quoted scalar. A JSON string is one, once DEL, C1 and the
 * byte-order mark are escaped too (`\uXXXX` means the same in both).
 */
function quote(value: string): string {
  return JSON.stringify(value).replace(
    YAML_UNPRINTABLE,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function isoDate(value: number | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The front matter block, ending with a newline. */
export function writeFrontMatter(input: FrontMatterInput): string {
  const lines = ["---", `title: ${quote(input.title)}`];
  if (input.tags.length === 0) {
    lines.push("tags: []");
  } else {
    lines.push("tags:", ...input.tags.map((tag) => `  - ${quote(tag)}`));
  }
  const created = isoDate(input.createdAt);
  const modified = isoDate(input.modifiedAt);
  if (created) lines.push(`created: ${created}`);
  if (modified) lines.push(`modified: ${modified}`);
  lines.push("---", "");
  return lines.join("\n");
}

/** Thrown inside the reader for a value it refuses. */
class Refused extends Error {}

/** Plain scalars may not start with these (YAML indicators we refuse). */
const REFUSED_START = /^[&*!|>{[\]}@`%]/;

function stripComment(value: string): string {
  const at = value.search(/(^|\s)#/);
  return (at === -1 ? value : value.slice(0, at)).trim();
}

function readQuoted(value: string): string {
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Falls through: YAML escapes JSON lacks (`\x41`, `\e`) are refused.
    }
    throw new Refused();
  }
  return value.slice(1, -1).replaceAll("''", "'");
}

/** One scalar: quoted, or plain without YAML indicators or a `key: value`. */
function readScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    // A quoted scalar may be followed by a comment, nothing else.
    const closing = (
      value.startsWith('"') ? /^"(?:[^"\\]|\\.)*"/ : /^'(?:[^']|'')*'/
    ).exec(value)?.[0];
    if (!closing) throw new Refused();
    if (stripComment(value.slice(closing.length)) !== "") throw new Refused();
    return readQuoted(closing);
  }
  const plain = stripComment(value);
  if (REFUSED_START.test(plain) || /:(\s|$)/.test(plain)) throw new Refused();
  return plain;
}

/** `[a, 'b', "c"]` with scalar items only. */
function readFlowList(raw: string): string[] {
  const value = raw.trim();
  const items: string[] = [];
  let i = 1;
  let current = "";
  let quoteChar: string | null = null;
  for (; i < value.length; i += 1) {
    const char = value[i];
    if (quoteChar) {
      current += char;
      if (char === "\\" && quoteChar === '"') {
        current += value[i + 1] ?? "";
        i += 1;
      } else if (char === quoteChar) {
        quoteChar = null;
      }
    } else if (char === '"' || char === "'") {
      quoteChar = char;
      current += char;
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else if (char === "]") {
      break;
    } else {
      current += char;
    }
  }
  if (quoteChar || i >= value.length) throw new Refused();
  if (stripComment(value.slice(i + 1)) !== "") throw new Refused();
  if (current.trim() !== "" || items.length > 0) items.push(current);
  return items.map((item) => {
    if (item.trim() === "") throw new Refused();
    return readScalar(item);
  });
}

const KEY_LINE = /^([^\s#'"-][^:]*?):(?:[ \t]+(.*))?$/;
const LIST_ITEM = /^[ \t]*-(?:[ \t]+(.*))?$/;
const FENCE_END = /^(?:---|\.\.\.)[ \t]*$/;

function readBlock(
  lines: string[],
): Omit<FrontMatterRead, "body" | "tooLarge"> {
  const data = new Map<string, FrontMatterValue>();
  const rejected: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i += 1;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = KEY_LINE.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    const rawValue = match[2] ?? "";
    // The lines that belong to this key: indented ones and list items.
    const children: string[] = [];
    while (i < lines.length && /^([ \t]|-([ \t]|$))/.test(lines[i])) {
      children.push(lines[i]);
      i += 1;
    }
    if (data.has(key) || rejected.includes(key)) continue;
    try {
      let value: FrontMatterValue;
      if (stripComment(rawValue) === "") {
        const items = children.filter((child) => child.trim() !== "");
        if (items.length === 0) {
          value = null;
        } else {
          value = items.map((child) => {
            const item = LIST_ITEM.exec(child);
            if (!item) throw new Refused();
            const text = item[1] ?? "";
            if (text.trim().startsWith("[")) throw new Refused();
            return readScalar(text);
          });
        }
      } else {
        if (children.some((child) => child.trim() !== "")) throw new Refused();
        value = rawValue.trim().startsWith("[")
          ? readFlowList(rawValue)
          : readScalar(rawValue);
      }
      data.set(key, value);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      rejected.push(key);
    }
  }
  return { data, rejected };
}

/** Splits a Markdown text into its front matter and body. */
export function readFrontMatter(text: string): FrontMatterRead {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const none: FrontMatterRead = {
    data: new Map(),
    body: text,
    rejected: [],
    tooLarge: false,
  };
  const opening = /^---[ \t]*\r?\n/.exec(source);
  if (!opening) return none;

  let offset = opening[0].length;
  const lines: string[] = [];
  while (offset <= source.length) {
    const newline = source.indexOf("\n", offset);
    const end = newline === -1 ? source.length : newline;
    const line = source.slice(offset, end).replace(/\r$/, "");
    const next = newline === -1 ? source.length : newline + 1;
    if (FENCE_END.test(line)) {
      const body = source.slice(next);
      const bytes = new TextEncoder().encode(source.slice(0, next)).length;
      if (bytes > FRONT_MATTER_MAX_BYTES) {
        return { data: new Map(), body, rejected: [], tooLarge: true };
      }
      return { ...readBlock(lines), body, tooLarge: false };
    }
    if (newline === -1) break;
    lines.push(line);
    offset = next;
  }
  return none;
}
