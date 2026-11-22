/**
 * T21 (offline data-model revision §5.3), the storage half: 10,000
 * documents with 200,000 links and 100,000 headings (`library-10k-linked`,
 * built here with the engine on `bun:sqlite` until Q1's fixture generator
 * lands), then the harness's `t21` mode in Electron reports:
 * - the sidebar as SQL on `node:sqlite` and as the round trip through the
 *   real worker (first paint belongs to P2.7). Mark: round trip ≤ 1.5 s on
 *   macOS and ≤ 2.5 s elsewhere, with the soak's 1.5× CI slack;
 * - backlinks for one document sent right behind a `putDerived` on another
 *   (≤ 5 ms end to end, with the same slack);
 * - `searchTitles` against Quick Open's 16 ms budget (reported, not gated:
 *   Quick Open filters the renderer snapshot up to 5,000 documents and
 *   only falls back to this query above that, §5.2).
 *
 * Registered in `desktop-durability-soak.ts`'s `CASES`.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import type { DerivedRows } from "@/desktop/storage/engine/derive";
import { LIBRARY_FILE, Library } from "@/desktop/storage/engine/library";
import { createNodeHost } from "@/desktop/storage/node-host";
import { seededRandom } from "@/desktop/storage-harness/gen";

type CaseResult = {
  name: string;
  pass: boolean;
  summary: string;
  details: Record<string, unknown>;
  failures: string[];
};

export type T21Deps = {
  runHarness(args: string[]): Promise<{ lines: string[]; stderr: string }>;
  removeDir(dir: string): void;
  args: Record<string, string | undefined>;
};

type T21Report = {
  docs: number;
  sidebar: { sqlMs: number; ipcFirstMs: number; ipcMs: number };
  searchTitles: {
    sqlMaxMs: number;
    ipcMs: number;
    ipcMaxMs: number;
    hits: number;
  };
  backlinks: {
    rows: number;
    sqlMs: number;
    aloneMs: number;
    behindPutMs: number;
    behindPutMaxMs: number;
    putDerivedMs: number;
  };
};

const WORDS = [
  "project",
  "plan",
  "notes",
  "quarterly",
  "review",
  "roadmap",
  "meeting",
  "budget",
  "design",
  "research",
  "proposal",
  "draft",
  "journal",
  "recipe",
  "travel",
  "reading",
];

/** CI slack on every mark, as T8 applies to the §10 sidebar budget. */
const SLACK = 1.5;
const BACKLINKS_MS = 5;
const QUICK_OPEN_MS = 16;

function sidebarBudgetMs(): number {
  return process.platform === "darwin" ? 1500 : 2500;
}

/** `library-10k-linked` (exported for local runs). Returns the watched document, the busy one and link targets. */
export function seedLinkedLibrary(
  dir: string,
  docs: number,
  linksPerDoc: number,
  headingsPerDoc: number,
) {
  const library = Library.open({
    dir,
    host: createNodeHost(),
    openSqlite: openBunSqlite,
    fullfsync: false,
    // A seed: 20,000 commits would otherwise each wait for the disk.
    synchronous: "OFF",
  });
  const random = seededRandom(21);
  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(random() * list.length)] as T;
  const folders = Array.from(
    { length: 100 },
    (_, i) => library.createFolder({ name: `Folder ${i}` })?.id ?? null,
  );
  const tags = Array.from(
    { length: 20 },
    (_, i) => library.createTag(`tag ${i}`)?.id ?? "",
  );
  const created = Array.from({ length: docs }, (_, i) => {
    const title = `${pick(WORDS)} ${pick(WORDS)} ${i}`;
    const doc = library.createDoc({ title, folderId: pick(folders) });
    const picked = tags.filter(() => random() < 0.05);
    if (picked.length) library.setDocTags(doc.id, picked);
    return { ...doc, title };
  });
  const keys = created.map((doc) => doc.linkKey);
  const watched = created[0];
  if (!watched) throw new Error("no documents");
  for (const [n, doc] of created.entries()) {
    const rows: DerivedRows = {
      title: doc.title,
      snippet: `${doc.title} begins here, with a sentence or two of body.`,
      headings: Array.from({ length: headingsPerDoc }, (_, ord) => ({
        ord,
        toc_id: `h${ord}`,
        level: 1 + (ord % 3),
        text: `${pick(WORDS)} ${ord}`,
      })),
      links: Array.from({ length: linksPerDoc }, (_, ord) => ({
        ord,
        src_toc_id: `h${ord % headingsPerDoc}`,
        // Every 500th document links to the watched one, so it has backlinks.
        target_key: ord === 0 && n % 500 === 1 ? watched.linkKey : pick(keys),
        target_toc_id: "",
        text: `see ${ord}`,
        context: `a sentence that mentions link ${ord}`,
      })),
    };
    const result = library.putDerived(doc.id, 0, rows);
    if (result !== "ok") throw new Error(`putDerived answered ${result}`);
  }
  library.shutdown();
  const db = new Database(join(dir, LIBRARY_FILE), { readonly: true });
  const count = (table: string) =>
    Number(
      (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
    );
  const counts = { links: count("links"), headings: count("doc_headings") };
  db.close();
  return {
    watched: watched.linkKey,
    busy: created[created.length - 1]?.id ?? "",
    targets: keys.slice(0, 200),
    counts,
  };
}

