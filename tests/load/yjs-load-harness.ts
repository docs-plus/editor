#!/usr/bin/env bun

/**
 * Yjs concurrency load harness — standalone Bun script.
 *
 * Simulates N concurrent clients editing the same Hocuspocus document,
 * then verifies all replicas converge to identical state.
 *
 * Industry-standard load test phases:
 *   1. Connect — all clients establish WebSocket + Yjs sync
 *   2. Seed    — client 0 populates the initial document structure
 *   3. Warm-up — brief idle period to stabilize connections
 *   4. Load    — all clients perform edits at target rate
 *   5. Drain   — stop edits, wait for CRDT convergence
 *   6. Verify  — byte-level + JSON-level convergence check
 *   7. Report  — structured metrics to stdout
 *
 * Usage: bun tests/load/yjs-load-harness.ts [options]
 */

import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

import { formatBytes } from "@/lib/utils";
import { parseEnvFloat, parseEnvNumber } from "@/tests/helpers/env-parsers";
import { writeReport } from "@/tests/helpers/report-writer";

const FRAGMENT_NAME = "default";
const WARMUP_MS = 2_000;
const DRAIN_MS = 5_000;
const SYNC_TIMEOUT_MS = 30_000;

interface YjsLoadHarnessConfig {
  clients: number;
  duration: number;
  rate: number;
  scenario: "distributed" | "conflict";
  url: string;
  doc: string;
}

function printUsage(): void {
  console.log(`Yjs Load Harness — concurrency & convergence testing

Usage: bun tests/load/yjs-load-harness.ts [options]

Options (CLI overrides env):
  --clients <n>       Concurrent clients           (env: LOAD_CLIENTS, default: 100)
  --duration <ms>     Steady-state duration in ms   (env: LOAD_DURATION, default: 30000)
  --rate <ops/s>      Operations/second per client  (env: LOAD_RATE, default: 2)
  --scenario <name>   "distributed" or "conflict"   (env: LOAD_SCENARIO)
  --url <ws-url>      Hocuspocus WebSocket URL      (env: LOAD_URL)
  --doc <name>        Document name                 (env: LOAD_DOC)
  -h, --help          Show this message
`);
}

function parseArgs(): YjsLoadHarnessConfig {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const config: YjsLoadHarnessConfig = {
    clients: parseEnvNumber(process.env.LOAD_CLIENTS, 100),
    duration: parseEnvNumber(process.env.LOAD_DURATION, 30_000),
    rate: parseEnvFloat(process.env.LOAD_RATE, 2),
    scenario:
      process.env.LOAD_SCENARIO?.trim() === "conflict"
        ? "conflict"
        : "distributed",
    url: process.env.LOAD_URL?.trim() || "ws://127.0.0.1:1234",
    doc: process.env.LOAD_DOC?.trim() || `load-test-${Date.now()}`,
  };

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "") ?? "";
    const val = args[i + 1];
    if (!val) continue;
    switch (key) {
      case "clients":
        config.clients = parseEnvNumber(val, config.clients);
        break;
      case "duration":
        config.duration = parseEnvNumber(val, config.duration);
        break;
      case "rate":
        config.rate = parseEnvFloat(val, config.rate);
        break;
      case "scenario":
        config.scenario = val === "conflict" ? "conflict" : "distributed";
        break;
      case "url":
        config.url = val;
        break;
      case "doc":
        config.doc = val;
        break;
    }
  }
  return config;
}

// ---------------------------------------------------------------------------
// Document seeding — builds a realistic TitleDocument-schema doc
// ---------------------------------------------------------------------------

const SEED_SENTENCES = [
  "The architecture relies on a shared document model enforced at the schema level.",
  "Each section can be folded independently, preserving context across sessions.",
  "Collaboration is powered by Yjs CRDTs, enabling conflict-free concurrent editing.",
  "Performance remains stable even in documents exceeding two hundred headings.",
  "Users can filter sections by keyword, hiding unmatched content in real time.",
  "Task lists allow teams to track progress directly within the document body.",
  "Code blocks support syntax highlighting for common programming languages.",
];

const SEED_TASKS = [
  "Review the pull request for edge cases",
  "Update the deployment documentation",
  "Add integration tests for the new endpoint",
  "Verify performance benchmarks pass the threshold",
];

