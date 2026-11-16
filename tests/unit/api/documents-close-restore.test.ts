import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { MAX_TABS_PER_CLIENT } from "@/lib/constants";
import { bootstrapDocumentActivityTable } from "@/lib/security/activity-store";
import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type DeleteRoute = typeof import("@/app/api/documents/[id]/route");
type RestoreRoute = typeof import("@/app/api/documents/restore/route");
type ClosedRoute = typeof import("@/app/api/documents/closed/route");

const ID = "11111111-1111-4111-8111-111111111111";
const DAY_MS = 86_400_000;

let dir: string;
let dbPath: string;

function withDb<T>(run: (db: Database) => T): T {
  const db = new Database(dbPath);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function seedDocument(name: string): void {
  withDb((db) =>
    db
      .prepare("INSERT INTO documents (name, data) VALUES (?, ?)")
      .run(name, Buffer.from("{}")),
  );
}

function closureOf(
  name: string,
): { title: string; tabs_doc: string; closed_at: number } | null {
  return withDb(
    (db) =>
      db
        .prepare(
          "SELECT title, tabs_doc, closed_at FROM document_closures WHERE name = ?",
        )
        .get(name) as {
        title: string;
        tabs_doc: string;
        closed_at: number;
      } | null,
  );
}

function hasRow(table: string, name: string): boolean {
  return withDb((db) =>
    Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE name = ?`).get(name)),
  );
}

function tombstone(name: string): void {
  withDb((db) =>
    db
      .prepare(
        "INSERT INTO document_tombstones (name, deleted_at) VALUES (?, ?)",
      )
      .run(name, Date.now()),
  );
}

const loadDelete = () =>
  importFresh<DeleteRoute>("@/app/api/documents/[id]/route");
const loadRestore = () =>
  importFresh<RestoreRoute>("@/app/api/documents/restore/route");
const loadClosed = () =>
  importFresh<ClosedRoute>("@/app/api/documents/closed/route");

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function deleteRequest(init: RequestInit = {}): Request {
  return new Request(`http://localhost/api/documents/${ID}`, {
    method: "DELETE",
    ...init,
  });
}

