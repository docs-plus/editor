import { afterEach, describe, expect, it, spyOn } from "bun:test";

import type { Editor } from "@tiptap/core";

import {
  matchPaletteHotkey,
  type PaletteKeyEvent,
  shouldHandlePaletteKey,
} from "@/components/smart-toolbar/palette/hotkey";
import {
  closePalette,
  getActiveEditor,
  getPaletteState,
  onPaletteKey,
  registerPaletteEditor,
} from "@/components/smart-toolbar/palette/palette-store";

const key = (overrides: Partial<PaletteKeyEvent>): PaletteKeyEvent => ({
  code: "Slash",
  key: "/",
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  repeat: false,
  ...overrides,
});

const fakeEditor = (name: string) =>
  ({
    name,
    isDestroyed: false,
    view: { focus: () => {} },
  }) as unknown as Editor;

afterEach(() => {
  closePalette();
  document.body.innerHTML = "";
});

describe("matchPaletteHotkey", () => {
  it.each([
    [{}, true],
    [{ code: "KeyZ", shiftKey: true }, true],
    [{ ctrlKey: true }, false], // AltGr on Windows
    [{ metaKey: true }, false],
    [{ shiftKey: true, key: "?" }, false], // US Alt+Shift+/
    [{ key: "÷" }, true], // macOS US ⌥/
    [{ key: "÷", shiftKey: true }, false],
    // German / Swiss Mac: the physical slash key is ⌥- (en dash).
    [{ key: "–" }, false],
    [{ key: "-" }, false],
    // A layout with "/" elsewhere (German Windows: Alt+Shift+7).
    [{ code: "Digit7", key: "/", shiftKey: true }, true],
    [{ code: "KeyZ", key: "z" }, false],
    [{ code: "KeyZ", key: "Z", shiftKey: true }, true],
    [{ isComposing: true }, false],
    [{ repeat: true }, false],
    [{ altKey: false }, false],
  ] as const)("%o → %p", (overrides, expected) => {
    expect(matchPaletteHotkey(key(overrides))).toBe(expected);
  });
});

describe("shouldHandlePaletteKey", () => {
  it("handles the editor, the page and the palette; leaves other fields", () => {
    document.body.innerHTML = `
      <div class="tiptap" contenteditable="true"><p id="in-editor">x</p></div>
      <div class="link-popover"><input id="link-url" /></div>
      <div role="dialog" data-command-palette><input id="palette-search" /></div>
      <div role="dialog"><button id="other-dialog">x</button></div>
      <div role="toolbar"><button id="toolbar-button">B</button></div>
    `;
    const at = (id: string) => document.getElementById(id);
    expect(shouldHandlePaletteKey(at("in-editor"))).toBe(true);
    expect(shouldHandlePaletteKey(at("link-url"))).toBe(false);
    expect(shouldHandlePaletteKey(at("palette-search"))).toBe(true);
    expect(shouldHandlePaletteKey(at("other-dialog"))).toBe(false);
    expect(shouldHandlePaletteKey(at("toolbar-button"))).toBe(true);
    expect(shouldHandlePaletteKey(document.body)).toBe(true);
    expect(shouldHandlePaletteKey(null)).toBe(true);
  });
});

describe("palette store", () => {
  it("targets the newest editor across a tab-switch race", () => {
    const a = fakeEditor("a");
    const b = fakeEditor("b");
    const releaseA = registerPaletteEditor(a);
    const releaseB = registerPaletteEditor(b);
    releaseA();
    expect(getActiveEditor()).toBe(b);
    releaseB();
    releaseB();
    expect(getActiveEditor()).toBeNull();
  });

  it("adds one capture listener for any number of editors and removes it with the last", () => {
    const add = spyOn(window, "addEventListener");
    const remove = spyOn(window, "removeEventListener");
    const releases = [fakeEditor("a"), fakeEditor("b"), fakeEditor("c")].map(
      registerPaletteEditor,
    );
    const adds = add.mock.calls.filter(([, fn]) => fn === onPaletteKey);
    expect(adds).toHaveLength(1);
    expect(adds[0][2]).toEqual({ capture: true });
    for (const release of releases) release();
    expect(
      remove.mock.calls.filter(([, fn]) => fn === onPaletteKey),
    ).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });

  it("toggles on the key and swallows it only when it handles it", () => {
    const a = fakeEditor("a");
    const release = registerPaletteEditor(a);
    const event = new KeyboardEvent("keydown", {
      code: "Slash",
      key: "/",
      altKey: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    expect(getPaletteState().editor).toBe(a);
    expect(getPaletteState().requested).toBe(true);
    const again = new KeyboardEvent("keydown", {
      code: "Slash",
      key: "/",
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(true);
    expect(getPaletteState().editor).toBeNull();
    const plain = new KeyboardEvent("keydown", {
      code: "Slash",
      key: "/",
      cancelable: true,
    });
    window.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    release();
  });

  it("closes when its editor goes away", () => {
    const a = fakeEditor("a");
    const release = registerPaletteEditor(a);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Slash", key: "/", altKey: true }),
    );
    expect(getPaletteState().editor).toBe(a);
    release();
    expect(getPaletteState().editor).toBeNull();
  });
});
