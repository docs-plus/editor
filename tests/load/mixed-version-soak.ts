#!/usr/bin/env bun

/**
 * Mixed-version soak (spec §3.1 N+1 ship gate: "mixed-version nightly soak
 * N + N+1 → 0 deleted blocks, 0 unexpected freezes") — standalone Bun
 * script against a running Hocuspocus with `HOCUS_MIN_CLIENT_SCHEMA` at its
 * default. One document, four clients:
 *
 *   N+1      `schema=2`, Tiptap editor with `textColor` and `fontSize`.
 *            Types text, then writes colour and size marks.
 *   N        `schema=2` (release N sends 2), Tiptap editor without the new
 *            marks. Types text. Expected: admitted; freezes read-only when
 *            the marks arrive (y-tiptap `onInvalidContent`, schema guard
 *            `outdated`) and sends nothing from then on (§3.1 guard 3, B1).
 *   pre-N ×2 no `schema` parameter, and `schema=1`; no new marks. Edit text
 *            and delete a block in their device copy, as a pre-N bundle
 *            does on marks it does not know. Expected: `client_outdated`
 *            on the document, even with the env at 0, because the floor is
 *            `SCHEMA_FLOOR = 2` (B3); the tab list on the same socket still
 *            syncs (exempt); nothing they write reaches the server; no
 *            `4205` socket reset (§3.1 guard 1).
 *
 * Then a late-joining verifier reads the stored copy: every block is still
 * there, the N and N+1 text typed before the freeze is there, the N+1
 * marks survived, nothing from the pre-N clients or from the frozen N
 * client is there, and the copy fits the editor schema.
 *
 * Usage: bun tests/load/mixed-version-soak.ts (configuration via env, below)
 */
import "@/tests/load/soak-dom";

