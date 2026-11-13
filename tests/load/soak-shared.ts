/**
 * Shared pieces of the standalone Yjs soaks (`colour-mark-soak.ts`,
 * `mixed-version-soak.ts`): clients over a real Hocuspocus server, refusal
 * tracking, convergence, a late-joining verifier, schema checks and the
 * server log scan. The server is started outside the script, as for the
 * load harness (`make dev-hocus` in CI).
 */
import { readFileSync, statSync } from "node:fs";

import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import type { Schema } from "@tiptap/pm/model";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { isAllowedMarkKey } from "@/lib/schema-names";
import { withClientVersion } from "@/lib/schema-version";
import { EDITOR_FRAGMENT_NAME } from "@/lib/yjs-mark-migration";

export const FRAGMENT = EDITOR_FRAGMENT_NAME;
export const DEFAULT_SOAK_URL = "ws://127.0.0.1:1234";
const SYNC_TIMEOUT_MS = 30_000;

/** Refusals that mean the document stopped syncing (spec §3.1, B2, size cap). */
export const REFUSAL_REASONS = [
  "schema_rejected",
  "document_too_large",
] as const;
export const REFUSAL_CODES = [4422, 4413] as const;

/** Server log events a soak must never cause (abuse log, `logAbuseEvent`). */
export const FORBIDDEN_SERVER_EVENTS = [
  "ws_unknown_schema_name",
  "ws_update_too_large",
  "document_store_rejected",
  "ws_throttle_ban",
  "editor_root_swept",
] as const;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mulberry32: a seeded PRNG, so a failing run can be replayed by its seed. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type CloseRecord = { code: number; reason: string };

export type SoakClient = {
  label: string;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** Every close the provider saw (socket closes and per-document closes). */
  closes: CloseRecord[];
  /** `authenticationFailed` reasons (`client_outdated`, `document_deleted`). */
  authFailures: string[];
  /** Resolves `"synced"` or the refusal reason; rejects on timeout. */
  outcome: Promise<string>;
};

