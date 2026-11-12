import { describe, expect, it, spyOn } from "bun:test";

import type { JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import {
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
async function loadThroughGuard(document: Y.Doc, documentName = "doc") {
  const guard = new DocumentGuard({
    maxDocumentBytes: () => 1e9,
    maxAwarenessStateBytes: 4096,
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
