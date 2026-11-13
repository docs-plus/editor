import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  type ChoiceSpec,
  forgetChoices,
  HIGHLIGHT_CHOICE,
  INSERT_KIND_CHOICE,
  isTableSize,
  OUTLINE_OPEN_CHOICE,
  RECENT_COLORS_CHOICE,
  type RecentColor,
  readChoice,
  rememberChoice,
  STORAGE_KEYS,
  STORAGE_VERSION,
  subscribeChoices,
  TABLE_SIZE_CHOICE,
  TEXT_COLOR_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";
import { isTextColorToken, type TextColorToken } from "@/lib/text-style-tokens";
import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const TEXT: ChoiceSpec<TextColorToken> = {
  slot: "textColor",
  maxRecent: 3,
  validate: isTextColorToken,
  fallback: "red",
};

const choicesRaw = () => localStorage.getItem(STORAGE_KEYS.choices);
const setRaw = (key: string, value: string) => localStorage.setItem(key, value);

beforeEach(() => localStorage.clear());

describe("remembered choices: read and write", () => {
  it("falls back when nothing is stored", () => {
    expect(readChoice(TEXT)).toEqual({ last: "red", recent: [] });
  });

  it("remembers last and recent, newest first, deduplicated, capped", () => {
    for (const token of ["blue", "green", "blue", "pink", "teal"] as const) {
      rememberChoice(TEXT, token);
    }
    expect(readChoice(TEXT)).toEqual({
      last: "teal",
      recent: ["teal", "pink", "blue"],
    });
  });

  it("stores a versioned payload under the slot's key", () => {
    rememberChoice(TEXT, "blue");
    expect(JSON.parse(choicesRaw() ?? "null")).toEqual({
      v: STORAGE_VERSION,
      slots: { textColor: { last: "blue", recent: ["blue"] } },
    });
  });

  it("merges slots that share a key instead of overwriting them", () => {
    rememberChoice(TEXT, "blue");
    rememberChoice(HIGHLIGHT_CHOICE, "yellow");
    expect(readChoice(TEXT).last).toBe("blue");
    expect(readChoice(HIGHLIGHT_CHOICE).last).toBe("yellow");
  });

  it("keeps ui slots under tinydocy-ui", () => {
    rememberChoice(OUTLINE_OPEN_CHOICE, false);
    expect(choicesRaw()).toBeNull();
    expect(readChoice(OUTLINE_OPEN_CHOICE).last).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.ui)).toContain('"outlineOpen"');
  });

  it("refuses to write a value its validator rejects", () => {
    rememberChoice(TEXT, "javascript:alert(1)" as TextColorToken);
    expect(choicesRaw()).toBeNull();
  });

  it("deduplicates object values by content", () => {
    const red: RecentColor = { kind: "text", token: "red" };
    rememberChoice(RECENT_COLORS_CHOICE, red);
    rememberChoice(RECENT_COLORS_CHOICE, { kind: "highlight", token: "red" });
    rememberChoice(RECENT_COLORS_CHOICE, { kind: "text", token: "red" });
    expect(readChoice(RECENT_COLORS_CHOICE).recent).toEqual([
      { kind: "text", token: "red" },
      { kind: "highlight", token: "red" },
    ]);
  });
});

describe("remembered choices: tamper resistance", () => {
  it.each([
    ["not JSON", "{oops"],
    ["null", "null"],
    ["an array", "[1,2]"],
    ["a string", '"red"'],
    ["slots not an object", '{"v":1,"slots":"x"}'],
  ])("discards %s", (_name, raw) => {
    setRaw(STORAGE_KEYS.choices, raw);
    expect(readChoice(TEXT)).toEqual({ last: "red", recent: [] });
    rememberChoice(TEXT, "blue");
    expect(readChoice(TEXT).last).toBe("blue");
  });

  it("discards a payload with another version", () => {
    setRaw(
      STORAGE_KEYS.choices,
      JSON.stringify({ v: 2, slots: { textColor: { last: "blue" } } }),
    );
    expect(readChoice(TEXT)).toEqual({ last: "red", recent: [] });
  });

  it("drops stored values that fail the validator", () => {
    setRaw(
      STORAGE_KEYS.choices,
      JSON.stringify({
        v: 1,
        slots: {
          textColor: {
            last: "url(x)",
            recent: ["blue", "<img>", 42, null, { token: "red" }, "green"],
          },
        },
      }),
    );
    expect(readChoice(TEXT)).toEqual({
      last: "red",
      recent: ["blue", "green"],
    });
  });

  it("caps an oversized recent list", () => {
    setRaw(
      STORAGE_KEYS.choices,
      JSON.stringify({
        v: 1,
        slots: {
          textColor: { last: "blue", recent: Array(5_000).fill("pink") },
        },
      }),
    );
    expect(readChoice(TEXT).recent).toEqual(["pink"]);
  });

  it("ignores a huge payload without parsing it", () => {
    setRaw(STORAGE_KEYS.choices, `{"v":1,"pad":"${"x".repeat(70_000)}"}`);
    expect(readChoice(TEXT)).toEqual({ last: "red", recent: [] });
  });

  it("never reads inherited properties as slots", () => {
    setRaw(
      STORAGE_KEYS.choices,
      '{"v":1,"slots":{"__proto__":{"textColor":{"last":"blue"}}}}',
    );
    expect(readChoice(TEXT).last).toBe("red");
    rememberChoice(TEXT, "green");
    expect(({} as Record<string, unknown>).textColor).toBeUndefined();
  });

  it("validates table sizes as small positive integers", () => {
    expect(isTableSize({ rows: 3, cols: 4 })).toBe(true);
    expect(isTableSize({ rows: 0, cols: 4 })).toBe(false);
    expect(isTableSize({ rows: 3.5, cols: 4 })).toBe(false);
    expect(isTableSize({ rows: 3, cols: 1e9 })).toBe(false);
    expect(isTableSize({ rows: "3", cols: 4 })).toBe(false);
    expect(readChoice(TABLE_SIZE_CHOICE).last).toEqual({ rows: 3, cols: 3 });
  });

  it("survives a storage that throws", () => {
    const original = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(readChoice(TEXT)).toEqual({ last: "red", recent: [] });
      expect(() => rememberChoice(TEXT, "blue")).not.toThrow();
      expect(() => forgetChoices()).not.toThrow();
    } finally {
      Storage.prototype.getItem = original;
      Storage.prototype.setItem = originalSet;
    }
  });
});

