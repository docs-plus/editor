/**
 * File and folder names from document titles (desktop architecture
 * `filenames.ts`, web library §6.1): safe on macOS, Windows and Linux for
 * exports, backups and the web library's backup zip. Pure, so the desktop
 * and the web library share it.
 */
import { cleanText } from "@/lib/clean-text";

/** Longest file or folder name: 255 UTF-8 bytes (ext4), within NTFS/APFS's 255 UTF-16 units. */
export const MAX_NAME_BYTES = 255;
export const MAX_NAME_CHARS = 255;
/** Longest relative path written under an export or backup folder. */
export const MAX_PATH_CHARS = 240;

/** Name for a title that cleans to nothing. */
export const UNTITLED = "Untitled";

/** Characters Windows forbids in names; `/` and `\` are separators. */
const FORBIDDEN_CHARS = /[<>:"/\\|?*]/g;

const LONE_SURROGATES =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Windows device names, reserved with any extension (`nul.tar.gz`) and
 * with trailing spaces (`CON .txt`), including the superscript-digit ports.
 */
const RESERVED_NAME =
  /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

const encoder = new TextEncoder();
const utf8Bytes = (value: string) => encoder.encode(value).length;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Leading dots (hidden files, `..`) and spaces; trailing dots and spaces (Windows). */
function trimEdges(value: string): string {
  return value.replace(/^[.\s]+/u, "").replace(/[.\s]+$/u, "");
}

/** `con` → `con_`, `nul.tar` → `nul_.tar`. */
function avoidReserved(value: string): string {
  const dot = value.indexOf(".");
  const base = (dot === -1 ? value : value.slice(0, dot)).trimEnd();
  return RESERVED_NAME.test(base)
    ? `${base}_${value.slice(base.length)}`
    : value;
}

/**
 * `stem` cut at a grapheme boundary to at most `maxChars` UTF-16 units and
 * `maxBytes` UTF-8 bytes, then made safe again (a cut can leave a trailing
 * dot or uncover a reserved name). Keeps at least one grapheme, so a
 * budget under 5 can be overrun by a reserved name's `_`.
 */
function fitStem(stem: string, maxChars: number, maxBytes: number): string {
  let out = "";
  let bytes = 0;
  for (const { segment } of segmenter.segment(stem)) {
    const size = utf8Bytes(segment);
    if (
      out &&
      (out.length + segment.length > maxChars || bytes + size > maxBytes)
    ) {
      break;
    }
    out += segment;
    bytes += size;
  }
  return (
    avoidReserved(trimEdges(out)) || UNTITLED.slice(0, Math.max(1, maxChars))
  );
}

/**
 * A safe file or folder name for `title`, with no extension: NFC; control,
 * bidi and zero-width characters, separators and `<>:"|?*` become spaces;
 * whitespace collapses; no leading dot, no trailing dot or space; Windows
 * device names get `_`; at most 255 UTF-8 bytes; never empty.
 */
export function cleanFileStem(title: string): string {
  const cleaned = cleanText(
    title.replace(LONE_SURROGATES, "").replace(FORBIDDEN_CHARS, " "),
  );
  return fitStem(
    avoidReserved(trimEdges(cleaned)) || UNTITLED,
    MAX_NAME_CHARS,
    MAX_NAME_BYTES,
  );
}

const SAFE_PART = /^[A-Za-z0-9_-]+$/;

export interface FileNameOptions {
  /** Without the dot, e.g. `md` or `tinydoc`. */
  extension: string;
  /** Appended as `-<id>`, so documents with the same title don't collide. */
  shortId?: string;
  /** Character budget for the whole name (default 255). */
  maxChars?: number;
}

/** `<clean title>[-<short id>].<extension>`, cut to fit its budget. */
export function fileName(title: string, options: FileNameOptions): string {
  const { extension, shortId, maxChars = MAX_NAME_CHARS } = options;
  if (
    !SAFE_PART.test(extension) ||
    (shortId !== undefined && !SAFE_PART.test(shortId))
  ) {
    throw new Error("extension and shortId must be [A-Za-z0-9_-]+");
  }
  const suffix = `${shortId ? `-${shortId}` : ""}.${extension}`;
  const stem = fitStem(
    cleanFileStem(title),
    maxChars - suffix.length,
    MAX_NAME_BYTES - utf8Bytes(suffix),
  );
  return stem + suffix;
}

/**
 * The key two names collide under on macOS and Windows: case-insensitive
 * and normalisation-insensitive.
 */
export function nameKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

export interface UniqueNameOptions {
  /** A folder name: no extension to keep after the suffix. */
  folder?: boolean;
  maxChars?: number;
}

/**
 * `name`, or `name (2)`, `name (3)`… before the extension, whichever is not
 * in `taken` (a set of `nameKey`s). The caller adds the result to `taken`.
 */
export function uniqueName(
  name: string,
  taken: ReadonlySet<string>,
  options: UniqueNameOptions = {},
): string {
  if (!taken.has(nameKey(name))) return name;
  const { folder = false, maxChars = MAX_NAME_CHARS } = options;
  const dot = folder ? -1 : name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let fitted = "";
  let fittedFor = -1;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})${extension}`;
    // The cut depends only on the suffix's length (ASCII digits), so a
    // run of collisions re-cuts the stem once per extra digit, not per try.
    if (suffix.length !== fittedFor) {
      fitted = fitStem(
        stem,
        maxChars - suffix.length,
        MAX_NAME_BYTES - utf8Bytes(suffix),
      );
      fittedFor = suffix.length;
    }
    const candidate = fitted + suffix;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
}

/**
 * `folder/…/file` for a document: every folder name cleaned, the file named
 * by `fileName`, and the longest part shortened until the path fits
 * `maxChars` (240 by default).
 */
export function documentPath(
  folders: readonly string[],
  title: string,
  options: FileNameOptions,
): string {
  const { maxChars = MAX_PATH_CHARS, ...nameOptions } = options;
  const parts = [...folders.map(cleanFileStem), fileName(title, nameOptions)];
  const last = parts.length - 1;
  const fixed = new Set<number>();
  const total = () => parts.reduce((sum, part) => sum + part.length, 0) + last;
  while (total() > maxChars) {
    let longest = -1;
    for (let i = 0; i <= last; i += 1) {
      if (
        !fixed.has(i) &&
        (longest === -1 || parts[i].length > parts[longest].length)
      ) {
        longest = i;
      }
    }
    if (longest === -1) throw new Error("The path cannot fit the length limit");
    const budget = Math.max(1, parts[longest].length - (total() - maxChars));
    const shorter =
      longest === last
        ? fileName(title, { ...nameOptions, maxChars: budget })
        : fitStem(parts[longest], budget, MAX_NAME_BYTES);
    if (shorter.length >= parts[longest].length) fixed.add(longest);
    else parts[longest] = shorter;
  }
  return parts.join("/");
}
