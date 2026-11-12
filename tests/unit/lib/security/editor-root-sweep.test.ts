import { describe, expect, it, spyOn } from "bun:test";

import { type Connection, Document } from "@hocuspocus/server";
import type { JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import * as decoding from "lib0/decoding";
import * as Y from "yjs";

import {
  BROADCAST_FLUSH_OPTIONS,
  ROOT_SWEEP_ORIGIN,
  sweepEditorRoot,
  watchEditorRoot,
} from "@/lib/security/editor-root-sweep";
import { DocumentGuard } from "@/lib/security/hocus-document-guard";
import titleOnly from "@/tests/fixtures/title-only.json";
import { createCollabEditor } from "@/tests/helpers/collab-editor";
import { getEditorSchema } from "@/tests/helpers/editor-schema";

const schema = getEditorSchema();

/** A server document holding a title and a paragraph. */
function serverDoc(): Y.Doc {
  return prosemirrorJSONToYDoc(schema, titleOnly as JSONContent, "default");
}

/** A client synced to `server`. */
function syncedClient(server: Y.Doc): Y.Doc {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  return client;
}

/** The updates `edits` produce on `doc`, one per transaction. */
function updatesOf(doc: Y.Doc, ...edits: Array<() => void>): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const listener = (update: Uint8Array) => updates.push(update);
  doc.on("update", listener);
  for (const edit of edits) doc.transact(edit);
  doc.off("update", listener);
  return updates;
}

const topLevel = (doc: Y.Doc) => doc.getXmlFragment("default").toArray();
const onlyElements = (doc: Y.Doc) =>
  topLevel(doc).every((child) => child instanceof Y.XmlElement);

/** Loads `document` through the guard, as Hocuspocus does after a fetch. */
async function loadThroughGuard(
  document: Y.Doc,
  documentName = "doc",
  options: Partial<ConstructorParameters<typeof DocumentGuard>[0]> = {},
) {
  const guard = new DocumentGuard({
    maxDocumentBytes: () => 1e9,
    maxAwarenessStateBytes: 4096,
    ...options,
  });
  await guard.afterLoadDocument({
    document,
    documentName,
  } as unknown as Parameters<DocumentGuard["afterLoadDocument"]>[0]);
  return guard;
}

/** Captures `console.warn` abuse lines while `run` executes. */
async function captureAbuseLog(run: () => unknown) {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    await run();
    return warn.mock.calls.map((call) => String(call[0]));
  } finally {
    warn.mockRestore();
  }
}

describe("sweepEditorRoot", () => {
  it("removes every top-level non-element and keeps the blocks", () => {
    const doc = serverDoc();
    const fragment = doc.getXmlFragment("default");
    const before = fragment.toString();
    fragment.insert(1, [new Y.XmlText("stray")]);
    // Typed for elements and text only; Yjs integrates any type.
    fragment.insert(0, [new Y.XmlHook("hook") as unknown as Y.XmlText]);
    fragment.push([new Y.XmlText("tail")]);

    const sweep = sweepEditorRoot(doc);

    expect(sweep.removed).toBe(3);
    expect(sweep.types.sort()).toEqual(["hook", "text"]);
    expect(onlyElements(doc)).toBe(true);
    expect(fragment.toString()).toBe(before);
  });

  it("labels content with a fixed vocabulary, never with its value", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    fragment.insert(0, [new Y.XmlElement("heading")]);
    // Raw list content an attacker could encode directly into the fragment.
    (fragment as unknown as Y.Array<unknown>).insert(1, [
      "<script>attacker</script>",
      { evil: true },
    ]);

    const sweep = sweepEditorRoot(doc);

    expect(sweep.removed).toBe(2);
    expect(JSON.stringify(sweep)).not.toContain("attacker");
    expect(JSON.stringify(sweep)).not.toContain("evil");
    expect(onlyElements(doc)).toBe(true);
  });

  it("deletes in one transaction under the sweep origin", () => {
    const doc = serverDoc();
    doc.getXmlFragment("default").insert(1, [new Y.XmlText("a")]);
    doc.getXmlFragment("default").insert(2, [new Y.XmlText("b")]);
    const origins: unknown[] = [];
    doc.on("update", (_update: Uint8Array, origin: unknown) =>
      origins.push(origin),
    );

    sweepEditorRoot(doc);

    expect(origins).toEqual([ROOT_SWEEP_ORIGIN]);
  });

  it("writes nothing when the fragment holds only elements", () => {
    const doc = serverDoc();
    let updates = 0;
    doc.on("update", () => updates++);
    expect(sweepEditorRoot(doc)).toEqual({ removed: 0, types: [] });
    expect(updates).toBe(0);
  });

  it("never creates the editor fragment in a document without one", () => {
    const doc = new Y.Doc();
    doc.getArray("tabs").insert(0, [{ id: "playground" }]);
    expect(sweepEditorRoot(doc)).toEqual({ removed: 0, types: [] });
    expect(doc.share.has("default")).toBe(false);
  });
});

