#!/usr/bin/env bun

/**
 * Alternating colour soak (spec §7 abuse soak, contract §1.3 "moved to
 * nightly") — standalone Bun script against a running Hocuspocus.
 *
 * Several clients toggle `textColor`, `highlight` and `fontSize` on and off
 * on overlapping ranges of the same paragraphs, with the raw Yjs calls
 * y-prosemirror makes for those marks (token values only). Then:
 *
 *   - every client and a late-joining verifier hold identical state;
 *   - no document was refused (no `4422` `schema_rejected`, no `4413`
 *     `document_too_large`) and the server logged no schema or size event;
 *   - the document fits the real editor schema and the mark allowlist;
 *   - the encoded state stays under `MAX_DOC_SIZE_BYTES` at every
 *     checkpoint; the final size and bytes per toggle are reported.
 *
 * Usage: bun tests/load/color-mark-soak.ts (configuration via env, below)
 */
import "@/tests/load/soak-dom";

import * as Y from "yjs";

import { MAX_DOC_SIZE_BYTES } from "@/lib/security/guardrail-config";
import {
  FONT_SIZE_MARK,
  FONT_SIZE_TOKENS,
  HIGHLIGHT_MARK,
  HIGHLIGHT_TOKENS,
  TEXT_COLOR_MARK,
  TEXT_COLOR_TOKENS,
} from "@/lib/text-style-tokens";
import { formatBytes } from "@/lib/utils";
import { getEditorSchema } from "@/tests/helpers/editor-schema";
import { parseEnvNumber } from "@/tests/helpers/env-parsers";
import { writeReport } from "@/tests/helpers/report-writer";
import {
  connectClient,
  createRandom,
  createServerLogReader,
  DEFAULT_SOAK_URL,
  destroyClients,
  FORBIDDEN_SERVER_EVENTS,
  FRAGMENT,
  fetchServerCopy,
  refusalsOf,
  type SoakClient,
  schemaProblems,
  sleep,
  verifyConvergence,
  waitForQuiescence,
} from "@/tests/load/soak-shared";

const PARAGRAPHS = 4;
const QUIESCE_TIMEOUT_MS = 120_000;
/** Lets the debounced store run and the document unload before the verifier. */
const UNLOAD_WAIT_MS = 4_000;
const CHECKPOINTS = 10;
/**
 * Yjs keeps a tombstone for every removed format run, so the state grows
 * linearly with toggles (about 20 B each); the cap is the only bound. The
 * growth per toggle in the second half of the run may not exceed the first
 * half's by more than this factor (super-linear growth means a leak).
 */
const MAX_GROWTH_RATIO = 1.5;

const PARAGRAPH_TEXT =
  "Colour and size marks overlap here while several people toggle them on and off at once, ";

type ColorSoakConfig = {
  toggles: number;
  clients: number;
  /** Toggles per Yjs transaction (one update on the wire). */
  batch: number;
  /** Total toggles per second across all clients; 0 runs unpaced. */
  rate: number;
  seed: number;
  url: string;
  doc: string;
  maxBytes: number;
};