import type { HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { AnyExtension, Editor } from "@tiptap/core";
import * as Y from "yjs";

import { FontSize, TextColor } from "@/extensions/text-style-marks";
import { createSchemaGuard, type SchemaGuard } from "@/lib/schema-guard";
import {
  FONT_SIZE_MARK,
  FONT_SIZE_TOKENS,
  TEXT_COLOR_MARK,
  TEXT_COLOR_TOKENS,
} from "@/lib/text-style-tokens";
import {
  type CollabEditorFixture,
  createCollabEditor,
} from "@/tests/helpers/collab-editor";
import { getEditorSchema } from "@/tests/helpers/editor-schema";
import { parseEnvNumber } from "@/tests/helpers/env-parsers";
import { writeReport } from "@/tests/helpers/report-writer";
import {
  attachToSocket,
  connectClient,
  createServerLogReader,
  DEFAULT_SOAK_URL,
  destroyClients,
  FORBIDDEN_SERVER_EVENTS,
  FRAGMENT,
  fetchServerCopy,
  openRawSocket,
  refusalsOf,
  type SoakClient,
  schemaProblems,
  sleep,
  verifyConvergence,
  waitForQuiescence,
} from "@/tests/load/soak-shared";

const QUIESCE_TIMEOUT_MS = 60_000;
const UNLOAD_WAIT_MS = 4_000;
/** Time for a remote update to reach the editors and the guard to react. */
const SETTLE_MS = 300;
const SOCKET_RESET_CODE = 4205;

/** Paragraph indexes (block index = paragraph + 1, after the title). */
const N_PARAGRAPH = 0;
const N1_TEXT_PARAGRAPH = 1;
const N1_MARK_PARAGRAPHS = [2, 3];
const PARAGRAPHS = 5;
const PARAGRAPH_TEXT =
  "Mixed versions edit this paragraph while colour and size marks arrive.";

/** Words each writer types; prefixes are unique so absence checks are exact. */
const WORD = {
  n1: (r: number) => ` nplus${r}`,
  nBeforeMarks: (r: number) => ` nrel${r}`,
  nFrozen: (r: number) => ` nfrozen${r}`,
  preN: (label: string, r: number) => ` prenold${label}${r}`,
};

type MixedSoakConfig = {
  rounds: number;
  url: string;
  doc: string;
};

function readConfig(): MixedSoakConfig {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Mixed-version soak

Usage: bun tests/load/mixed-version-soak.ts

Env:
  MIXED_SOAK_ROUNDS  Edit rounds per phase (text, then marks) (default 30; nightly 300)
  MIXED_SOAK_URL     Hocuspocus WebSocket URL (default ${DEFAULT_SOAK_URL})
  MIXED_SOAK_DOC     Document name            (default mixed-soak-<time>)
  SOAK_HOCUS_LOG     Server log file to scan for schema, size and ban events
`);
    process.exit(0);
  }
  return {
    rounds: Math.max(2, parseEnvNumber(process.env.MIXED_SOAK_ROUNDS, 30)),
    url: process.env.MIXED_SOAK_URL?.trim() || DEFAULT_SOAK_URL,
    doc: process.env.MIXED_SOAK_DOC?.trim() || `mixed-soak-${Date.now()}`,
  };
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

type EditorClient = {
  label: string;
  socket: SoakClient;
  fixture: CollabEditorFixture;
  guard: SchemaGuard;
};

/**
 * A Tiptap editor (StarterKit + title-first schema + `extensions`) whose
 * Y.Doc relays to a provider-attached doc, wired to the schema guard as
 * the app wires it.
 */
function createEditorClient(
  socket: SoakClient,
  extensions: AnyExtension[],
): EditorClient {
  let guard: SchemaGuard | undefined;
  const fixture = createCollabEditor({
    server: socket.doc,
    extensions,
    onInvalidContent: (error) => guard?.onInvalidContent(error),
  });
  const created = createSchemaGuard(fixture.fragment, {
    repairDelayMs: () => 0,
    onRepairFailed() {},
  });
  created.bind({ editor: fixture.editor, canWrite: () => true });
  guard = created;
  return { label: socket.label, socket, fixture, guard };
}

function isFrozen(client: EditorClient): boolean {
  return (
    client.guard.getState() !== "ok" ||
    (client.fixture.binding()?.invalidContentError ?? null) !== null
  );
}

type PreNClient = {
  label: string;
  socket: HocuspocusProviderWebsocket;
  doc: SoakClient;
  tabs: SoakClient;
  socketCloses: number[];
};

function connectPreN(
  url: string,
  documentName: string,
  label: string,
  schema: string | null,
): PreNClient {
  const socket = openRawSocket(url, schema);
  const socketCloses: number[] = [];
  socket.on("close", ({ event }: { event: { code: number } }) => {
    socketCloses.push(event.code);
  });
  return {
    label,
    socket,
    doc: attachToSocket(socket, documentName, `pre-N ${label}`),
    tabs: attachToSocket(
      socket,
      `global-tabs-${crypto.randomUUID()}`,
      `pre-N ${label} tabs`,
    ),
    socketCloses,
  };
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/** ProseMirror position of the start and end of paragraph `index`'s text. */
function paragraphRange(
  editor: Editor,
  index: number,
): { from: number; to: number } {
  let seen = -1;
  let range = { from: 0, to: 0 };
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name !== "paragraph") return;
    seen += 1;
    if (seen === index)
      range = { from: offset + 1, to: offset + 1 + node.content.size };
  });
  return range;
}

function typeAtEnd(editor: Editor, paragraph: number, text: string): void {
  const { to } = paragraphRange(editor, paragraph);
  editor.chain().setTextSelection(to).insertContent(text).run();
}

/** Round `r`'s mark: colour on even rounds, size on odd, on a sliding range. */
function applyMark(editor: Editor, r: number): void {
  const paragraph = N1_MARK_PARAGRAPHS[r % N1_MARK_PARAGRAPHS.length];
  const { from, to } = paragraphRange(editor, paragraph);
  const start = from + ((r * 7) % Math.max(1, to - from - 12));
  const chain = editor
    .chain()
    .setTextSelection({ from: start, to: start + 12 });
  if (r % 2 === 0)
    chain.setTextColor(TEXT_COLOR_TOKENS[r % TEXT_COLOR_TOKENS.length]);
  else chain.setFontSize(FONT_SIZE_TOKENS[r % FONT_SIZE_TOKENS.length]);
  chain.run();
}

/** A pre-N bundle's edits, local only: types, and drops a block it cannot show. */
function preNEdit(client: PreNClient, r: number): void {
  const fragment = client.doc.doc.getXmlFragment(FRAGMENT);
  client.doc.doc.transact(() => {
    const paragraph = fragment.get(1 + (r % PARAGRAPHS));
    if (paragraph instanceof Y.XmlElement) {
      const text = paragraph.get(0);
      if (text instanceof Y.XmlText)
        text.insert(text.length, WORD.preN(client.label, r));
    }
    if (r % 5 === 4 && fragment.length > 1)
      fragment.delete(fragment.length - 1);
  });
}

function seedDocument(fragment: Y.XmlFragment): void {
  const title = new Y.XmlElement("heading");
  fragment.insert(0, [title]);
  title.setAttribute("level", "1");
  title.insert(0, [new Y.XmlText("Mixed versions")]);
  for (let p = 0; p < PARAGRAPHS; p++) {
    const paragraph = new Y.XmlElement("paragraph");
    fragment.push([paragraph]);
    paragraph.insert(0, [new Y.XmlText(`${PARAGRAPH_TEXT} (${p + 1})`)]);
  }
}

const blockNames = (doc: Y.Doc) =>
  doc
    .getXmlFragment(FRAGMENT)
    .toArray()
    .map((node) => (node instanceof Y.XmlElement ? node.nodeName : "#text"));

/** Runs of the editor fragment that carry `markKey`. */
function countMarkedRuns(doc: Y.Doc, markKey: string): number {
  let runs = 0;
  for (const node of doc.getXmlFragment(FRAGMENT).toArray()) {
    if (!(node instanceof Y.XmlElement)) continue;
    const text = node.get(0);
    if (!(text instanceof Y.XmlText)) continue;
    for (const op of text.toDelta() as {
      attributes?: Record<string, unknown>;
    }[]) {
      if (op.attributes?.[markKey]) runs += 1;
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run(config: MixedSoakConfig): Promise<boolean> {
  const startedAt = Date.now();
  const failures: string[] = [];
  const expect = (ok: boolean, message: string) => {
    if (!ok) failures.push(message);
  };
  const serverLog = createServerLogReader(process.env.SOAK_HOCUS_LOG);
  const schema = getEditorSchema();

  console.log(`[connect] → ${config.url} (doc: ${config.doc})`);
  const n1Socket = connectClient(config.url, config.doc, "N+1");
  const nSocket = connectClient(config.url, config.doc, "N");
  const preN = [
    connectPreN(config.url, config.doc, "missing", null),
    connectPreN(config.url, config.doc, "v1", "1"),
  ];
  const [n1Outcome, nOutcome] = await Promise.all([
    n1Socket.outcome,
    nSocket.outcome,
  ]);
  if (n1Outcome !== "synced" || nOutcome !== "synced") {
    console.error(`[connect] FAILED: N+1 ${n1Outcome}, N ${nOutcome}`);
    process.exit(1);
  }
  for (const old of preN) {
    const [docOutcome, tabsOutcome] = await Promise.all([
      old.doc.outcome,
      old.tabs.outcome,
    ]);
    console.log(
      `[connect] pre-N ${old.label}: document ${docOutcome}, tab list ${tabsOutcome}`,
    );
    expect(
      docOutcome === "client_outdated",
      `pre-N ${old.label}: document ${docOutcome}, expected client_outdated`,
    );
    expect(
      tabsOutcome === "synced",
      `pre-N ${old.label}: tab list ${tabsOutcome}, expected synced (exempt)`,
    );
  }

  n1Socket.doc.transact(() =>
    seedDocument(n1Socket.doc.getXmlFragment(FRAGMENT)),
  );
  if (!(await waitForQuiescence([n1Socket, nSocket], QUIESCE_TIMEOUT_MS))) {
    console.error("[seed] FAILED: the N client did not receive the seed");
    process.exit(1);
  }
  const seededBlocks = blockNames(n1Socket.doc);
  // Each pre-N client edits its device copy of the seeded document.
  for (const old of preN)
    Y.applyUpdate(old.doc.doc, Y.encodeStateAsUpdate(n1Socket.doc));
  console.log(`[seed] ${seededBlocks.length} blocks`);

  const n1 = createEditorClient(n1Socket, [TextColor, FontSize]);
  const n = createEditorClient(nSocket, []);

  // Phase 1: text only. Nobody may freeze.
  console.log(`[text] ${config.rounds} rounds: N+1 and N type, pre-N edit`);
  for (let r = 0; r < config.rounds; r++) {
    typeAtEnd(n1.fixture.editor, N1_TEXT_PARAGRAPH, WORD.n1(r));
    typeAtEnd(n.fixture.editor, N_PARAGRAPH, WORD.nBeforeMarks(r));
    for (const old of preN) preNEdit(old, r);
    await sleep(20);
  }
  await waitForQuiescence([n1Socket, nSocket], QUIESCE_TIMEOUT_MS);
  await sleep(SETTLE_MS);
  const nFrozeOnText = isFrozen(n);
  expect(!nFrozeOnText, "N froze on text-only edits (unexpected freeze)");
  expect(!isFrozen(n1), "N+1 froze on text-only edits (unexpected freeze)");
  const nSentBeforeMarks = n.fixture.outgoing.length;
  expect(nSentBeforeMarks > 0, "N sent nothing during the text phase");

  // Phase 2: N+1 writes colour and size. N must freeze and stop sending.
  console.log(`[marks] ${config.rounds} rounds: N+1 colours and sizes`);
  let nSentAtFreeze = -1;
  for (let r = 0; r < config.rounds; r++) {
    applyMark(n1.fixture.editor, r);
    typeAtEnd(n1.fixture.editor, N1_TEXT_PARAGRAPH, WORD.n1(config.rounds + r));
    if (r === 0) {
      await sleep(SETTLE_MS);
      expect(isFrozen(n), "N did not freeze when the new marks arrived");
      nSentAtFreeze = n.fixture.outgoing.length;
    }
    // A frozen N editor still runs commands; y-tiptap must drop them.
    typeAtEnd(n.fixture.editor, N_PARAGRAPH, WORD.nFrozen(r));
    for (const old of preN) preNEdit(old, config.rounds + r);
    await sleep(20);
  }
  const quiet = await waitForQuiescence(
    [n1Socket, nSocket],
    QUIESCE_TIMEOUT_MS,
  );
  await sleep(SETTLE_MS);
  expect(quiet, "N+1 and N did not quiesce");
  expect(
    n.guard.getState() === "outdated",
    `N guard ${n.guard.getState()}, expected outdated`,
  );
  expect(
    n.fixture.outgoing.length === nSentAtFreeze,
    `frozen N sent ${n.fixture.outgoing.length - nSentAtFreeze} updates`,
  );
  expect(
    n1.guard.getState() === "ok" && n1.fixture.editor.isEditable,
    `N+1 guard ${n1.guard.getState()} (unexpected freeze)`,
  );
  // The provider docs relay the server; both must hold the same state.
  const convergence = verifyConvergence([n1Socket, nSocket]);
  expect(
    convergence.pass,
    `N+1 and N provider docs differ: ${convergence.mismatch}`,
  );
  const n1Xml = n1Socket.doc.getXmlFragment(FRAGMENT).toString();

  const sockets = [n1Socket, nSocket, ...preN.flatMap((o) => [o.doc, o.tabs])];
  const refusals = refusalsOf(sockets);
  for (const refusal of refusals) expect(false, `refused: ${refusal}`);
  for (const old of preN) {
    expect(
      !old.socketCloses.includes(SOCKET_RESET_CODE),
      `pre-N ${old.label}: socket reset ${SOCKET_RESET_CODE}`,
    );
    expect(
      blockNames(old.doc.doc).length < seededBlocks.length,
      `pre-N ${old.label}: its local block deletions did not run`,
    );
  }

  n1.fixture.destroy();
  n.fixture.destroy();
  destroyClients(sockets);
  for (const old of preN) old.socket.destroy();
  await sleep(UNLOAD_WAIT_MS);

  console.log("[verify] late-joining verifier reads the stored copy");
  const { doc: server } = await fetchServerCopy(config.url, config.doc);
  const serverXml = server.getXmlFragment(FRAGMENT).toString();
  const serverText = serverXml.replace(/<[^>]*>/g, "");
  const serverBlocks = blockNames(server);
  const colourRuns = countMarkedRuns(server, TEXT_COLOR_MARK);
  const sizeRuns = countMarkedRuns(server, FONT_SIZE_MARK);

  expect(
    JSON.stringify(serverBlocks) === JSON.stringify(seededBlocks),
    `blocks ${serverBlocks.join(",")} != seeded ${seededBlocks.join(",")}`,
  );
  expect(serverXml === n1Xml, "stored copy differs from the N+1 client");
  const missing = [
    ...Array.from({ length: config.rounds * 2 }, (_, r) => WORD.n1(r)),
    ...Array.from({ length: config.rounds }, (_, r) => WORD.nBeforeMarks(r)),
  ].filter((word) => !serverText.includes(word.trim()));
  expect(missing.length === 0, `lost text: ${missing.slice(0, 5).join(",")}`);
  expect(!serverText.includes("nfrozen"), "frozen N text reached the server");
  expect(!serverText.includes("prenold"), "pre-N text reached the server");
  expect(colourRuns > 0, "no textColor run survived");
  expect(sizeRuns > 0, "no fontSize run survived");
  for (const problem of schemaProblems(server, schema))
    expect(false, `stored copy: ${problem}`);
  const serverEvents = serverLog.matching(FORBIDDEN_SERVER_EVENTS);
  for (const line of serverEvents)
    expect(false, `server log: ${line.slice(0, 200)}`);
  const storedBytes = Y.encodeStateAsUpdate(server).byteLength;
  server.destroy();

  const pass = failures.length === 0;
  const elapsedMs = Date.now() - startedAt;
  console.log(`
Mixed-version soak
  Rounds          ${config.rounds} text + ${config.rounds} marks
  pre-N clients   ${preN.map((o) => `${o.label}: ${o.doc.authFailures[0] ?? "admitted"}`).join(", ")}
  N client        ${nFrozeOnText ? "froze early" : "editable on text"}, then ${n.guard.getState()} (${nSentBeforeMarks} updates sent before, ${Math.max(0, n.fixture.outgoing.length - nSentAtFreeze)} after)
  Stored blocks   ${serverBlocks.length} of ${seededBlocks.length} seeded
  N+1 marks       ${colourRuns} textColor runs, ${sizeRuns} fontSize runs
  Stored state    ${storedBytes} B
  Server log      ${serverLog.file ? `${serverEvents.length} schema/size/ban events` : "not scanned (SOAK_HOCUS_LOG unset)"}
  Elapsed         ${(elapsedMs / 1000).toFixed(1)} s
  Result          ${pass ? "PASS" : "FAIL"}
`);
  for (const failure of failures) console.error(`[fail] ${failure}`);

  writeReport(`mixed-version-soak-report-${Date.now()}.json`, {
    timestamp: new Date().toISOString(),
    ...config,
    preN: preN.map((o) => ({
      label: o.label,
      document: o.doc.authFailures[0] ?? "admitted",
      tabsSynced: o.tabs.authFailures.length === 0,
      socketCloses: o.socketCloses,
    })),
    nFrozeOnText,
    nGuardState: n.guard.getState(),
    nUpdatesBeforeMarks: nSentBeforeMarks,
    nUpdatesAfterFreeze: Math.max(0, n.fixture.outgoing.length - nSentAtFreeze),
    seededBlocks: seededBlocks.length,
    storedBlocks: serverBlocks.length,
    textColorRuns: colourRuns,
    fontSizeRuns: sizeRuns,
    storedStateBytes: storedBytes,
    serverLogScanned: Boolean(serverLog.file),
    elapsedMs,
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
