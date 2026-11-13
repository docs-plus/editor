import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { STORAGE_KEYS } from "@/lib/remembered-choice";
import {
  FORMAT_REASONS,
  FORMATS_STORAGE_KEY,
  MAX_SAVED_FORMATS,
  readSavedFormats,
  removeFormat,
  resetSavedFormatsCacheForTests,
  restoreFormat,
  sanitizeFormatName,
  saveFormat,
  subscribeSavedFormats,
} from "@/lib/saved-formats";

const RLO = String.fromCharCode(0x202e);
const BEL = String.fromCharCode(0x07);
const ZWSP = String.fromCharCode(0x200b);
const LRI = String.fromCharCode(0x2066);

function setRaw(value: string): void {
  localStorage.setItem(FORMATS_STORAGE_KEY, value);
  resetSavedFormatsCacheForTests();
}

beforeEach(() => {
  localStorage.clear();
  resetSavedFormatsCacheForTests();
});
afterEach(() => {
  localStorage.clear();
  resetSavedFormatsCacheForTests();
});

describe("saved formats", () => {
  it("uses its own storage key, outside Forget's", () => {
    expect(FORMATS_STORAGE_KEY).toBe(STORAGE_KEYS.formats);
    expect(FORMATS_STORAGE_KEY).not.toBe(STORAGE_KEYS.choices);
  });

  it("round-trips a format", () => {
    const result = saveFormat("Warning", { bold: true, textColor: "red" });
    expect(result.ok).toBe(true);
    resetSavedFormatsCacheForTests();
    const formats = readSavedFormats();
    expect(formats).toHaveLength(1);
    expect(formats[0].name).toBe("Warning");
    expect(formats[0].bundle).toEqual({ bold: true, textColor: "red" });
  });

  it("keeps only set entries (a saved format only adds marks)", () => {
    saveFormat("Mixed", { bold: true, italic: false, highlight: null });
    expect(readSavedFormats()[0].bundle).toEqual({ bold: true });
    expect(saveFormat("Plain", { bold: false })).toEqual({
      ok: false,
      reason: FORMAT_REASONS.empty,
    });
  });

  it("sanitizes names", () => {
    expect(sanitizeFormatName(`${RLO}evil${BEL} name `)).toBe("evil name");
    expect(sanitizeFormatName(`a${ZWSP}b${LRI}c`)).toBe("abc");
  });

  it("strips the soft hyphen, Arabic letter mark, word joiner and invisible operators", () => {
    const invisible = [0xad, 0x61c, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064];
    for (const code of invisible) {
      expect(sanitizeFormatName(`a${String.fromCharCode(code)}b`)).toBe("ab");
    }
    // Only invisible characters: no name at all.
    expect(sanitizeFormatName(String.fromCharCode(...invisible))).toBe("");
  });

  it("keeps the other naming rules", () => {
    expect(Array.from(sanitizeFormatName("x".repeat(10_000)))).toHaveLength(40);
    expect(sanitizeFormatName(42)).toBe("");
    expect(saveFormat("   ", { bold: true })).toEqual({
      ok: false,
      reason: FORMAT_REASONS.name,
    });
  });

  it("caps at 20", () => {
    for (let i = 0; i < MAX_SAVED_FORMATS; i++) {
      expect(saveFormat(`F${i}`, { bold: true }).ok).toBe(true);
    }
    expect(saveFormat("One more", { bold: true })).toEqual({
      ok: false,
      reason: FORMAT_REASONS.cap,
    });
    const many = Array.from({ length: 500 }, (_, i) => ({
      id: `id${i}`,
      name: `N${i}`,
      bundle: { italic: true },
    }));
    setRaw(JSON.stringify({ v: 1, formats: many }));
    expect(readSavedFormats()).toHaveLength(MAX_SAVED_FORMATS);
  });

  it("discards tampered storage", () => {
    setRaw(
      JSON.stringify({
        v: 1,
        formats: [
          {
            id: "a",
            name: "x",
            bundle: { textColor: "red;background:url(x)" },
          },
        ],
      }),
    );
    expect(readSavedFormats()).toEqual([]);
    setRaw(
      JSON.stringify({
        v: 9,
        formats: [{ id: "a", name: "x", bundle: { bold: true } }],
      }),
    );
    expect(readSavedFormats()).toEqual([]);
    setRaw("{not json");
    expect(readSavedFormats()).toEqual([]);
    setRaw(
      JSON.stringify({
        v: 1,
        formats: [{ id: "<script>", name: "x", bundle: { bold: true } }],
      }),
    );
    expect(readSavedFormats()).toEqual([]);
    setRaw(
      JSON.stringify({
        v: 1,
        formats: [
          {
            id: "ok",
            name: `${RLO}${"y".repeat(10_000)}`,
            bundle: { bold: true, evil: 1 },
          },
        ],
      }),
    );
    const [format] = readSavedFormats();
    expect(Array.from(format.name)).toHaveLength(40);
    expect(format.bundle).toEqual({ bold: true });
  });

  it("replaces a format with the same name, keeping its id", () => {
    const first = saveFormat("Warning", { bold: true });
    const second = saveFormat("warning", { italic: true });
    expect(first.ok && second.ok).toBe(true);
    const formats = readSavedFormats();
    expect(formats).toHaveLength(1);
    expect(formats[0].bundle).toEqual({ italic: true });
    if (first.ok) expect(formats[0].id).toBe(first.format.id);
    // The caller learns which name it overwrote; a new name replaces nothing.
    expect(second.ok && second.replaced).toBe("Warning");
    expect(first.ok && first.replaced).toBeUndefined();
  });

  it("drops its cache on another tab's write, with no subscriber", () => {
    saveFormat("Mine", { bold: true });
    expect(readSavedFormats().map((format) => format.name)).toEqual(["Mine"]);
    // Another tab removed it (the storage event never fires in the writer).
    localStorage.setItem(
      FORMATS_STORAGE_KEY,
      JSON.stringify({ v: 1, formats: [] }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: FORMATS_STORAGE_KEY }),
    );
    expect(readSavedFormats()).toEqual([]);
  });

  it("keeps listening after the last subscriber leaves", () => {
    const off = subscribeSavedFormats(() => {});
    off();
    saveFormat("Theirs", { italic: true });
    localStorage.setItem(
      FORMATS_STORAGE_KEY,
      JSON.stringify({ v: 1, formats: [] }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(readSavedFormats()).toEqual([]);
  });

  it("removes a format and notifies subscribers", () => {
    let calls = 0;
    const off = subscribeSavedFormats(() => {
      calls += 1;
    });
    const saved = saveFormat("Gone", { underline: true });
    if (saved.ok) removeFormat(saved.format.id);
    expect(readSavedFormats()).toEqual([]);
    expect(calls).toBe(2);
    off();
  });

  it("restores a removed format at its place (Undo), once", () => {
    saveFormat("One", { bold: true });
    const two = saveFormat("Two", { italic: true });
    saveFormat("Three", { underline: true });
    if (!two.ok) throw new Error("not saved");
    removeFormat(two.format.id);
    expect(readSavedFormats().map((format) => format.name)).toEqual([
      "One",
      "Three",
    ]);
    expect(restoreFormat(two.format, 1)).toBe(true);
    expect(readSavedFormats().map((format) => format.name)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    // Already back (or its name taken): nothing doubles.
    expect(restoreFormat(two.format, 1)).toBe(false);
    expect(readSavedFormats()).toHaveLength(3);
  });

  it("survives clearing the choices key (Forget my choices)", () => {
    saveFormat("Keep", { bold: true });
    localStorage.removeItem(STORAGE_KEYS.choices);
    resetSavedFormatsCacheForTests();
    expect(readSavedFormats()).toHaveLength(1);
  });
});