const SEED_LIST_ITEMS = [
  "Configure the development environment",
  "Install required dependencies and verify versions",
  "Run the test suite to confirm baseline",
  "Review the coding standards document",
  "Set up branch protection rules",
];

function pushParagraph(parent: Y.XmlFragment | Y.XmlElement, text: string) {
  const p = new Y.XmlElement("paragraph");
  parent.push([p]);
  p.insert(0, [new Y.XmlText(text)]);
}

function pushBulletList(parent: Y.XmlFragment | Y.XmlElement, items: string[]) {
  const list = new Y.XmlElement("bulletList");
  parent.push([list]);
  for (const item of items) {
    const li = new Y.XmlElement("listItem");
    list.push([li]);
    pushParagraph(li, item);
  }
}

function pushTaskList(
  parent: Y.XmlFragment | Y.XmlElement,
  items: { text: string; checked: boolean }[],
) {
  const list = new Y.XmlElement("taskList");
  parent.push([list]);
  for (const item of items) {
    const ti = new Y.XmlElement("taskItem");
    list.push([ti]);
    ti.setAttribute("checked", item.checked ? "true" : "false");
    pushParagraph(ti, item.text);
  }
}

function seedDocument(fragment: Y.XmlFragment): void {
  const title = new Y.XmlElement("heading");
  fragment.insert(0, [title]);
  title.setAttribute("level", "1");
  title.setAttribute("data-toc-id", "title");
  title.insert(0, [new Y.XmlText("Load Test Document")]);

  for (let s = 0; s < 10; s++) {
    const h2 = new Y.XmlElement("heading");
    fragment.push([h2]);
    h2.setAttribute("level", "2");
    h2.setAttribute("data-toc-id", `section-${s}`);
    h2.insert(0, [new Y.XmlText(`Section ${s + 1}`)]);

    for (let p = 0; p < 5; p++) {
      pushParagraph(fragment, SEED_SENTENCES[p % SEED_SENTENCES.length]);
    }

    if (s % 3 === 0) {
      pushBulletList(fragment, SEED_LIST_ITEMS.slice(0, 4));
    }

    if (s % 4 === 1) {
      pushTaskList(
        fragment,
        SEED_TASKS.map((text, i) => ({ text, checked: i % 2 === 0 })),
      );
    }

    pushParagraph(fragment, SEED_SENTENCES[(s + 3) % SEED_SENTENCES.length]);
  }
}

// ---------------------------------------------------------------------------
// Edit operations — mirror realistic user typing behavior
// ---------------------------------------------------------------------------

function findParagraphIndices(fragment: Y.XmlFragment): number[] {
  const indices: number[] = [];
  for (let i = 0; i < fragment.length; i++) {
    const node = fragment.get(i);
    if (node instanceof Y.XmlElement && node.nodeName === "paragraph") {
      indices.push(i);
    }
  }
  return indices;
}

function getTargetParagraphIndex(
  clientIndex: number,
  scenario: "distributed" | "conflict",
  paraIndices: number[],
): number {
  if (paraIndices.length === 0) return -1;
  if (scenario === "conflict") return paraIndices[0];
  return paraIndices[clientIndex % paraIndices.length];
}

function performEdit(
  fragment: Y.XmlFragment,
  paraIndex: number,
  editId: number,
): boolean {
  if (paraIndex < 0 || paraIndex >= fragment.length) return false;
  const para = fragment.get(paraIndex);
  if (!(para instanceof Y.XmlElement) || para.nodeName !== "paragraph")
    return false;

  if (para.length === 0) {
    para.insert(0, [new Y.XmlText("")]);
  }
  const textNode = para.get(0);
  if (!(textNode instanceof Y.XmlText)) return false;

  const char = String.fromCharCode(97 + (editId % 26));
  const offset =
    textNode.length > 0
      ? Math.min(
          Math.floor(Math.random() * (textNode.length + 1)),
          textNode.length,
        )
      : 0;
  textNode.insert(offset, char);
  return true;
}

// ---------------------------------------------------------------------------
// Convergence verification
// ---------------------------------------------------------------------------

