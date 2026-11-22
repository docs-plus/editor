import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { connectedPayload } from "@hocuspocus/server";

import { shareDocumentName } from "@/lib/sharing/share-name";
import {
  createShareServer,
  type ShareConnectionContext,
  type ShareServer,
} from "@/lib/sharing/share-server";
import { endShare, setShareViewOnly } from "@/lib/sharing/share-store";
import { createShareDb, seedShare } from "@/tests/helpers/share-db";

const IP = "203.0.113.30";

let db: Database;
let server: ShareServer;

beforeEach(() => {
  db = createShareDb();
  server = createShareServer({
    db,
    mode: "on",
    minClientSchema: 2,
    serverSchema: 3,
    serverVersion: "0.0.0",
    maxDocBytes: 1024,
    maxFrameBytes: 1024,
    mutationsPerMinute: 100,
    closeDocument: () => {},
  });
});

afterEach(() => db.close());

/** A `connected` payload whose connection records its close. */
function connectedTo(shareId: string, context: ShareConnectionContext) {
  const closes: unknown[] = [];
  const payload = {
    documentName: shareDocumentName(shareId),
    requestHeaders: new Headers({ "x-real-ip": IP }),
    context,
    connection: { close: (event: unknown) => closes.push(event) },
  } as unknown as connectedPayload<ShareConnectionContext>;
  return { payload, closes };
}

describe("share connections re-check the row once connected (L3)", () => {
  it("closes a connection whose share ended while it was joining", () => {
    const { shareId } = seedShare(db);
    const { payload, closes } = connectedTo(shareId, { shareReadOnly: false });
    endShare(db, shareId, "sharing_stopped");
    server.onConnected(payload);
    expect(closes).toHaveLength(1);
  });

  it("closes an editing connection whose share turned view-only meanwhile", () => {
    const { shareId } = seedShare(db);
    setShareViewOnly(db, shareId);
    const editor = connectedTo(shareId, { shareReadOnly: false });
    server.onConnected(editor.payload);
    expect(editor.closes).toHaveLength(1);

    const viewer = connectedTo(shareId, { shareReadOnly: true });
    server.onConnected(viewer.payload);
    expect(viewer.closes).toHaveLength(0);
  });

  it("leaves a connection to a live share open", () => {
    const { shareId } = seedShare(db);
    const { payload, closes } = connectedTo(shareId, { shareReadOnly: false });
    server.onConnected(payload);
    expect(closes).toHaveLength(0);
  });
});