function jsonDelete(body: unknown): Request {
  return deleteRequest({
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function restoreRequest(
  body: unknown,
  contentType = "application/json",
): Request {
  return new Request("http://localhost/api/documents/restore", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function closedRequest(tabs = "global-tabs"): Request {
  return new Request(
    `http://localhost/api/documents/closed?tabs=${encodeURIComponent(tabs)}`,
  );
}

describe("close, restore and list routes", () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "closed-routes-"));
    dbPath = path.join(dir, "db.sqlite");
    process.env.DB_PATH = dbPath;
    withDb((db) => {
      db.exec("CREATE TABLE documents (name TEXT PRIMARY KEY, data BLOB)");
      bootstrapDocumentActivityTable(db);
    });
    seedDocument(ID);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.DB_PATH;
    delete process.env.HTTP_MUTATION_RATE_LIMIT;
    delete process.env.HOCUS_ALLOW_ISOLATED_TABS_DOCS;
    delete process.env.CLOSED_DOCUMENTS_LIST;
    vi.restoreAllMocks();
    resetModules();
    rmSync(dir, { recursive: true, force: true });
  });

  it("DELETE closes softly and keeps the stored document", async () => {
    const { DELETE } = await loadDelete();
    const res = await DELETE(
      jsonDelete({ title: "Plan", tabsDoc: "global-tabs" }),
      params(ID),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ closed: true });
    expect(hasRow("documents", ID)).toBe(true);
    expect(hasRow("document_tombstones", ID)).toBe(false);
    expect(closureOf(ID)?.title).toBe("Plan");
  });

  it("DELETE without a body records an empty title in global-tabs", async () => {
    const { DELETE } = await loadDelete();
    const res = await DELETE(deleteRequest(), params(ID));
    expect(res.status).toBe(200);
    expect(closureOf(ID)).toMatchObject({ title: "", tabs_doc: "global-tabs" });
  });

  it("DELETE ignores an oversized, chunked, non-JSON or malformed body", async () => {
    const { DELETE } = await loadDelete();
    const big = JSON.stringify({ title: "x".repeat(2048) });
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(big);
        controller.enqueue(bytes.slice(0, 1000));
        controller.enqueue(bytes.slice(1000));
        controller.close();
      },
    });
    const requests = [
      deleteRequest({
        headers: { "content-type": "application/json" },
        body: chunked,
        // @ts-expect-error: `duplex` is required for a streamed body.
        duplex: "half",
      }),
      deleteRequest({
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ title: "Plain" }),
      }),
      deleteRequest({
        headers: { "content-type": "application/json" },
        body: '{"title":',
      }),
      jsonDelete({ title: 5 }),
    ];
    // The streamed body declares no length: only counting while reading catches it.
    expect(requests[0].headers.get("content-length")).toBeNull();
    for (const request of requests) {
      const res = await DELETE(request, params(ID));
      expect(res.status).toBe(200);
      expect(closureOf(ID)?.title).toBe("");
    }
  });

  it("DELETE keeps an isolated tabsDoc only when isolation is allowed", async () => {
    let { DELETE } = await loadDelete();
    await DELETE(
      jsonDelete({ title: "A", tabsDoc: "global-tabs-w1" }),
      params(ID),
    );
    expect(closureOf(ID)?.tabs_doc).toBe("global-tabs");

    process.env.HOCUS_ALLOW_ISOLATED_TABS_DOCS = "1";
    ({ DELETE } = await loadDelete());
    await DELETE(
      jsonDelete({ title: "A", tabsDoc: "global-tabs-w1" }),
      params(ID),
    );
    expect(closureOf(ID)?.tabs_doc).toBe("global-tabs-w1");
  });

  it("DELETE of a tombstoned id reports closed: false", async () => {
    tombstone(ID);
    const { DELETE } = await loadDelete();
    const res = await DELETE(jsonDelete({ title: "A" }), params(ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ closed: false });
  });

  it("restore returns restored, then not_closed", async () => {
    const { DELETE } = await loadDelete();
    await DELETE(jsonDelete({ title: "Plan" }), params(ID));
    const { POST } = await loadRestore();

    const first = await POST(restoreRequest({ ids: [ID] }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ results: { [ID]: "restored" } });

    const second = await POST(restoreRequest({ ids: [ID] }));
    expect(await second.json()).toEqual({ results: { [ID]: "not_closed" } });
  });

  it("restore of a tombstoned id is gone", async () => {
    tombstone(ID);
    const { POST } = await loadRestore();
    const res = await POST(restoreRequest({ ids: [ID] }));
    expect(await res.json()).toEqual({ results: { [ID]: "gone" } });
  });

  it("restore of a close older than CLOSED_RETENTION_DAYS is gone before the purge runs", async () => {
    withDb((db) =>
      db
        .prepare(
          "INSERT INTO document_closures (name, tabs_doc, closed_at, title) VALUES (?, ?, ?, ?)",
        )
        .run(ID, "global-tabs", Date.now() - 8 * DAY_MS, "Old"),
    );
    const { POST } = await loadRestore();
    const res = await POST(restoreRequest({ ids: [ID] }));
    expect(await res.json()).toEqual({ results: { [ID]: "gone" } });
    expect(hasRow("document_tombstones", ID)).toBe(false);

    const { GET } = await loadClosed();
    expect((await (await GET(closedRequest())).json()).documents).toEqual([]);
  });

  it("restore restores a batch in one request", async () => {
    process.env.HTTP_MUTATION_RATE_LIMIT = "1";
    const ids = [
      ID,
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    withDb((db) => {
      const insert = db.prepare(
        "INSERT INTO document_closures (name, tabs_doc, closed_at, title) VALUES (?, ?, ?, ?)",
      );
      for (const id of ids) insert.run(id, "global-tabs", Date.now(), id);
    });
    const { POST } = await loadRestore();
    const res = await POST(restoreRequest({ ids }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: Object.fromEntries(ids.map((id) => [id, "restored"])),
    });
    // One limiter unit was spent on the whole batch.
    expect((await POST(restoreRequest({ ids }))).status).toBe(429);
  });

  it("restore refuses a bad body", async () => {
    const { POST } = await loadRestore();
    const tooMany = Array.from(
      { length: MAX_TABS_PER_CLIENT + 1 },
      (_, i) => `doc-${i}`,
    );
    const bad = [
      restoreRequest({ ids: ["playground"] }),
      restoreRequest({ ids: [] }),
      restoreRequest({ ids: tooMany }),
      restoreRequest({ ids: [ID] }, "text/plain"),
      restoreRequest({ ids: ["../x"] }),
      restoreRequest({ ids: [5] }),
      restoreRequest("not json"),
    ];
    for (const request of bad) {
      expect((await POST(request)).status).toBe(400);
    }
  });

  it("GET closed lists recent closes without caching", async () => {
    const { DELETE } = await loadDelete();
    await DELETE(jsonDelete({ title: "Plan" }), params(ID));
    const { GET, dynamic } = await loadClosed();
    expect(dynamic).toBe("force-dynamic");
    const res = await GET(closedRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      documents: [{ id: ID, title: "Plan", closedAt: expect.any(Number) }],
      retentionDays: 7,
      disabled: false,
    });
  });

  it("GET closed reads only the caller's tab list", async () => {
    process.env.HOCUS_ALLOW_ISOLATED_TABS_DOCS = "1";
    const { DELETE } = await loadDelete();
    await DELETE(
      jsonDelete({ title: "W1", tabsDoc: "global-tabs-w1" }),
      params(ID),
    );
    const { GET } = await loadClosed();
    expect((await (await GET(closedRequest())).json()).documents).toEqual([]);
    expect(
      (await (await GET(closedRequest("global-tabs-w1"))).json()).documents,
    ).toHaveLength(1);
  });

  it("GET closed is empty when CLOSED_DOCUMENTS_LIST=0", async () => {
    process.env.CLOSED_DOCUMENTS_LIST = "0";
    const { DELETE } = await loadDelete();
    await DELETE(jsonDelete({ title: "Plan" }), params(ID));
    const { GET } = await loadClosed();
    expect(await (await GET(closedRequest())).json()).toEqual({
      documents: [],
      retentionDays: 7,
      disabled: true,
    });
    const { POST } = await loadRestore();
    expect(await (await POST(restoreRequest({ ids: [ID] }))).json()).toEqual({
      results: { [ID]: "restored" },
    });
  });

  it("restore and list return 429 past HTTP_MUTATION_RATE_LIMIT", async () => {
    process.env.HTTP_MUTATION_RATE_LIMIT = "1";
    const { POST } = await loadRestore();
    expect((await POST(restoreRequest({ ids: [ID] }))).status).toBe(200);
    const throttled = await POST(restoreRequest({ ids: [ID] }));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBeTruthy();

    const { GET } = await loadClosed();
    expect((await GET(closedRequest())).status).toBe(200);
    const listThrottled = await GET(closedRequest());
    expect(listThrottled.status).toBe(429);
    expect(listThrottled.headers.get("Retry-After")).toBeTruthy();
  });
});
