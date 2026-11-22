/**
 * Bidi isolation and control stripping (languages design §4.6, §3.5).
 */
import { describe, expect, it } from "bun:test";

import { fsi, lri, stripBidiControls } from "@/lib/i18n/isolate";

describe("fsi / lri", () => {
  it("wraps text in FSI…PDI", () => {
    expect(fsi("سلام")).toBe("\u2068سلام\u2069");
  });

  it("wraps shortcuts in LRI…PDI", () => {
    expect(lri("Ctrl+Shift+V")).toBe("\u2066Ctrl+Shift+V\u2069");
  });
});

describe("stripBidiControls", () => {
  it("removes the RLO in a spoofed filename", () => {
    expect(stripBidiControls("report\u202Efdp.exe")).toBe("reportfdp.exe");
  });

  it("removes every bidi mark, embedding, override and isolate", () => {
    const controls =
      "\u200E\u200F\u061C\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069";
    expect(stripBidiControls(`a${controls}b`)).toBe("ab");
  });

  it("keeps ZWNJ and ZWJ, which Persian and emoji need", () => {
    const persian = "می\u200Cخواهم";
    expect(stripBidiControls(persian)).toBe(persian);
    const family = "👩\u200D👧";
    expect(stripBidiControls(family)).toBe(family);
  });
});
