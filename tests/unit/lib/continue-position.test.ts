import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import {
  CONTINUE_MAX_AGE_DAYS,
  CONTINUE_MAX_DOCS,
  CONTINUE_STORAGE_KEY,
  deleteContinueEntry,
  installContinueRecorder,
  readContinueEntry,
  sectionHeadingAt,
  writeContinueEntry,
} from "@/lib/continue-position";
import { createTestEditor } from "@/tests/helpers/create-test-editor";
import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const raw = () => localStorage.getItem(CONTINUE_STORAGE_KEY);

type StorageMethods = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Swaps the global `localStorage` for one whose `methods` are replaced
 * (the rest call the real one); returns the undo.
 */
function patchStorage(methods: Partial<StorageMethods>): () => void {
  const real = globalThis.localStorage;
  const fake: StorageMethods = {
    getItem: (key) => real.getItem(key),
    setItem: (key, value) => real.setItem(key, value),
    removeItem: (key) => real.removeItem(key),
    ...methods,
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: fake,
  });
  return () =>
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: real,
    });
}

const stored = () => JSON.parse(raw() ?? "null");

beforeEach(() => localStorage.clear());

describe("continue store", () => {
  it("round-trips a heading id per document", () => {
    writeContinueEntry("doc-a", "id-1", NOW);
    writeContinueEntry("doc-b", "id-2", NOW);
    expect(readContinueEntry("doc-a", NOW)).toEqual({ id: "id-1", at: NOW });
    expect(readContinueEntry("doc-b", NOW)).toEqual({ id: "id-2", at: NOW });
    expect(readContinueEntry("doc-c", NOW)).toBeNull();
    expect(stored()).toEqual({
      v: 1,
      docs: {
        "doc-a": { id: "id-1", at: NOW },
        "doc-b": { id: "id-2", at: NOW },
      },
    });
  });

  it("keeps the newest 30 and drops entries older than 14 days", () => {
    for (let i = 0; i < CONTINUE_MAX_DOCS + 5; i++) {
      writeContinueEntry(`doc-${i}`, "h", NOW + i);
    }
    const docs = Object.keys(stored().docs);
    expect(docs).toHaveLength(CONTINUE_MAX_DOCS);
    expect(docs).not.toContain("doc-0");
    expect(docs).toContain(`doc-${CONTINUE_MAX_DOCS + 4}`);

    const later = NOW + CONTINUE_MAX_AGE_DAYS * DAY + 100;
    expect(readContinueEntry("doc-34", later)).toBeNull();
    writeContinueEntry("fresh", "h", later);
    expect(Object.keys(stored().docs)).toEqual(["fresh"]);
  });

  it("deletes one document's entry and leaves the others", () => {
    writeContinueEntry("doc-a", "id-1", NOW);
    writeContinueEntry("doc-b", "id-2", NOW);
    deleteContinueEntry("doc-a");
    expect(readContinueEntry("doc-a", NOW)).toBeNull();
    expect(readContinueEntry("doc-b", NOW)).not.toBeNull();
  });

  it.each([
    ["not JSON", "{oops"],
    ["a wrong version", JSON.stringify({ v: 2, docs: {} })],
    ["an array", JSON.stringify([1, 2])],
    ["docs not an object", JSON.stringify({ v: 1, docs: "x" })],
    [
      "an entry without an id",
      JSON.stringify({ v: 1, docs: { d: { at: 1 } } }),
    ],
    [
      "a non-string id",
      JSON.stringify({ v: 1, docs: { d: { id: 5, at: NOW } } }),
    ],
    [
      "an id longer than 64",
      JSON.stringify({ v: 1, docs: { d: { id: "x".repeat(65), at: NOW } } }),
    ],
    [
      "a non-numeric time",
      JSON.stringify({ v: 1, docs: { d: { id: "h", at: "now" } } }),
    ],
    [
      "an oversized payload",
      `{"v":1,"docs":{"d":{"id":"h","at":${NOW}}},"pad":"${"x".repeat(20_000)}"}`,
    ],
  ])("tamper: %s reads as nothing and never throws", (_, value) => {
    localStorage.setItem(CONTINUE_STORAGE_KEY, value);
    expect(readContinueEntry("d", NOW)).toBeNull();
    expect(() => writeContinueEntry("e", "h", NOW)).not.toThrow();
    expect(readContinueEntry("e", NOW)).toEqual({ id: "h", at: NOW });
  });

  it("tamper: a __proto__ key never reaches the prototype", () => {
    localStorage.setItem(
      CONTINUE_STORAGE_KEY,
      `{"v":1,"docs":{"__proto__":{"id":"h","at":${NOW}}}}`,
    );
    expect(readContinueEntry("__proto__", NOW)).toBeNull();
    writeContinueEntry("doc", "h", NOW);
    expect(Object.keys(stored().docs)).toEqual(["doc"]);
    expect(({} as Record<string, unknown>).id).toBeUndefined();
  });

  it("storage that throws reads as nothing and writes nothing", () => {
    writeContinueEntry("d", "h", NOW);
    const restore = patchStorage({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    try {
      expect(readContinueEntry("d", NOW)).toBeNull();
      expect(() => writeContinueEntry("d", "h", NOW)).not.toThrow();
      expect(() => deleteContinueEntry("d")).not.toThrow();
    } finally {
      restore();
    }
  });
});

describe("continue store: kill switch", () => {
  const previous = process.env.NEXT_PUBLIC_REMEMBER_CHOICES;
  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_REMEMBER_CHOICES;
    else process.env.NEXT_PUBLIC_REMEMBER_CHOICES = previous;
    resetModules();
  });

  it("reads nothing, writes nothing and removes the key", async () => {
    localStorage.setItem(
      CONTINUE_STORAGE_KEY,
      JSON.stringify({ v: 1, docs: { d: { id: "h", at: NOW } } }),
    );
    process.env.NEXT_PUBLIC_REMEMBER_CHOICES = "0";
    const off = await importFresh<typeof import("@/lib/continue-position")>(
      "@/lib/continue-position",
    );
    expect(off.readContinueEntry("d", NOW)).toBeNull();
    expect(raw()).toBeNull();
    off.writeContinueEntry("d", "h", NOW);
    expect(raw()).toBeNull();
  });
});

