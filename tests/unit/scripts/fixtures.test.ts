import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { inflateSync } from "node:zlib";

import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { SAFE_ID } from "@/desktop/storage/engine/library-index";
import { sweepEditorRoot } from "@/lib/security/editor-root-sweep";
import {
  EDITOR_FRAGMENT_NAME,
  migrateLegacyMarks,
} from "@/lib/yjs-mark-migration";
import {
  FIXTURE_IMPORT_BOUNDARY,
  FIXTURE_SOURCES,
  fixtureCacheKey,
} from "@/scripts/fixtures/cache-key";
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
  docImagesSet,
  docLargeSet,
  docNearCapSet,
  FIXTURE_SETS,
  type FixtureManifest,
  type FixtureSet,
  findSet,
  generateSet,
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

/** Off by default: `FIXTURES_FULL_SIZE=1` runs the full-size sets too. */
const FULL_SIZE = process.env.FIXTURES_FULL_SIZE === "1";

/**
 * Generates `set` twice into fresh folders with the same seed. Returns the
 * first manifest after checking both match and that every listed sha256 is
 * the file's bytes on disk.
 */
function generateTwice(set: FixtureSet): FixtureManifest {
  const runs = [tempDir(), tempDir()].map((out) => {
    const manifest = generateSet(set, out, createRng(DEFAULT_SEED));
    for (const file of manifest.files) {
      const bytes = readFileSync(join(out, set.name, file.path));
      expect(bytes.byteLength).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        file.sha256,
      );
    }
    return manifest;
  });
  expect(runs[1]).toEqual(runs[0]);
  return runs[0];
}

