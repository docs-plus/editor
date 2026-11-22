/**
 * Document fixtures (test strategy §3.2): Tiptap JSON and the Yjs state the
 * editor would store for it, built from a seed.
 *
 * Every Y.Doc gets its `clientID` from the seed: Yjs mints a random one, and
 * the same seed must give the same bytes.
 */
import type { JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { EDITOR_FRAGMENT_NAME } from "@/lib/yjs-mark-migration";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { getEditorSchema } from "@/tests/helpers/editor-schema";

import { dataUrl, syntheticPng } from "./images";
import type { Rng } from "./rng";

export type DocJson = { type: "doc"; content: JSONContent[] };

/** Production's per-document cap (`MAX_DOC_SIZE_BYTES`, 2 MiB). */
export const PRODUCTION_DOC_CAP_BYTES = 2 * 1024 * 1024;
/** `doc-near-cap`: 1.9 MiB of state, just under the production cap. */
export const NEAR_CAP_TARGET_BYTES = Math.floor(1.9 * 1024 * 1024);

let schema: Schema | null = null;
function editorSchema(): Schema {
  schema ??= getEditorSchema();
  return schema;
}

/** A Y.Doc whose client id comes from the seed, so its bytes replay. */
export function seededYDoc(rng: Rng): Y.Doc {
  const doc = new Y.Doc();
  // Yjs client ids are 32-bit unsigned; 0 is legal but unusual.
  doc.clientID = rng.int(1, 0xffffffff);
  return doc;
}

/** The Yjs update the editor stores for `json`, on the real schema. */
export function jsonToYState(json: DocJson, rng: Rng): Uint8Array {
  const doc = seededYDoc(rng);
  prosemirrorJSONToYXmlFragment(
    editorSchema(),
    json,
    doc.getXmlFragment(EDITOR_FRAGMENT_NAME),
  );
  return Y.encodeStateAsUpdate(doc);
}

function heading(level: number, text: string): JSONContent {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

/** `doc-large`: the `generateLargeDocument` defaults, seeded. */
export function largeDocument(headings: number, rng: Rng): DocJson {
  return generateLargeDocument(headings, { random: rng.next });
}

const FILLER = [
  "Near the cap, every keystroke costs a little more to store and send.",
  "This paragraph exists to grow the document towards its size limit.",
  "Size refusals must name the document and leave the editor read-only.",
  "Deletes stay allowed at the cap, so a full document can always shrink.",
];

/**
 * `doc-near-cap`: a title, then paragraphs until the Yjs state reaches
 * `target` bytes, always below `cap`. Built on the Y types directly (the
 * shape y-prosemirror writes for a paragraph), measuring as it grows.
 */
export function nearCapDocument(
  rng: Rng,
  target = NEAR_CAP_TARGET_BYTES,
  cap = PRODUCTION_DOC_CAP_BYTES,
): Uint8Array {
  const doc = seededYDoc(rng);
  const fragment = doc.getXmlFragment(EDITOR_FRAGMENT_NAME);
  prosemirrorJSONToYXmlFragment(
    editorSchema(),
    { type: "doc", content: [heading(1, "Near the size cap")] },
    fragment,
  );
  const appendParagraphs = (count: number) =>
    doc.transact(() => {
      const texts = Array.from({ length: count }, () => new Y.XmlText());
      const paragraphs = texts.map((text) => {
        const p = new Y.XmlElement("paragraph");
        p.insert(0, [text]);
        return p;
      });
      // One push per batch: `push` walks to the fragment's end each time.
      fragment.push(paragraphs);
      for (const text of texts)
        text.insert(0, `${rng.pick(FILLER)} ${rng.hex(8)}`);
    });
  let size = Y.encodeStateAsUpdate(doc).byteLength;
  while (size < target) {
    // Each paragraph adds about 90 bytes; approach the target in halves.
    appendParagraphs(Math.max(1, Math.floor((target - size) / 180)));
    size = Y.encodeStateAsUpdate(doc).byteLength;
  }
  const state = Y.encodeStateAsUpdate(doc);
  if (state.byteLength >= cap)
    throw new Error(`doc-near-cap overshot the cap: ${state.byteLength}`);
  return state;
}

/**
 * Persian sentences written for this fixture. They carry ZWNJ (U+200C,
 * نیم‌فاصله), Arabic-script diacritics (fatha, kasra, damma, shadda, sukun,
 * tanwin) and embedded Latin words and digits.
 */
const PERSIAN = [
  "این سند برای آزمایش نوشتار راست‌به‌چپ ساخته شده است.",
  "ویرایشگر باید فاصله‌ها و نیم‌فاصله‌ها را درست نگه دارد.",
  "کتاب‌خانه‌ی شخصی شما روی همین دستگاه ذخیره می‌شود.",
  "دَرسِ اَوَّل: نِوِشتَنِ جُملِه‌هایِ کوتاه و روشَن.",
  "مَثَلاً این جمله تنوین دارد و حَتماً باید درست نمایش داده شود.",
  "نسخه‌ی 1.2.0 از TinyDocy روی macOS و Windows اجرا می‌شود.",
  "فهرست‌ها، نقل‌قول‌ها و جدول‌ها هم باید راست‌چین بمانند.",
];

const PERSIAN_HEADINGS = ["پیش‌گفتار", "نوشتار و فاصله", "متن آمیخته", "پایان"];

const ENGLISH = [
  "This block is left to right, between two right-to-left sections.",
  "Mixed direction: the word «سلام» sits inside an English sentence.",
];

/** `doc-rtl`: a Persian title and body, with mixed RTL and LTR blocks. */
export function rtlDocument(rng: Rng): DocJson {
  const content: JSONContent[] = [heading(1, "آزمایش نوشتار فارسی")];
  for (const [i, title] of PERSIAN_HEADINGS.entries()) {
    content.push(heading(2, title));
    for (let j = 0; j < 3; j++) content.push(paragraph(rng.pick(PERSIAN)));
    if (i % 2 === 1) content.push(paragraph(rng.pick(ENGLISH)));
    if (i === 2)
      content.push({
        type: "bulletList",
        content: PERSIAN.slice(0, 3).map((text) => ({
          type: "listItem",
          content: [paragraph(text)],
        })),
      });
  }
  return { type: "doc", content };
}

/**
 * `doc-legacy`: what stored documents from before the @docs.plus swap hold.
 * The `link` and `code` marks are not in today's schema, so the Y types are
 * written by hand, as the old editor wrote them; the fragment also keeps a
 * bare text root at the top level (an editor-root leftover the server's
 * root sweep removes).
 */
export function legacyDocument(rng: Rng): Uint8Array {
  const doc = seededYDoc(rng);
  const fragment = doc.getXmlFragment(EDITOR_FRAGMENT_NAME);
  doc.transact(() => {
    const title = new Y.XmlElement("heading");
    title.setAttribute("level", 1 as unknown as string);
    const titleText = new Y.XmlText();
    title.insert(0, [titleText]);

    const body = new Y.XmlElement("paragraph");
    const bodyText = new Y.XmlText();
    body.insert(0, [bodyText]);

    const leftover = new Y.XmlText();
    fragment.insert(0, [title, body, leftover]);

    titleText.insert(0, "Legacy marks");
    bodyText.insert(0, "Read ");
    bodyText.insert(5, "the docs", { link: { href: "https://docs.plus" } });
    bodyText.insert(13, ", then run ");
    bodyText.insert(24, "bun install", { code: {} });
    bodyText.insert(35, ".");
    leftover.insert(0, "stray root text");
  });
  return Y.encodeStateAsUpdate(doc);
}

/** `doc-images` (inline part): images stored as `data:` URLs before P2.6c. */
export function inlineImagesDocument(rng: Rng, count = 10): DocJson {
  const content: JSONContent[] = [heading(1, "Inline images")];
  for (let i = 0; i < count; i++) {
    const png = syntheticPng(rng, rng.int(16, 48), rng.int(16, 48));
    content.push(paragraph(`Figure ${i + 1}`), {
      type: "image",
      attrs: { src: dataUrl("image/png", png), alt: `Figure ${i + 1}` },
    });
  }
  return { type: "doc", content };
}
