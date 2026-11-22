import { afterEach, describe, expect, it } from "bun:test";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { Editor, getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { buildDocumentEditorExtensions } from "@/components/document-editor/document-editor-config";
import { headingFoldPluginKey } from "@/extensions/heading-fold";
import { moveSection } from "@/lib/editor-utils";

const text = (value: string): JSONContent => ({ type: "text", text: value });

const heading = (level: number, value: string, id?: string): JSONContent => ({
  type: "heading",
  attrs: id ? { level, id, "data-toc-id": id } : { level },
  content: [text(value)],
});

/** Unnamed headings: the outline names them when the editor is created. */
const UNNAMED: JSONContent = {
  type: "doc",
  content: [heading(1, "Title"), heading(2, "Section")],
};

const NAMED: JSONContent = {
  type: "doc",
  content: [
    heading(1, "Title", "t"),
    heading(2, "Section", "s"),
    { type: "paragraph", content: [text("Body")] },
  ],
};

/** A provider stand-in: UniqueID only subscribes to "synced". */
function fakeProvider() {
  const listeners = new Map<string, () => void>();
  // Like HocuspocusProvider's EventEmitter, `on` returns the provider.
  const provider = {
    on(event: string, fn: () => void) {
      listeners.set(event, fn);
      return provider;
    },
    off: (event: string) => listeners.delete(event),
  } as unknown as HocuspocusProvider;
  return { provider, listeners, sync: () => listeners.get("synced")?.() };
}

interface OpenOptions {
  canWrite?: () => boolean;
  getProvider?: () => HocuspocusProvider | null;
}

const extensionsFor = (
  ydoc: Y.Doc,
  awareness: Awareness,
  { canWrite = () => true, getProvider = () => null }: OpenOptions = {},
) =>
  buildDocumentEditorExtensions({
    documentId: "write-gate",
    ydoc,
    awareness,
    getProvider,
    canWrite,
    onFoldChange() {},
    onFilterChange() {},
    onTocUpdate() {},
  });

/** A Y.Doc holding `content` in the editor's fragment. */
function seededDoc(content: JSONContent): Y.Doc {
  const schema = getSchema(extensionsFor(new Y.Doc(), {} as Awareness));
  return prosemirrorJSONToYDoc(schema, content, "default");
}

let editor: Editor | undefined;
let awareness: Awareness | undefined;
afterEach(() => {
  editor?.destroy();
  awareness?.destroy();
  editor = undefined;
  awareness = undefined;
});

/**
 * Opens the app's editor on `ydoc` and waits for `create` (Tiptap emits it
 * on a timer); returns the Yjs updates it makes.
 */
async function open(ydoc: Y.Doc, options?: OpenOptions): Promise<Uint8Array[]> {
  const updates: Uint8Array[] = [];
  ydoc.on("update", (update: Uint8Array) => updates.push(update));
  awareness = new Awareness(ydoc);
  editor = new Editor({
    element: document.createElement("div"),
    extensions: extensionsFor(ydoc, awareness, options),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  return updates;
}

const headingIds = () => {
  const ids: unknown[] = [];
  editor?.state.doc.forEach((node) => {
    if (node.type.name === "heading") ids.push(node.attrs["data-toc-id"]);
  });
  return ids;
};

const title = () => editor?.state.doc.firstChild?.textContent;

describe("WriteGate", () => {
  it("lets the opening writes through when writable", async () => {
    await open(seededDoc(UNNAMED));
    // Control for the next test: the outline names both headings.
    expect(headingIds().every((id) => typeof id === "string")).toBe(true);
  });

  it("blocks the opening writes when read-only", async () => {
    const { provider, sync } = fakeProvider();
    const updates = await open(seededDoc(UNNAMED), {
      canWrite: () => false,
      getProvider: () => provider,
    });
    // UniqueID's first-sync pass is gated too.
    sync();
    expect(headingIds()).toEqual([null, null]);
    expect(updates).toHaveLength(0);
    // The content still renders from Yjs.
    expect(editor?.state.doc.textContent).toBe("TitleSection");
  });

  it("blocks local edits but not a collaborator's", async () => {
    const ydoc = seededDoc(NAMED);
    let writable = true;
    const updates = await open(ydoc, { canWrite: () => writable });
    editor?.commands.insertContentAt(1, "My ");
    expect(updates.length).toBeGreaterThan(0);

    writable = false;
    const before = updates.length;
    editor?.commands.insertContentAt(1, "Local ");
    expect(updates.length).toBe(before);
    expect(title()).toBe("My Title");

    // A collaborator's change arrives through Yjs and is shown.
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(ydoc));
    const first = remote.getXmlFragment("default").get(0) as Y.XmlElement;
    (first.get(0) as Y.XmlText).insert(0, "Remote ");
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(remote, Y.encodeStateVector(ydoc)),
    );
    expect(title()).toBe("Remote My Title");
  });

  it("reading mode: moving a section and regenerating write nothing", async () => {
    const ydoc = seededDoc({
      type: "doc",
      content: [
        heading(1, "Title", "t"),
        heading(2, "First", "a"),
        { type: "paragraph", content: [text("One")] },
        heading(2, "Second", "b"),
        { type: "paragraph", content: [text("Two")] },
      ],
    });
    const updates = await open(ydoc, { canWrite: () => false });
    const view = editor?.view;
    if (!editor || !view) throw new Error("no editor");
    const before = editor.state.doc.toJSON();
    // The outline's drag (and the palette's Move) run moveSection.
    let firstFrom = -1;
    let firstTo = -1;
    let end = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.attrs["data-toc-id"] === "a") firstFrom = offset;
      if (node.attrs["data-toc-id"] === "b") firstTo = offset;
      end = offset + node.nodeSize;
    });
    moveSection(view, firstFrom, firstTo, end);
    // The Playground's Regenerate replaces the content with setContent.
    editor.commands.setContent({
      type: "doc",
      content: [heading(1, "Regenerated")],
    });
    expect(updates).toHaveLength(0);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("lets meta-only transactions through", async () => {
    await open(seededDoc(NAMED), { canWrite: () => false });
    // A fold is meta-only: it works on a read-only document.
    editor?.commands.toggleFold("s");
    const folded = editor && headingFoldPluginKey.getState(editor.state);
    expect([...(folded?.foldedIds ?? [])]).toEqual(["s"]);
  });
});

