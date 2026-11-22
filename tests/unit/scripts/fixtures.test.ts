import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { sweepEditorRoot } from "@/lib/security/editor-root-sweep";
import {
  EDITOR_FRAGMENT_NAME,
  migrateLegacyMarks,
} from "@/lib/yjs-mark-migration";
import { fixtureCacheKey } from "@/scripts/fixtures/cache-key";
import {
  inlineImagesDocument,
  jsonToYState,
  largeDocument,
  legacyDocument,
  NEAR_CAP_TARGET_BYTES,
  nearCapDocument,
  PRODUCTION_DOC_CAP_BYTES,
  rtlDocument,
} from "@/scripts/fixtures/documents";
import { DEFAULT_SEED, main } from "@/scripts/fixtures/generate";
import {
  gifBomb,
  HOSTILE_TITLES,
  htmlPngPolyglot,
  unknownRootsState,
} from "@/scripts/fixtures/hostile";
import {
  exifSamples,
  PHOTO_HEIGHT,
  PHOTO_WIDTH,
  syntheticPhoto,
  syntheticPng,
} from "@/scripts/fixtures/images";
import { generateLibrary } from "@/scripts/fixtures/libraries";
import { createRng, parseSeed } from "@/scripts/fixtures/rng";
import {
  DEFERRED_SETS,
  DOC_IMAGES_COUNTS,
  FIXTURE_SETS,
  findSet,
  generateSet,
  LIBRARY_SPECS,
} from "@/scripts/fixtures/sets";
import { generateLargeDocument } from "@/tests/helpers/document-generators";

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tinydocy-fixtures-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function decodeState(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

/** Width, height and inflated pixel bytes of a PNG this module wrote. */
function readPng(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: { type: string; data: Uint8Array }[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8));
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  const ihdr = chunks[0].data;
  const ihdrView = new DataView(ihdr.buffer, ihdr.byteOffset);
  const idat = chunks.find((c) => c.type === "IDAT")?.data ?? new Uint8Array();
  return {
    types: chunks.map((c) => c.type),
    width: ihdrView.getUint32(0),
    height: ihdrView.getUint32(4),
    pixels: inflateSync(idat),
  };
}