const heading = (text: string, id: string, level = 2): JSONContent => ({
  type: "heading",
  attrs: { level, "data-toc-id": id, id },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

/** Title, an intro, then sections s1…s5, each a heading and two paragraphs. */
const DOC: JSONContent = {
  type: "doc",
  content: [
    heading("Title", "title", 1),
    paragraph("intro"),
    ...[1, 2, 3, 4, 5].flatMap((n) => [
      heading(`Section ${n}`, `s${n}`),
      paragraph(`body ${n}a`),
      paragraph(`body ${n}b`),
    ]),
  ],
};

/** Position just inside the text of the first block whose text is `text`. */
function posOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isTextblock && node.textContent === text) found = pos + 1;
    return !node.isTextblock;
  });
  if (found === -1) throw new Error(`no block "${text}"`);
  return found;
}

let editor: Editor;
afterEach(() => editor?.destroy());

describe("sectionHeadingAt", () => {
  beforeEach(() => {
    editor = createTestEditor({ content: DOC });
  });

  it("returns the nearest heading at or before the position", () => {
    const { doc } = editor.state;
    expect(sectionHeadingAt(doc, posOf(editor, "body 3b"))).toEqual({
      id: "s3",
      index: 8,
    });
    expect(sectionHeadingAt(doc, posOf(editor, "Section 4"))).toEqual({
      id: "s4",
      index: 11,
    });
  });

  it("returns null in the title, before the first section, or near the top", () => {
    const { doc } = editor.state;
    expect(sectionHeadingAt(doc, posOf(editor, "Title"))).toBeNull();
    expect(sectionHeadingAt(doc, posOf(editor, "intro"))).toBeNull();
    // Section 1 is the third top-level block (index 2).
    expect(sectionHeadingAt(doc, posOf(editor, "body 1b"))).toBeNull();
    expect(sectionHeadingAt(doc, posOf(editor, "body 2a"))).toEqual({
      id: "s2",
      index: 5,
    });
  });
});