describe("no provider", () => {
  it("opens and edits with the session's Awareness alone", async () => {
    const ydoc = seededDoc(NAMED);
    await open(ydoc);
    editor?.commands.insertContentAt(1, "Local ");
    expect(ydoc.getXmlFragment("default").toString()).toContain("Local Title");
    // The caret publishes this user on the session's Awareness.
    editor?.commands.updateUser({ name: "Ada", color: "#000000" });
    expect(awareness?.getLocalState()?.user?.name).toBe("Ada");
  });

  it("forwards UniqueID's wait for a sync to the provider of the moment", async () => {
    let current: HocuspocusProvider | null = null;
    const { provider, listeners } = fakeProvider();
    current = provider;
    await open(seededDoc(UNNAMED), { getProvider: () => current });
    // As before this change: UniqueID waits on the real provider's sync.
    expect(listeners.has("synced")).toBe(true);
    listeners.get("synced")?.();
    expect(listeners.has("synced")).toBe(false);
  });

  it("hands back the provider from the caret's on (e2e helpers find it so)", async () => {
    const { provider } = fakeProvider();
    let current: HocuspocusProvider | null = null;
    await open(seededDoc(NAMED), { getProvider: () => current });
    const caret = editor?.extensionManager.extensions.find(
      (extension) => extension.name === "collaborationCaret",
    );
    const forward = caret?.options.provider as {
      on: (event: string, fn: () => void) => unknown;
    };
    const probe = () => {};
    expect(forward.on("probe", probe)).toBeUndefined();
    current = provider;
    expect(forward.on("probe", probe)).toBe(provider);
  });
});
