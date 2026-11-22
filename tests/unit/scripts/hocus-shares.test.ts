import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import * as Y from "yjs";

import { mintShareId, shareDocumentName } from "@/lib/sharing/share-name";
import {
  makeShareSecrets,
  rawSecretForms,
  type ShareSecrets,
} from "@/tests/helpers/share-secrets";
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

/** The real provider (see hocus-client-gate.test.ts for why the suffix). */
const { HocuspocusProvider, HocuspocusProviderWebsocket }: ProviderModule =
  await import(
    `${Bun.resolveSync("@hocuspocus/provider", import.meta.dir)}?unmocked`
  );

const TIMEOUT_MS = 40_000;
const WAIT_MS = 10_000;

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

async function start(env: Record<string, string> = {}) {
  const server = await spawnHocus({ DB_PATH: createTempDbPath(), ...env });
  servers.push(server);
  return server;
}

function httpUrl(server: SpawnedHocus, pathname: string): string {
  return `${server.url.replace("ws://", "http://")}${pathname}`;
}

async function createShare(server: SpawnedHocus, secrets = makeShareSecrets()) {
  const lineage = crypto.randomUUID();
  const response = await fetch(httpUrl(server, "/api/shares"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lineage, ...secrets.hashes, schema: 3 }),
  });
  expect(response.status).toBe(201);
  const { share_id } = (await response.json()) as { share_id: string };
  return {
    shareId: share_id,
    name: shareDocumentName(share_id),
    secrets,
    lineage,
  };
}

type Client = {
  document: Y.Doc;
  provider: HocuspocusProvider;
  outcome: Promise<string>;
  closes: string[];
};

