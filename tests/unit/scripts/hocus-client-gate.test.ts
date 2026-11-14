import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";

import * as Y from "yjs";

import { DOCUMENTS_SCHEMA } from "@/lib/hocus-persistence";
import {
  bootstrapDocumentActivityTable,
  deleteDocumentPermanently,
} from "@/lib/security/activity-store";
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

/**
 * The real provider. Other test files in this process replace
 * `@hocuspocus/provider` with `mock.module`; a query suffix loads the same
 * file as a separate, unmocked module (sharing this process's Yjs).
 */
const { HocuspocusProvider, HocuspocusProviderWebsocket }: ProviderModule =
  await import(
    `${Bun.resolveSync("@hocuspocus/provider", import.meta.dir)}?unmocked`
  );

const TIMEOUT_MS = 30_000;
const OUTCOME_TIMEOUT_MS = 10_000;

type Outcome = "synced" | string;

const servers: SpawnedHocus[] = [];
const sockets: HocuspocusProviderWebsocket[] = [];
const providers: HocuspocusProvider[] = [];

async function start(env: Record<string, string> = {}) {
  const server = await spawnHocus(env);
  servers.push(server);
  return server;
}

/** A shared socket, as the app opens it: bare origin plus `/?schema=…`. */
function openSocket(server: SpawnedHocus, schema: string | null) {
  const query = schema === null ? "" : `/?schema=${schema}&build=test`;
  const socket = new HocuspocusProviderWebsocket({
    url: `${server.url}${query}`,
    maxAttempts: 1,
  });
  sockets.push(socket);
  return socket;
}

/** Attaches `name`; resolves with `synced` or the refusal reason. */
function attach(socket: HocuspocusProviderWebsocket, name: string) {
  const document = new Y.Doc();
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name,
    document,
  });
  providers.push(provider);
  const outcome = new Promise<Outcome>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no outcome for ${name}`)),
      OUTCOME_TIMEOUT_MS,
    );
    provider.on("synced", () => {
      clearTimeout(timer);
      resolve("synced");
    });
    provider.on("authenticationFailed", ({ reason }: { reason: string }) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
  provider.attach();
  return { provider, document, outcome };
}

function createDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.exec(DOCUMENTS_SCHEMA);
  bootstrapDocumentActivityTable(db);
  return db;
}

afterEach(async () => {
  for (const provider of providers.splice(0)) provider.destroy();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) {
    await server.stop();
    rmSync(path.dirname(server.dbPath), { recursive: true, force: true });
  }
});

describe("hocus-server client schema gate", () => {
  it(
    "refuses a gated document and keeps the tab list on the same socket",
    async () => {
      const server = await start({ HOCUS_MIN_CLIENT_SCHEMA: "2" });
      const socket = openSocket(server, "1");
      const doc = attach(socket, crypto.randomUUID());
      const tabs = attach(socket, "global-tabs");
      expect(await doc.outcome).toBe("client_outdated");
      expect(await tabs.outcome).toBe("synced");
    },
    TIMEOUT_MS,
  );

  it(
    "gates the playground",
    async () => {
      const server = await start({ HOCUS_MIN_CLIENT_SCHEMA: "2" });
      const socket = openSocket(server, "1");
      expect(await attach(socket, "playground").outcome).toBe(
        "client_outdated",
      );
    },
    TIMEOUT_MS,
  );

  it(
    "checks tombstones before the gate",
    async () => {
      const name = crypto.randomUUID();
      const dbPath = createTempDbPath();
      const db = createDb(dbPath);
      deleteDocumentPermanently(db, name);
      db.close();
      const server = await start({
        HOCUS_MIN_CLIENT_SCHEMA: "2",
        DB_PATH: dbPath,
      });
      const socket = openSocket(server, "1");
      expect(await attach(socket, name).outcome).toBe("document_deleted");
    },
    TIMEOUT_MS,
  );

  it(
    "accepts a current client",
    async () => {
      const server = await start({ HOCUS_MIN_CLIENT_SCHEMA: "2" });
      const socket = openSocket(server, "2");
      expect(await attach(socket, crypto.randomUUID()).outcome).toBe("synced");
    },
    TIMEOUT_MS,
  );

  const drillEnvs: Record<string, string>[] = [
    {},
    { HOCUS_MIN_CLIENT_SCHEMA: "0" },
  ];
  for (const env of drillEnvs) {
    it(
      `env ${JSON.stringify(env)} → effective min 2: refuses schema < 2, keeps tabs exempt, logs counts (staging drill)`,
      async () => {
        const server = await start(env);
        const outcomes = await Promise.all(
          [null, "abc", "1", "2"].map(
            (schema) =>
              attach(openSocket(server, schema), crypto.randomUUID()).outcome,
          ),
        );
        expect(outcomes).toEqual([
          "client_outdated",
          "client_outdated",
          "client_outdated",
          "synced",
        ]);
        const tabs = await attach(
          openSocket(server, null),
          `global-tabs-${crypto.randomUUID()}`,
        ).outcome;
        expect(tabs).toBe("synced");
        expect(server.logs()).toContain(
          "client schema gate: min=2 (floor 2, env 0)",
        );
        await server.stop();
        const line = server
          .logs()
          .split("\n")
          .find((entry) => entry.includes('"client_schema"'));
        expect(line).toBeDefined();
        const counts = JSON.parse(line ?? "{}");
        expect(counts).toMatchObject({
          type: "hocus",
          event: "client_schema",
          missing: 1,
          invalid: 1,
          low: 1,
          ok: 1,
        });
        expect(counts.refused).toBeGreaterThanOrEqual(3);
        expect(line).not.toContain("abc");
        // Refusals reach the log only through the aggregate: no per-attempt
        // hook error, no code frame.
        expect(server.logs()).not.toContain("[onConnect]");
        expect(server.logs()).not.toContain("client_outdated");
      },
      TIMEOUT_MS,
    );
  }

  it(
    "never lets a refused client grow the queue into a socket reset",
    async () => {
      // Read after stop: a caller-owned DB outlives the server. No env
      // minimum: the built-in floor alone refuses (refused-client soak).
      const server = await start({
        HOCUS_THROTTLE: "1",
        DB_PATH: createTempDbPath(),
      });
      const socket = openSocket(server, "1");
      const closeCodes: number[] = [];
      socket.on("close", ({ event }: { event: { code: number } }) => {
        closeCodes.push(event.code);
      });
      const name = crypto.randomUUID();
      const { document, outcome } = attach(socket, name);
      expect(await outcome).toBe("client_outdated");

      const text = document.getText("t");
      for (let i = 0; i < 3000; i++) {
        text.insert(text.length, "x");
        if (i % 100 === 99) await Bun.sleep(5);
      }
      await Bun.sleep(500);

      expect(closeCodes).not.toContain(4205);
      await server.stop();
      const logs = server.logs();
      expect(logs).not.toContain("ws_throttle_ban");
      expect(logs).not.toContain("ws_guardrail_rejected");
      const db = new Database(server.dbPath, { readonly: true });
      try {
        const row = db
          .prepare("SELECT name FROM documents WHERE name = ?")
          .get(name);
        expect(row).toBeNull();
      } finally {
        db.close();
      }
    },
    TIMEOUT_MS,
  );
});