interface ConvergenceResult {
  pass: boolean;
  byteLevelMatch: boolean;
  jsonLevelMatch: boolean;
  mismatchClient?: number;
}

function verifyConvergence(docs: Y.Doc[]): ConvergenceResult {
  if (docs.length < 2)
    return { pass: true, byteLevelMatch: true, jsonLevelMatch: true };

  const states = docs.map((d) => Y.encodeStateAsUpdate(d));
  const ref = states[0];

  for (let i = 1; i < states.length; i++) {
    if (
      ref.length !== states[i].length ||
      !ref.every((b, j) => states[i][j] === b)
    ) {
      // Byte-level mismatch — check JSON content as fallback
      const jsonRef = docs[0].getXmlFragment(FRAGMENT_NAME).toJSON();
      const jsonI = docs[i].getXmlFragment(FRAGMENT_NAME).toJSON();
      if (jsonRef === jsonI) {
        return { pass: true, byteLevelMatch: false, jsonLevelMatch: true };
      }
      return {
        pass: false,
        byteLevelMatch: false,
        jsonLevelMatch: false,
        mismatchClient: i,
      };
    }
  }
  return { pass: true, byteLevelMatch: true, jsonLevelMatch: true };
}

// ---------------------------------------------------------------------------
// Connection pool — each client gets its own Y.Doc + HocuspocusProvider
// ---------------------------------------------------------------------------

interface ClientSlot {
  doc: Y.Doc;
  provider: HocuspocusProvider;
}

