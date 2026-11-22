/**
 * The eager side of comments (P4.9): the `comment.add` action, its gate,
 * the loader, and the `sectionMove` meta. On the web nothing mounts
 * comments, so the action is neither offered nor enabled there.
 */
import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import * as Y from "yjs";

import { mountComments } from "@/extensions/comments/comments-loader";
import { DecorationHost } from "@/extensions/decoration-host/decoration-host";
import { authorIdFor, DEVICE_SECRET_KEY } from "@/lib/comments/author-id";
import { listThreads } from "@/lib/comments/list-threads";
import { SECTION_MOVE_META } from "@/lib/comments/reanchor";
import { editorActions } from "@/lib/editor-actions";
import { availability } from "@/lib/editor-actions/registry";
import { onUiIntent } from "@/lib/editor-actions/ui-intents";
import { computeContext } from "@/lib/editor-context/snapshot";
import { moveSection } from "@/lib/editor-utils";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

import { createCollabEditor } from "../../helpers/collab-editor";
import { createHarnessClient } from "../../helpers/comment-harness";

const DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "A" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "B" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "beta" }] },
  ],
};

const LINEAGE = "6f1c2a52-6c39-4a56-9a5e-0d8f8b1f0c11";

/** Until the lazy host chunk has loaded (a dynamic import). */
async function until(done: () => boolean) {
  for (let tick = 0; tick < 100 && !done(); tick++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const action = () => {
  const found = editorActions.get("comment.add");
  if (!found) throw new Error("comment.add is not registered");
  return found;
};

describe("comment.add", () => {
  it("is registered for the bubble, palette and menus to call", () => {
    expect(editorActions.has("comment.add")).toBe(true);
    expect(action().mutates).toBe(false);
    expect(action().shortcut).toBeUndefined();
  });

  it("is neither offered nor enabled where nothing mounted comments (the web)", () => {
    editor = createTestEditor({ content: DOC });
    const ctx = computeContext(editor);
    expect(action().offered?.(ctx)).toBe(false);
    expect(availability(action(), ctx)).toEqual({
      reason: "Comments aren't available here.",
    });
    expect(action().run(editor, undefined)).toBe(false);
  });

  it("asks the shell for a draft card where comments are mounted", () => {
    editor = createTestEditor({ content: DOC });
    let allowed = true;
    const mounted = mountComments(editor, {
      doc: new Y.Doc(),
      lineage: LINEAGE,
      canComment: () => allowed,
    });
    const intents: string[] = [];
    const off = onUiIntent(editor, (intent) => {
      intents.push(intent.type);
      return intent.type === "comment.add";
    });
    try {
      expect(action().offered?.(computeContext(editor))).toBe(true);
      expect(availability(action(), computeContext(editor))).toBe(true);
      expect(action().run(editor, undefined)).toBe(true);
      expect(intents).toEqual(["comment.add"]);
      allowed = false;
      expect(action().run(editor, undefined)).toBe(false);
      expect(intents).toEqual(["comment.add"]);
    } finally {
      off();
      mounted.unmount();
    }
    expect(action().offered?.(computeContext(editor))).toBe(false);
  });

  it("stays available in a read-only editor: reading mode allows comments", () => {
    editor = createTestEditor({ content: DOC });
    const mounted = mountComments(editor, {
      doc: new Y.Doc(),
      lineage: LINEAGE,
      canComment: () => true,
    });
    editor.setEditable(false);
    try {
      expect(availability(action(), computeContext(editor))).toBe(true);
    } finally {
      mounted.unmount();
    }
  });
});

describe("mountComments", () => {
  it("loads the comments chunk when the first thread arrives", async () => {
    const fixture = createCollabEditor({
      extensions: [
        DecorationHost.configure({ layers: [{ name: "comments", map: true }] }),
      ],
    });
    const mounted = mountComments(fixture.editor, {
      doc: fixture.client,
      lineage: LINEAGE,
      canComment: () => true,
    });
    try {
      // A collaborator comments; the thread reaches this client.
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(fixture.server));
      const other = createHarnessClient({ doc });
      other.createThread({ from: 8, to: 13 });
      Y.applyUpdate(fixture.server, Y.encodeStateAsUpdate(other.doc));
      const controller = await mounted.controller();
      expect(controller).not.toBeNull();
      expect(await mounted.controller()).toBe(controller);
      expect(controller?.getSnapshot().threads).toHaveLength(1);
    } finally {
      mounted.unmount();
      fixture.destroy();
    }
    expect(await mounted.controller()).toBeNull();
  });

  it("writes with this browser's author id for the document's lineage (SEC-002)", async () => {
    const fixture = createCollabEditor({
      extensions: [
        DecorationHost.configure({ layers: [{ name: "comments", map: true }] }),
      ],
    });
    const mounted = mountComments(fixture.editor, {
      doc: fixture.client,
      lineage: LINEAGE,
      canComment: () => true,
    });
    try {
      const controller = await mounted.controller();
      fixture.editor.commands.setTextSelection({ from: 14, to: 19 });
      const result = controller?.createFromSelection("Per document");
      expect(result?.ok).toBe(true);
      const [thread] = listThreads(fixture.client).threads;
      expect(thread?.head.au.id).toBe(await authorIdFor(LINEAGE));
      expect(thread?.head.au.id).not.toBe(await authorIdFor(`${LINEAGE}-2`));
      // The device secret stays in this browser, never in the document.
      const secret = localStorage.getItem(DEVICE_SECRET_KEY) ?? "";
      expect(secret).not.toBe("");
      expect(
        JSON.stringify(fixture.client.getMap("comments").toJSON()),
      ).not.toContain(secret);
    } finally {
      mounted.unmount();
      fixture.destroy();
    }
  });

  it("preloads a document's threads within a second, even on a busy thread", async () => {
    const fixture = createCollabEditor();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(fixture.server));
    createHarnessClient({ doc }).createThread({ from: 8, to: 13 });
    Y.applyUpdate(fixture.client, Y.encodeStateAsUpdate(doc));
    // happy-dom has no idle callbacks: stand both in, and put back what was.
    const real = {
      request: globalThis.requestIdleCallback,
      cancel: globalThis.cancelIdleCallback,
    };
    const options: (IdleRequestOptions | undefined)[] = [];
    globalThis.requestIdleCallback = ((
      _run: IdleRequestCallback,
      opts?: IdleRequestOptions,
    ) => {
      options.push(opts);
      return 1;
    }) as typeof requestIdleCallback;
    globalThis.cancelIdleCallback = () => {};
    const mounted = mountComments(fixture.editor, {
      doc: fixture.client,
      lineage: LINEAGE,
      canComment: () => true,
    });
    try {
      await until(() => options.length > 0);
      expect(options).toEqual([{ timeout: 1000 }]);
    } finally {
      mounted.unmount();
      // The host unmounts once its chunk's promise settles.
      await new Promise((resolve) => setTimeout(resolve, 0));
      globalThis.requestIdleCallback = real.request;
      globalThis.cancelIdleCallback = real.cancel;
      fixture.destroy();
    }
  });
});

describe("moveSection's meta (§5.3)", () => {
  it("names the moved slice and where it landed", () => {
    editor = createTestEditor({ content: DOC });
    const seen: Transaction[] = [];
    editor.on("transaction", ({ transaction }) => {
      seen.push(transaction);
    });
    const doc = editor.state.doc;
    const a = doc.child(0).nodeSize;
    const b = a + doc.child(1).nodeSize + doc.child(2).nodeSize;
    moveSection(editor.view, a, b, doc.content.size);
    const meta = seen
      .find((tr) => tr.getMeta(SECTION_MOVE_META))
      ?.getMeta(SECTION_MOVE_META);
    expect(meta).toEqual({
      from: a,
      to: b,
      insertAt: doc.content.size - (b - a),
    });
    expect(editor.state.doc.child(1).textContent).toBe("B");
  });
});
