/**
 * The comments controller on a live collaborative editor (comments design
 * §5.3, §8, §9.1): highlights through the decoration host, re-anchoring
 * through the real sync plugin, remote re-resolution, undo isolation,
 * view-only silence and cleanup.
 */
import { afterEach, describe, expect, it } from "bun:test";

import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import type * as Y from "yjs";

import {
  attachComments,
  authorOf,
  type CommentsController,
  DETACHED_AFTER_MS,
  IDLE_TIMEOUT_MS,
  OPEN_SLICE,
} from "@/extensions/comments/comments-controller";
import { COMMENTS_DEPS } from "@/extensions/comments/comments-deps";
import { DecorationHost } from "@/extensions/decoration-host/decoration-host";
import { createAnchorPair, resolveAnchors } from "@/lib/comments/anchors";
import { type Anchors, anchorKey, COMMENT_ORIGIN } from "@/lib/comments/model";
import { createCommentStore } from "@/lib/comments/store";

import {
  type CollabEditorFixture,
  createCollabEditor,
} from "../../helpers/collab-editor";

// Title / "hello world": the paragraph's text starts at 8; "world" is 14..19.
const WORLD = { from: 14, to: 19 };
const IDENTITY = {
  id: "A".repeat(22),
  name: "Calm Otter",
  color: "#64B5F6" as const,
};

let fixture: CollabEditorFixture | null = null;
let controller: CommentsController | null = null;

afterEach(() => {
  controller?.destroy();
  controller = null;
  fixture?.destroy();
  fixture = null;
});

function setup(canComment = true, server?: Y.Doc) {
  fixture = createCollabEditor({
    server,
    extensions: [
      DecorationHost.configure({ layers: [{ name: "comments", map: true }] }),
    ],
  });
  const { editor, client } = fixture;
  controller = attachComments({
    editor,
    doc: client,
    deps: COMMENTS_DEPS,
    canComment: () => canComment,
    identity: () => IDENTITY,
    // Frames run when the test flushes; idle slices run at once.
    schedule: () => () => {},
    idle: (run) => {
      run();
      return () => {};
    },
  });
  return { fixture, controller, editor };
}

const highlighted = (fixtureOf: CollabEditorFixture) =>
  [...fixtureOf.editor.view.dom.querySelectorAll(".comment-range")].map(
    (node) => node.textContent,
  );

function rangeText(
  ctl: CommentsController,
  tid: string,
  f: CollabEditorFixture,
) {
  const range = ctl.getSnapshot().ranges.get(tid);
  return range
    ? f.editor.state.doc.textBetween(range.from, range.to, "|")
    : null;
}

function comment(ctl: CommentsController, f: CollabEditorFixture) {
  f.editor.commands.setTextSelection(WORLD);
  const result = ctl.createFromSelection("Nice word");
  if (!result.ok) throw new Error(result.reason);
  return result.tid;
}