describe("seeded rng", () => {
  it("replays the same sequence for a seed, and another for another seed", () => {
    const a = createRng(7);
    const b = createRng(7);
    const c = createRng(8);
    const draw = (rng: ReturnType<typeof createRng>) =>
      Array.from({ length: 5 }, () => rng.next());
    const first = draw(a);
    expect(draw(b)).toEqual(first);
    expect(draw(c)).not.toEqual(first);
    for (const n of first) expect(n >= 0 && n < 1).toBe(true);
  });

  it("mints UUIDs the engine's guards accept", () => {
    const rng = createRng(1);
    for (let i = 0; i < 50; i++)
      expect(rng.uuid()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    expect(rng.hex(16)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("forks streams that don't depend on how much the parent drew", () => {
    const a = createRng(3);
    const b = createRng(3);
    b.next();
    b.next();
    expect(a.fork("x").next()).toBe(b.fork("x").next());
    expect(a.fork("x").next()).not.toBe(a.fork("y").next());
  });

  it("parses --seed / SEED and refuses junk", () => {
    expect(parseSeed(undefined, 42)).toBe(42);
    expect(parseSeed("", 42)).toBe(42);
    expect(parseSeed("123", 42)).toBe(123);
    expect(() => parseSeed("-1", 42)).toThrow();
    expect(() => parseSeed("1.5", 42)).toThrow();
    expect(() => parseSeed("abc", 42)).toThrow();
    expect(DEFAULT_SEED).toBe(42);
  });
});

describe("document generators", () => {
  it("generateLargeDocument replays with a seeded random and keeps its shape", () => {
    const one = generateLargeDocument(30, { random: createRng(5).next });
    const two = generateLargeDocument(30, { random: createRng(5).next });
    expect(two).toEqual(one);
    expect(one.content.filter((n) => n.type === "heading")).toHaveLength(30);
  });

  it("encodes JSON to identical Yjs bytes for a seed, on the real schema", () => {
    const doc = largeDocument(8, createRng(9));
    const a = jsonToYState(doc, createRng(10));
    const b = jsonToYState(doc, createRng(10));
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    const back = yDocToProsemirrorJSON(decodeState(a), EDITOR_FRAGMENT_NAME);
    expect(back.content).toHaveLength(doc.content.length);
    expect((back.content as { type: string }[])[0].type).toBe("heading");
  });

  it("doc-near-cap grows to its target and stays under the cap", () => {
    expect(NEAR_CAP_TARGET_BYTES).toBe(Math.floor(1.9 * 1024 * 1024));
    expect(PRODUCTION_DOC_CAP_BYTES).toBe(2_097_152);
    // The real target takes a few seconds; the same loop at 1/40 scale.
    const state = nearCapDocument(createRng(2), 50_000, 52_429);
    expect(state.byteLength).toBeGreaterThanOrEqual(50_000);
    expect(state.byteLength).toBeLessThan(52_429);
    const json = yDocToProsemirrorJSON(
      decodeState(state),
      EDITOR_FRAGMENT_NAME,
    );
    expect((json.content as { type: string }[])[0].type).toBe("heading");
    expect(json.content.length).toBeGreaterThan(100);
  });

  it("doc-rtl carries Persian, ZWNJ, diacritics and LTR blocks", () => {
    const doc = rtlDocument(createRng(4));
    const text = JSON.stringify(doc);
    expect(doc.content[0].content?.[0].text).toBe("آزمایش نوشتار فارسی");
    expect(text).toContain("‌"); // ZWNJ
    expect(text).toMatch(/[ً-ْ]/); // tanwin to sukun
    expect(text).toMatch(/[A-Za-z]{4,}/);
    expect(text).toContain("bulletList");
    expect(() => jsonToYState(doc, createRng(1))).not.toThrow();
  });

  it("doc-legacy holds link and code marks the migration renames, and a root leftover", () => {
    const doc = decodeState(legacyDocument(createRng(6)));
    const fragment = doc.getXmlFragment(EDITOR_FRAGMENT_NAME);
    const paragraph = fragment.get(1) as Y.XmlElement;
    const keys = (paragraph.get(0) as Y.XmlText)
      .toDelta()
      .flatMap((d: { attributes?: object }) => Object.keys(d.attributes ?? {}));
    expect(keys).toEqual(expect.arrayContaining(["link", "code"]));
    expect(sweepEditorRoot(doc)).toEqual({ removed: 1, types: ["text"] });
    expect(migrateLegacyMarks(doc)).toBe(2);
  });

  it("doc-images inlines data-URL PNGs", () => {
    const doc = inlineImagesDocument(createRng(3), 4);
    const images = doc.content.filter((n) => n.type === "image");
    expect(images).toHaveLength(4);
    for (const image of images)
      expect(image.attrs?.src).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(DOC_IMAGES_COUNTS).toEqual({ inline: 10, assets: 200, photos: 10 });
  });
});

describe("synthetic images", () => {
  it("draws decodable PNGs that differ by seed", () => {
    const a = readPng(syntheticPng(createRng(1), 5, 3));
    expect(a.width).toBe(5);
    expect(a.height).toBe(3);
    expect(a.pixels.length).toBe(3 * (5 * 3 + 1));
    const b = readPng(syntheticPng(createRng(2), 5, 3));
    expect(Buffer.from(b.pixels).equals(Buffer.from(a.pixels))).toBe(false);
  });

  it("photos carry an eXIf block with made-up GPS, at 12 MP by default", () => {
    expect(PHOTO_WIDTH * PHOTO_HEIGHT).toBe(12_000_000);
    const photo = readPng(syntheticPhoto(createRng(1), 4, 4));
    expect(photo.types).toEqual(["IHDR", "eXIf", "IDAT", "IEND"]);
  });

  it("writes one EXIF sample per container", () => {
    const samples = exifSamples(createRng(1));
    expect(Object.keys(samples).sort()).toEqual([
      "animated.gif",
      "exif-gps-xmp.webp",
      "exif-gps.jpg",
      "exif-gps.png",
    ]);
    const jpg = samples["exif-gps.jpg"];
    expect([jpg[0], jpg[1]]).toEqual([0xff, 0xd8]);
    expect(Buffer.from(jpg).includes(Buffer.from("Exif\0\0"))).toBe(true);
  });
});

describe("hostile set", () => {
  it("names the separator, traversal, reserved and overlong cases", () => {
    for (const title of ["..", "CON", "aux", "trailing dots...", "a/b"])
      expect(HOSTILE_TITLES).toContain(title);
    expect(HOSTILE_TITLES.some((t) => t.length === 300)).toBe(true);
  });

  it("builds the polyglot, the GIF bomb and a state with unknown roots", () => {
    const polyglot = htmlPngPolyglot();
    expect(Array.from(polyglot.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    expect(Buffer.from(polyglot).includes(Buffer.from("<html>"))).toBe(true);
    const bomb = new DataView(gifBomb().buffer);
    expect(bomb.getUint16(6, true)).toBe(65_535);
    expect(bomb.getUint16(8, true)).toBe(65_535);
    const doc = decodeState(unknownRootsState(createRng(1)));
    expect([...doc.share.keys()].sort()).toEqual([
      "comments-v0",
      "default",
      "evil",
    ]);
  });
});

describe("libraries", () => {
  const small = {
    docs: 12,
    folderFanOut: [2, 2],
    tags: 3,
    content: "rich",
  } as const;

  it("writes folders, tags and documents through the engine, reproducibly", () => {
    const a = generateLibrary(join(tempDir(), "lib"), small, createRng(11));
    const b = generateLibrary(join(tempDir(), "lib"), small, createRng(11));
    const c = generateLibrary(join(tempDir(), "lib"), small, createRng(12));
    expect(a).toMatchObject({
      docs: 12,
      folders: 6,
      maxFolderDepth: 2,
      tags: 3,
    });
    expect(a.taggedDocs).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(c.contentSha256).not.toBe(a.contentSha256);
  });

  it("defines the §3.2 sizes", () => {
    expect(LIBRARY_SPECS["library-s"]).toMatchObject({
      docs: 20,
      folderFanOut: [3],
      tags: 5,
    });
    expect(LIBRARY_SPECS["library-1k"]).toMatchObject({ docs: 1000, tags: 30 });
    expect(LIBRARY_SPECS["library-1k"].folderFanOut).toHaveLength(4);
    expect(LIBRARY_SPECS["library-10k"]).toMatchObject({
      docs: 10_000,
      content: "titles",
    });
  });
});

describe("fixture sets", () => {
  it("lists every §3.2 set as built or deferred", () => {
    const built = FIXTURE_SETS.map((s) => s.name);
    expect(built).toEqual([
      "library-s",
      "library-1k",
      "library-10k",
      "doc-large",
      "doc-near-cap",
      "doc-images",
      "doc-rtl",
      "doc-legacy",
      "exif",
      "hostile",
    ]);
    expect(Object.keys(DEFERRED_SETS)).toEqual(
      expect.arrayContaining(["doc-comments", "prefs/", "web-library/"]),
    );
    expect(() => findSet("doc-comments")).toThrow(/waits on/);
    expect(() => findSet("prefs")).toThrow(/waits on/);
    expect(() => findSet("nope")).toThrow(/unknown fixture set/);
  });

  it("writes the same bytes for the same seed", () => {
    const names = ["doc-rtl", "doc-legacy", "exif", "hostile", "library-s"];
    const run = () => {
      const out = tempDir();
      return names.map((name) =>
        generateSet(findSet(name), out, createRng(DEFAULT_SEED)),
      );
    };
    const first = run();
    expect(run()).toEqual(first);
    const hostile = first.find((m) => m.set === "hostile");
    expect(hostile?.files.map((f) => f.path)).toContain("titles.json");
    expect(first.find((m) => m.set === "library-s")?.library?.docs).toBe(20);
  });
});

describe("cache key", () => {
  it("is stable and changes when a source changes", () => {
    const root = tempDir();
    mkdirSync(join(root, "gen"));
    writeFileSync(join(root, "gen", "a.ts"), "export const a = 1;");
    writeFileSync(join(root, "lock"), "v1");
    const sources = ["gen", "lock"];
    const key = fixtureCacheKey(root, sources);
    expect(key).toMatch(/^fixtures-[0-9a-f]{16}$/);
    expect(fixtureCacheKey(root, sources)).toBe(key);
    writeFileSync(join(root, "lock"), "v2");
    expect(fixtureCacheKey(root, sources)).not.toBe(key);
  });

  it("covers the repo's real sources", () => {
    expect(fixtureCacheKey(process.cwd())).toMatch(/^fixtures-[0-9a-f]{16}$/);
  });
});

describe("generate.ts CLI", () => {
  it("prints the seed and writes the manifest", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const out = tempDir();
      expect(main(["--set", "doc-legacy", "--out", out], { SEED: "9" })).toBe(
        0,
      );
      expect(log.mock.calls[0]?.[0]).toBe("seed=9");
      const manifest = JSON.parse(
        readFileSync(join(out, "doc-legacy", "manifest.json"), "utf8"),
      );
      expect(manifest).toMatchObject({ set: "doc-legacy", seed: 9 });
    } finally {
      log.mockRestore();
    }
  });

  it("needs --out and a set", () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main(["--set", "doc-rtl"], {})).toBe(2);
      expect(main(["--out", tempDir()], {})).toBe(2);
    } finally {
      error.mockRestore();
    }
  });
});