/** Attaches `name` with `token`; `outcome` is `synced:<scope>` or the refusal. */
function attach(
  server: SpawnedHocus,
  name: string,
  token: string,
  schema = "3",
): Client {
  const socket = new HocuspocusProviderWebsocket({
    url: `${server.url}/?schema=${schema}&build=test`,
    maxAttempts: 1,
  });
  sockets.push(socket);
  const document = new Y.Doc();
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name,
    document,
    token,
  });
  providers.push(provider);
  const closes: string[] = [];
  provider.on("close", ({ event }: { event: { reason: string } }) =>
    closes.push(event.reason),
  );
  let scope = "";
  provider.on("authenticated", ({ scope: granted }: { scope: string }) => {
    scope = granted;
  });
  const outcome = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no outcome for ${name}`)),
      WAIT_MS,
    );
    provider.on("synced", () => {
      clearTimeout(timer);
      resolve(`synced:${scope}`);
    });
    provider.on("authenticationFailed", ({ reason }: { reason: string }) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
  provider.attach();
  return { document, provider, outcome, closes };
}

function writeParagraph(document: Y.Doc, text: string): void {
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  document.getXmlFragment("default").push([paragraph]);
}

const textOf = (document: Y.Doc) =>
  document.getXmlFragment("default").toString();

describe("hocus-server share server while HOCUS_SHARES is off (the default)", () => {
  it(
    "answers 404 on the new endpoints, ok on the health check, and refuses share names as before",
    async () => {
      const server = await start();
      expect((await fetch(httpUrl(server, "/api/info"))).status).toBe(404);
      expect(
        (await fetch(httpUrl(server, "/api/shares"), { method: "POST" }))
          .status,
      ).toBe(404);
      expect(
        (
          await fetch(httpUrl(server, "/api/documents/abc"), {
            method: "DELETE",
          })
        ).status,
      ).toBe(404);
      const health = await fetch(httpUrl(server, "/"));
      expect(await health.text()).toBe("ok");

      const secrets = makeShareSecrets();
      const client = attach(
        server,
        shareDocumentName(mintShareId()),
        secrets.authEdit,
      );
      expect(await client.outcome).toBe("invalid_document_name");

      await server.stop();
      const db = new Database(server.dbPath, { readonly: true });
      try {
        expect(
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shares'",
            )
            .get(),
        ).toBeNull();
      } finally {
        db.close();
      }
    },
    TIMEOUT_MS,
  );
});

describe("hocus-server share server (HOCUS_SHARES=on)", () => {
  it(
    "syncs an edit token, keeps a view token read-only and refuses guesses",
    async () => {
      const server = await start({ HOCUS_SHARES: "on" });
      const { name, secrets, shareId } = await createShare(server);

      const editor = attach(server, name, secrets.authEdit);
      expect(await editor.outcome).toBe("synced:read-write");
      writeParagraph(editor.document, "from the editor");
      await waitFor(() => !editor.provider.hasUnsyncedChanges, "editor sent");

      const viewer = attach(server, name, secrets.authView);
      expect(await viewer.outcome).toBe("synced:readonly");
      await waitFor(
        () => textOf(viewer.document).includes("from the editor"),
        "viewer sees the edit",
      );
      writeParagraph(viewer.document, "from the viewer");
      await Bun.sleep(500);
      expect(textOf(editor.document)).not.toContain("from the viewer");

      const wrong = makeShareSecrets();
      expect(await attach(server, name, wrong.authEdit).outcome).toBe(
        "share_unavailable",
      );
      expect(
        await attach(server, shareDocumentName(mintShareId()), wrong.authEdit)
          .outcome,
      ).toBe("share_unavailable");
      expect(
        await attach(server, name, secrets.e.toString("base64url")).outcome,
      ).toBe("share_unavailable");
      expect(await attach(server, name, secrets.authEdit, "2").outcome).toBe(
        "client_outdated",
      );

      // The share commits after the debounced store.
      await waitFor(() => {
        const db = new Database(server.dbPath, { readonly: true });
        try {
          const row = db
            .prepare("SELECT status FROM shares WHERE share_id = ?")
            .get(shareId) as { status: string } | null;
          return row?.status === "committed";
        } finally {
          db.close();
        }
      }, "share committed");
    },
    TIMEOUT_MS,
  );

  it(
    "marks viewers in awareness and strips their cursor",
    async () => {
      const server = await start({ HOCUS_SHARES: "on" });
      const { name, secrets } = await createShare(server);
      const editor = attach(server, name, secrets.authEdit);
      expect(await editor.outcome).toBe("synced:read-write");
      const viewer = attach(server, name, secrets.authView);
      expect(await viewer.outcome).toBe("synced:readonly");

      viewer.provider.awareness?.setLocalState({
        user: { name: "Sam" },
        cursor: { anchor: 1, head: 1 },
      });
      editor.provider.awareness?.setLocalState({
        user: { name: "Ann" },
        viewer: true,
      });
      const viewerId = viewer.document.clientID;
      const editorId = editor.document.clientID;
      await waitFor(
        () =>
          editor.provider.awareness?.getStates().get(viewerId)?.user?.name ===
          "Sam",
        "editor sees the viewer",
      );
      const seen = editor.provider.awareness?.getStates().get(viewerId);
      expect(seen?.viewer).toBe(true);
      expect(seen?.cursor).toBeUndefined();
      await waitFor(
        () =>
          viewer.provider.awareness?.getStates().get(editorId)?.user?.name ===
          "Ann",
        "viewer sees the editor",
      );
      expect(
        viewer.provider.awareness?.getStates().get(editorId)?.viewer,
      ).toBeUndefined();
    },
    TIMEOUT_MS,
  );

  it(
    "stop sharing closes live connections and refuses with sharing_stopped",
    async () => {
      const server = await start({ HOCUS_SHARES: "on" });
      const { name, secrets, shareId } = await createShare(server);
      const editor = attach(server, name, secrets.authEdit);
      expect(await editor.outcome).toBe("synced:read-write");

      const response = await fetch(httpUrl(server, `/api/shares/${shareId}`), {
        method: "DELETE",
        headers: { authorization: `Bearer ${secrets.ownerToken}` },
      });
      expect(response.status).toBe(200);
      await waitFor(() => editor.closes.length > 0, "editor closed");

      expect(await attach(server, name, secrets.authEdit).outcome).toBe(
        "sharing_stopped",
      );
      expect(await attach(server, name, secrets.authView).outcome).toBe(
        "sharing_stopped",
      );
    },
    TIMEOUT_MS,
  );

  it(
    "view-only turns edit tokens away with view_only and keeps the view token",
    async () => {
      const server = await start({ HOCUS_SHARES: "on" });
      const { name, secrets, shareId } = await createShare(server);
      const response = await fetch(
        httpUrl(server, `/api/shares/${shareId}/view-only`),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${secrets.ownerToken}`,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      expect(response.status).toBe(200);
      expect(await attach(server, name, secrets.authEdit).outcome).toBe(
        "view_only",
      );
      expect(await attach(server, name, secrets.authView).outcome).toBe(
        "synced:readonly",
      );
    },
    TIMEOUT_MS,
  );

  it(
    "pauses the next share connection from one IP as busy, apart from the sandbox cap",
    async () => {
      const server = await start({
        HOCUS_SHARES: "on",
        SHARE_WS_CONNECTIONS_PER_IP: "2",
        WS_CONNECTION_LIMIT: "1",
      });
      const { name, secrets } = await createShare(server);
      expect(await attach(server, name, secrets.authEdit).outcome).toBe(
        "synced:read-write",
      );
      expect(await attach(server, name, secrets.authView).outcome).toBe(
        "synced:readonly",
      );
      expect(await attach(server, name, secrets.authEdit).outcome).toBe("busy");
      // The sandbox's own per-IP cap is untouched by share connections.
      expect(await attach(server, crypto.randomUUID(), "", "2").outcome).toBe(
        "synced:read-write",
      );
      await server.stop();
      expect(server.logs()).not.toContain("ws_throttle_ban");
    },
    TIMEOUT_MS,
  );

  it(
    "never receives, stores or logs a raw link secret (seam S1)",
    async () => {
      const server = await start({ HOCUS_SHARES: "on", HOCUS_LOGGER: "1" });
      const secrets: ShareSecrets = makeShareSecrets();
      const { name, shareId, lineage } = await createShare(server, secrets);
      const editor = attach(server, name, secrets.authEdit);
      expect(await editor.outcome).toBe("synced:read-write");
      writeParagraph(editor.document, "secret-free");
      await waitFor(() => !editor.provider.hasUnsyncedChanges, "editor sent");
      await Bun.sleep(300);

      // Reset and stop: owner calls carry only the owner secret and hashes.
      const next = makeShareSecrets();
      const reset = await fetch(
        httpUrl(server, `/api/shares/${shareId}/reset`),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${secrets.ownerToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...next.hashes, schema: 3 }),
        },
      );
      expect(reset.status).toBe(201);
      const { share_id: nextId } = (await reset.json()) as { share_id: string };
      const stop = await fetch(httpUrl(server, `/api/shares/${nextId}`), {
        method: "DELETE",
        headers: { authorization: `Bearer ${next.ownerToken}` },
      });
      expect(stop.status).toBe(200);
      await server.stop();

      const stored = [server.dbPath, `${server.dbPath}-wal`]
        .filter((file) => existsSync(file))
        .map((file) => readFileSync(file).toString("latin1"))
        .join("\n");
      const logs = server.logs();
      // Positive controls: the scans read the real logs and stored bytes.
      expect(logs).toContain(shareId);
      expect(logs).toContain('"type":"hocus"'); // HOCUS_LOGGER output
      expect(logs).toContain(name);
      expect(stored).toContain(lineage);
      for (const form of [
        ...rawSecretForms(secrets),
        ...rawSecretForms(next),
        secrets.authEdit,
        secrets.authView,
        secrets.ownerToken,
        next.authEdit,
        next.authView,
        next.ownerToken,
      ]) {
        expect(logs).not.toContain(form);
        expect(stored).not.toContain(form);
      }
    },
    TIMEOUT_MS,
  );
});

describe("hocus-server delete route (P4.1, HOCUS_DELETE_ROUTE=on)", () => {
  it(
    "closes a sandbox document softly and refuses share, sync and system names",
    async () => {
      const server = await start({ HOCUS_DELETE_ROUTE: "on" });
      const del = (id: string) =>
        fetch(httpUrl(server, `/api/documents/${encodeURIComponent(id)}`), {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Notes" }),
        });

      const ok = await del(crypto.randomUUID());
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ closed: true });

      for (const id of [
        shareDocumentName(mintShareId()),
        `sync:${mintShareId()}`,
        "../etc",
      ]) {
        const refused = await del(id);
        expect(refused.status).toBe(400);
        expect(await refused.json()).toEqual({ error: "Invalid document id" });
      }
      const system = await del("playground");
      expect(system.status).toBe(400);
      expect(await system.json()).toEqual({
        error: "Cannot delete a shared system document",
      });
      expect(
        (await fetch(httpUrl(server, "/api/documents/x"), { method: "GET" }))
          .status,
      ).toBe(405);
    },
    TIMEOUT_MS,
  );
});