export async function caseT21(deps: T21Deps): Promise<CaseResult> {
  const docs = Number(deps.args["t21-docs"] ?? 10_000);
  const dir = mkdtempSync(join(tmpdir(), "soak-t21-"));
  const failures: string[] = [];
  const seedStarted = performance.now();
  const seeded = seedLinkedLibrary(dir, docs, 20, 10);
  const seedMs = performance.now() - seedStarted;
  const run = await deps.runHarness([
    "--mode=t21",
    `--dir=${dir}`,
    `--link-key=${seeded.watched}`,
    `--busy=${seeded.busy}`,
    `--targets=${seeded.targets.join(",")}`,
  ]);
  deps.removeDir(dir);
  const line = run.lines.find((l) => l.startsWith("T21 "));
  if (!line)
    return {
      name: "T21",
      pass: false,
      summary: "the harness reported nothing",
      details: { seedMs },
      failures: [run.stderr.slice(0, 2000)],
    };
  const report = JSON.parse(line.slice(4)) as T21Report;
  const sidebarMark = sidebarBudgetMs() * SLACK;
  if (seeded.counts.links !== docs * 20 || seeded.counts.headings !== docs * 10)
    failures.push(`seeded ${JSON.stringify(seeded.counts)}`);
  if (report.docs !== docs)
    failures.push(`sidebar listed ${report.docs} documents, wanted ${docs}`);
  if (!(report.sidebar.ipcMs <= sidebarMark))
    failures.push(
      `sidebar round trip ${report.sidebar.ipcMs.toFixed(0)} ms, mark ${sidebarBudgetMs()} ms (× ${SLACK} CI slack)`,
    );
  if (!(report.backlinks.behindPutMs <= BACKLINKS_MS * SLACK))
    failures.push(
      `backlinks behind a putDerived ${report.backlinks.behindPutMs.toFixed(1)} ms, mark ${BACKLINKS_MS} ms (× ${SLACK} CI slack)`,
    );
  if (report.backlinks.rows === 0)
    failures.push("the watched document has no backlinks");
  const quickOpen =
    report.searchTitles.ipcMaxMs <= QUICK_OPEN_MS
      ? "within"
      : "over (the renderer snapshot serves Quick Open up to 5,000 documents)";
  return {
    name: "T21",
    pass: failures.length === 0,
    summary: `${report.docs} documents, ${seeded.counts.links} links, ${seeded.counts.headings} headings (seeded in ${(seedMs / 1000).toFixed(0)} s): sidebar SQL ${report.sidebar.sqlMs.toFixed(0)} ms, IPC round trip ${report.sidebar.ipcMs.toFixed(0)} ms (first ${report.sidebar.ipcFirstMs.toFixed(0)} ms; mark ${sidebarBudgetMs()} ms; first paint is P2.7's); backlinks (${report.backlinks.rows} rows) ${report.backlinks.behindPutMs.toFixed(1)} ms behind a putDerived (max ${report.backlinks.behindPutMaxMs.toFixed(1)}, alone ${report.backlinks.aloneMs.toFixed(1)}, putDerived ${report.backlinks.putDerivedMs.toFixed(1)} ms; mark ${BACKLINKS_MS} ms); searchTitles ${report.searchTitles.ipcMs.toFixed(1)} ms round trip (max ${report.searchTitles.ipcMaxMs.toFixed(1)}, SQL max ${report.searchTitles.sqlMaxMs.toFixed(1)} ms): ${quickOpen} Quick Open's ${QUICK_OPEN_MS} ms`,
    details: {
      ...report,
      seeded: seeded.counts,
      seedMs,
      sidebarMarkMs: sidebarMark,
    },
    failures,
  };
}