describe("M10: a fresh profile has no remembered Insert kind", () => {
  it("falls back to null, so the face stays '+ Insert'", () => {
    expect(readChoice(INSERT_KIND_CHOICE).last).toBeNull();
  });

  it("remembers a real kind", () => {
    rememberChoice(INSERT_KIND_CHOICE, "codeBlock");
    expect(readChoice(INSERT_KIND_CHOICE).last).toBe("codeBlock");
  });

  it("never stores null", () => {
    rememberChoice(INSERT_KIND_CHOICE, null);
    expect(localStorage.getItem(STORAGE_KEYS.choices)).toBeNull();
  });
});

describe("forget my choices", () => {
  it("clears tinydocy-choices and keeps ui and formats", () => {
    rememberChoice(TEXT, "blue");
    rememberChoice(OUTLINE_OPEN_CHOICE, false);
    setRaw(STORAGE_KEYS.formats, '{"v":1,"formats":[]}');
    forgetChoices();
    expect(choicesRaw()).toBeNull();
    expect(readChoice(TEXT).last).toBe("red");
    expect(readChoice(OUTLINE_OPEN_CHOICE).last).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.formats)).not.toBeNull();
  });
});

describe("change feed", () => {
  it("notifies in-tab writes and Forget, until unsubscribed", () => {
    let calls = 0;
    const off = subscribeChoices(() => calls++);
    rememberChoice(TEXT, "blue");
    forgetChoices();
    expect(calls).toBe(2);
    off();
    rememberChoice(TEXT, "pink");
    expect(calls).toBe(2);
  });

  it("forwards storage events for our keys only", () => {
    let calls = 0;
    const off = subscribeChoices(() => calls++);
    window.dispatchEvent(
      new StorageEvent("storage", { key: STORAGE_KEYS.choices }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(calls).toBe(2);
    off();
  });
});

let seen: { ready: boolean; last: TextColorToken }[] = [];

function Probe() {
  const choice = useRememberedChoice(TEXT);
  seen.push({ ready: choice.ready, last: choice.last });
  return null;
}

describe("useRememberedChoice", () => {
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    seen = [];
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => act(() => root.unmount()));

  it("starts not ready with the fallback, then reads storage", () => {
    rememberChoice(TEXT, "blue");
    act(() => root.render(createElement(Probe)));
    expect(seen[0]).toEqual({ ready: false, last: "red" });
    expect(seen.at(-1)).toEqual({ ready: true, last: "blue" });
  });

  it("updates on an in-tab write", () => {
    act(() => root.render(createElement(Probe)));
    act(() => rememberChoice(TEXT, "green"));
    expect(seen.at(-1)).toEqual({ ready: true, last: "green" });
  });

  it("updates on a storage event from another tab", () => {
    act(() => root.render(createElement(Probe)));
    // Another tab wrote: storage changed without an in-tab notify.
    setRaw(
      STORAGE_KEYS.choices,
      JSON.stringify({ v: 1, slots: { textColor: { last: "purple" } } }),
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: STORAGE_KEYS.choices }),
      );
    });
    expect(seen.at(-1)).toEqual({ ready: true, last: "purple" });
  });
});

describe("kill switch NEXT_PUBLIC_REMEMBER_CHOICES=0", () => {
  const previous = process.env.NEXT_PUBLIC_REMEMBER_CHOICES;
  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_REMEMBER_CHOICES;
    else process.env.NEXT_PUBLIC_REMEMBER_CHOICES = previous;
    resetModules();
  });

  it("reads fallbacks and writes nothing", async () => {
    rememberChoice(TEXT, "blue");
    process.env.NEXT_PUBLIC_REMEMBER_CHOICES = "0";
    const memory = await importFresh<typeof import("@/lib/remembered-choice")>(
      "@/lib/remembered-choice",
    );
    expect(memory.REMEMBER_CHOICES_ENABLED).toBe(false);
    expect(memory.readChoice(TEXT).last).toBe("red");
    memory.rememberChoice(TEXT, "green");
    expect(readChoice(TEXT).last).toBe("blue");
    expect(TEXT_COLOR_CHOICE.slot).toBe("textColor");
  });
});
