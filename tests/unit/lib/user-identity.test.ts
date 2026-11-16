import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type * as UserIdentityModule from "@/lib/user-identity";
import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type Mod = typeof UserIdentityModule;

const FALLBACK = { name: "Brave Otter", color: "#E57373" };
const FAMILY = "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}";

const ownStorageDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

let m: Mod;

beforeEach(async () => {
  localStorage.clear();
  m = await importFresh<Mod>("@/lib/user-identity");
});

afterEach(() => {
  if (ownStorageDescriptor) {
    Object.defineProperty(window, "localStorage", ownStorageDescriptor);
  } else {
    delete (window as { localStorage?: Storage }).localStorage;
  }
  localStorage.clear();
  resetModules();
});

/**
 * Storage whose reads work but whose writes fail (quota). A stub, because
 * happy-dom's `localStorage` keeps its own `setItem` once it has been used,
 * so spying on `Storage.prototype` does not reach it.
 */
function fullStorage(seed: Record<string, string> = {}): void {
  const items = new Map(Object.entries(seed));
  const stub = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => stub,
  });
}

function blockStorage(): void {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("denied", "SecurityError");
    },
  });
}

describe("normalizeName", () => {
  it("keeps ZWNJ in a Persian name", () =>
    expect(m.normalizeName("  علی\u200Cرضا  ")).toEqual({
      ok: true,
      name: "علی\u200Cرضا",
    }));

  it("strips an RTL-override attack", () =>
    expect(m.normalizeName("\u202Egnp.exe\u202C Bob")).toEqual({
      ok: true,
      name: "gnp.exe Bob",
    }));

  it("collapses whitespace and drops controls", () =>
    expect(m.normalizeName("A\u0000\t\n  B\u0085")).toEqual({
      ok: true,
      name: "A B",
    }));

  it("counts graphemes, not code units", () => {
    expect(m.normalizeName(FAMILY.repeat(32))).toEqual({
      ok: true,
      name: FAMILY.repeat(32),
    });
    expect(m.normalizeName("a".repeat(33))).toEqual({
      ok: false,
      error: "too_long",
    });
  });

  it("keeps at most 4 combining marks in a row (no Zalgo towers)", () =>
    expect(m.normalizeName(`a${"\u0301".repeat(5000)}`)).toEqual({
      ok: true,
      name: `\u00E1${"\u0301".repeat(4)}`,
    }));

  it("refuses a name too long in code units even as one grapheme", () =>
    expect(m.normalizeName("\u{1F600}\u200D".repeat(200))).toEqual({
      ok: false,
      error: "too_long",
    }));

  it("keeps Persian vowel marks", () => {
    const name = "\u0645\u064F\u062D\u064E\u0645\u0651\u064E\u062F";
    expect(m.normalizeName(name)).toEqual({
      ok: true,
      name: name.normalize("NFC"),
    });
  });

  it("rejects empty after stripping", () => {
    expect(m.normalizeName(" \u202A ")).toEqual({ ok: false, error: "empty" });
    expect(m.normalizeName("\u200B")).toEqual({ ok: false, error: "empty" });
  });

  it("NFC-normalises", () =>
    expect(m.normalizeName("e\u0301")).toEqual({ ok: true, name: "\u00E9" }));

  it("rejects a non-string", () =>
    expect(m.normalizeName(5)).toEqual({ ok: false, error: "empty" }));
});

describe("caret colours", () => {
  it("canonicalises a lowercase palette colour", () =>
    expect(m.toCaretColor("#e57373")).toBe("#E57373"));

  it("refuses CSS in a colour", () => {
    expect(m.toCaretColor("red;background:url(//x)")).toBeNull();
    expect(m.toRemoteCaretColor("red;background:url(//x)")).toBe("#9E9E9E");
    expect(m.toRemoteCaretColor("transparent")).toBe("#9E9E9E");
    expect(m.toRemoteCaretColor("#123abc")).toBe("#123abc");
    expect(m.toRemoteCaretColor("#e57373")).toBe("#E57373");
    expect(m.toRemoteCaretColor(undefined)).toBe("#9E9E9E");
  });
});

