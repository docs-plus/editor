/**
 * Every advertised shortcut is bound, and each key does one thing: no combo
 * is bound by two editor extensions, and none of the tab bar's window keys
 * reaches the editor keymap too (⌘⇧R once aligned right *and* regenerated
 * the Playground). The action-vs-action uniqueness check lives in
 * `contract.test.ts`.
 */
import { afterEach, describe, expect, it } from "bun:test";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import type { buildDocumentEditorExtensions as BuildExtensions } from "@/components/document-editor/document-editor-config";
import {
  matchTabBarShortcut,
  SETTINGS_SHORTCUT,
  TAB_BAR_SHORTCUTS,
} from "@/lib/app-shortcuts";
import type { ActionRegistry } from "@/lib/editor-actions/registry";

import { collectEditorKeys, normalizeCombo } from "../../helpers/editor-keymap";
import { importFresh, resetModules } from "../../helpers/import-fresh";

/** Combos chained by design across the list, table and indent extensions. */
const CHAINED = new Set(["Tab", "Shift-Tab"]);

/** Actions whose key is bound outside the editor keymap, with the binder. */
const BOUND_OUTSIDE_EDITOR = {
  "palette.open": "components/smart-toolbar/palette/palette-store.ts", // window capture keydown, Alt-/
  "history.undo": "Collaboration (filtered: collaborationRenderOnce)",
  "history.redo": "Collaboration (filtered: collaborationRenderOnce)",
} as const;

async function loadEditor(): Promise<{
  keys: Map<string, string[]>;
  actions: ActionRegistry;
}> {
  const { buildDocumentEditorExtensions } = await importFresh<{
    buildDocumentEditorExtensions: typeof BuildExtensions;
  }>("@/components/document-editor/document-editor-config");
  const { editorActions } = await import("@/lib/editor-actions");
  const extensions = buildDocumentEditorExtensions({
    documentId: "keys",
    ydoc: new Y.Doc(),
    provider: {} as HocuspocusProvider,
    onFoldChange() {},
    onFilterChange() {},
    onTocUpdate() {},
  }).filter((ext) => !ext.name.startsWith("collaboration"));
  return { keys: collectEditorKeys(extensions), actions: editorActions };
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_TARGET;
  resetModules();
});

describe("editor key bindings", () => {
  it("binds every advertised shortcut, and each one once unless chained", async () => {
    const { keys, actions } = await loadEditor();
    for (const action of actions.list()) {
      if (!action.shortcut || action.id in BOUND_OUTSIDE_EDITOR) continue;
      const combo = normalizeCombo(action.shortcut);
      const bound = keys.get(combo) ?? [];
      expect({ id: action.id, combo, bound: bound.length > 0 }).toEqual({
        id: action.id,
        combo,
        bound: true,
      });
      if (!CHAINED.has(combo)) {
        expect({ combo, bound }).toEqual({ combo, bound: [bound[0]] });
      }
    }
  });

  it("never exempts a Mod- combo", () => {
    expect([...CHAINED].filter((combo) => combo.startsWith("Mod-"))).toEqual(
      [],
    );
  });

  it("keeps the tab bar's keys out of the editor keymap", async () => {
    const { keys } = await loadEditor();
    for (const combo of Object.values(TAB_BAR_SHORTCUTS)) {
      const normalized = normalizeCombo(combo);
      expect({ combo: normalized, bound: keys.get(normalized) }).toEqual({
        combo: normalized,
        bound: undefined,
      });
    }
  });

  it("keeps Strike on Mod-Shift-s and leaves Mod-d free for Duplicate (P2.8)", async () => {
    const { keys } = await loadEditor();
    expect(keys.get("Mod-Shift-s")).toEqual(["strike"]);
    expect(keys.has("Mod-d")).toBe(false);
  });

  it("web: Subscript is Mod-, (unchanged)", async () => {
    const { keys, actions } = await loadEditor();
    expect(actions.get("mark.subscript")?.shortcut).toBe("Mod-,");
    expect(keys.get("Mod-,")).toEqual(["subscript"]);
  });

  it("desktop: Subscript moves to Mod-Shift-, and Mod-, is free for Settings", async () => {
    process.env.NEXT_PUBLIC_APP_TARGET = "desktop";
    const { keys, actions } = await loadEditor();
    expect(actions.get("mark.subscript")?.shortcut).toBe("Mod-Shift-,");
    expect(keys.get("Mod-Shift-,")).toEqual(["subscript"]);
    expect(keys.has(normalizeCombo(SETTINGS_SHORTCUT))).toBe(false);
  });
});

describe("normalizeCombo", () => {
  it.each([
    ["Shift-Mod-z", "Mod-Shift-z"],
    ["Mod-Shift-Z", "Mod-Shift-z"],
    ["Alt-Mod-v", "Mod-Alt-v"],
    ["Mod--", "Mod--"],
    ["Shift-Tab", "Shift-Tab"],
  ])("%s → %s", (combo, expected) => {
    expect(normalizeCombo(combo)).toBe(expected);
  });
});

describe("matchTabBarShortcut", () => {
  const press = (
    key: string,
    mods: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
  ) =>
    matchTabBarShortcut({
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      ...mods,
    });

  it("matches the key whatever its case (Caps Lock)", () => {
    expect(press("t", { metaKey: true })).toBe("newTab");
    expect(press("T", { ctrlKey: true })).toBe("newTab");
    expect(press("w", { ctrlKey: true })).toBe("closeTab");
  });

  it("matches the shifted brackets", () => {
    expect(press("[", { metaKey: true, shiftKey: true })).toBe("previousTab");
    expect(press("{", { metaKey: true, shiftKey: true })).toBe("previousTab");
    expect(press("}", { ctrlKey: true, shiftKey: true })).toBe("nextTab");
  });

  it("never takes ⌘⇧T, the browser's reopen-tab", () => {
    expect(press("T", { metaKey: true, shiftKey: true })).toBeNull();
  });

  it("leaves ⌘⇧R to the editor's Align right and the browser's hard reload", () => {
    expect(press("R", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press("r", { metaKey: true, shiftKey: true })).toBeNull();
  });

  it("needs Cmd or Ctrl", () => {
    expect(press("t", {})).toBeNull();
    expect(press("[", { shiftKey: true })).toBeNull();
  });
});