describe("watchEditorRoot", () => {
  it("sweeps top-level text released from pending by a later update", () => {
    const server = serverDoc();
    const swept: number[] = [];
    watchEditorRoot(server, (sweep) => swept.push(sweep.removed));
    const attacker = syncedClient(server);
    const fragment = attacker.getXmlFragment("default");
    const [u1, u2] = updatesOf(
      attacker,
      () => fragment.insert(1, [new Y.XmlElement("paragraph")]),
      () => fragment.insert(2, [new Y.XmlText("stray root text")]),
    );

    Y.applyUpdate(server, u2);
    expect(server.store.pendingStructs).not.toBeNull();
    Y.applyUpdate(server, u1);

    expect(swept).toEqual([1]);
    expect(onlyElements(server)).toBe(true);
    expect(server.getXmlFragment("default").toString()).not.toContain("stray");
  });

  it("hands the sweep the origin of the update that released it", () => {
    const server = serverDoc();
    const origins: unknown[] = [];
    watchEditorRoot(server, (_sweep, origin) => origins.push(origin));
    const sender = { source: "connection" };
    const client = syncedClient(server);
    const [update] = updatesOf(client, () =>
      client.getXmlFragment("default").insert(0, [new Y.XmlText("x")]),
    );
    Y.applyUpdate(server, update, sender);
    expect(origins).toEqual([sender]);
  });

  it("lets a fresh editor mount once the stray text is swept", () => {
    const server = serverDoc();
    watchEditorRoot(server, () => {});
    const attacker = syncedClient(server);
    const fragment = attacker.getXmlFragment("default");
    const [u1, u2] = updatesOf(
      attacker,
      () => fragment.insert(1, [new Y.XmlElement("paragraph")]),
      () => fragment.insert(2, [new Y.XmlText("stray root text")]),
    );
    Y.applyUpdate(server, u2);
    Y.applyUpdate(server, u1);

    const fixture = createCollabEditor({ server });
    try {
      expect(fixture.errors).toEqual([]);
      expect(fixture.editor.getText()).not.toContain("stray");
      expect(onlyElements(fixture.client)).toBe(true);
    } finally {
      fixture.destroy();
    }
  });

  it("delivers the sweep to connected clients in the same broadcast", () => {
    const server = serverDoc();
    watchEditorRoot(server, () => {});
    // Hocuspocus queues every update of one event-loop turn and merges them.
    const queued: Uint8Array[] = [];
    server.on("update", (update: Uint8Array) => queued.push(update));
    const victim = syncedClient(server);
    const attacker = syncedClient(server);
    const fragment = attacker.getXmlFragment("default");
    const [u1, u2] = updatesOf(
      attacker,
      () => fragment.insert(1, [new Y.XmlElement("paragraph")]),
      () => fragment.insert(2, [new Y.XmlText("stray root text")]),
    );
    Y.applyUpdate(server, u2);
    Y.applyUpdate(server, u1);

    let sawStray = false;
    victim.getXmlFragment("default").observe(() => {
      if (!onlyElements(victim)) sawStray = true;
    });
    Y.applyUpdate(victim, Y.mergeUpdates(queued));

    expect(sawStray).toBe(false);
    expect(topLevel(victim)).toHaveLength(topLevel(server).length);
    expect(onlyElements(victim)).toBe(true);
  });

  describe("through a Hocuspocus document", () => {
    /** Over Hocuspocus's 1 MiB default `flushMaxBytes`, under the 2 MiB frame cap. */
    const BIG_TEXT = "x".repeat(1_150_000);

    /** Sync frames `document` broadcasts, decoded to their update payloads. */
    function captureBroadcasts(document: Document): Uint8Array[] {
      const updates: Uint8Array[] = [];
      const connection = {
        messageAddress: document.name,
        send(message: Uint8Array) {
          const decoder = decoding.createDecoder(message);
          decoding.readVarString(decoder);
          if (decoding.readVarUint(decoder) !== 0) return;
          if (decoding.readVarUint(decoder) !== 2) return;
          updates.push(decoding.readVarUint8Array(decoder));
        },
      };
      document.addConnection(connection as unknown as Connection);
      return updates;
    }

    /**
     * An open editor relayed through a Hocuspocus document running the sweep,
     * after an attacker's U2 (top-level text) and a U1 over 1 MiB releasing it.
     */
    async function releaseOverOneMiB(options: typeof BROADCAST_FLUSH_OPTIONS) {
      const fixture = createCollabEditor();
      const document = new Document("doc", {}, options);
      Y.applyUpdate(document, Y.encodeStateAsUpdate(fixture.server));
      watchEditorRoot(document, () => {});
      const broadcasts = captureBroadcasts(document);
      const attacker = syncedClient(document);
      const fragment = attacker.getXmlFragment("default");
      const [u1, u2] = updatesOf(
        attacker,
        () => {
          const paragraph = new Y.XmlElement("paragraph");
          fragment.insert(fragment.length, [paragraph]);
          paragraph.insert(0, [new Y.XmlText(BIG_TEXT)]);
        },
        () =>
          fragment.insert(fragment.length, [new Y.XmlText("stray root text")]),
      );
      Y.applyUpdate(document, u2);
      Y.applyUpdate(document, u1);
      await new Promise((resolve) => setImmediate(resolve));
      return { fixture, broadcasts };
    }

    it("sends a release over 1 MiB and its sweep as one broadcast", async () => {
      const { fixture, broadcasts } = await releaseOverOneMiB(
        BROADCAST_FLUSH_OPTIONS,
      );
      try {
        expect(broadcasts).toHaveLength(1);
        // The editor receives each broadcast, and the user types after each.
        const thrown: unknown[] = [];
        for (const update of broadcasts) {
          try {
            Y.applyUpdate(fixture.server, update, "relay");
            fixture.editor.commands.insertContentAt(1, "K");
          } catch (error) {
            thrown.push(error);
          }
        }
        expect(thrown).toEqual([]);
        expect(fixture.errors).toEqual([]);
        expect(onlyElements(fixture.server)).toBe(true);
        const stored = fixture.server.getXmlFragment("default").toString();
        expect(stored).toContain("hello world");
        expect(stored).toContain(BIG_TEXT);
        expect(stored).not.toContain("stray");
      } finally {
        fixture.destroy();
      }
    });

    it("would split them at Hocuspocus's 1 MiB default", async () => {
      const { fixture, broadcasts } = await releaseOverOneMiB({
        flushDelay: 0,
        flushMaxBytes: 1024 * 1024,
      });
      try {
        expect(broadcasts).toHaveLength(2);
        const relay = new Y.Doc();
        Y.applyUpdate(relay, Y.encodeStateAsUpdate(fixture.server));
        Y.applyUpdate(relay, broadcasts[0]);
        expect(onlyElements(relay)).toBe(false);
      } finally {
        fixture.destroy();
      }
    });
  });

  it("ignores typing, new blocks and its own deletions", () => {
    const server = serverDoc();
    let sweeps = 0;
    watchEditorRoot(server, () => sweeps++);
    const client = syncedClient(server);
    const fragment = client.getXmlFragment("default");
    const updates = updatesOf(
      client,
      () => {
        const paragraph = new Y.XmlElement("paragraph");
        fragment.insert(1, [paragraph]);
        const text = new Y.XmlText();
        paragraph.insert(0, [text]);
        text.insert(0, "typed");
      },
      () =>
        ((fragment.get(1) as Y.XmlElement).get(0) as Y.XmlText).insert(
          0,
          "more ",
        ),
      () => fragment.delete(1, 1),
    );
    const origins: unknown[] = [];
    server.on("update", (_u: Uint8Array, origin: unknown) =>
      origins.push(origin),
    );
    for (const update of updates) Y.applyUpdate(server, update);

    expect(sweeps).toBe(0);
    expect(origins).not.toContain(ROOT_SWEEP_ORIGIN);
  });

  it("ignores an offline device copy resumed before the sync", () => {
    const server = serverDoc();
    let sweeps = 0;
    watchEditorRoot(server, () => sweeps++);
    // Yesterday: edits made offline, kept only in the device copy.
    const yesterday = syncedClient(server);
    const offline = yesterday.getXmlFragment("default");
    yesterday.transact(() => {
      const paragraph = new Y.XmlElement("paragraph");
      offline.insert(offline.length, [paragraph]);
      const text = new Y.XmlText();
      paragraph.insert(0, [text]);
      text.insert(0, "offline paragraph");
    });
    // Today: restored from the copy, typing and Enter reach the server first.
    const today = new Y.Doc();
    Y.applyUpdate(today, Y.encodeStateAsUpdate(yesterday));
    const fragment = today.getXmlFragment("default");
    const typed = updatesOf(
      today,
      () => {
        const block = fragment.get(fragment.length - 1) as Y.XmlElement;
        (block.get(0) as Y.XmlText).insert(0, "?");
      },
      () => fragment.insert(fragment.length, [new Y.XmlElement("paragraph")]),
    );
    for (const update of typed) Y.applyUpdate(server, update);
    // Then the sync step 2 carrying the device copy releases them.
    Y.applyUpdate(server, Y.encodeStateAsUpdate(today));

    expect(sweeps).toBe(0);
    expect(server.getXmlFragment("default").toString()).toBe(
      fragment.toString(),
    );
  });
});

