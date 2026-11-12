import { describe, expect, it, spyOn } from "bun:test";

import type { JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";

import { generatePlaygroundContent } from "@/components/document-editor/playground-scenarios";
import {
  addsNoItems,
  DocumentGuard,
  findDisallowedSchemaNames,
  isDocumentUpdateFrame,
  SCHEMA_REJECTED,
} from "@/lib/security/hocus-document-guard";
import deeplyNested from "@/tests/fixtures/deeply-nested.json";
import emptyDoc from "@/tests/fixtures/empty-document.json";
import mixedContent from "@/tests/fixtures/mixed-content.json";
import realWorld from "@/tests/fixtures/real-world-complex.json";
import titleOnly from "@/tests/fixtures/title-only.json";
import wide from "@/tests/fixtures/wide-document.json";
import { getEditorSchema } from "@/tests/helpers/editor-schema";

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

describe("findDisallowedSchemaNames (B2)", () => {
  const schema = getEditorSchema();
  const FIXTURES = [
    deeplyNested,
    emptyDoc,
    mixedContent,
    realWorld,
    titleOnly,
    wide,
  ] as JSONContent[];
  const toUpdate = (json: JSONContent) =>
    Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, json, "default"));

  /** An update with one XmlText per given format key and element name. */
  function craft(elements: string[], formatKeys: string[]): Uint8Array {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    for (const name of elements) fragment.push([new Y.XmlElement(name)]);
    if (formatKeys.length > 0) {
      const text = new Y.XmlText();
      fragment.push([text]);
      text.insert(0, "x");
      for (const key of formatKeys) text.format(0, 1, { [key]: true });
    }
    return Y.encodeStateAsUpdate(doc);
  }

  it("passes every fixture and the playground (allowlist drift guard)", () => {
    for (const json of [...FIXTURES, generatePlaygroundContent()]) {
      expect(findDisallowedSchemaNames(toUpdate(json))).toEqual([]);
    }
  });

  it("allows legacy, pending and hashed mark keys", () => {
    const keys = [
      "link",
      "code",
      "textColor",
      "fontSize",
      "hyperlink--abcd1234",
    ];
    expect(findDisallowedSchemaNames(craft([], keys))).toEqual([]);
  });

  it("names unknown elements and marks", () => {
    expect(findDisallowedSchemaNames(craft(["zzz"], []))).toEqual(["zzz"]);
    expect(findDisallowedSchemaNames(craft([], ["zzz--abcd1234"]))).toEqual([
      "zzz",
    ]);
  });

  it("truncates names and honors the limit", () => {
    const long = "a".repeat(100);
    expect(findDisallowedSchemaNames(craft([long], []))).toEqual([
      "a".repeat(40),
    ]);
    expect(
      findDisallowedSchemaNames(craft(["a", "b", "c", "d", "e"], []), 3),
    ).toHaveLength(3);
  });

  it("fails closed on bytes it cannot decode", () => {
    expect(
      findDisallowedSchemaNames(Uint8Array.from([255, 255, 255])),
    ).toBeNull();
  });

  function payloadFor(name: string, update: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, name);
    encoding.writeVarUint(encoder, 0);
    encoding.writeVarUint(encoder, 2);
    encoding.writeVarUint8Array(encoder, update);
    return {
      documentName: name,
      update: encoding.toUint8Array(encoder),
      requestHeaders: new Headers(),
      document: new Y.Doc(),
    } as unknown as Parameters<DocumentGuard["beforeHandleMessage"]>[0];
  }

  it("closes with schema_rejected before any size check and logs ws_unknown_schema_name", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const guard = new DocumentGuard({
        maxDocumentBytes: () => 1e9,
        maxAwarenessStateBytes: 4096,
      });
      await expect(
        guard.beforeHandleMessage(payloadFor("doc", craft(["zzz"], []))),
      ).rejects.toEqual(SCHEMA_REJECTED);
      const logged = warn.mock.calls.map(String).join();
      expect(logged).toContain("ws_unknown_schema_name");
      expect(logged).not.toContain("ws_guardrail_rejected");
    } finally {
      warn.mockRestore();
    }
  });

  it("lets valid updates through", async () => {
    const guard = new DocumentGuard({
      maxDocumentBytes: () => 1e9,
      maxAwarenessStateBytes: 4096,
    });
    await expect(
      guard.beforeHandleMessage(
        payloadFor("doc", toUpdate(mixedContent as JSONContent)),
      ),
    ).resolves.toBeUndefined();
  });
});
