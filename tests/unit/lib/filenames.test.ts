import { describe, expect, it } from "bun:test";

import {
  cleanFileStem,
  documentPath,
  fileName,
  MAX_NAME_BYTES,
  MAX_PATH_CHARS,
  nameKey,
  uniqueName,
} from "@/lib/filenames";

const FORBIDDEN = /[<>:"/\\|?*\p{Cc}\u202A-\u202E\u2066-\u2069\u200B\uFEFF]/u;
const RESERVED =
  /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

/** Every rule a single path component must follow on all three systems. */
function expectSafeComponent(name: string) {
  expect(name.length).toBeGreaterThan(0);
  expect(name).not.toMatch(FORBIDDEN);
  expect(name).not.toMatch(LONE_SURROGATE);
  expect(name).not.toMatch(/^[.\s]/);
  expect(name).not.toMatch(/[.\s]$/);
  expect(name).not.toBe(".");
  expect(name).not.toBe("..");
  expect(RESERVED.test(name.split(".")[0].trimEnd())).toBe(false);
  expect(utf8Bytes(name)).toBeLessThanOrEqual(MAX_NAME_BYTES);
  expect(name).toBe(name.normalize("NFC"));
}

describe("cleanFileStem", () => {
  const cases: Array<[string, string]> = [
    ["Q4 plan", "Q4 plan"],
    ["Q4: plan / draft", "Q4 plan draft"],
    ['a<b>c:d"e/f\\g|h?i*j', "a b c d e f g h i j"],
    ["../../etc/passwd", "etc passwd"],
    ["..", "Untitled"],
    [".", "Untitled"],
    ["", "Untitled"],
    ["   ", "Untitled"],
    ["???", "Untitled"],
    [".hidden", "hidden"],
    ["trailing dots...", "trailing dots"],
    ["trailing spaces   ", "trailing spaces"],
    ["CON", "CON_"],
    ["con", "con_"],
    ["Com1", "Com1_"],
    ["LPT¹", "LPT¹_"],
    ["nul.tar.gz", "nul_.tar.gz"],
    ["aux .txt", "aux_ .txt"],
    ["CONIN$", "CONIN$_"],
    ["Console", "Console"],
    ["C:\\Windows\\System32", "C Windows System32"],
    ["line\nbreak\ttab", "line break tab"],
    ["\u0000nul\u001fctl\u007fdel\u0085c1", "nul ctl del c1"],
    ["evil\u202Egnp.exe", "evil gnp.exe"],
    ["zero\u200Bwidth\uFEFF", "zero width"],
    ["e\u0301te\u0301", "été"],
    ["lone \uD800 surrogate", "lone surrogate"],
    ["سلام دنیا", "سلام دنیا"],
    ["👨‍👩‍👧 family", "👨‍👩‍👧 family"],
  ];
  for (const [title, expected] of cases) {
    it(`cleans ${JSON.stringify(title)}`, () => {
      const stem = cleanFileStem(title);
      expect(stem).toBe(expected);
      expectSafeComponent(stem);
    });
  }

  it("is idempotent", () => {
    for (const [title] of cases) {
      const once = cleanFileStem(title);
      expect(cleanFileStem(once)).toBe(once);
    }
  });
});

describe("fileName", () => {
  it("adds the short id and the extension", () => {
    expect(fileName("Q4 plan", { extension: "md", shortId: "a1b2c3" })).toBe(
      "Q4 plan-a1b2c3.md",
    );
    expect(fileName("Q4 plan", { extension: "md" })).toBe("Q4 plan.md");
  });

  it("keeps a reserved title safe once the id is added", () => {
    expect(fileName("CON", { extension: "md", shortId: "x1" })).toBe(
      "CON_-x1.md",
    );
  });

  it("caps a long title at 255 UTF-8 bytes and keeps the id and extension", () => {
    for (const unit of ["a", "é", "😀", "👨‍👩‍👧‍👦", "글"]) {
      const name = fileName(unit.repeat(300), {
        extension: "tinydoc",
        shortId: "abc123",
      });
      expect(utf8Bytes(name)).toBeLessThanOrEqual(MAX_NAME_BYTES);
      expect(name.endsWith("-abc123.tinydoc")).toBe(true);
      expectSafeComponent(name);
      // Cut between whole characters (grapheme clusters).
      const stem = name.slice(0, -"-abc123.tinydoc".length);
      expect(stem.replaceAll(unit, "")).toBe("");
    }
  });

  it("does not leave a trailing dot or space where it cuts", () => {
    // 252 bytes are left for the stem: the cut lands after ". ".
    const name = fileName(`${"a".repeat(250)}. bcdef`, { extension: "md" });
    expectSafeComponent(name);
    expect(name).toBe(`${"a".repeat(250)}.md`);
  });

  it("ends on a tiny budget, even for a reserved name", () => {
    expect(fileName("nul extra", { extension: "md", maxChars: 6 })).toBe(
      "nul_.md",
    );
    expect(fileName("...", { extension: "md", maxChars: 6 })).toBe("Unt.md");
  });

  it("honours a smaller character budget", () => {
    const name = fileName("x".repeat(100), { extension: "md", maxChars: 20 });
    expect(name).toBe(`${"x".repeat(17)}.md`);
  });
});

describe("uniqueName", () => {
  it("returns the name when it is free", () => {
    expect(uniqueName("Plan.md", new Set())).toBe("Plan.md");
  });

  it("adds (2), (3) before the extension", () => {
    const taken = new Set([nameKey("Plan.md"), nameKey("Plan (2).md")]);
    expect(uniqueName("Plan.md", taken)).toBe("Plan (3).md");
  });

  it("compares like macOS and Windows: ignoring case and normalisation", () => {
    const taken = new Set([nameKey("PLAN.MD"), nameKey("e\u0301te\u0301.md")]);
    expect(uniqueName("plan.md", taken)).toBe("plan (2).md");
    expect(uniqueName("été.md", taken)).toBe("été (2).md");
  });

  it("names folders (no extension) the same way", () => {
    expect(
      uniqueName("Vault", new Set([nameKey("vault")]), { folder: true }),
    ).toBe("Vault (2)");
    expect(
      uniqueName("v1.2", new Set([nameKey("v1.2")]), { folder: true }),
    ).toBe("v1.2 (2)");
  });

  it("stays within the length cap after adding the suffix", () => {
    const long = fileName("a".repeat(300), { extension: "md" });
    const name = uniqueName(long, new Set([nameKey(long)]));
    expect(name.endsWith(" (2).md")).toBe(true);
    expect(utf8Bytes(name)).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expectSafeComponent(name);
  });
});

describe("documentPath", () => {
  it("joins cleaned folder names and the file name with /", () => {
    expect(
      documentPath(["Work: 2026", "../Plans"], "Q4/plan", {
        extension: "md",
        shortId: "ab12",
      }),
    ).toBe("Work 2026/Plans/Q4 plan-ab12.md");
  });

  it("keeps the whole path within 240 characters", () => {
    const folders = Array.from({ length: 4 }, (_, i) => `${i}`.repeat(200));
    const path = documentPath(folders, "t".repeat(200), {
      extension: "tinydoc",
      shortId: "ab12cd",
    });
    expect(path.length).toBeLessThanOrEqual(MAX_PATH_CHARS);
    expect(path.endsWith("-ab12cd.tinydoc")).toBe(true);
    const parts = path.split("/");
    expect(parts).toHaveLength(5);
    for (const part of parts) expectSafeComponent(part);
  });

  it("leaves short paths alone", () => {
    expect(documentPath([], "Note", { extension: "md" })).toBe("Note.md");
  });
});

/** Deterministic random strings over hostile Unicode ranges. */
function* randomTitles(count: number): Generator<string> {
  let seed = 0x2f6b_1d3;
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) >>> 0;
    return seed;
  };
  const pools = [
    [0x00, 0x7f],
    [0x80, 0x9f],
    [0xa0, 0x24f],
    [0x0600, 0x06ff],
    [0x200b, 0x206f],
    [0xd800, 0xdfff],
    [0xfe00, 0xffff],
    [0x1f300, 0x1faff],
  ];
  const specials = [".", " ", "..", "/", "\\", ":", "CON", "nul", "COM1", "*"];
  for (let i = 0; i < count; i += 1) {
    let title = "";
    const length = next() % 300;
    for (let j = 0; j < length; j += 1) {
      if (next() % 8 === 0) {
        title += specials[next() % specials.length];
        continue;
      }
      const [low, high] = pools[next() % pools.length];
      title += String.fromCodePoint(low + (next() % (high - low + 1)));
    }
    yield title;
  }
}

describe("hostile titles (property)", () => {
  it("always give a safe component, path and unique name", () => {
    const taken = new Set<string>();
    for (const title of randomTitles(1_000)) {
      const stem = cleanFileStem(title);
      expectSafeComponent(stem);
      expect(cleanFileStem(stem)).toBe(stem);

      const name = uniqueName(
        fileName(title, { extension: "md", shortId: "z9" }),
        taken,
      );
      expectSafeComponent(name);
      expect(taken.has(nameKey(name))).toBe(false);
      taken.add(nameKey(name));

      const path = documentPath([title, title], title, { extension: "md" });
      expect(path.length).toBeLessThanOrEqual(MAX_PATH_CHARS);
      for (const part of path.split("/")) expectSafeComponent(part);
    }
  });
});
