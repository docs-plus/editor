/**
 * Library fixtures (test strategy §3.2: `library-s`, `library-1k`,
 * `library-10k`): a desktop library folder written through the storage
 * engine's own API, so the schema, the sidebar index and the content log are
 * exactly what the app would write.
 *
 * Images wait for the asset store (P2.6b), which adds them to `library-1k`.
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";

import type { Library } from "@/desktop/storage/engine/library";
import { DOC_SCHEMA } from "@/lib/doc-migrations";
import {
  createClock,
  createTestHost,
  openTestLibrary,
} from "@/tests/helpers/storage-library";

import { type DocJson, jsonToYState, largeDocument } from "./documents";
import type { Rng } from "./rng";

export type LibrarySpec = {
  docs: number;
  /** Folders per level, top level first: `[4, 3]` is 4 + 4 × 3 folders. */
  folderFanOut: readonly number[];
  tags: number;
  /** `rich`: a few sections of body; `titles`: the title heading only. */
  content: "rich" | "titles";
};

export type LibrarySummary = {
  docs: number;
  folders: number;
  maxFolderDepth: number;
  tags: number;
  taggedDocs: number;
  /** sha256 over every document's title and stored state, in id order. */
  contentSha256: string;
};

const OWNER = "fixtures";

const TOPICS = [
  "Roadmap",
  "Meeting notes",
  "Reading list",
  "Recipe",
  "Trip plan",
  "Budget",
  "Research",
  "Draft",
  "Checklist",
  "Journal",
];

const FOLDER_NAMES = [
  "Work",
  "Personal",
  "Projects",
  "Archive",
  "Ideas",
  "Notes",
  "Clients",
  "Drafts",
];

const TAG_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", null];

function titleDocument(title: string): DocJson {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: title }],
      },
    ],
  };
}

function withTitle(json: DocJson, title: string): DocJson {
  const [, ...rest] = json.content;
  return { type: "doc", content: [...titleDocument(title).content, ...rest] };
}

function createFolders(
  library: Library,
  fanOut: readonly number[],
  rng: Rng,
): string[] {
  const all: string[] = [];
  let parents: (string | null)[] = [null];
  for (const width of fanOut) {
    const next: string[] = [];
    for (const parentId of parents)
      for (let i = 0; i < width; i++) {
        const name = `${rng.pick(FOLDER_NAMES)} ${all.length + next.length + 1}`;
        next.push(library.createFolder({ name, parentId }).id);
      }
    all.push(...next);
    parents = next;
  }
  return all;
}

/** Writes a library into `dir` (which must be empty) and summarises it. */
export function generateLibrary(
  dir: string,
  spec: LibrarySpec,
  rng: Rng,
): LibrarySummary {
  mkdirSync(dir, { recursive: true });
  const clock = createClock();
  const library = openTestLibrary(dir, createTestHost(clock));
  try {
    const folderIds = createFolders(
      library,
      spec.folderFanOut,
      rng.fork("folders"),
    );
    const tagIds = Array.from(
      { length: spec.tags },
      (_, i) => library.createTag(`tag-${i + 1}`, rng.pick(TAG_COLORS)).id,
    );
    const docRng = rng.fork("docs");
    for (let i = 0; i < spec.docs; i++) {
      clock.advance(60_000);
      const title = `${docRng.pick(TOPICS)} ${i + 1}`;
      const json =
        spec.content === "rich"
          ? withTitle(largeDocument(docRng.int(2, 6), docRng), title)
          : titleDocument(title);
      const folderId =
        folderIds.length > 0 && docRng.next() < 0.8
          ? docRng.pick(folderIds)
          : null;
      const { id } = library.createDoc({
        id: docRng.uuid(),
        lineage: docRng.uuid(),
        linkKey: docRng.hex(16),
        schema: DOC_SCHEMA,
        title,
        folderId,
        sortKey: `a${i.toString(36).padStart(5, "0")}`,
      });
      library.claim(id, OWNER);
      library.append(id, OWNER, {
        origin: "local",
        update: jsonToYState(json, docRng),
        title,
      });
      library.close(id, OWNER);
      if (tagIds.length > 0 && docRng.next() < 0.5) {
        const count = docRng.int(1, Math.min(3, tagIds.length));
        const picked = new Set<string>();
        while (picked.size < count) picked.add(docRng.pick(tagIds));
        library.setDocTags(id, [...picked]);
      }
    }
    return summarizeLibrary(library);
  } finally {
    library.shutdown();
  }
}

/**
 * The logical content of a library: what a seed must reproduce. File bytes
 * are not compared (SQLite pages and tag ids differ run to run).
 */
export function summarizeLibrary(library: Library): LibrarySummary {
  const { docs, folders, tags } = library.sidebar();
  const parentOf = new Map(folders.map((f) => [f.id, f.parentId]));
  const depthOf = (id: string): number => {
    const parent = parentOf.get(id);
    return parent ? 1 + depthOf(parent) : 1;
  };
  const hash = createHash("sha256");
  for (const doc of [...docs].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(doc.id);
    hash.update(doc.title);
    hash.update(library.stateOf(doc.id));
  }
  return {
    docs: docs.length,
    folders: folders.length,
    maxFolderDepth: folders.reduce((max, f) => Math.max(max, depthOf(f.id)), 0),
    tags: tags.length,
    taggedDocs: docs.filter((d) => d.tagIds.length > 0).length,
    contentSha256: hash.digest("hex"),
  };
}
