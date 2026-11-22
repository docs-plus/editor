import { afterEach, describe, expect, it } from "bun:test";

import type * as FindKeys from "@/components/find/find-keys";
import {
  isFindKeyTarget,
  matchFindShortcut,
} from "@/components/find/find-keys";

import { importFresh, resetModules } from "../../../helpers/import-fresh";

const mac = { mac: true, desktop: false };
const pc = { mac: false, desktop: false };
const macApp = { mac: true, desktop: true };
const pcApp = { mac: false, desktop: true };

const press = (
  key: string,
  mods: Partial<
    Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>
  > = {},
  code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

const cssDescriptor = Object.getOwnPropertyDescriptor(globalThis, "CSS");

/** Gives happy-dom the CSS Custom Highlight API until the test ends. */
function withHighlightApi() {
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { highlights: new Map() },
  });
  Object.assign(globalThis, { Highlight: class {} });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FIND;
  resetModules();
  document.body.replaceChildren();
  if (cssDescriptor) Object.defineProperty(globalThis, "CSS", cssDescriptor);
  else Reflect.deleteProperty(globalThis, "CSS");
  Reflect.deleteProperty(globalThis, "Highlight");
});

describe("matchFindShortcut", () => {
  it("opens Find with ⌘F on a Mac and Ctrl+F elsewhere", () => {
    expect(matchFindShortcut(press("f", { metaKey: true }), mac)).toBe("open");
    expect(matchFindShortcut(press("f", { ctrlKey: true }), pc)).toBe("open");
    // Ctrl+F on a Mac is a text-field key (forward one character).
    expect(matchFindShortcut(press("f", { ctrlKey: true }), mac)).toBeNull();
    expect(matchFindShortcut(press("f", { metaKey: true }), pc)).toBeNull();
  });

  it("leaves ⌘⇧F to the heading filter", () => {
    expect(
      matchFindShortcut(press("F", { metaKey: true, shiftKey: true }), mac),
    ).toBeNull();
    expect(
      matchFindShortcut(press("F", { ctrlKey: true, shiftKey: true }), pc),
    ).toBeNull();
  });

  it("steps with ⌘G / ⌘⇧G, Ctrl+G and F3 / Shift+F3", () => {
    expect(matchFindShortcut(press("g", { metaKey: true }), mac)).toBe("next");
    expect(
      matchFindShortcut(press("G", { metaKey: true, shiftKey: true }), mac),
    ).toBe("previous");
    expect(matchFindShortcut(press("g", { ctrlKey: true }), pc)).toBe("next");
    expect(matchFindShortcut(press("F3"), pc)).toBe("next");
    expect(matchFindShortcut(press("F3", { shiftKey: true }), pc)).toBe(
      "previous",
    );
    expect(matchFindShortcut(press("F3"), mac)).toBeNull();
  });

  it("binds Replace only in the desktop app (the web reaches it from the bar)", () => {
    const optionF = press("ƒ", { metaKey: true, altKey: true }, "KeyF");
    expect(matchFindShortcut(optionF, macApp)).toBe("replace");
    expect(matchFindShortcut(optionF, mac)).toBeNull();
    expect(matchFindShortcut(press("h", { ctrlKey: true }), pcApp)).toBe(
      "replace",
    );
    expect(matchFindShortcut(press("h", { ctrlKey: true }), pc)).toBeNull();
    // Ctrl+Alt+F is AltGr on many layouts: never Replace.
    expect(
      matchFindShortcut(press("f", { ctrlKey: true, altKey: true }), pcApp),
    ).toBeNull();
  });

  it("reads the physical key on non-Latin layouts", () => {
    expect(matchFindShortcut(press("ب", { metaKey: true }, "KeyF"), mac)).toBe(
      "open",
    );
    expect(matchFindShortcut(press("ل", { metaKey: true }, "KeyG"), mac)).toBe(
      "next",
    );
  });

  it("ignores everything else", () => {
    expect(matchFindShortcut(press("f"), mac)).toBeNull();
    expect(matchFindShortcut(press("k", { metaKey: true }), mac)).toBeNull();
    expect(
      matchFindShortcut(press("g", { metaKey: true, ctrlKey: true }), mac),
    ).toBeNull();
  });
});

describe("FIND_ENABLED", () => {
  it("is on by default (the row is shared with the web)", async () => {
    const { FIND_ENABLED } = await importFresh<typeof FindKeys>(
      "@/components/find/find-keys",
    );
    expect(FIND_ENABLED).toBe(true);
  });

  it("is off under NEXT_PUBLIC_FIND=0", async () => {
    process.env.NEXT_PUBLIC_FIND = "0";
    const { FIND_ENABLED } = await importFresh<typeof FindKeys>(
      "@/components/find/find-keys",
    );
    expect(FIND_ENABLED).toBe(false);
  });
});

describe("findAvailable", () => {
  it("is off where the CSS Custom Highlight API is missing (the browser's find bar stays)", async () => {
    const { findAvailable } = await importFresh<typeof FindKeys>(
      "@/components/find/find-keys",
    );
    // happy-dom, like Firefox before 140 and Safari before 17.2.
    expect(findAvailable()).toBe(false);
    withHighlightApi();
    expect(findAvailable()).toBe(true);
  });

  it("is off under NEXT_PUBLIC_FIND=0 even with the API", async () => {
    process.env.NEXT_PUBLIC_FIND = "0";
    withHighlightApi();
    const { findAvailable } = await importFresh<typeof FindKeys>(
      "@/components/find/find-keys",
    );
    expect(findAvailable()).toBe(false);
  });
});

describe("isFindKeyTarget", () => {
  function mount(html: string) {
    document.body.innerHTML = html;
    return (selector: string) => document.querySelector(selector);
  }

  it("takes keys from the editor, the page and the find bar", () => {
    const $ = mount(`
      <div class="ProseMirror" contenteditable="true"><p id="text">x</p></div>
      <div data-find-bar><input id="find"></div>
      <button id="button">b</button>`);
    expect(isFindKeyTarget($("#text"))).toBe(true);
    expect(isFindKeyTarget($(".ProseMirror"))).toBe(true);
    expect(isFindKeyTarget($("#find"))).toBe(true);
    expect(isFindKeyTarget($("#button"))).toBe(true);
    expect(isFindKeyTarget(document.body)).toBe(true);
    expect(isFindKeyTarget(null)).toBe(true);
  });

  it("leaves keys to other fields and to dialogs", () => {
    const $ = mount(`
      <input id="rename">
      <textarea id="notes"></textarea>
      <select id="pick"></select>
      <div id="rich" contenteditable="true"><span id="inner">x</span></div>
      <div class="ProseMirror" contenteditable="true">
        <div contenteditable="false"><textarea id="node-view-source"></textarea></div>
      </div>
      <div role="dialog"><button id="dialog-button">ok</button></div>
      <div aria-modal="true"><p id="modal-text">x</p></div>`);
    for (const id of [
      "rename",
      "notes",
      "pick",
      "rich",
      "inner",
      "node-view-source",
      "dialog-button",
      "modal-text",
    ]) {
      expect(isFindKeyTarget($(`#${id}`)), id).toBe(false);
    }
  });
});
