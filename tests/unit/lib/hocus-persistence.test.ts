// @vitest-environment node
import { Hocuspocus } from "@hocuspocus/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { createSqlitePersistence } from "@/lib/hocus-persistence";
import type { GuardrailDecision } from "@/lib/security/ws-guardrails";

import { Database } from "bun:sqlite";

const ALLOW: GuardrailDecision = { allowed: true };

let db: Database;

function createServer(
  canStore: (name: string, size: number) => GuardrailDecision = () => ALLOW,
  onStored: (name: string, size: number) => void = () => {},
): Hocuspocus {
  return new Hocuspocus({
    quiet: true,
    debounce: 0,
    extensions: [createSqlitePersistence(db, { canStore, onStored })],
  });
}

/**
 * Disconnects without the direct-connection forced unload, so the document
 * goes through the same debounced store + unload path as a closed WebSocket.
 */
async function writeText(
  server: Hocuspocus,
  name: string,
  text: string,
): Promise<void> {
  const connection = await server.openDirectConnection(name);
  await connection.transact((doc) => doc.getText("body").insert(0, text));
  await connection.disconnect({ unloadImmediately: false });
  await vi.waitFor(() => expect(server.getDocumentsCount()).toBe(0));
}

async function readText(server: Hocuspocus, name: string): Promise<string> {
  const connection = await server.openDirectConnection(name);
  const text = connection.document?.getText("body").toString() ?? "";
  await connection.disconnect();
  return text;
}

function storedNames(): string[] {
  return (
    db.prepare('SELECT name FROM "documents"').all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

describe("createSqlitePersistence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    db?.close();
  });

  it("stores state and loads it in a fresh server", async () => {
    db = new Database(":memory:");
    const onStored = vi.fn();
    await writeText(createServer(undefined, onStored), "doc-a", "hello");

    expect(storedNames()).toEqual(["doc-a"]);
    expect(onStored).toHaveBeenCalledWith("doc-a", expect.any(Number));
    expect(await readText(createServer(), "doc-a")).toBe("hello");
  });

  it("loads rows written by @hocuspocus/extension-sqlite", async () => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE IF NOT EXISTS "documents" (
      "name" varchar(255) NOT NULL,
      "data" blob NOT NULL,
      UNIQUE(name)
    )`);
    const legacy = new Y.Doc();
    legacy.getText("body").insert(0, "from v3");
    db.prepare(
      `INSERT INTO "documents" ("name", "data") VALUES ($name, $data)
        ON CONFLICT(name) DO UPDATE SET data = $data`,
    ).run({ name: "legacy", data: Buffer.from(Y.encodeStateAsUpdate(legacy)) });

    expect(await readText(createServer(), "legacy")).toBe("from v3");
  });

  it("skips denied stores and still unloads the document", async () => {
    db = new Database(":memory:");
    const onStored = vi.fn();
    const server = createServer(
      () => ({ allowed: false, reason: "max_document_size_exceeded" }),
      onStored,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    // writeText waits for the unload; a plain error would pin the document.
    await writeText(server, "too-big", "x".repeat(4096));

    expect(storedNames()).toEqual([]);
    expect(onStored).not.toHaveBeenCalled();
  });
});
