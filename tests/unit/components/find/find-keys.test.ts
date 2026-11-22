import { afterEach, describe, expect, it } from "bun:test";

import type * as FindKeys from "@/components/find/find-keys";
import { matchFindShortcut } from "@/components/find/find-keys";

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

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FIND;
  resetModules();
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
