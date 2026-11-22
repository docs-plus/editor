/**
 * `hostile/` (test strategy §3.2): inputs an import, export or image path
 * must refuse or clean, never trust.
 *
 * File names that are themselves hostile (`CON`, `..`, trailing dots) can't
 * be written on every OS, so they ship as data in `titles.json`; tests feed
 * them to the code under test instead of the file system.
 */
import * as Y from "yjs";

import { EDITOR_FRAGMENT_NAME } from "@/lib/yjs-mark-migration";
import { ascii, buildPng, concat, pngChunk } from "@/tests/helpers/image-bytes";

import { seededYDoc } from "./documents";
import type { Rng } from "./rng";

/** Titles that break naive file naming (P2.8 filename cleaning). */
export const HOSTILE_TITLES: readonly string[] = [
  "a/b",
  "a\\b",
  "a:b",
  'quote"d',
  "pipe|star*question?",
  "<angle>",
  ".",
  "..",
  "../../etc/passwd",
  "..\\..\\Windows\\System32",
  "CON",
  "con",
  "aux",
  "NUL",
  "PRN",
  "COM1",
  "LPT9",
  "con.txt",
  "AUX.tinydoc",
  "trailing dots...",
  "trailing spaces   ",
  " leading space",
  "-leading-dash",
  "",
  "   ",
  "tab\tand\nnewline",
  "nul\u0000byte",
  "bell\u0007",
  "‮gnp.exe",
  "zero​width",
  "é decomposed",
  "x".repeat(300),
  "ک".repeat(300),
];

/** An SVG with a script, saved under a `.png` name (image sniffing). */
export const SVG_AS_PNG: Uint8Array = ascii(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>',
);

/**
 * A valid PNG that also carries an HTML document in a `tEXt` chunk: an
 * image decoder accepts it, an HTML sniffer may too.
 */
export function htmlPngPolyglot(): Uint8Array {
  return buildPng([
    pngChunk(
      "tEXt",
      ascii("Comment\0<html><body><script>alert(1)</script></body></html>"),
    ),
  ]);
}

/**
 * A GIF bomb: a few dozen bytes whose header and one frame claim
 * 65,535 × 65,535 pixels (about 17 GB of RGBA if decoded naively).
 */
export function gifBomb(): Uint8Array {
  return concat(
    ascii("GIF89a"),
    new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x80, 0x00, 0x00]),
    new Uint8Array([0x00, 0x00, 0x00, 0xff, 0xff, 0xff]),
    new Uint8Array([
      0x2c, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x00,
    ]),
    new Uint8Array([0x02, 0x02, 0x44, 0x01, 0x00]),
    new Uint8Array([0x3b]),
  );
}

/**
 * A Yjs update with roots the editor never writes: a map, an array and a
 * bare text in the fragment. The import guard refuses it; it never repairs.
 */
export function unknownRootsState(rng: Rng): Uint8Array {
  const doc = seededYDoc(rng);
  doc.transact(() => {
    doc.getMap("evil").set("payload", "x".repeat(64));
    doc.getArray("comments-v0").push([{ forged: true }]);
    const stray = new Y.XmlText();
    doc.getXmlFragment(EDITOR_FRAGMENT_NAME).insert(0, [stray]);
    stray.insert(0, "not an element");
  });
  return Y.encodeStateAsUpdate(doc);
}

/** The files of the set, by name. */
export function hostileFiles(rng: Rng): Record<string, Uint8Array> {
  return {
    "titles.json": new TextEncoder().encode(
      `${JSON.stringify(HOSTILE_TITLES, null, 2)}\n`,
    ),
    "svg-named.png": SVG_AS_PNG,
    "polyglot.png": htmlPngPolyglot(),
    "gif-bomb.gif": gifBomb(),
    "unknown-roots.ystate": unknownRootsState(rng),
  };
}
