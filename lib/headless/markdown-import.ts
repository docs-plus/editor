import type { JSONContent } from "@tiptap/core";

import { cleanText } from "@/lib/clean-text";

import { type FrontMatterValue, readFrontMatter } from "./front-matter";
import {
  getHeadlessSchema,
  proseMirrorFromJSON,
  SchemaMismatchError,
} from "./headless-schema";
import { parseMarkdownBody } from "./markdown";

/** Library tag limits (details spec §3). */
export const TAG_MAX_LENGTH = 40;
export const TAGS_PER_DOCUMENT = 20;

/** Front matter properties the library keeps. */
const KEPT_PROPERTIES = new Set([
  "title",
  "tags",
  "created",
  "date",
  "modified",
  "updated",
]);

export interface MarkdownImportOptions {
  /** The source file's name, the title of last resort. */
  fileName?: string;
}

export interface MarkdownImport {
  title: string;
  tags: string[];
  /** Epoch milliseconds, or null when the file gives none. */
  createdAt: number | null;
  modifiedAt: number | null;
  /** Title-first ProseMirror JSON, valid in the editor schema. */
  doc: JSONContent;
  /** Front matter keys not kept (unknown, or refused by the reader). */
  droppedProperties: string[];
  /** Tags over the length or count limit, or duplicates. */
  droppedTags: number;
}

function stringValue(value: FrontMatterValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function dateValue(value: FrontMatterValue | undefined): number | null {
  const text = stringValue(value);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

function readTags(value: FrontMatterValue | undefined): {
  tags: string[];
  dropped: number;
} {
  const raw =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value
        : [];
  const tags: string[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const entry of raw) {
    const tag = cleanText(entry).replace(/^#+/, "").trim();
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (
      tag.length > TAG_MAX_LENGTH ||
      seen.has(key) ||
      tags.length >= TAGS_PER_DOCUMENT
    ) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    tags.push(tag);
  }
  return { tags, dropped };
}

/**
 * Block nodes the Markdown parser left inside a paragraph (media embeds
 * written as `![youtube](…)`) move out of it, splitting the paragraph.
 */
function liftBlocks(node: JSONContent): JSONContent {
  if (!node.content) return node;
  const { nodes } = getHeadlessSchema();
  const content: JSONContent[] = [];
  for (const child of node.content.map(liftBlocks)) {
    const inner = child.content ?? [];
    if (
      child.type !== "paragraph" ||
      !inner.some((item) => nodes[item.type ?? ""]?.isBlock)
    ) {
      content.push(child);
      continue;
    }
    let run: JSONContent[] = [];
    const flush = () => {
      if (run.some((item) => item.type !== "text" || item.text?.trim())) {
        content.push({ ...child, content: run });
      }
      run = [];
    };
    for (const item of inner) {
      if (nodes[item.type ?? ""]?.isBlock) {
        flush();
        content.push(item);
      } else {
        run.push(item);
      }
    }
    flush();
  }
  return { ...node, content };
}

function headingText(node: JSONContent | undefined): string | null {
  if (node?.type !== "heading") return null;
  return cleanText(
    (node.content ?? [])
      .map((child) => (child.type === "hardBreak" ? " " : (child.text ?? "")))
      .join(""),
  );
}

function fileStem(fileName: string | undefined): string | null {
  if (!fileName) return null;
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const stem = cleanText(base.replace(/\.[^.]+$/, ""));
  return stem || null;
}

/**
 * A Markdown file as a title-first document plus library metadata.
 *
 * Title: front matter `title` › a leading H1 › the file name. A leading
 * heading equal to the title is the title, so an exported file comes back
 * without a repeated title. Throws `SchemaMismatchError` when the result
 * does not fit the schema.
 *
 * Not yet the full import engine (IM1): `javascript:` and `data:` links
 * come back with an empty href, but raw HTML is not sanitised, there are
 * no size caps, and images are not run through the image pipeline. Use it
 * on untrusted files only behind IM1's guards.
 */
export function importMarkdown(
  text: string,
  options: MarkdownImportOptions = {},
): MarkdownImport {
  const { data, body, rejected } = readFrontMatter(text);
  const parsed = liftBlocks(parseMarkdownBody(body));
  const blocks = parsed.content ?? [];

  const frontTitle = stringValue(data.get("title"));
  const cleanFrontTitle = frontTitle === null ? null : cleanText(frontTitle);
  const leading = headingText(blocks[0]);
  const leadingIsTitle =
    leading !== null &&
    (cleanFrontTitle === null
      ? blocks[0].attrs?.level === 1
      : leading === cleanFrontTitle);

  let title: string;
  let content: JSONContent[];
  if (leadingIsTitle) {
    title = leading;
    content = blocks;
  } else {
    title = cleanFrontTitle ?? fileStem(options.fileName) ?? "";
    const heading: JSONContent = { type: "heading", attrs: { level: 1 } };
    if (title) heading.content = [{ type: "text", text: title }];
    content = [heading, ...blocks];
  }

  const doc: JSONContent = { type: "doc", content };
  try {
    proseMirrorFromJSON(doc);
  } catch (error) {
    throw new SchemaMismatchError((error as Error).message);
  }

  const { tags, dropped } = readTags(data.get("tags"));
  return {
    title,
    tags,
    createdAt: dateValue(data.get("created") ?? data.get("date")),
    modifiedAt: dateValue(data.get("modified") ?? data.get("updated")),
    doc,
    droppedProperties: [
      ...[...data.keys()].filter((key) => !KEPT_PROPERTIES.has(key)),
      ...rejected,
    ],
    droppedTags: dropped,
  };
}