const countUnder = (manifest: FixtureManifest, prefix: string) =>
  manifest.files.filter((f) => f.path.startsWith(prefix)).length;

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

  it("mints version-4 UUIDs that are also safe ids", () => {
    // The engine's own UUID check runs on every createDoc in the library
    // tests below; its SAFE_ID guard is exported, so check that here too.
    const rng = createRng(1);
    for (let i = 0; i < 50; i++) {
      const id = rng.uuid();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(id).toMatch(SAFE_ID);
    }
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
    // A tight window at small scale: the loop lands between target and cap.
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

  it("keeps the invisible-character titles, written as escapes", () => {
    expect(HOSTILE_TITLES).toContain("\u202Egnp.exe");
    expect(HOSTILE_TITLES).toContain("zero\u200Bwidth");
    const decomposed = HOSTILE_TITLES.find((t) => t.endsWith(" decomposed"));
    expect(decomposed).toBe("e\u0301 decomposed");
    expect(decomposed).not.toBe(decomposed?.normalize("NFC"));
    // No raw bidi controls or zero-width characters in the source itself.
    const source = readFileSync(
      join(process.cwd(), "scripts/fixtures/hostile.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B]|\u0301/);
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

  it("refuses a folder that already holds a library", () => {
    const dir = join(tempDir(), "lib");
    generateLibrary(dir, small, createRng(11));
    expect(() => generateLibrary(dir, small, createRng(12))).toThrow(
      /not empty/,
    );
  });

  it("generates library-s and library-1k at their §3.2 sizes", () => {
    const sizes = (name: string) =>
      generateSet(findSet(name), tempDir(), createRng(DEFAULT_SEED)).library;
    expect(sizes("library-s")).toMatchObject({
      docs: 20,
      folders: 3,
      maxFolderDepth: 1,
      tags: 5,
    });
    expect(sizes("library-1k")).toMatchObject({
      docs: 1000,
      folders: 4 + 4 * 3 + 4 * 3 * 2 + 4 * 3 * 2 * 2,
      maxFolderDepth: 4,
      tags: 30,
    });
  });

  it.skipIf(!FULL_SIZE)(
    "replays library-1k and library-10k at full size (FIXTURES_FULL_SIZE=1)",
    () => {
      expect(generateTwice(findSet("library-1k")).library?.docs).toBe(1000);
      expect(generateTwice(findSet("library-10k")).library).toMatchObject({
        docs: 10_000,
        folders: 0,
        tags: 0,
      });
    },
    60_000,
  );
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

  it("replays doc-large, with small heading counts", () => {
    const manifest = generateTwice(docLargeSet([12, 20]));
    expect(manifest.files.map((f) => f.path)).toEqual([
      "doc-large-12.json",
      "doc-large-12.ystate",
      "doc-large-20.json",
      "doc-large-20.ystate",
    ]);
  });

  it("replays doc-large at full size", () => {
    const manifest = generateTwice(findSet("doc-large"));
    expect(manifest.files).toHaveLength(4);
  });

  it("replays doc-near-cap at full size, between 1.9 MiB and the cap", () => {
    const [state] = generateTwice(findSet("doc-near-cap")).files;
    expect(state.path).toBe("doc-near-cap.ystate");
    expect(state.bytes).toBeGreaterThanOrEqual(NEAR_CAP_TARGET_BYTES);
    expect(state.bytes).toBeLessThan(PRODUCTION_DOC_CAP_BYTES);
  });

  it("replays doc-near-cap at a reduced target", () => {
    const [state] = generateTwice(docNearCapSet(30_000)).files;
    expect(state.bytes).toBeGreaterThanOrEqual(30_000);
  });

  it("replays doc-images, with small counts and photos", () => {
    const manifest = generateTwice(
      docImagesSet({
        counts: { inline: 2, assets: 3, photos: 2 },
        photoWidth: 16,
        photoHeight: 12,
      }),
    );
    expect(countUnder(manifest, "assets/")).toBe(3);
    expect(countUnder(manifest, "photos/")).toBe(2);
    expect(manifest.files).toHaveLength(2 + 3 + 2);
  });

  it("writes doc-images with the §3.2 counts: 10 inline, 200 assets, 10 photos", () => {
    const out = tempDir();
    const manifest = generateSet(
      docImagesSet({ photoWidth: 4, photoHeight: 4 }),
      out,
      createRng(DEFAULT_SEED),
    );
    expect(countUnder(manifest, "assets/")).toBe(200);
    expect(countUnder(manifest, "photos/")).toBe(10);
    expect(manifest.files).toHaveLength(2 + 200 + 10);
    const inline = JSON.parse(
      readFileSync(join(out, "doc-images", "inline-images.json"), "utf8"),
    ) as { content: { type: string }[] };
    expect(inline.content.filter((n) => n.type === "image")).toHaveLength(10);
  });

  it.skipIf(!FULL_SIZE)(
    "replays doc-images with 12 MP photos (FIXTURES_FULL_SIZE=1)",
    () => {
      const manifest = generateTwice(findSet("doc-images"));
      expect(countUnder(manifest, "photos/")).toBe(10);
      for (const photo of manifest.files.filter((f) =>
        f.path.startsWith("photos/"),
      ))
        expect(photo.bytes).toBeGreaterThan(1_000_000);
    },
    120_000,
  );

  it("refuses a set folder with files in it, and --force replaces it", () => {
    const out = tempDir();
    const set = findSet("doc-legacy");
    generateSet(set, out, createRng(1));
    writeFileSync(join(out, "doc-legacy", "stale.txt"), "left over");
    expect(() => generateSet(set, out, createRng(1))).toThrow(/not empty/);
    generateSet(set, out, createRng(1), { force: true });
    expect(readdirSync(join(out, "doc-legacy")).sort()).toEqual([
      "doc-legacy.ystate",
      "manifest.json",
    ]);
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

  it("lists every module the generators import", () => {
    const root = process.cwd();
    const missing = fixtureImportClosure(root).filter(
      (file) =>
        !FIXTURE_SOURCES.some(
          (source) => file === source || file.startsWith(`${source}/`),
        ),
    );
    expect(missing).toEqual([]);
  });
});

/**
 * Repo files reachable through `@/` and relative imports from the
 * generators, stopping at {@link FIXTURE_IMPORT_BOUNDARY}.
 */
function fixtureImportClosure(root: string): string[] {
  const transpiler = new Bun.Transpiler({ loader: "tsx" });
  const resolveImport = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = join(root, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
    else return null; // a package: bun.lock covers it
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
      join(base, "index.tsx"),
    ])
      if (existsSync(candidate) && statSync(candidate).isFile())
        return candidate;
    throw new Error(`can't resolve ${spec} from ${from}`);
  };
  const seen = new Set<string>();
  const stack = [
    ...readdirSync(join(root, "scripts/fixtures")).map((f) =>
      join(root, "scripts/fixtures", f),
    ),
    join(root, "tests/helpers/storage-library.ts"),
  ];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = relative(root, file).split("\\").join("/");
    if (!/\.tsx?$/.test(file) || FIXTURE_IMPORT_BOUNDARY.includes(rel))
      continue;
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      const next = resolveImport(file, path);
      if (next) stack.push(next);
    }
  }
  return [...seen].map((f) => relative(root, f).split("\\").join("/")).sort();
}

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

  it("prints one line and exits 2 on bad input, never a stack trace", () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const out = tempDir();
      const cases: [string[], Record<string, string>, RegExp][] = [
        [["--set", "doc-comments", "--out", out], {}, /waits on/],
        [["--set", "nope", "--out", out], {}, /unknown fixture set/],
        [["--set", "doc-rtl", "--out", out], { SEED: "abc" }, /seed/i],
        [["--bogus"], {}, /bogus/],
      ];
      for (const [argv, env, message] of cases) {
        error.mockClear();
        expect(main(argv, env)).toBe(2);
        expect(String(error.mock.calls[0]?.[0])).toMatch(message);
      }
      expect(main(["--set", "doc-rtl", "--out", out], {})).toBe(0);
      error.mockClear();
      expect(main(["--set", "doc-rtl", "--out", out], {})).toBe(2);
      expect(String(error.mock.calls[0]?.[0])).toMatch(/--force/);
      expect(main(["--set", "doc-rtl", "--out", out, "--force"], {})).toBe(0);
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  });
});