function track(
  label: string,
  doc: Y.Doc,
  provider: HocuspocusProvider,
): SoakClient {
  const closes: CloseRecord[] = [];
  const authFailures: string[] = [];
  provider.on(
    "close",
    ({ event }: { event: { code?: number; reason?: string } }) => {
      closes.push({ code: event.code ?? 0, reason: event.reason ?? "" });
    },
  );
  const outcome = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: no sync within ${SYNC_TIMEOUT_MS} ms`)),
      SYNC_TIMEOUT_MS,
    );
    provider.on("synced", () => {
      clearTimeout(timer);
      resolve("synced");
    });
    provider.on("authenticationFailed", ({ reason }: { reason: string }) => {
      authFailures.push(reason);
      clearTimeout(timer);
      resolve(reason);
    });
  });
  return { label, doc, provider, closes, authFailures, outcome };
}

/** A current client (`schema=2`) on its own socket, as the app connects. */
export function connectClient(
  url: string,
  documentName: string,
  label: string,
  doc: Y.Doc = new Y.Doc(),
): SoakClient {
  const provider = new HocuspocusProvider({
    url: withClientVersion(url),
    name: documentName,
    document: doc,
    token: `soak-${label}`,
  } as ConstructorParameters<typeof HocuspocusProvider>[0]);
  return track(label, doc, provider);
}

/**
 * A shared socket opened with an explicit `schema` (null: no parameter at
 * all, as pre-release-N bundles connect). One reconnect attempt only.
 */
export function openRawSocket(
  url: string,
  schema: string | null,
): HocuspocusProviderWebsocket {
  const base = new URL(url);
  if (schema !== null) {
    base.searchParams.set("schema", schema);
    base.searchParams.set("build", "soak-old");
  }
  return new HocuspocusProviderWebsocket({
    url: base.toString(),
    maxAttempts: 1,
  });
}

/** Attaches `documentName` to a socket opened by `openRawSocket`. */
export function attachToSocket(
  socket: HocuspocusProviderWebsocket,
  documentName: string,
  label: string,
  doc: Y.Doc = new Y.Doc(),
): SoakClient {
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: documentName,
    document: doc,
  });
  const client = track(label, doc, provider);
  provider.attach();
  return client;
}

export function destroyClients(clients: SoakClient[]): void {
  for (const { provider, doc } of clients) {
    provider.destroy();
    doc.destroy();
  }
}

/** Closes that mean the server refused a document (empty when none). */
export function refusalsOf(clients: SoakClient[]): string[] {
  return clients.flatMap((client) =>
    client.closes
      .filter(
        ({ code, reason }) =>
          (REFUSAL_CODES as readonly number[]).includes(code) ||
          (REFUSAL_REASONS as readonly string[]).includes(reason),
      )
      .map(({ code, reason }) => `${client.label}: ${code} ${reason}`),
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => b[i] === byte);
}

/**
 * Waits until no client has unsynced changes and every state vector is
 * equal, i.e. the server acknowledged everything and relayed it to all.
 * Resolves false on timeout.
 */
export async function waitForQuiescence(
  clients: SoakClient[],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = clients.some((c) => c.provider.hasUnsyncedChanges);
    const vectors = clients.map((c) => Y.encodeStateVector(c.doc));
    if (!pending && vectors.every((v) => sameBytes(v, vectors[0]))) return true;
    await sleep(100);
  }
  return false;
}

export type Convergence = {
  pass: boolean;
  byteLevelMatch: boolean;
  mismatch?: string;
};

/** Byte-level state match, falling back to the editor fragment's XML. */
export function verifyConvergence(
  labelled: { label: string; doc: Y.Doc }[],
): Convergence {
  const [ref, ...rest] = labelled;
  const refState = Y.encodeStateAsUpdate(ref.doc);
  const refXml = ref.doc.getXmlFragment(FRAGMENT).toString();
  let byteLevelMatch = true;
  for (const other of rest) {
    if (sameBytes(refState, Y.encodeStateAsUpdate(other.doc))) continue;
    byteLevelMatch = false;
    if (other.doc.getXmlFragment(FRAGMENT).toString() !== refXml) {
      return {
        pass: false,
        byteLevelMatch,
        mismatch: `${ref.label} vs ${other.label}`,
      };
    }
  }
  return { pass: true, byteLevelMatch };
}

/**
 * The server's copy as a fresh client sees it: connects, syncs, and
 * returns the doc after detaching. Run it after the others disconnect and
 * the document unloaded, and it reads what persistence stored.
 */
export async function fetchServerCopy(
  url: string,
  documentName: string,
): Promise<{ doc: Y.Doc; closes: CloseRecord[] }> {
  const verifier = connectClient(url, documentName, "verifier");
  const outcome = await verifier.outcome;
  if (outcome !== "synced") {
    destroyClients([verifier]);
    throw new Error(`verifier refused: ${outcome}`);
  }
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(verifier.doc));
  const closes = [...verifier.closes];
  destroyClients([verifier]);
  return { doc: copy, closes };
}

/** Keys of every format attribute stored in the editor fragment. */
function collectMarkKeys(
  node: Y.XmlFragment | Y.XmlElement,
  keys: Set<string>,
): void {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as {
        attributes?: Record<string, unknown>;
      }[]) {
        for (const key of Object.keys(op.attributes ?? {})) keys.add(key);
      }
    } else if (child instanceof Y.XmlElement) {
      collectMarkKeys(child, keys);
    }
  }
}

/**
 * Problems that would freeze or break the editor: content that does not
 * fit `schema` (ProseMirror `check()`), and mark keys outside the server
 * allowlist. Empty when the document is valid.
 */
export function schemaProblems(doc: Y.Doc, schema: Schema): string[] {
  const problems: string[] = [];
  try {
    schema.nodeFromJSON(yDocToProsemirrorJSON(doc, FRAGMENT)).check();
  } catch (error) {
    problems.push(`schema: ${(error as Error).message}`);
  }
  const keys = new Set<string>();
  collectMarkKeys(doc.getXmlFragment(FRAGMENT), keys);
  for (const key of keys) {
    if (!isAllowedMarkKey(key)) problems.push(`mark not allowed: ${key}`);
  }
  return problems;
}

/**
 * Reads the server log the soak appends to (`SOAK_HOCUS_LOG`). `since()`
 * returns lines written after the reader was created, so earlier runs
 * against the same server do not count. Without a path, nothing is read.
 */
export function createServerLogReader(path: string | undefined) {
  const file = path?.trim() || undefined;
  const offset = file ? statSync(file).size : 0;
  return {
    file,
    since(): string[] {
      if (!file) return [];
      return readFileSync(file).subarray(offset).toString("utf8").split("\n");
    },
    /** Lines naming any of `events`. */
    matching(events: readonly string[]): string[] {
      return this.since().filter((line) =>
        events.some((event) => line.includes(event)),
      );
    },
  };
}