describe("stored identity", () => {
  it("repairs a stored payload per field", () => {
    localStorage.setItem(
      "tinydocy-user",
      JSON.stringify({ name: "Ann", color: "#e11d48" }),
    );
    const id = m.getUserIdentity();
    expect(id.name).toBe("Ann");
    expect(m.CARET_COLORS).toContain(
      id.color as (typeof m.CARET_COLORS)[number],
    );
    expect(JSON.parse(localStorage.getItem("tinydocy-user") ?? "null")).toEqual(
      id,
    );
  });

  it("regenerates a non-object, a non-string name and an over-long name", () => {
    for (const raw of [
      "[]",
      "null",
      '{"name":5}',
      "{not json",
      JSON.stringify({ name: "x".repeat(40), color: "#E57373" }),
    ])
      expect(m.parseStoredIdentity(raw, FALLBACK).name).toBe(FALLBACK.name);
  });

  it("sees a name saved by another tab", () => {
    m.getUserIdentity();
    localStorage.setItem(
      "tinydocy-user",
      JSON.stringify({ name: "Zed", color: "#64B5F6" }),
    );
    expect(m.getUserIdentity()).toEqual({ name: "Zed", color: "#64B5F6" });
  });

  it("survives blocked storage and keeps one identity per session", () => {
    blockStorage();
    const a = m.getUserIdentity();
    expect(m.getUserIdentity()).toEqual(a);
    expect(m.saveUserIdentity({ name: "Bo", color: "#64B5F6" })).toEqual({
      ok: true,
      name: "Bo",
    });
    expect(m.getUserIdentity()).toEqual({ name: "Bo", color: "#64B5F6" });
  });

  it("keeps one identity when only setItem throws (quota)", () => {
    fullStorage();
    expect(m.getUserIdentity()).toEqual(m.getUserIdentity());
  });

  it("keeps a save whose write failed instead of reverting to the stored one", () => {
    fullStorage({
      "tinydocy-user": JSON.stringify({ name: "Ann", color: "#E57373" }),
    });
    expect(m.getUserIdentity().name).toBe("Ann");
    expect(m.saveUserIdentity({ name: "Bo", color: "#64B5F6" })).toEqual({
      ok: true,
      name: "Bo",
    });
    expect(m.getUserIdentity()).toEqual({ name: "Bo", color: "#64B5F6" });
  });

  it("save refuses an invalid name and keeps the stored identity", () => {
    const before = m.getUserIdentity();
    expect(m.saveUserIdentity({ name: "  ", color: "#64B5F6" })).toEqual({
      ok: false,
      error: "empty",
    });
    expect(m.getUserIdentity()).toEqual(before);
  });

  it("save stores the normalised name and a palette colour", () => {
    const before = m.getUserIdentity();
    expect(m.saveUserIdentity({ name: "  Ann  ", color: "url(x)" })).toEqual({
      ok: true,
      name: "Ann",
    });
    expect(m.getUserIdentity()).toEqual({ name: "Ann", color: before.color });
  });
});

describe("clampRemoteName", () => {
  it("clamps a remote name", () => {
    expect(m.clampRemoteName(`\u202E${"w".repeat(10_000)}`)).toBe(
      "w".repeat(32),
    );
    expect(m.clampRemoteName("\u202E\u200B")).toBe("");
  });

  it("trims combining-mark runs and never ends on half a surrogate pair", () => {
    expect(m.clampRemoteName(`a${"\u0301".repeat(5000)}`)).toBe(
      `\u00E1${"\u0301".repeat(4)}`,
    );
    expect(m.clampRemoteName(`a${"\u0301".repeat(1022)}\u{1F600}`)).toBe(
      `\u00E1${"\u0301".repeat(4)}`,
    );
  });

  it("caps a remote name in code units", () =>
    expect(
      m.clampRemoteName("\u{1F600}\u200D".repeat(200)).length,
    ).toBeLessThanOrEqual(320));
});

describe("without Intl.Segmenter (Firefox < 125)", () => {
  it("falls back to code points instead of throwing", async () => {
    const intl = Intl as { Segmenter?: typeof Intl.Segmenter };
    const original = intl.Segmenter;
    delete intl.Segmenter;
    try {
      const fresh = await importFresh<Mod>("@/lib/user-identity");
      localStorage.setItem(
        "tinydocy-user",
        JSON.stringify({ name: "Ann", color: "#E57373" }),
      );
      expect(fresh.getUserIdentity()).toEqual({
        name: "Ann",
        color: "#E57373",
      });
      expect(fresh.normalizeName("Bo")).toEqual({ ok: true, name: "Bo" });
      expect(fresh.normalizeName("a".repeat(33))).toEqual({
        ok: false,
        error: "too_long",
      });
      expect(fresh.clampRemoteName("w".repeat(100))).toBe("w".repeat(32));
    } finally {
      intl.Segmenter = original;
    }
  });
});
