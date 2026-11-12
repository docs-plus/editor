import { describe, expect, it, spyOn } from "bun:test";

import type { JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";

import { generatePlaygroundContent } from "@/components/document-editor/playground-scenarios";
import {
  addsNoItems,
  DOCUMENT_TOO_LARGE,
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

  /** An update with the given elements, then a paragraph formatted with each key. */
  function craft(elements: string[], formatKeys: string[]): Uint8Array {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    for (const name of elements) fragment.push([new Y.XmlElement(name)]);
    if (formatKeys.length > 0) {
      const paragraph = new Y.XmlElement("paragraph");
      const text = new Y.XmlText();
      fragment.push([paragraph]);
      paragraph.push([text]);
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

  it("allows legacy and hashed mark keys", () => {
    const keys = ["link", "code", "hyperlink--abcd1234"];
    expect(findDisallowedSchemaNames(craft([], keys))).toEqual([]);
  });

  it("refuses the smart toolbar marks until their server half ships", () => {
    // Allowed in N, `textColor` would freeze every N client on any document.
    expect(findDisallowedSchemaNames(craft([], ["textColor"]))).toEqual([
      "textColor",
    ]);
    expect(
      findDisallowedSchemaNames(craft([], ["fontSize--abcd1234"])),
    ).toEqual(["fontSize"]);
  });

  describe("content directly in the editor fragment (I4)", () => {
    /** A server document holding a title, and a client synced to it. */
    function serverAndClient() {
      const server = prosemirrorJSONToYDoc(
        schema,
        titleOnly as JSONContent,
        "default",
      );
      const client = new Y.Doc();
      Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
      return { server, client, fragment: client.getXmlFragment("default") };
    }
    const changes = (client: Y.Doc, edit: () => void) => {
      const before = Y.encodeStateVector(client);
      edit();
      return Y.encodeStateAsUpdate(client, before);
    };

    it("refuses top-level text in a fresh fragment", () => {
      const doc = new Y.Doc();
      doc.getXmlFragment("default").insert(0, [new Y.XmlText("x")]);
      expect(findDisallowedSchemaNames(Y.encodeStateAsUpdate(doc))).toEqual([
        "#text",
      ]);
    });

    it("refuses top-level text placed after an existing block", () => {
      const { server, client, fragment } = serverAndClient();
      const update = changes(client, () =>
        fragment.insert(1, [new Y.XmlText("x")]),
      );
      expect(findDisallowedSchemaNames(update, 3, server)).toEqual(["#text"]);
    });

    it("refuses top-level text placed before an existing block", () => {
      const { server, client, fragment } = serverAndClient();
      const update = changes(client, () =>
        fragment.insert(0, [new Y.XmlText("x")]),
      );
      expect(findDisallowedSchemaNames(update, 3, server)).toEqual(["#text"]);
    });

    it("refuses top-level text chained after a new block in one update", () => {
      const { server, client, fragment } = serverAndClient();
      const update = changes(client, () => {
        fragment.insert(1, [new Y.XmlElement("paragraph")]);
        fragment.insert(2, [new Y.XmlText("x")]);
      });
      expect(findDisallowedSchemaNames(update, 3, server)).toEqual(["#text"]);
    });

    it("allows content whose position it cannot resolve yet", () => {
      const { server, client, fragment } = serverAndClient();
      // The paragraph has not reached the server: Yjs holds the text pending,
      // and the server sweep deletes it if it lands in the fragment.
      changes(client, () =>
        fragment.insert(1, [new Y.XmlElement("paragraph")]),
      );
      const update = changes(client, () =>
        fragment.insert(2, [new Y.XmlText("x")]),
      );
      expect(findDisallowedSchemaNames(update, 3, server)).toEqual([]);
    });

    /** A client restored from a device copy holding edits the server lacks. */
    function resumedFromDeviceCopy(
      offlineEdit: (fragment: Y.XmlFragment) => void,
    ) {
      const { server, client, fragment } = serverAndClient();
      offlineEdit(fragment);
      const resumed = new Y.Doc();
      Y.applyUpdate(resumed, Y.encodeStateAsUpdate(client));
      return { server, resumed, fragment: resumed.getXmlFragment("default") };
    }
    const textOf = (fragment: Y.XmlFragment, index: number) =>
      (fragment.get(index) as Y.XmlElement).get(0) as Y.XmlText;

    it("allows a keystroke after offline text, before the sync", () => {
      const { server, resumed, fragment } = resumedFromDeviceCopy((offline) =>
        textOf(offline, 0).insert(textOf(offline, 0).length, " offline words"),
      );
      const update = changes(resumed, () => {
        const text = textOf(fragment, 0);
        text.insert(text.length, "!");
      });
      expect(findDisallowedSchemaNames(update, 3, server)).toEqual([]);
    });

    it("allows a keystroke in a paragraph created offline", () => {
      const { server, resumed, fragment } = resumedFromDeviceCopy((offline) => {
        const paragraph = new Y.XmlElement("paragraph");
        offline.insert(1, [paragraph]);
        const text = new Y.XmlText();
        paragraph.insert(0, [text]);
        text.insert(0, "offline paragraph");
      });
      const update = changes(resumed, () => {
        const text = textOf(fragment, 1);
        text.insert(text.length, "?");
      });
      expect(findDisallowedSchemaNames(update, 3, server)).toEqual([]);
    });

    it("allows a tab list update whose origin is not on the server yet", () => {
      const server = new Y.Doc();
      server.getArray("tabs").insert(0, [{ id: "playground" }]);
      const client = new Y.Doc();
      Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
      const tabs = client.getArray("tabs");
      // The first push is still queued when the provider drops its queue.
      changes(client, () => tabs.push([{ id: "unsent" }]));
      const update = changes(client, () => tabs.push([{ id: "next" }]));
      expect(findDisallowedSchemaNames(update, 3, server)).toEqual([]);
    });

    it("resolves a long chain of blocks in linear time", () => {
      // ~1.2 MB, under the size cap: quadratic took ~550 ms here, linear ~30.
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment("default");
      const blocks = Array.from(
        { length: 100_000 },
        () => new Y.XmlElement("paragraph"),
      );
      fragment.insert(0, blocks);
      fragment.insert(blocks.length, [new Y.XmlText("x")]);
      const update = Y.encodeStateAsUpdate(doc);
      const started = performance.now();
      expect(findDisallowedSchemaNames(update)).toEqual(["#text"]);
      expect(performance.now() - started).toBeLessThan(250);
    });

    it("allows typing, blocks and other root types", () => {
      const { server, client, fragment } = serverAndClient();
      const update = changes(client, () => {
        const paragraph = new Y.XmlElement("paragraph");
        fragment.insert(1, [paragraph]);
        const text = new Y.XmlText();
        paragraph.insert(0, [text]);
        text.insert(0, "hello");
        ((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(
          0,
          "typed ",
        );
        client.getArray("tabs").insert(0, ["not the editor"]);
      });
      expect(findDisallowedSchemaNames(update, 3, server)).toEqual([]);
    });
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

  it("closes with schema_rejected and logs ws_unknown_schema_name", async () => {
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

  describe("frame decoding matches Hocuspocus (bypass fixes)", () => {
    const unknown = craft(["zzz"], []);

    /** Frame with raw prefix bytes between the name and the payload. */
    function rawFrame(prefix: number[], update: Uint8Array, padLength = false) {
      const encoder = encoding.createEncoder();
      encoding.writeVarString(encoder, "doc");
      for (const byte of prefix) encoding.writeUint8(encoder, byte);
      if (padLength) {
        // length varint padded with zero continuation bytes
        const n = update.byteLength;
        for (const byte of [(n & 0x7f) | 0x80, 0x80, 0x80, 0x80, 0x80, 0x00])
          encoding.writeUint8(encoder, byte);
        encoding.writeUint8Array(encoder, update);
      } else {
        encoding.writeVarUint8Array(encoder, update);
      }
      return encoding.toUint8Array(encoder);
    }
    const guardFor = (maxBytes = 1e9) => {
      const guard = new DocumentGuard({
        maxDocumentBytes: () => maxBytes,
        maxAwarenessStateBytes: 4096,
      });
      guard.recordStored("doc", 10);
      return guard;
    };
    const run = (guard: DocumentGuard, frame: Uint8Array) =>
      guard.beforeHandleMessage({
        documentName: "doc",
        update: frame,
        requestHeaders: new Headers(),
        document: new Y.Doc(),
      } as unknown as Parameters<DocumentGuard["beforeHandleMessage"]>[0]);

    it("rejects an unknown name in a SyncReply (type 4) frame", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await expect(
          run(guardFor(), rawFrame([4, 2], unknown)),
        ).rejects.toEqual(SCHEMA_REJECTED);
        const event = JSON.parse(String(warn.mock.calls[0]?.[0]));
        expect(event).toMatchObject({
          event: "ws_unknown_schema_name",
          documentName: "doc",
          names: ["zzz"],
        });
      } finally {
        warn.mockRestore();
      }
    });

    it("rejects sync step 2 (syncType 1) carrying an unknown name", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await expect(
          run(guardFor(), rawFrame([0, 1], unknown)),
        ).rejects.toEqual(SCHEMA_REJECTED);
      } finally {
        warn.mockRestore();
      }
    });

    it("rejects zero-padded varints in the type and length fields", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const paddedType = [0x80, 0x80, 0x80, 0x80, 0x80, 0x00, 2];
        await expect(
          run(guardFor(), rawFrame(paddedType, unknown)),
        ).rejects.toEqual(SCHEMA_REJECTED);
        await expect(
          run(guardFor(), rawFrame([0, 2], unknown, true)),
        ).rejects.toEqual(SCHEMA_REJECTED);
      } finally {
        warn.mockRestore();
      }
    });

    it("fails closed on a truncated sync frame", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const frame = rawFrame([0, 2], unknown);
        await expect(
          run(guardFor(), frame.subarray(0, frame.length - 3)),
        ).rejects.toEqual(SCHEMA_REJECTED);
        expect(String(warn.mock.calls[0]?.[0])).toContain('"names":[]');
      } finally {
        warn.mockRestore();
      }
    });

    it("still size-caps an over-cap update sent as type 4", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await expect(
          run(
            guardFor(20),
            rawFrame([4, 2], toUpdate(mixedContent as JSONContent)),
          ),
        ).rejects.toEqual(DOCUMENT_TOO_LARGE);
      } finally {
        warn.mockRestore();
      }
    });

    it("refuses an over-cap update by size before scanning names (M1)", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await expect(
          run(guardFor(20), rawFrame([0, 2], craft(["zzz"], []))),
        ).rejects.toEqual(DOCUMENT_TOO_LARGE);
      } finally {
        warn.mockRestore();
      }
    });

    it("still scans names under the cap and without a size record", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await expect(
          run(guardFor(), rawFrame([0, 2], unknown)),
        ).rejects.toEqual(SCHEMA_REJECTED);
        const unrecorded = new DocumentGuard({
          maxDocumentBytes: () => 20,
          maxAwarenessStateBytes: 4096,
        });
        await expect(
          run(unrecorded, rawFrame([0, 2], unknown)),
        ).rejects.toEqual(SCHEMA_REJECTED);
      } finally {
        warn.mockRestore();
      }
    });

    it("checks top-level content against the server's document", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const document = prosemirrorJSONToYDoc(
          schema,
          titleOnly as JSONContent,
          "default",
        );
        const client = new Y.Doc();
        Y.applyUpdate(client, Y.encodeStateAsUpdate(document));
        const before = Y.encodeStateVector(client);
        client.getXmlFragment("default").insert(1, [new Y.XmlText("x")]);
        const update = Y.encodeStateAsUpdate(client, before);
        await expect(
          guardFor().beforeHandleMessage({
            documentName: "doc",
            update: rawFrame([0, 2], update),
            requestHeaders: new Headers(),
            document,
          } as unknown as Parameters<DocumentGuard["beforeHandleMessage"]>[0]),
        ).rejects.toEqual(SCHEMA_REJECTED);
      } finally {
        warn.mockRestore();
      }
    });

    it("passes a well-formed frame and leaves non-sync types alone", async () => {
      const valid = toUpdate(mixedContent as JSONContent);
      await expect(
        run(guardFor(), rawFrame([0, 2], valid)),
      ).resolves.toBeUndefined();
      await expect(
        run(guardFor(), rawFrame([4, 2], valid)),
      ).resolves.toBeUndefined();
      await expect(
        run(guardFor(), rawFrame([1], unknown)),
      ).resolves.toBeUndefined();
    });
  });
});
