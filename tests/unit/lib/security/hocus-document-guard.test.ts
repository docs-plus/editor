import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  addsNoItems,
  isDocumentUpdateFrame,
} from "@/lib/security/hocus-document-guard";

/** Hocuspocus frame: varString document name, varUint fields, payload. */
function frame(name: string, ...varUints: number[]): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  return Uint8Array.from([nameBytes.length, ...nameBytes, ...varUints]);
}

/** Sync frame carrying a Yjs update of `updateBytes` bytes. */
function syncFrame(syncType: number, updateBytes: number): Uint8Array {
  return Uint8Array.from([
    ...frame("doc", 0, syncType, updateBytes),
    ...new Uint8Array(updateBytes),
  ]);
}

describe("isDocumentUpdateFrame (A04-2)", () => {
  it("counts sync step 2 and update frames that carry content", () => {
    expect(isDocumentUpdateFrame(syncFrame(1, 40))).toBe(true);
    expect(isDocumentUpdateFrame(syncFrame(2, 40))).toBe(true);
    expect(isDocumentUpdateFrame(syncFrame(2, 300))).toBe(true);
  });

  it("ignores the empty step 2 every client sends on connect", () => {
    expect(isDocumentUpdateFrame(syncFrame(1, 2))).toBe(false);
    expect(isDocumentUpdateFrame(syncFrame(2, 2))).toBe(false);
  });

  it("ignores step 1, awareness, auth and malformed frames", () => {
    expect(isDocumentUpdateFrame(syncFrame(0, 40))).toBe(false);
    expect(isDocumentUpdateFrame(frame("doc", 1))).toBe(false);
    expect(isDocumentUpdateFrame(frame("doc", 2))).toBe(false);
    expect(isDocumentUpdateFrame(new Uint8Array())).toBe(false);
    expect(isDocumentUpdateFrame(Uint8Array.from([200]))).toBe(false);
  });
});

describe("addsNoItems (delete-only updates at the cap)", () => {
  function docWithText(text: string): Y.Doc {
    const doc = new Y.Doc();
    doc.getText("t").insert(0, text);
    return doc;
  }

  it("allows a deletion so a document at its cap can be trimmed", () => {
    const server = docWithText("hello world");
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    const before = Y.encodeStateVector(client);
    client.getText("t").delete(0, 5);
    const deletion = Y.encodeStateAsUpdate(client, before);
    expect(addsNoItems(deletion, server)).toBe(true);
  });

  it("allows a resend of content the server already has", () => {
    const server = docWithText("same");
    expect(addsNoItems(Y.encodeStateAsUpdate(server), server)).toBe(true);
  });

  it("refuses an update that inserts content", () => {
    const server = docWithText("hello");
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    const before = Y.encodeStateVector(client);
    client.getText("t").insert(5, "!");
    expect(addsNoItems(Y.encodeStateAsUpdate(client, before), server)).toBe(
      false,
    );
  });

  it("treats garbage as growth (fails closed)", () => {
    expect(addsNoItems(Uint8Array.from([9, 9, 9]), new Y.Doc())).toBe(false);
  });
});
