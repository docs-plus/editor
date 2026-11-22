import { describe, expect, it } from "bun:test";

import {
  cardWidthPx,
  effectivePage,
  outlineDockMinPx,
  PAGE_WIDTHS,
  type PageState,
  PREFS_VERSION,
  parsePageSlot,
  parsePrefs,
  prefsAttributes,
  resolveBoot,
  stepTextSize,
  TEXT_SIZES,
  withKnob,
} from "@/lib/prefs/schema";

const CLASSIC: PageState = { style: "classic" };
const DEFAULT: PageState = { style: "default" };

describe("page slot", () => {
  it("keeps the style and valid knobs only", () => {
    expect(
      parsePageSlot({ style: "default", size: 18, width: "x", extra: 1 }),
    ).toEqual({ style: "default", size: 18 });
    expect(parsePageSlot({ style: "classic" })).toBeNull();
    expect(parsePageSlot(null)).toBeNull();
    expect(parsePageSlot([])).toBeNull();
  });

  it("resolves the style's knobs under the overrides", () => {
    expect(effectivePage(DEFAULT)).toEqual({
      size: 16,
      width: "standard",
      spacing: "normal",
    });
    expect(effectivePage({ style: "default", width: "full" })?.width).toBe(
      "full",
    );
    expect(effectivePage(CLASSIC)).toBeNull();
  });

  it("leaves classic for Default plus the change, and drops equal overrides", () => {
    expect(withKnob(CLASSIC, "size", 18)).toEqual({
      style: "default",
      size: 18,
    });
    expect(withKnob(CLASSIC, "size", 16)).toEqual({ style: "default" });
    expect(withKnob({ style: "default", size: 20 }, "size", 16)).toEqual({
      style: "default",
    });
    expect(withKnob(DEFAULT, "spacing", "relaxed")).toEqual({
      style: "default",
      spacing: "relaxed",
    });
  });

  it("steps text size along the ladder, from 15 in classic", () => {
    expect(stepTextSize(CLASSIC, 1)).toBe(16);
    expect(stepTextSize(CLASSIC, -1)).toBe(14);
    expect(stepTextSize(DEFAULT, 1)).toBe(18);
    expect(stepTextSize({ style: "default", size: 20 }, 1)).toBe(24);
    expect(stepTextSize({ style: "default", size: 32 }, 1)).toBe(32);
    expect(stepTextSize({ style: "default", size: 14 }, -1)).toBe(14);
  });
});

describe("outline docking (§5.9)", () => {
  it("keeps today's 950 px for classic", () => {
    expect(outlineDockMinPx(CLASSIC)).toBe(950);
  });

  it("matches the design's generated table", () => {
    const table: Record<string, number[]> = {
      narrow: [818, 878, 938, 998, 1118, 1238, 1358],
      standard: [860, 926, 992, 1058, 1190, 1322, 1454],
      wide: [1042, 1134, 1226, 1318, 1502, 1686, 1870],
    };
    for (const width of PAGE_WIDTHS) {
      TEXT_SIZES.forEach((size, index) => {
        const min = outlineDockMinPx({ style: "default", size, width });
        if (width === "full") expect(min).toBe(Number.POSITIVE_INFINITY);
        else expect(min).toBe(table[width][index]);
      });
    }
  });

  it("follows the browser's default text size", () => {
    expect(cardWidthPx(DEFAULT, 20)).toBe(780);
    expect(cardWidthPx(CLASSIC, 20)).toBe(648);
  });
});

describe("attributes", () => {
  it("writes overrides only, and the switches only when off", () => {
    const prefs = parsePrefs(
      {
        page: { style: "default", size: 24, width: "full" },
        a11y: { contrast: "more", motion: "system" },
        spellcheck: false,
      },
      "new",
    );
    expect(prefsAttributes(prefs)).toEqual({
      "data-page-style": "default",
      "data-text-size": "24",
      "data-page-width": "full",
      "data-contrast": "more",
      spellcheck: "false",
      "data-prefs": "1",
    });
  });

  it("classic writes only the style", () => {
    expect(prefsAttributes(parsePrefs({}, "classic"))).toEqual({
      "data-page-style": "classic",
      "data-prefs": "1",
    });
  });
});

describe("one validator for every store", () => {
  it("reads a desktop meta('prefs') payload, ignoring what it doesn't know", () => {
    expect(
      parsePrefs({
        v: PREFS_VERSION,
        appearance: "system",
        zoom: 125,
        page: { style: "default", size: 18, width: "huge" },
        spellcheck: false,
        smartQuotes: "yes",
      }),
    ).toEqual({
      page: { style: "default", size: 18 },
      a11y: { contrast: "system", motion: "system" },
      spellcheck: false,
      smartQuotes: true,
      rememberPlace: true,
    });
  });

  it("reads a newer version's known fields instead of dropping them", () => {
    expect(
      parsePrefs({ v: PREFS_VERSION + 1, rememberPlace: false }).rememberPlace,
    ).toBe(false);
  });

  it("defaults everything for a missing or hostile payload", () => {
    expect(parsePrefs(null).page).toEqual({ style: "default" });
    expect(parsePrefs("x", "classic").page).toEqual({ style: "classic" });
  });
});

describe("migration matrix (§5.6)", () => {
  const boot = (
    seed: Record<string, string>,
    remember = true,
  ): ReturnType<typeof resolveBoot> =>
    resolveBoot({
      storage: {
        keys: Object.keys(seed),
        theme: seed["tinydocy-theme"] ?? null,
        ui: seed["tinydocy-ui"] ?? null,
        look: seed["tinydocy-look"] ?? null,
      },
      remember,
      systemDark: false,
    });

  it("a new browser gets System and the new look, written at once", () => {
    const result = boot({});
    expect(result.theme).toBe("system");
    expect(result.prefs.page).toEqual({ style: "default" });
    expect(result.writes).toEqual({
      "tinydocy-theme": "system",
      "tinydocy-look": "new",
    });
  });

  it("a returning browser keeps Light and classic", () => {
    const result = boot({ "tinydocy-tabs": "[]" });
    expect(result.theme).toBe("light");
    expect(result.prefs.page).toEqual({ style: "classic" });
  });

  it("an F3-era browser keeps its theme and gets classic", () => {
    const result = boot({ "tinydocy-theme": "dark" });
    expect(result.theme).toBe("dark");
    expect(result.prefs.page).toEqual({ style: "classic" });
    expect(result.writes).toEqual({ "tinydocy-look": "classic" });
  });

  it("the marker wins over later keys, and a chosen slot wins over it", () => {
    expect(
      boot({ "tinydocy-look": "new", "tinydocy-user": "{}" }).prefs.page,
    ).toEqual({ style: "default" });
    const chosen = JSON.stringify({
      v: 1,
      slots: { page: { last: { style: "default", size: 18 }, recent: [] } },
    });
    expect(
      boot({ "tinydocy-look": "classic", "tinydocy-ui": chosen }).prefs.page,
    ).toEqual({ style: "default", size: 18 });
  });

  it("the kill switch shows classic, ignores slots and writes no marker", () => {
    const chosen = JSON.stringify({
      v: 1,
      slots: {
        page: { last: { style: "default", size: 18 }, recent: [] },
        rememberPlace: { last: true, recent: [] },
      },
    });
    const result = boot({ "tinydocy-ui": chosen }, false);
    expect(result.prefs.page).toEqual({ style: "classic" });
    expect(result.prefs.rememberPlace).toBe(false);
    expect(result.writes).toEqual({ "tinydocy-theme": "light" });
  });
});