describe("DocumentGuard root sweep", () => {
  it("cleans a stored document holding top-level text when it loads", async () => {
    const stored = serverDoc();
    stored.getXmlFragment("default").insert(1, [new Y.XmlText("poison")]);
    const document = new Y.Doc();
    Y.applyUpdate(document, Y.encodeStateAsUpdate(stored));

    const lines = await captureAbuseLog(() => loadThroughGuard(document));

    expect(onlyElements(document)).toBe(true);
    const swept = lines.filter((line) => line.includes("editor_root_swept"));
    expect(swept).toHaveLength(1);
    expect(JSON.parse(swept[0])).toMatchObject({
      type: "abuse",
      event: "editor_root_swept",
      documentName: "doc",
      phase: "load",
      removed: 1,
      types: ["text"],
    });
    expect(swept[0]).not.toContain("poison");
  });

  it("sweeps updates after load and logs the sender's pinned IP", async () => {
    const document = serverDoc();
    await loadThroughGuard(document);
    const attacker = syncedClient(document);
    const fragment = attacker.getXmlFragment("default");
    const [u1, u2] = updatesOf(
      attacker,
      () => fragment.insert(1, [new Y.XmlElement("paragraph")]),
      () => fragment.insert(2, [new Y.XmlText("stray root text")]),
    );
    const headers = new Headers({ "x-real-ip": "203.0.113.7" });
    const origin = {
      source: "connection",
      connection: { request: { headers } },
    };

    const lines = await captureAbuseLog(() => {
      Y.applyUpdate(document, u2, origin);
      Y.applyUpdate(document, u1, origin);
    });

    expect(onlyElements(document)).toBe(true);
    const swept = lines.filter((line) => line.includes("editor_root_swept"));
    expect(swept).toHaveLength(1);
    expect(JSON.parse(swept[0])).toMatchObject({
      phase: "update",
      removed: 1,
      ip: "203.0.113.7",
    });
    expect(swept[0]).not.toContain("stray");
  });

  describe("log volume", () => {
    const WINDOW_MS = 60_000;

    /** A loaded document, a clock, and a client writing top-level text to it. */
    async function sweptDocument(documentName = "doc") {
      const clock = { now: 1_000 };
      const document = serverDoc();
      const guard = await loadThroughGuard(document, documentName, {
        sweepLogWindowMs: WINDOW_MS,
        now: () => clock.now,
      });
      const client = syncedClient(document);
      const headers = new Headers({ "x-real-ip": "203.0.113.7" });
      const origin = {
        source: "connection",
        connection: { request: { headers } },
      };
      /** One update per call, each leaving top-level text for the sweep. */
      const pollute = (times: number) => {
        for (const update of updatesOf(
          client,
          ...Array.from({ length: times }, () => () => {
            client.getXmlFragment("default").insert(0, [new Y.XmlText("x")]);
          }),
        )) {
          Y.applyUpdate(document, update, origin);
        }
      };
      return { clock, document, guard, pollute };
    }

    const sweptLines = (lines: string[]) =>
      lines
        .filter((line) => line.includes("editor_root_swept"))
        .map((line) => JSON.parse(line));

    it("logs one line per window and counts the rest", async () => {
      const { clock, document, pollute } = await sweptDocument();

      const first = sweptLines(await captureAbuseLog(() => pollute(100)));

      expect(onlyElements(document)).toBe(true);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ removed: 1, ip: "203.0.113.7" });
      expect(first[0].sweeps).toBeUndefined();

      clock.now += WINDOW_MS;
      const next = sweptLines(await captureAbuseLog(() => pollute(1)));

      expect(next).toHaveLength(2);
      expect(next[0]).toMatchObject({
        documentName: "doc",
        phase: "update",
        sweeps: 99,
        removed: 99,
        types: ["text"],
      });
      expect(next[0].ip).toBeUndefined();
      expect(next[1]).toMatchObject({ removed: 1, ip: "203.0.113.7" });
      expect(next[1].sweeps).toBeUndefined();
    });

    it("reports the count still pending when the document unloads", async () => {
      const { guard, pollute } = await sweptDocument();
      await captureAbuseLog(() => pollute(5));

      const lines = sweptLines(
        await captureAbuseLog(() =>
          guard.afterUnloadDocument({
            documentName: "doc",
          } as Parameters<DocumentGuard["afterUnloadDocument"]>[0]),
        ),
      );

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ sweeps: 4, removed: 4 });
      expect(
        sweptLines(await captureAbuseLog(() => guard.onDestroy())),
      ).toEqual([]);
    });

    it("reports pending counts when the server shuts down", async () => {
      const { guard, pollute } = await sweptDocument();
      await captureAbuseLog(() => pollute(3));

      const lines = sweptLines(await captureAbuseLog(() => guard.onDestroy()));

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ sweeps: 2, removed: 2 });
    });

    it("throttles each document on its own", async () => {
      const a = await sweptDocument("a");
      const b = await sweptDocument("b");

      const lines = sweptLines(
        await captureAbuseLog(() => {
          a.pollute(3);
          b.pollute(3);
        }),
      );

      expect(lines.map((line) => line.documentName)).toEqual(["a", "b"]);
    });
  });

  it("leaves a clean document untouched at load", async () => {
    const document = serverDoc();
    let updates = 0;
    document.on("update", () => updates++);
    const lines = await captureAbuseLog(() => loadThroughGuard(document));
    expect(updates).toBe(0);
    expect(lines.join()).not.toContain("editor_root_swept");
  });

  it("never touches a tab list", async () => {
    const document = new Y.Doc();
    document.getArray("tabs").insert(0, [{ id: "playground", title: "x" }]);
    await loadThroughGuard(document, "global-tabs");
    expect(document.share.has("default")).toBe(false);
  });
});
