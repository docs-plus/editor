/**
 * The RepeatFormatting shell around E's lazy engine: the pending buffer
 * while the chunk loads, the hand-over when it lands, the per-session
 * bundle against other tabs and Forget, and the Repeat key's feedback.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type * as Y from "yjs";

import {
  RepeatFormatting,
  type RepeatFormattingStorage,
} from "@/extensions/repeat-formatting";
import { onlyCode } from "@/extensions/repeat-formatting/apply-bundle";
import {
  getRememberedBundle,
  rememberBundle,
  resetBundleMemoryForTests,
} from "@/extensions/repeat-formatting/bundle-memory";
import { TextColor } from "@/extensions/text-style-marks";
import { getEditorVersionStore } from "@/hooks/use-tiptap-editor";
import { availability } from "@/lib/editor-actions/registry";
import {
  ENGINE_LOADING_REASON,
  getV11Engine,
  installV11Engine,
  repeatApplyAction,
  resetV11EngineForTests,
} from "@/lib/editor-actions/v11-actions";
import { v11Engine } from "@/lib/editor-actions/v11-engine";
import { getEditorContextStore } from "@/lib/editor-context/store";
import { forgetChoices } from "@/lib/remembered-choice";

import {
  type CollabEditorFixture,
  createCollabEditor,
} from "../../helpers/collab-editor";

let f: CollabEditorFixture | null = null;
let editor: Editor;

const storage = () =>
  (editor.storage as unknown as { repeatFormatting: RepeatFormattingStorage })
    .repeatFormatting;

/** Past Tiptap's deferred `create` and the engine import's microtasks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function open(): void {
  f = createCollabEditor({ extensions: [TextColor, RepeatFormatting] });
  editor = f.editor;
}

/** Selects the first occurrence of `text`. */
function sel(text: string): void {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    const index = node.text?.indexOf(text) ?? -1;
    if (index >= 0) {
      found = { from: pos + index, to: pos + index + text.length };
    }
    return false;
  });
  if (!found) throw new Error(`text not found: ${text}`);
  const { from, to } = found as { from: number; to: number };
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, to),
    ),
  );
}

const setRed = () => editor.commands.setMark("textColor", { color: "red" });

/** Another tab writes its own Repeat bundle (the `storage` event). */
function otherTabRemembers(bundle: Record<string, unknown>): void {
  localStorage.setItem(
    "tinydocy-choices",
    JSON.stringify({ v: 1, slots: { repeatBundle: { last: bundle } } }),
  );
  window.dispatchEvent(
    new StorageEvent("storage", { key: "tinydocy-choices" }),
  );
}

beforeEach(() => {
  localStorage.clear();
  resetBundleMemoryForTests();
});

afterEach(() => {
  f?.destroy();
  f = null;
  // Other files share this process: leave the engine installed.
  installV11Engine(v11Engine);
  localStorage.clear();
  resetBundleMemoryForTests();
});