function readConfig(): ColorSoakConfig {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Alternating colour soak

Usage: bun tests/load/color-mark-soak.ts

Env:
  COLOR_SOAK_TOGGLES   Total mark toggles          (default 3000; nightly 50000)
  COLOR_SOAK_CLIENTS   Concurrent clients, ≥ 2     (default 3)
  COLOR_SOAK_BATCH     Toggles per transaction     (default 5)
  COLOR_SOAK_RATE      Toggles/s, all clients      (default 1000; 0 = unpaced)
  COLOR_SOAK_SEED      PRNG seed                   (default: time)
  COLOR_SOAK_URL       Hocuspocus WebSocket URL    (default ${DEFAULT_SOAK_URL})
  COLOR_SOAK_DOC       Document name               (default color-soak-<time>)
  MAX_DOC_SIZE_BYTES   Size cap, same as the server (default 1 MiB)
  SOAK_HOCUS_LOG       Server log file to scan for schema and size events
`);
    process.exit(0);
  }
  return {
    toggles: parseEnvNumber(process.env.COLOR_SOAK_TOGGLES, 3_000),
    clients: Math.max(2, parseEnvNumber(process.env.COLOR_SOAK_CLIENTS, 3)),
    batch: Math.max(1, parseEnvNumber(process.env.COLOR_SOAK_BATCH, 5)),
    rate: parseEnvNumber(process.env.COLOR_SOAK_RATE, 1_000),
    seed: parseEnvNumber(process.env.COLOR_SOAK_SEED, Date.now() % 2 ** 31),
    url: process.env.COLOR_SOAK_URL?.trim() || DEFAULT_SOAK_URL,
    doc: process.env.COLOR_SOAK_DOC?.trim() || `color-soak-${Date.now()}`,
    maxBytes: MAX_DOC_SIZE_BYTES,
  };
}

// ---------------------------------------------------------------------------
// Document and toggles
// ---------------------------------------------------------------------------

function seedDocument(fragment: Y.XmlFragment): void {
  const title = new Y.XmlElement("heading");
  fragment.insert(0, [title]);
  title.setAttribute("level", "1");
  title.insert(0, [new Y.XmlText("Colour soak")]);
  for (let p = 0; p < PARAGRAPHS; p++) {
    const paragraph = new Y.XmlElement("paragraph");
    fragment.push([paragraph]);
    paragraph.insert(0, [new Y.XmlText(PARAGRAPH_TEXT.repeat(2).trim())]);
  }
}

/** The stored attribute of each mark: key and attrs (highlight keeps `color`, B4). */
const MARKS = [
  {
    key: TEXT_COLOR_MARK,
    attrs: (i: number) => ({ color: TEXT_COLOR_TOKENS[i % 10] }),
  },
  {
    key: HIGHLIGHT_MARK,
    attrs: (i: number) => ({ color: HIGHLIGHT_TOKENS[i % 10] }),
  },
  {
    key: FONT_SIZE_MARK,
    attrs: (i: number) => ({
      size: FONT_SIZE_TOKENS[i % FONT_SIZE_TOKENS.length],
    }),
  },
] as const;

function paragraphTexts(doc: Y.Doc): Y.XmlText[] {
  return doc
    .getXmlFragment(FRAGMENT)
    .toArray()
    .filter(
      (node): node is Y.XmlElement =>
        node instanceof Y.XmlElement && node.nodeName === "paragraph",
    )
    .map((paragraph) => paragraph.get(0))
    .filter((node): node is Y.XmlText => node instanceof Y.XmlText);
}

/**
 * Toggle `i`: the mark cycles textColor → highlight → fontSize; each mark
 * alternates on, off; the value walks the token list. Range and paragraph
 * come from the client's PRNG, so ranges overlap across clients.
 */
function applyToggle(
  texts: Y.XmlText[],
  i: number,
  random: () => number,
): void {
  const mark = MARKS[i % MARKS.length];
  const round = Math.floor(i / MARKS.length);
  const text = texts[Math.floor(random() * texts.length)];
  const start = Math.floor(random() * text.length);
  const length = Math.min(1 + Math.floor(random() * 24), text.length - start);
  if (length <= 0) return;
  const value = round % 2 === 0 ? mark.attrs(Math.floor(round / 2)) : null;
  text.format(start, length, { [mark.key]: value });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

type SizeSample = { toggles: number; bytes: number };

/**
 * Bytes per toggle over the first and the second half of the checkpoints.
 * The first segment also holds the seed, so it is left out.
 */
function growthPerToggle(samples: SizeSample[]): {
  early: number;
  late: number;
} {
  const rate = (from: SizeSample, to: SizeSample) =>
    (to.bytes - from.bytes) / Math.max(1, to.toggles - from.toggles);
  if (samples.length < 4) return { early: 0, late: 0 };
  const middle = Math.floor(samples.length / 2);
  return {
    early: rate(samples[0], samples[middle]),
    late: rate(samples[middle], samples[samples.length - 1]),
  };
}

async function runToggles(
  config: ColorSoakConfig,
  clients: SoakClient[],
  onCheckpoint: (done: number) => void,
): Promise<number> {
  const perBatchMs =
    config.rate > 0 ? (1000 * config.batch * config.clients) / config.rate : 0;
  const checkpointEvery = Math.max(
    1,
    Math.floor(config.toggles / CHECKPOINTS / config.batch) * config.batch,
  );
  let done = 0;
  let nextCheckpoint = checkpointEvery;

  await Promise.all(
    clients.map(async (client, c) => {
      const random = createRandom(config.seed + c);
      const texts = paragraphTexts(client.doc);
      // Client c owns toggles c, c + n, c + 2n, … of the global sequence.
      const own: number[] = [];
      for (let i = c; i < config.toggles; i += config.clients) own.push(i);
      for (let b = 0; b < own.length; b += config.batch) {
        const started = Date.now();
        const slice = own.slice(b, b + config.batch);
        client.doc.transact(() => {
          for (const i of slice) applyToggle(texts, i, random);
        });
        done += slice.length;
        if (done >= nextCheckpoint) {
          nextCheckpoint += checkpointEvery;
          onCheckpoint(done);
        }
        await sleep(Math.max(0, perBatchMs - (Date.now() - started)));
      }
    }),
  );
  return done;
}

async function run(config: ColorSoakConfig): Promise<boolean> {
  const startedAt = Date.now();
  const serverLog = createServerLogReader(process.env.SOAK_HOCUS_LOG);
  const schema = getEditorSchema();
  console.log(
    `[connect] ${config.clients} clients → ${config.url} (doc: ${config.doc}, seed ${config.seed})`,
  );
  const clients = Array.from({ length: config.clients }, (_, c) =>
    connectClient(config.url, config.doc, `client-${c}`),
  );
  const outcomes = await Promise.all(clients.map((c) => c.outcome));
  if (outcomes.some((o) => o !== "synced")) {
    console.error(`[connect] FAILED: ${outcomes.join(", ")}`);
    destroyClients(clients);
    return false;
  }

  const fragment0 = clients[0].doc.getXmlFragment(FRAGMENT);
  clients[0].doc.transact(() => seedDocument(fragment0));
  if (!(await waitForQuiescence(clients, QUIESCE_TIMEOUT_MS))) {
    console.error("[seed] FAILED: clients did not receive the seed");
    destroyClients(clients);
    return false;
  }
  console.log(`[seed] ${fragment0.length} top-level blocks on every client`);

  const samples: SizeSample[] = [];
  let maxSampleBytes = 0;
  const loadStart = Date.now();
  console.log(
    `[load] ${config.toggles.toLocaleString()} toggles, batch ${config.batch}, ${config.rate || "unpaced"} toggles/s`,
  );
  const done = await runToggles(config, clients, (toggles) => {
    const bytes = Y.encodeStateAsUpdate(clients[0].doc).byteLength;
    maxSampleBytes = Math.max(maxSampleBytes, bytes);
    samples.push({ toggles, bytes });
    console.log(
      `[load] ${toggles.toLocaleString()} toggles, client-0 state ${formatBytes(bytes)}`,
    );
  });
  const loadMs = Date.now() - loadStart;

  console.log("[drain] waiting for every client to acknowledge and converge");
  const quiet = await waitForQuiescence(clients, QUIESCE_TIMEOUT_MS);
  const convergence = verifyConvergence(clients);
  const refusals = refusalsOf(clients);
  const finalBytes = Y.encodeStateAsUpdate(clients[0].doc).byteLength;
  maxSampleBytes = Math.max(maxSampleBytes, finalBytes);
  const clientProblems = schemaProblems(clients[0].doc, schema);
  const marksLeft = clients[0].doc.getXmlFragment(FRAGMENT).toString();

  destroyClients(clients);
  await sleep(UNLOAD_WAIT_MS);

  console.log("[verify] late-joining verifier reads the stored copy");
  const server = await fetchServerCopy(config.url, config.doc);
  const serverBytes = Y.encodeStateAsUpdate(server.doc).byteLength;
  const serverXml = server.doc.getXmlFragment(FRAGMENT).toString();
  const serverMatches = serverXml === marksLeft;
  const serverProblems = schemaProblems(server.doc, schema);
  server.doc.destroy();

  const serverEvents = serverLog.matching(FORBIDDEN_SERVER_EVENTS);
  const growth = growthPerToggle(samples);
  const failures = [
    ...(done === config.toggles
      ? []
      : [`ran ${done} of ${config.toggles} toggles`]),
    ...(quiet ? [] : ["clients did not quiesce"]),
    ...(convergence.pass
      ? []
      : [`convergence: ${convergence.mismatch ?? "mismatch"}`]),
    ...(serverMatches ? [] : ["server copy differs from the clients"]),
    ...refusals.map((r) => `refused: ${r}`),
    ...clientProblems.map((p) => `client: ${p}`),
    ...serverProblems.map((p) => `server copy: ${p}`),
    ...(maxSampleBytes < config.maxBytes
      ? []
      : [`state ${maxSampleBytes} B reached the ${config.maxBytes} B cap`]),
    ...(growth.late <= growth.early * MAX_GROWTH_RATIO
      ? []
      : [
          `growth ${growth.late.toFixed(2)} B/toggle late vs ${growth.early.toFixed(2)} early`,
        ]),
    ...serverEvents.map((line) => `server log: ${line.slice(0, 200)}`),
  ];
  const pass = failures.length === 0;
  const bytesPerToggle = done > 0 ? finalBytes / done : 0;
  const elapsedMs = Date.now() - startedAt;

  console.log(`
Alternating colour soak
  Toggles         ${done.toLocaleString()} (${config.clients} clients, seed ${config.seed})
  Load time       ${(loadMs / 1000).toFixed(1)} s (${(done / (loadMs / 1000)).toFixed(0)} toggles/s)
  Convergence     ${convergence.pass ? "PASS" : "FAIL"} (byte-level ${convergence.byteLevelMatch ? "yes" : "no, XML match"}; server copy ${serverMatches ? "matches" : "DIFFERS"})
  Final state     ${formatBytes(finalBytes)} on clients, ${formatBytes(serverBytes)} stored (${bytesPerToggle.toFixed(2)} B/toggle)
  Peak state      ${formatBytes(maxSampleBytes)} of ${formatBytes(config.maxBytes)} cap
  Growth          ${growth.early.toFixed(2)} B/toggle (first half), ${growth.late.toFixed(2)} (second half)
  Refusals        ${refusals.length}
  Server log      ${serverLog.file ? `${serverEvents.length} schema/size events` : "not scanned (SOAK_HOCUS_LOG unset)"}
  Elapsed         ${(elapsedMs / 1000).toFixed(1)} s
  Result          ${pass ? "PASS" : "FAIL"}
`);
  for (const failure of failures) console.error(`[fail] ${failure}`);

  writeReport(`color-soak-report-${Date.now()}.json`, {
    timestamp: new Date().toISOString(),
    ...config,
    togglesRun: done,
    loadMs,
    elapsedMs,
    convergence: convergence.pass,
    byteLevelMatch: convergence.byteLevelMatch,
    serverCopyMatches: serverMatches,
    finalStateBytes: finalBytes,
    storedStateBytes: serverBytes,
    peakStateBytes: maxSampleBytes,
    bytesPerToggle,
    growthPerToggle: growth,
    samples,
    refusals,
    serverLogScanned: Boolean(serverLog.file),
    failures,
    pass,
  });
  return pass;
}

run(readConfig())
  .then((pass) => process.exit(pass ? 0 : 1))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