function createClients(config: YjsLoadHarnessConfig): {
  clients: ClientSlot[];
  allSynced: Promise<void>;
} {
  const clients: ClientSlot[] = [];
  const syncedSet = new Set<number>();

  const allSynced = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Sync timeout: ${syncedSet.size}/${config.clients} clients synced within ${SYNC_TIMEOUT_MS / 1000}s`,
        ),
      );
    }, SYNC_TIMEOUT_MS);

    for (let i = 0; i < config.clients; i++) {
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url: config.url,
        name: config.doc,
        document: doc,
        token: `load-client-${i}-${config.doc}`,
        WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
        onSynced() {
          syncedSet.add(i);
          if (syncedSet.size === config.clients) {
            clearTimeout(timeout);
            resolve();
          }
        },
      } as ConstructorParameters<typeof HocuspocusProvider>[0]);
      clients.push({ doc, provider });
    }
  });

  return { clients, allSynced };
}

function destroyClients(clients: ClientSlot[]): void {
  for (const { provider, doc } of clients) {
    provider.destroy();
    doc.destroy();
  }
}

// ---------------------------------------------------------------------------
// Load driver
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function run(config: YjsLoadHarnessConfig): Promise<void> {
  const memStart = process.memoryUsage();

  // Phase 1: Connect
  console.log(
    `[connect] Creating ${config.clients} clients → ${config.url} (doc: ${config.doc})`,
  );
  const { clients, allSynced } = createClients(config);

  try {
    await allSynced;
  } catch (err) {
    console.error(`[connect] FAILED:`, (err as Error).message);
    destroyClients(clients);
    process.exit(1);
  }
  const connectMs = Date.now();
  console.log(`[connect] All ${config.clients} clients synced`);

  // Phase 2: Seed
  const doc0 = clients[0].doc;
  const fragment0 = doc0.getXmlFragment(FRAGMENT_NAME);
  if (fragment0.length === 0) {
    doc0.transact(() => seedDocument(fragment0));
    console.log(`[seed] Document seeded: ${fragment0.length} top-level nodes`);
  } else {
    console.log(`[seed] Document already populated: ${fragment0.length} nodes`);
  }

  // Phase 3: Warm-up
  console.log(`[warm-up] Waiting ${WARMUP_MS}ms for sync propagation...`);
  await sleep(WARMUP_MS);

  // Phase 4: Load — steady-state editing
  const intervalMs = 1000 / config.rate;
  const editCounts = new Array<number>(config.clients).fill(0);
  let totalErrors = 0;
  const loadStartMs = Date.now();
  const loadEndMs = loadStartMs + config.duration;

  console.log(
    `[load] Starting: ${config.scenario} scenario, ${config.rate} ops/s/client, ${config.duration / 1000}s`,
  );

  const editTasks = clients.map(({ doc }, clientIndex) => {
    return (async () => {
      const fragment = doc.getXmlFragment(FRAGMENT_NAME);
      const paraIndices = findParagraphIndices(fragment);
      const paraIndex = getTargetParagraphIndex(
        clientIndex,
        config.scenario,
        paraIndices,
      );

      while (Date.now() < loadEndMs) {
        try {
          const ok = performEdit(fragment, paraIndex, editCounts[clientIndex]);
          if (ok) editCounts[clientIndex]++;
          else totalErrors++;
        } catch {
          totalErrors++;
        }
        await sleep(intervalMs);
      }
    })();
  });

  await Promise.all(editTasks);
  const loadElapsedMs = Date.now() - loadStartMs;
  const totalEdits = editCounts.reduce((a, b) => a + b, 0);
  console.log(
    `[load] Completed: ${totalEdits.toLocaleString()} edits in ${(loadElapsedMs / 1000).toFixed(1)}s (${totalErrors} errors)`,
  );

  // Phase 5: Drain — disconnect and wait for CRDT convergence
  console.log(
    `[drain] Disconnecting providers, waiting ${DRAIN_MS / 1000}s for convergence...`,
  );
  for (const { provider } of clients) {
    provider.disconnect();
  }
  await sleep(DRAIN_MS);

  // Phase 6: Verify convergence
  const docs = clients.map((c) => c.doc);
  const convergence = verifyConvergence(docs);

  if (!convergence.pass && convergence.mismatchClient !== undefined) {
    const refJson = docs[0].getXmlFragment(FRAGMENT_NAME).toJSON();
    const badJson = docs[convergence.mismatchClient]
      .getXmlFragment(FRAGMENT_NAME)
      .toJSON();
    console.error(
      `[verify] CONVERGENCE FAIL: client 0 (${refJson.length} chars) vs client ${convergence.mismatchClient} (${badJson.length} chars)`,
    );
  }

  // Phase 7: Report
  const memEnd = process.memoryUsage();
  const firstState = Y.encodeStateAsUpdate(docs[0]);
  const docSizeBytes = firstState.length;
  const docSizeStr = formatBytes(docSizeBytes);
  const memDeltaMB = (memEnd.rss - memStart.rss) / (1024 * 1024);
  const throughput = totalEdits / (loadElapsedMs / 1000);

  console.log(`
╔══════════════════════════════════════╗
║       Yjs Load Test Report           ║
╠══════════════════════════════════════╣
║ Scenario      ${config.scenario.padEnd(22)}║
║ Clients       ${String(config.clients).padEnd(22)}║
║ Duration      ${`${(config.duration / 1000).toFixed(0)}s`.padEnd(22)}║
║ Target rate   ${`${config.rate} ops/s/client`.padEnd(22)}║
╠══════════════════════════════════════╣
║ Total edits   ${totalEdits.toLocaleString().padEnd(22)}║
║ Edit errors   ${String(totalErrors).padEnd(22)}║
║ Throughput    ${`${throughput.toFixed(1)} ops/s`.padEnd(22)}║
║ Convergence   ${(convergence.pass ? "PASS" : "FAIL").padEnd(22)}║
║  └ Byte-level ${(convergence.byteLevelMatch ? "✓" : "✗ (JSON match)").padEnd(22)}║
║ Memory Δ      ${`${memDeltaMB >= 0 ? "+" : ""}${memDeltaMB.toFixed(1)} MB RSS`.padEnd(22)}║
║ Doc size      ${docSizeStr.padEnd(22)}║
╚══════════════════════════════════════╝
`);

  const report = {
    timestamp: new Date().toISOString(),
    scenario: config.scenario,
    clients: config.clients,
    duration: config.duration,
    rate: config.rate,
    totalEdits: totalEdits,
    editErrors: totalErrors,
    throughput,
    convergence: convergence.pass,
    byteLevelMatch: convergence.byteLevelMatch,
    memDeltaMB,
    docSizeBytes,
    docSizeStr,
  };
  writeReport(`load-report-${Date.now()}.json`, report);

  destroyClients(clients);
  process.exit(convergence.pass ? 0 : 1);
}

const config = parseArgs();
run(config).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