describe("continue recorder", () => {
  let release: () => void;

  beforeEach(() => {
    editor = createTestEditor({ content: DOC });
  });
  afterEach(() => release?.());

  const isRemote = (tr: { getMeta: (key: string) => unknown }) =>
    tr.getMeta("remote") === true;
  const place = (text: string) =>
    editor.commands.setTextSelection(posOf(editor, text));
  const blur = () =>
    editor.view.dom.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  const setFocused = (focused: boolean) => {
    editor.view.hasFocus = () => focused;
  };
  const hide = () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  };

  it("records the section on editor blur", () => {
    release = installContinueRecorder(editor, "doc", isRemote);
    place("body 3a");
    blur();
    expect(readContinueEntry("doc")?.id).toBe("s3");
  });

  it("records on hidden and pagehide only while the editor has focus", () => {
    release = installContinueRecorder(editor, "doc", isRemote);
    place("body 3a");
    setFocused(false);
    hide();
    window.dispatchEvent(new Event("pagehide"));
    expect(readContinueEntry("doc")).toBeNull();

    setFocused(true);
    hide();
    expect(readContinueEntry("doc")?.id).toBe("s3");
    place("body 4a");
    window.dispatchEvent(new Event("pagehide"));
    expect(readContinueEntry("doc")?.id).toBe("s4");
  });

  it("release records while focused, then removes its listeners; idempotent", () => {
    release = installContinueRecorder(editor, "doc", isRemote);
    setFocused(true);
    place("body 5a");
    release();
    expect(readContinueEntry("doc")?.id).toBe("s5");

    localStorage.clear();
    place("body 4a");
    blur();
    hide();
    window.dispatchEvent(new Event("pagehide"));
    release();
    expect(raw()).toBeNull();
  });

  it("an unfocused release (the writer never touched the text) keeps the old entry", () => {
    writeContinueEntry("doc", "s4");
    release = installContinueRecorder(editor, "doc", isRemote);
    place("Title");
    setFocused(false);
    release();
    expect(readContinueEntry("doc")?.id).toBe("s4");
  });

  it("text focused before the recorder loaded counts as the writer's place", () => {
    setFocused(true);
    release = installContinueRecorder(editor, "doc", isRemote);
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, posOf(editor, "body 3a")),
    );
    editor.view.dispatch(tr.setMeta("remote", true));
    blur();
    expect(readContinueEntry("doc")?.id).toBe("s3");
  });

  it("records nothing until the writer selects or edits: remote, appended and seed transactions do not count", () => {
    writeContinueEntry("doc", "s4");
    release = installContinueRecorder(editor, "doc", isRemote);
    const select = (meta: Record<string, unknown>) => {
      const tr = editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, posOf(editor, "Title")),
      );
      for (const [key, value] of Object.entries(meta)) tr.setMeta(key, value);
      editor.view.dispatch(tr);
    };
    select({ remote: true });
    select({ appendedTransaction: editor.state.tr });
    select({ addToHistory: false });
    // Dismissing the chip focuses the text where it is: no transaction.
    setFocused(true);
    blur();
    hide();
    release();
    expect(readContinueEntry("doc")?.id).toBe("s4");
  });

  it("a caret near the top deletes the entry", () => {
    writeContinueEntry("doc", "s4");
    release = installContinueRecorder(editor, "doc", isRemote);
    place("Title");
    blur();
    expect(readContinueEntry("doc")).toBeNull();
  });

  it("writes once while the section stays the same", () => {
    release = installContinueRecorder(editor, "doc", isRemote);
    place("body 3a");
    blur();
    let writes = 0;
    const real = localStorage;
    const restore = patchStorage({
      setItem: (key, value) => {
        writes++;
        real.setItem(key, value);
      },
    });
    try {
      place("body 3b");
      blur();
      expect(writes).toBe(0);
      place("body 4a");
      blur();
      expect(writes).toBe(1);
      expect(readContinueEntry("doc")?.id).toBe("s4");
    } finally {
      restore();
    }
  });
});