describe("RepeatFormatting: before the engine lands", () => {
  beforeEach(() => {
    resetV11EngineForTests();
    open();
  });

  it("records the buffered transactions in order once it lands", async () => {
    sel("hello");
    editor.commands.toggleBold();
    setRed();
    expect(getV11Engine()).toBeNull();
    expect(getRememberedBundle()).toBeNull();
    await settle();
    expect(getV11Engine()).not.toBeNull();
    expect(storage().pending).toHaveLength(0);
    // Same selection throughout: one extended bundle, in order.
    expect(getRememberedBundle()).toEqual({ bold: true, textColor: "red" });
  });

  it("keeps only the newest transactions past the cap", () => {
    const seen: Transaction[] = [];
    editor.on("transaction", ({ transaction }) => seen.push(transaction));
    for (let i = 0; i < 60; i += 1) sel(i % 2 === 0 ? "hello" : "world");
    const { pending } = storage();
    expect(pending).toHaveLength(50);
    const newest = seen.slice(-50);
    // Identity, not deep equality (a transaction diff never finishes).
    expect(pending.every((entry, i) => entry.tr === newest[i])).toBe(true);
  });

  it("never buffers remote edits or meta-only transactions", () => {
    f?.remote((frag) => {
      const paragraph = frag.get(1) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).insert(0, "XX");
    });
    expect(editor.state.doc.textContent).toContain("XXhello");
    editor.view.dispatch(editor.state.tr.setMeta("caret", true));
    expect(storage().pending).toHaveLength(0);
    sel("hello");
    expect(storage().pending).toHaveLength(1);
  });

  it("hands over when another importer installs the engine first", async () => {
    sel("hello");
    editor.commands.toggleBold();
    // Another surface's import evaluates the engine before this load (and
    // before this editor's deferred create subscribed): the next
    // transaction records the buffer first, in order.
    installV11Engine(v11Engine);
    setRed();
    expect(storage().pending).toHaveLength(0);
    expect(getRememberedBundle()).toEqual({ bold: true, textColor: "red" });
    await settle();
    expect(getRememberedBundle()).toEqual({ bold: true, textColor: "red" });
  });

  it("drains before a command uses the engine", async () => {
    await settle(); // subscribed (create) and installed
    resetV11EngineForTests();
    sel("hello");
    editor.commands.toggleBold();
    // Landed with nobody waiting (this editor's wait ended at the first
    // landing): the buffer is still there until something uses the engine.
    installV11Engine(v11Engine);
    expect(storage().pending).toHaveLength(2);
    expect(editor.commands.repeatFormatting()).toBe(true);
    expect(storage().pending).toHaveLength(0);
    sel("world");
    expect(editor.commands.repeatFormatting()).toBe(true);
    expect(editor.getHTML()).toContain("<strong>world</strong>");
  });

  it("moves the toolbar version when it lands, so cached views re-read", async () => {
    const versions = getEditorVersionStore(editor);
    const stop = getEditorContextStore(editor).subscribe(() => {});
    sel("hello");
    const before = versions.getVersion();
    expect(
      availability(
        repeatApplyAction,
        getEditorContextStore(editor).getContext(),
      ),
    ).toEqual({ reason: ENGINE_LOADING_REASON });
    await settle();
    expect(versions.getVersion()).toBeGreaterThan(before);
    expect(
      getEditorContextStore(editor).getView(repeatApplyAction.id)?.enabled,
    ).not.toEqual({ reason: ENGINE_LOADING_REASON });
    stop();
  });

  it("clears the buffer and stops waiting on destroy", async () => {
    sel("hello");
    editor.commands.toggleBold();
    await new Promise((resolve) => setTimeout(resolve, 0)); // create ran
    const kept = storage();
    resetV11EngineForTests();
    f?.destroy();
    f = null;
    expect(kept.pending).toHaveLength(0);
    expect(kept.unwait).toBeNull();
    // Landing later touches no destroyed editor.
    expect(() => installV11Engine(v11Engine)).not.toThrow();
  });
});

describe("RepeatFormatting: the extend session", () => {
  beforeEach(() => {
    installV11Engine(v11Engine);
    open();
  });

  it("extends its own bundle, not another tab's", () => {
    sel("hello");
    editor.commands.toggleBold();
    otherTabRemembers({ italic: true });
    expect(getRememberedBundle()).toEqual({ italic: true });
    setRed();
    expect(getRememberedBundle()).toEqual({ bold: true, textColor: "red" });
    sel("world");
    editor.commands.repeatFormatting();
    expect(editor.getHTML()).not.toContain("<em>");
  });

  it("ends when the choices are forgotten mid-session", () => {
    sel("hello");
    editor.commands.toggleBold();
    forgetChoices();
    expect(getRememberedBundle()).toBeNull();
    setRed();
    expect(getRememberedBundle()).toEqual({ textColor: "red" });
  });

  it("an applied format becomes the session's bundle", () => {
    rememberBundle({ italic: true });
    sel("hello");
    editor.commands.repeatFormatting();
    otherTabRemembers({ underline: true });
    editor.commands.toggleBold();
    expect(getRememberedBundle()).toEqual({ italic: true, bold: true });
  });
});

describe("RepeatFormatting: the key", () => {
  beforeEach(() => {
    installV11Engine(v11Engine);
    open();
  });

  const announced = async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return document.querySelector("[data-announcer]")?.textContent;
  };

  it("announces why it cannot repeat, and keeps the key", async () => {
    sel("hello");
    expect(v11Engine.repeatKey(editor)).toBe(true);
    expect(await announced()).toBe(
      "Format some text first, or use Copy formatting.",
    );
  });

  it("announces what it repeated", async () => {
    rememberBundle({ bold: true, italic: true });
    sel("world");
    expect(v11Engine.repeatKey(editor)).toBe(true);
    expect(editor.getHTML()).toContain("world");
    expect(await announced()).toBe("Repeated Bold, Italic");
  });
});

describe("onlyCode", () => {
  beforeEach(() => {
    installV11Engine(v11Engine);
    open();
  });

  it("is false for prose and an empty selection, true for code only", () => {
    sel("hello");
    expect(onlyCode(editor.state)).toBe(false);
    editor.commands.setCodeBlock();
    sel("hello");
    expect(onlyCode(editor.state)).toBe(true);
    editor.commands.setTextSelection(3);
    expect(onlyCode(editor.state)).toBe(false);
    // Code plus a formattable title: not code only.
    editor.commands.setTextSelection({
      from: 1,
      to: editor.state.doc.content.size - 1,
    });
    expect(onlyCode(editor.state)).toBe(false);
  });
});
