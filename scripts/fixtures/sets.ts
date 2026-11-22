/**
 * The fixture sets of test strategy §3.2, by name. Each writes into its own
 * folder and returns a manifest: per-file sha256 for byte fixtures, a
 * logical summary for libraries (whose SQLite bytes vary run to run).
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  inlineImagesDocument,
  jsonToYState,
  largeDocument,
  legacyDocument,
  NEAR_CAP_TARGET_BYTES,
  nearCapDocument,
  rtlDocument,
} from "./documents";
import { hostileFiles } from "./hostile";
import {
  exifSamples,
  PHOTO_HEIGHT,
  PHOTO_WIDTH,
  syntheticPhoto,
  syntheticPng,
} from "./images";
import {
  generateLibrary,
  type LibrarySpec,
  type LibrarySummary,
} from "./libraries";
import type { Rng } from "./rng";

export type FixtureFile = { path: string; bytes: number; sha256: string };

export type FixtureManifest = {
  set: string;
  seed: number;
  files: FixtureFile[];
  library?: LibrarySummary;
};

export type FixtureSet = {
  name: string;
  contents: string;
  usedBy: string;
  generate(dir: string, rng: Rng): Omit<FixtureManifest, "set" | "seed">;
};

/** Sets of §3.2 that wait on unmerged work, and what each waits on. */
export const DEFERRED_SETS: Readonly<Record<string, string>> = {
  "doc-comments": "the comments model (P4.9)",
  "prefs/": "the preferences schema (lib/prefs, page engine)",
  "web-library/": "the web library's IndexedDB format (W2)",
  "doc-images (asset-store part)": "the asset store and blobs table (P2.6b)",
  "library-1k (images)": "the asset store and blobs table (P2.6b)",
  "hostile/ (bad .tinydoc header)": "the .tinydoc format (P2.8)",
  "doc-legacy (schema 1 and 2 bundles)":
    "DOC_SCHEMA above 0 and .tinydoc (P2.8)",
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type FileContent = Uint8Array | string;

/**
 * Writes `files` under `dir` and lists them, sorted, for the manifest. An
 * iterable is consumed one file at a time, so a generator can hand over
 * large files (the 12 MP photos) without holding them all in memory.
 */
export function writeFiles(
  dir: string,
  files: Record<string, FileContent> | Iterable<[string, FileContent]>,
): FixtureFile[] {
  const entries = Symbol.iterator in files ? files : Object.entries(files);
  const listed: FixtureFile[] = [];
  for (const [path, content] of entries) {
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    listed.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return listed.sort((a, b) => a.path.localeCompare(b.path));
}

const json = (value: unknown) => `${JSON.stringify(value)}\n`;

function librarySet(
  name: string,
  spec: LibrarySpec,
  contents: string,
  usedBy: string,
): FixtureSet {
  return {
    name,
    contents,
    usedBy,
    generate(dir, rng) {
      const library = generateLibrary(join(dir, "library"), spec, rng);
      return { files: [], library };
    },
  };
}

export const LIBRARY_SPECS = {
  "library-s": { docs: 20, folderFanOut: [3], tags: 5, content: "rich" },
  "library-1k": {
    docs: 1000,
    folderFanOut: [4, 3, 2, 2],
    tags: 30,
    content: "rich",
  },
  "library-10k": { docs: 10_000, folderFanOut: [], tags: 0, content: "titles" },
} as const satisfies Record<string, LibrarySpec>;

/** `doc-images` counts (§3.2): 10 inline, 200 asset images, 10 photos. */
export const DOC_IMAGES_COUNTS = { inline: 10, assets: 200, photos: 10 };

/** `doc-large`: one document per heading count. Tests pass small counts. */
export function docLargeSet(headingCounts: readonly number[] = [1000, 2000]) {
  return {
    name: "doc-large",
    contents: "1,000 and 2,000 headings, rich content",
    usedBy: "perf, find and replace, comments open",
    generate(dir, rng) {
      const files: Record<string, FileContent> = {};
      for (const headings of headingCounts) {
        const doc = largeDocument(headings, rng.fork(`json-${headings}`));
        files[`doc-large-${headings}.json`] = json(doc);
        files[`doc-large-${headings}.ystate`] = jsonToYState(
          doc,
          rng.fork(`y-${headings}`),
        );
      }
      return { files: writeFiles(dir, files) };
    },
  } satisfies FixtureSet;
}

/** `doc-near-cap`: Yjs state of `target` bytes, under the production cap. */
export function docNearCapSet(target = NEAR_CAP_TARGET_BYTES) {
  return {
    name: "doc-near-cap",
    contents: "1.9 MiB of Yjs state, under the 2 MiB production cap",
    usedBy: "T11, size refusals",
    generate(dir, rng) {
      return {
        files: writeFiles(dir, {
          "doc-near-cap.ystate": nearCapDocument(rng, target),
        }),
      };
    },
  } satisfies FixtureSet;
}

export type DocImagesOptions = {
  counts?: { inline: number; assets: number; photos: number };
  photoWidth?: number;
  photoHeight?: number;
};

function* docImagesFiles(
  rng: Rng,
  { counts, photoWidth, photoHeight }: Required<DocImagesOptions>,
): Generator<[string, FileContent]> {
  const inline = inlineImagesDocument(rng.fork("inline"), counts.inline);
  yield ["inline-images.json", json(inline)];
  yield ["inline-images.ystate", jsonToYState(inline, rng.fork("inline-y"))];
  const assets = rng.fork("assets");
  for (let i = 1; i <= counts.assets; i++)
    yield [
      `assets/asset-${String(i).padStart(3, "0")}.png`,
      syntheticPng(assets, assets.int(24, 64), assets.int(24, 64)),
    ];
  // One photo at a time: each is ~10 MB compressed from a 36 MB raw buffer.
  const photos = rng.fork("photos");
  for (let i = 1; i <= counts.photos; i++)
    yield [
      `photos/photo-${String(i).padStart(2, "0")}.png`,
      syntheticPhoto(photos, photoWidth, photoHeight),
    ];
}

/**
 * `doc-images`. The photos are PNGs with an `eXIf` block: no JPEG encoder
 * is in the tree, so a JPEG-only EXIF or orientation path is covered only
 * by the structural JPEG in `exif`. P2.6b adds a size-controlled
 * structural 12 MP JPEG when it needs one.
 */
export function docImagesSet(options: DocImagesOptions = {}) {
  const resolved = {
    counts: options.counts ?? DOC_IMAGES_COUNTS,
    photoWidth: options.photoWidth ?? PHOTO_WIDTH,
    photoHeight: options.photoHeight ?? PHOTO_HEIGHT,
  };
  return {
    name: "doc-images",
    contents:
      "10 inline data-URL images, 200 asset images, 10 photos of 12 MP (PNG with eXIf, not JPEG)",
    usedBy: "P2.6c, T17, T18, the image perf case",
    generate(dir, rng) {
      return { files: writeFiles(dir, docImagesFiles(rng, resolved)) };
    },
  } satisfies FixtureSet;
}

export const FIXTURE_SETS: readonly FixtureSet[] = [
  librarySet(
    "library-s",
    LIBRARY_SPECS["library-s"],
    "20 documents, 3 folders, 5 tags",
    "local and electron smoke",
  ),
  librarySet(
    "library-1k",
    LIBRARY_SPECS["library-1k"],
    "1,000 documents in 4-level folders, 30 tags (images from P2.6b)",
    "startup and sidebar budgets, T8",
  ),
  librarySet(
    "library-10k",
    LIBRARY_SPECS["library-10k"],
    "10,000 documents, titles only",
    "the P2.7b list budget",
  ),
  docLargeSet(),
  docNearCapSet(),
  docImagesSet(),
  {
    name: "doc-rtl",
    contents:
      "Persian body with diacritics and ZWNJ, mixed RTL and LTR blocks, a Persian title",
    usedBy: "P2.13, the spacing check on three engines",
    generate(dir, rng) {
      const doc = rtlDocument(rng.fork("json"));
      return {
        files: writeFiles(dir, {
          "doc-rtl.json": json(doc),
          "doc-rtl.ystate": jsonToYState(doc, rng.fork("y")),
        }),
      };
    },
  },
  {
    name: "doc-legacy",
    contents: "link and code marks, an editor-root leftover",
    usedBy: "migrations, mixed-version soak",
    generate(dir, rng) {
      return {
        files: writeFiles(dir, { "doc-legacy.ystate": legacyDocument(rng) }),
      };
    },
  },
  {
    name: "exif",
    contents: "JPEG, PNG and WebP with synthetic GPS; an animated GIF",
    usedBy: "GPS stripping, image sniffing",
    generate(dir, rng) {
      return { files: writeFiles(dir, exifSamples(rng)) };
    },
  },
  {
    name: "hostile",
    contents:
      "hostile titles, an SVG named .png, an HTML/PNG polyglot, a GIF bomb, unknown Yjs roots",
    usedBy: "P2.8, the import guard, image sniffing",
    generate(dir, rng) {
      return { files: writeFiles(dir, hostileFiles(rng)) };
    },
  },
];

export function findSet(name: string): FixtureSet {
  const set = FIXTURE_SETS.find((s) => s.name === name);
  if (set) return set;
  const deferred = DEFERRED_SETS[name] ?? DEFERRED_SETS[`${name}/`];
  throw new Error(
    deferred
      ? `fixture set "${name}" waits on ${deferred}`
      : `unknown fixture set "${name}"; known: ${FIXTURE_SETS.map((s) => s.name).join(", ")}`,
  );
}

/**
 * Generates `set` into `<outDir>/<set>/` and writes its `manifest.json`.
 * Refuses a folder that already holds files (a second run would mix two
 * libraries or leave stale files outside the manifest) unless `force`,
 * which empties it first.
 */
export function generateSet(
  set: FixtureSet,
  outDir: string,
  rng: Rng,
  options: { force?: boolean } = {},
): FixtureManifest {
  const dir = join(outDir, set.name);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    if (!options.force)
      throw new Error(
        `${dir} is not empty; pass --force to replace it, or pick another --out`,
      );
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  const manifest: FixtureManifest = {
    set: set.name,
    seed: rng.seed,
    ...set.generate(dir, rng.fork(set.name)),
  };
  writeFileSync(
    join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}
