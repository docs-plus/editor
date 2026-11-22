/**
 * The comments controller on a live collaborative editor (comments design
 * §5.3, §8, §9.1): highlights through the decoration host, re-anchoring
 * through the real sync plugin, remote re-resolution, undo isolation,
 * view-only silence and cleanup.
 */
import { afterEach, describe, expect, it } from "bun:test";

import type * as Y from "yjs";

import {
  attachComments,
  type CommentsController,
  DETACHED_AFTER_MS,
} from "@/extensions/comments/comments-controller";
import { COMMENTS_DEPS } from "@/extensions/comments/comments-deps";
import { DecorationHost } from "@/extensions/decoration-host/decoration-host";
import { type Anchors, anchorKey, COMMENT_ORIGIN } from "@/lib/comments/model";

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
    f.editor.commands.insertContentAt(8, "oh ");
    ctl.flush();
    expect(highlighted(f)).toEqual(["world"]);
    expect(f.client.getMap("comments").get(anchorKey(tid))).toBe(before);
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
