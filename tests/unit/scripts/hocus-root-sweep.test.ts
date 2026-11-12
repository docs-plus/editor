import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";

import type { JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";

import { DOCUMENTS_SCHEMA } from "@/lib/hocus-persistence";
import titleOnly from "@/tests/fixtures/title-only.json";
import { createCollabEditor } from "@/tests/helpers/collab-editor";
import { getEditorSchema } from "@/tests/helpers/editor-schema";
import {
  createTempDbPath,
  type SpawnedHocus,
  spawnHocus,
} from "@/tests/helpers/spawn-hocus";

type ProviderModule = typeof import("@hocuspocus/provider");
type HocuspocusProvider = InstanceType<ProviderModule["HocuspocusProvider"]>;
type HocuspocusProviderWebsocket = InstanceType<
  ProviderModule["HocuspocusProviderWebsocket"]
>;

/** The real provider (other files mock it); see hocus-client-gate.test.ts. */
const { HocuspocusProvider, HocuspocusProviderWebsocket }: ProviderModule =
  await import(
    `${Bun.resolveSync("@hocuspocus/provider", import.meta.dir)}?unmocked`
  );

const TIMEOUT_MS = 30_000;
const WAIT_MS = 10_000;
const schema = getEditorSchema();

const servers: SpawnedHocus[] = [];
const sockets: HocuspocusProviderWebsocket[] = [];
const providers: HocuspocusProvider[] = [];

afterEach(async () => {
  for (const provider of providers.splice(0)) provider.destroy();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) {
    await server.stop();
    rmSync(path.dirname(server.dbPath), { recursive: true, force: true });
  }
});

async function waitFor(condition: () => boolean, what: string) {
  const deadline = Date.now() + WAIT_MS;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await Bun.sleep(20);
  }
}

async function start() {
  // Caller-owned DB: read after the server stopped.
  const server = await spawnHocus({ DB_PATH: createTempDbPath() });
  servers.push(server);
  return server;
}

/** A synced editor client on its own socket, as the app opens one. */
async function connect(server: SpawnedHocus, name: string) {
  const socket = new HocuspocusProviderWebsocket({
    url: `${server.url}/?schema=2&build=test`,
    maxAttempts: 1,
  });
  sockets.push(socket);
  const document = new Y.Doc();
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name,
    document,
  });
  providers.push(provider);
  const closes: string[] = [];
  provider.on("close", ({ event }: { event: { reason: string } }) =>
    closes.push(event.reason),
  );
  provider.attach();
  await waitFor(() => provider.isSynced, `${name} synced`);
  /** Sends a raw sync update frame for `name`, bypassing the provider's doc. */
  const sendUpdate = (update: Uint8Array) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, name);
    encoding.writeVarUint(encoder, 0);
    encoding.writeVarUint(encoder, 2);
    encoding.writeVarUint8Array(encoder, update);
    socket.send(encoding.toUint8Array(encoder));
  };
  return { document, provider, closes, sendUpdate };
}

const onlyElements = (doc: Y.Doc) =>
  doc
    .getXmlFragment("default")
    .toArray()
    .every((child) => child instanceof Y.XmlElement);

function readStored(dbPath: string, name: string): Y.Doc {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare<{ data: Uint8Array }, [string]>(
        'SELECT data FROM "documents" WHERE name = ?',
      )
      .get(name);
    const doc = new Y.Doc();
    if (row) Y.applyUpdate(doc, row.data);
    return doc;
  } finally {
    db.close();
  }
}

describe("hocus-server editor root sweep", () => {
  it(
    "sweeps top-level text released from pending before clients see it",
    async () => {
      const server = await start();
      const name = crypto.randomUUID();
      const attacker = await connect(server, name);
      attacker.document.transact(() => {
        const seed = prosemirrorJSONToYDoc(
          schema,
          titleOnly as JSONContent,
          "default",
        );
        Y.applyUpdate(attacker.document, Y.encodeStateAsUpdate(seed));
      });
      await waitFor(
        () => !attacker.provider.hasUnsyncedChanges,
        "seed stored on the server",
      );

      // U1 adds a block, U2 top-level text after it; U2 is sent first.
      const forged = new Y.Doc();
      Y.applyUpdate(forged, Y.encodeStateAsUpdate(attacker.document));
      const updates: Uint8Array[] = [];
      forged.on("update", (update: Uint8Array) => updates.push(update));
      const fragment = forged.getXmlFragment("default");
      forged.transact(() =>
        fragment.insert(1, [new Y.XmlElement("paragraph")]),
      );
      forged.transact(() => fragment.insert(2, [new Y.XmlText("stray text")]));
      const [u1, u2] = updates;
      attacker.sendUpdate(u2);
      await Bun.sleep(300);

      // A client joining now receives U2 too and holds it pending.
      const victim = await connect(server, name);
      expect(victim.document.store.pendingStructs).not.toBeNull();
      const blocks = victim.document.getXmlFragment("default").length;
      let sawStray = false;
      victim.document.getXmlFragment("default").observe(() => {
        if (!onlyElements(victim.document)) sawStray = true;
      });

      attacker.sendUpdate(u1);
      await waitFor(
        () =>
          victim.document.getXmlFragment("default").length === blocks + 1 &&
          victim.document.store.pendingStructs === null,
        "victim received the block",
      );
      await Bun.sleep(300);

      expect(sawStray).toBe(false);
      expect(onlyElements(victim.document)).toBe(true);
      expect(onlyElements(attacker.document)).toBe(true);
      expect(attacker.closes).toEqual([]);
      const fresh = createCollabEditor({ server: victim.document });
      try {
        expect(fresh.errors).toEqual([]);
        expect(fresh.editor.getText()).not.toContain("stray");
      } finally {
        fresh.destroy();
      }

      await server.stop();
      expect(onlyElements(readStored(server.dbPath, name))).toBe(true);
      const swept = server
        .logs()
        .split("\n")
        .filter((line) => line.includes("editor_root_swept"));
      expect(swept).toHaveLength(1);
      expect(JSON.parse(swept[0])).toMatchObject({
        documentName: name,
        phase: "update",
        removed: 1,
        types: ["text"],
      });
      expect(swept[0]).not.toContain("stray");
    },
    TIMEOUT_MS,
  );

  it(
    "cleans a stored document holding top-level text when it loads",
    async () => {
      const dbPath = createTempDbPath();
      const name = crypto.randomUUID();
      const poisoned = prosemirrorJSONToYDoc(
        schema,
        titleOnly as JSONContent,
        "default",
      );
      poisoned.getXmlFragment("default").insert(1, [new Y.XmlText("poison")]);
      const db = new Database(dbPath);
      db.exec(DOCUMENTS_SCHEMA);
      db.prepare('INSERT INTO "documents" ("name", "data") VALUES (?, ?)').run(
        name,
        Y.encodeStateAsUpdate(poisoned),
      );
      db.close();
      const server = await spawnHocus({ DB_PATH: dbPath });
      servers.push(server);

      const client = await connect(server, name);
      expect(onlyElements(client.document)).toBe(true);
      const fresh = createCollabEditor({ server: client.document });
      try {
        expect(fresh.errors).toEqual([]);
      } finally {
        fresh.destroy();
      }

      await server.stop();
      expect(onlyElements(readStored(dbPath, name))).toBe(true);
      expect(server.logs()).toContain('"phase":"load"');
      expect(server.logs()).not.toContain("poison");
    },
    TIMEOUT_MS,
  );
});