describe("comments controller", () => {
  it("comments on the selection and draws it in the comments layer", () => {
    const { fixture: f, controller: ctl } = setup();
    const tid = comment(ctl, f);
    expect(highlighted(f)).toEqual(["world"]);
    expect(
      f.editor.view.dom.querySelector(`[data-comment-thread="${tid}"]`),
    ).not.toBeNull();
    expect(ctl.getSnapshot().threads.map((thread) => thread.head.q)).toEqual([
      "world",
    ]);
    expect(ctl.getSnapshot().threads[0].head.au).toEqual({
      id: IDENTITY.id,
      n: IDENTITY.name,
      k: IDENTITY.color,
    });
  });

  it("anchors, re-anchors and resolves with no network (offline, §6)", () => {
    const real = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
    const calls: string[] = [];
    globalThis.fetch = (async () => {
      calls.push("fetch");
      throw new Error("offline");
    }) as unknown as typeof fetch;
    globalThis.WebSocket = class {
      constructor() {
        calls.push("WebSocket");
        throw new Error("offline");
      }
    } as unknown as typeof WebSocket;
    try {
      const { fixture: f, controller: ctl } = setup();
      const tid = comment(ctl, f);
      // A structural edit before the range re-anchors it.
      f.editor.commands.setTextSelection(8);
      f.editor.commands.splitBlock();
      ctl.flush();
      expect(rangeText(ctl, tid, f)).toBe("world");
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = real.fetch;
      globalThis.WebSocket = real.WebSocket;
    }
  });

  it("comments on the word at the caret, and refuses where there is none", () => {
    const { fixture: f, controller: ctl } = setup();
    f.editor.commands.setTextSelection(16);
    const result = ctl.createFromSelection("On a word");
    expect(result.ok).toBe(true);
    expect(highlighted(f)).toEqual(["world"]);
  });

  it("maps the highlight while typing, without re-anchoring", () => {
    const { fixture: f, controller: ctl } = setup();
    const tid = comment(ctl, f);
    const before = f.client.getMap("comments").get(anchorKey(tid));
    // Not even an empty comment transaction per keystroke.
    const commentTransactions: unknown[] = [];
    f.client.on("afterTransaction", (tr) => {
      if (tr.origin === COMMENT_ORIGIN) commentTransactions.push(tr);
    });
    f.editor.commands.insertContentAt(8, "oh ");
    // "oh hello world": typing right after "world" (17..22) stays outside.
    f.editor.commands.insertContentAt(22, "!");
    ctl.flush();
    expect(highlighted(f)).toEqual(["world"]);
    expect(f.client.getMap("comments").get(anchorKey(tid))).toBe(before);
    expect(commentTransactions).toHaveLength(0);
  });

  it("re-anchors after a local block type change, keeping the old pair", () => {
    const { fixture: f, controller: ctl } = setup();
    const tid = comment(ctl, f);
    f.editor.commands.setTextSelection(10);
    f.editor.commands.setNode("heading", { level: 2 });
    ctl.flush();
    const anchors = f.client.getMap("comments").get(anchorKey(tid)) as Anchors;
    expect(anchors.ps).toBeInstanceOf(Uint8Array);
    expect(rangeText(ctl, tid, f)).toBe("world");
    expect(highlighted(f)).toEqual(["world"]);
  });

  it("re-anchors after Enter before the range in the same paragraph", () => {
    const { fixture: f, controller: ctl } = setup();
    const tid = comment(ctl, f);
    f.editor.commands.setTextSelection(10);
    f.editor.commands.splitBlock();
    ctl.flush();
    expect(rangeText(ctl, tid, f)).toBe("world");
    expect(highlighted(f)).toEqual(["world"]);
  });

  it("re-resolves after a collaborator's edit and never re-anchors from it", () => {
    const { fixture: f, controller: ctl } = setup();
    const tid = comment(ctl, f);
    const writes: unknown[] = [];
    f.client.on("afterTransaction", (tr) => {
      if (tr.origin === COMMENT_ORIGIN) writes.push(tr.origin);
    });
    f.remote((fragment) => {
      const text = (fragment.get(1) as Y.XmlElement).get(0) as Y.XmlText;
      text.insert(0, "remote ");
    });
    ctl.flush();
    expect(rangeText(ctl, tid, f)).toBe("world");
    expect(writes).toEqual([]);
  });

  it("keeps comments out of the editor's undo stack", () => {
    const { fixture: f, controller: ctl } = setup();
    f.editor.commands.insertContentAt(8, "typed ");
    const tid = comment(ctl, f);
    f.editor.commands.undo();
    ctl.flush();
    expect(f.client.getMap("comments").has(`t:${tid}`)).toBe(true);
    expect(f.editor.state.doc.textContent).not.toContain("typed");
  });

  it("shows a thread as Detached only after its anchor fails for 1.5 s", async () => {
    const { fixture: f, controller: ctl } = setup();
    const tid = comment(ctl, f);
    f.editor.commands.deleteRange(WORLD);
    ctl.flush();
    expect(ctl.getSnapshot().ranges.has(tid)).toBe(false);
    expect(ctl.getSnapshot().detached.has(tid)).toBe(false);
    expect(highlighted(f)).toEqual([]);
    await Bun.sleep(DETACHED_AFTER_MS + 100);
    expect(ctl.getSnapshot().detached.has(tid)).toBe(true);
  });

  it("brings a deleted thread back when local undo restores its text", async () => {
    const { fixture: f, controller: ctl } = setup();
    const tid = comment(ctl, f);
    f.editor.commands.deleteRange(WORLD);
    ctl.flush();
    expect(ctl.getSnapshot().ranges.has(tid)).toBe(false);
    await Bun.sleep(DETACHED_AFTER_MS + 100);
    expect(ctl.getSnapshot().detached.has(tid)).toBe(true);
    // Undo is a change-origin transaction, and no comment key changes.
    f.editor.commands.undo();
    ctl.flush();
    expect(rangeText(ctl, tid, f)).toBe("world");
    expect(ctl.getSnapshot().detached.has(tid)).toBe(false);
    expect(highlighted(f)).toEqual(["world"]);
  });

  it("brings a thread back for everyone when a collaborator's undo restores its text", () => {
    const { fixture: f, controller: ctl } = setup();
    const tid = comment(ctl, f);
    const other = createCollabEditor({
      server: f.server,
      extensions: [
        DecorationHost.configure({ layers: [{ name: "comments", map: true }] }),
      ],
    });
    const otherCtl = attachComments({
      editor: other.editor,
      doc: other.client,
      deps: COMMENTS_DEPS,
      canComment: () => true,
      identity: () => ({ ...IDENTITY, id: "B".repeat(22) }),
      schedule: () => () => {},
      idle: (run) => {
        run();
        return () => {};
      },
    });
    try {
      other.editor.commands.deleteRange(WORLD);
      otherCtl.flush();
      ctl.flush();
      expect(ctl.getSnapshot().ranges.has(tid)).toBe(false);
      // Yjs follows undo's re-created text (`redone`) only on the client
      // that undid, so that client writes anchors everyone can resolve.
      other.editor.commands.undo();
      otherCtl.flush();
      ctl.flush();
      expect(rangeText(otherCtl, tid, other)).toBe("world");
      expect(rangeText(ctl, tid, f)).toBe("world");
      expect(highlighted(f)).toEqual(["world"]);
    } finally {
      otherCtl.destroy();
      other.destroy();
    }
  });

  it("re-anchors a local split before a collaborator's edit lands in the block", async () => {
    const { fixture: f, controller: ctl } = setup();
    const tid = comment(ctl, f);
    f.editor.commands.setTextSelection(10);
    f.editor.commands.splitBlock();
    // A collaborator's update is its own task: it lands after this one.
    await Promise.resolve();
    f.remote((fragment) => {
      const text = (fragment.get(2) as Y.XmlElement).get(0) as Y.XmlText;
      text.insert(0, "so ");
    });
    ctl.flush();
    expect(f.editor.state.doc.child(2).textContent).toBe("so llo world");
    expect(rangeText(ctl, tid, f)).toBe("world");
    const anchors = f.client.getMap("comments").get(anchorKey(tid)) as Anchors;
    const binding = COMMENTS_DEPS.syncBinding(f.editor.state);
    if (!binding) throw new Error("no binding");
    const range = resolveAnchors(COMMENTS_DEPS, binding, anchors);
    expect(range && f.editor.state.doc.textBetween(range.from, range.to)).toBe(
      "world",
    );
  });

  it("re-anchors before the frame, so a hidden tab never holds it back", async () => {
    const { fixture: f, controller: ctl } = setup();
    const tid = comment(ctl, f);
    const before = f.client.getMap("comments").get(anchorKey(tid));
    f.editor.commands.setTextSelection(10);
    f.editor.commands.setNode("heading", { level: 2 });
    // No frame runs (the test's `schedule` never fires), only microtasks.
    await Promise.resolve();
    expect(f.client.getMap("comments").get(anchorKey(tid))).not.toBe(before);
  });

  it("sends one Yjs update when one edit re-anchors many threads", () => {
    const words = Array.from({ length: 50 }, (_, index) => `w${index}`);
    const server = prosemirrorJSONToYDoc(
      createCollabEditor().schema,
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: words.join(" ") }],
          },
        ],
      },
      "default",
    );
    const { fixture: f, controller: ctl } = setup(true, server);
    // Past the client rate: a second store on the same doc, without one.
    const bulk = createCommentStore({
      doc: f.client,
      canComment: () => true,
      author: () => authorOf(IDENTITY),
      rates: { threads: 100, messages: 100 },
    });
    const binding = COMMENTS_DEPS.syncBinding(f.editor.state);
    if (!binding) throw new Error("no binding");
    let at = 8;
    for (const word of words) {
      const range = { from: at, to: at + word.length };
      const anchors = createAnchorPair(COMMENTS_DEPS, binding, range);
      if (!anchors || !bulk.create({ anchors, quote: word, body: "n" }).ok) {
        throw new Error("refused");
      }
      at += word.length + 1;
    }
    ctl.flush();
    expect(highlighted(f)).toEqual(words);
    const commentUpdates: unknown[] = [];
    f.client.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin === COMMENT_ORIGIN) commentUpdates.push(origin);
    });
    f.editor.commands.setTextSelection(9);
    f.editor.commands.setNode("heading", { level: 2 });
    ctl.flush();
    expect(commentUpdates).toHaveLength(1);
    expect(highlighted(f)).toEqual(words);
  });

  it("waits for the sync binding instead of polling for it", () => {
    let ready = false;
    fixture = createCollabEditor({
      extensions: [
        DecorationHost.configure({ layers: [{ name: "comments", map: true }] }),
      ],
    });
    const f = fixture;
    const writer = attachComments({
      editor: f.editor,
      doc: f.client,
      deps: COMMENTS_DEPS,
      canComment: () => true,
      identity: () => IDENTITY,
      schedule: () => () => {},
      idle: (run) => {
        run();
        return () => {};
      },
    });
    const tid = comment(writer, f);
    writer.destroy();
    const slices: (() => void)[] = [];
    controller = attachComments({
      editor: f.editor,
      doc: f.client,
      deps: {
        ...COMMENTS_DEPS,
        syncBinding: (state) =>
          ready ? COMMENTS_DEPS.syncBinding(state) : null,
      },
      canComment: () => true,
      identity: () => IDENTITY,
      schedule: () => () => {},
      idle: (run) => {
        slices.push(run);
        return () => {};
      },
    });
    for (let index = 0; index < 5 && slices.length; index++) {
      slices.shift()?.();
    }
    expect(slices).toHaveLength(0);
    expect(controller.getSnapshot().ranges.has(tid)).toBe(false);
    ready = true;
    // The next transaction (any) finds the binding and resolves.
    f.editor.commands.setTextSelection(9);
    expect(controller.getSnapshot().ranges.has(tid)).toBe(true);
  });

  it("resolves on open in idle slices that a busy thread can't starve", () => {
    const { fixture: f, controller: ctl } = setup();
    ctl.destroy();
    controller = null;
    // One slice more than runs at once.
    const bulk = createCommentStore({
      doc: f.client,
      canComment: () => true,
      author: () => authorOf(IDENTITY),
      rates: { threads: 100, messages: 100 },
    });
    const binding = COMMENTS_DEPS.syncBinding(f.editor.state);
    const anchors = binding && createAnchorPair(COMMENTS_DEPS, binding, WORLD);
    if (!anchors) throw new Error("no anchors");
    for (let index = 0; index <= OPEN_SLICE; index++) {
      bulk.create({ anchors, quote: "world", body: "n" });
    }
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
    try {
      controller = attachComments({
        editor: f.editor,
        doc: f.client,
        deps: COMMENTS_DEPS,
        canComment: () => true,
        identity: () => IDENTITY,
      });
      // The first slice runs at once; the second waits for idle time, or
      // for the timeout.
      expect(options).toEqual([{ timeout: IDLE_TIMEOUT_MS }]);
    } finally {
      controller?.destroy();
      controller = null;
      globalThis.requestIdleCallback = real.request;
      globalThis.cancelIdleCallback = real.cancel;
    }
  });

  it("writes nothing from a client that may not comment", () => {
    const server = createCollabEditor().server;
    const writer = setup(true, server);
    const tid = comment(writer.controller, writer.fixture);
    const readerFixture = createCollabEditor({
      server,
      extensions: [
        DecorationHost.configure({ layers: [{ name: "comments", map: true }] }),
      ],
    });
    const reader = attachComments({
      editor: readerFixture.editor,
      doc: readerFixture.client,
      deps: COMMENTS_DEPS,
      canComment: () => false,
      identity: () => IDENTITY,
      schedule: () => () => {},
      idle: (run) => {
        run();
        return () => {};
      },
    });
    try {
      const commentWrites: unknown[] = [];
      readerFixture.client.on("afterTransaction", (tr) => {
        if (tr.origin === COMMENT_ORIGIN) commentWrites.push(tr);
      });
      expect(reader.getSnapshot().ranges.has(tid)).toBe(true);
      expect(reader.createFromSelection("no").ok).toBe(false);
      expect(reader.reattach(tid).ok).toBe(false);
      reader.flush();
      expect(commentWrites).toEqual([]);
    } finally {
      reader.destroy();
      readerFixture.destroy();
    }
  });

  it("leaves no listeners behind after 20 open and close cycles", () => {
    const { fixture: f } = setup();
    controller?.destroy();
    controller = null;
    const callbacks = (
      f.editor as unknown as { callbacks: Record<string, unknown[]> }
    ).callbacks;
    const map = f.client.getMap("comments") as unknown as {
      _eH: { l: unknown[] };
    };
    const baseline = [callbacks.transaction?.length ?? 0, map._eH.l.length];
    for (let cycle = 0; cycle < 20; cycle++) {
      const ctl = attachComments({
        editor: f.editor,
        doc: f.client,
        deps: COMMENTS_DEPS,
        canComment: () => true,
        identity: () => IDENTITY,
      });
      ctl.destroy();
    }
    expect([callbacks.transaction?.length ?? 0, map._eH.l.length]).toEqual(
      baseline,
    );
    expect(highlighted(f)).toEqual([]);
  });
});
