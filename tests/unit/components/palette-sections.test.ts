import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";

import { PALETTE_RECENT_CHOICE } from "@/components/smart-toolbar/palette/palette-recent";
import {
  buildPaletteSections,
  MAX_SUGGESTED,
  PALETTE_GROUP_OF,
  PALETTE_HEADINGS,
  recentKeyOf,
} from "@/components/smart-toolbar/palette/palette-sections";
import {
  rememberBundle,
  resetBundleMemoryForTests,
} from "@/extensions/repeat-formatting/bundle-memory";
import { coreActions } from "@/lib/editor-actions/core-actions";
import { surfaceActions } from "@/lib/editor-actions/surface-actions";
import {
  ACTION_GROUPS,
  type AnyAction,
  READ_ONLY_REASON,
} from "@/lib/editor-actions/types";
import { v11Actions } from "@/lib/editor-actions/v11-actions";
import { computeContext } from "@/lib/editor-context/snapshot";
import {
  removeFormat,
  resetSavedFormatsCacheForTests,
  saveFormat,
} from "@/lib/saved-formats";

import { createTestEditor } from "../../helpers/create-test-editor";
// The E action bodies are a lazy chunk in the app; install them here.
import "@/lib/editor-actions/v11-engine";

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  resetBundleMemoryForTests();
});

function setup(): Editor {
  editor = createTestEditor({
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Section" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
      ],
    },
  });
  return editor;
}

const fake = (overrides: Partial<AnyAction>): AnyAction => ({
  id: "section.fold",
  label: "Fold section",
  group: "section",
  contexts: ["heading"],
  enabled: () => true,
  run: () => true,
  ...overrides,
});

const ACTIONS: AnyAction[] = [
  fake({
    id: "mark.bold",
    label: "Bold",
    group: "mark",
    contexts: "any",
    shortcut: "Mod-b",
  }),
  fake({ id: "section.fold", label: "Fold section" }),
  fake({ id: "section.moveUp", label: "Move section up" }),
  fake({
    id: "size.increase",
    label: "Larger text",
    group: "size",
    contexts: "any",
    enabled: () => ({ reason: "Headings scale automatically." }),
  }),
  fake({
    id: "view.outline",
    label: "Toggle outline",
    group: "view",
    contexts: "any",
    mutates: false,
  }),
  ...v11Actions,
];

function sectionsAt(pos: number, recentKeys: string[] = []) {
  const ed = editor ?? setup();
  ed.commands.setTextSelection(pos);
  return buildPaletteSections({
    ctx: computeContext(ed),
    actions: ACTIONS,
    recentKeys,
  });
}

describe("buildPaletteSections", () => {
  it("maps every action group to a heading", () => {
    for (const group of ACTION_GROUPS)
      expect(PALETTE_GROUP_OF[group]).toBeDefined();
  });

  it("orders headings and puts Recent first", () => {
    const sections = sectionsAt(10, ["mark.bold", "nope.unknown"]);
    const headings = sections.map((s) => s.heading);
    expect(headings).toEqual(
      PALETTE_HEADINGS.filter((h) => headings.includes(h)),
    );
    expect(sections[0].heading).toBe("Recent");
    expect(sections[0].items.map((i) => i.actionId)).toEqual(["mark.bold"]);
    const format = sections.find((s) => s.heading === "Format");
    expect(format?.items.some((i) => i.actionId === "mark.bold")).toBe(true);
  });

  it("suggests the slot's actions for the context kind", () => {
    const heading = sectionsAt(10).find((s) => s.heading === "Suggested here");
    expect(heading?.items.map((i) => i.actionId)).toEqual([
      "section.fold",
      "section.moveUp",
    ]);
    const paragraph = sectionsAt(20).find(
      (s) => s.heading === "Suggested here",
    );
    expect(paragraph).toBeUndefined();
  });

  it("suggests Repeat once a bundle exists and text is selected", () => {
    const ed = setup();
    rememberBundle({ bold: true });
    ed.commands.setTextSelection({ from: 18, to: 23 });
    const sections = buildPaletteSections({
      ctx: computeContext(ed),
      actions: ACTIONS,
      recentKeys: [],
    });
    const suggested = sections.find((s) => s.heading === "Suggested here");
    const repeat = suggested?.items.find((i) => i.actionId === "repeat.apply");
    // Named by the action alone; what it applies is the second line.
    expect(repeat?.label).toBe("Repeat formatting");
    expect(repeat?.detail).toBe("Bold");
  });

  it("never repeats a suggested action in its home group", () => {
    const sections = sectionsAt(10);
    const suggested = sections.find((s) => s.heading === "Suggested here");
    const ids = new Set(suggested?.items.map((i) => i.actionId));
    expect(ids.size).toBeGreaterThan(0);
    const home = sections.filter(
      (s) => s.heading !== "Suggested here" && s.heading !== "Recent",
    );
    for (const section of home) {
      for (const item of section.items) {
        expect(ids.has(item.actionId)).toBe(false);
      }
    }
  });

  it("suggests at most four entries", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      fake({ id: `section.extra${i}`, label: `Extra ${i}` }),
    );
    const ed = setup();
    ed.commands.setTextSelection(10);
    const suggested = buildPaletteSections({
      ctx: computeContext(ed),
      actions: [...ACTIONS, ...many],
      recentKeys: [],
    }).find((s) => s.heading === "Suggested here");
    expect(suggested?.items).toHaveLength(MAX_SUGGESTED);
    expect(MAX_SUGGESTED).toBe(4);
  });

  it("names colour rows once, with a chip, and puts formats in Your formats", () => {
    const ed = setup();
    ed.commands.setTextSelection({ from: 18, to: 23 });
    const sections = buildPaletteSections({
      ctx: computeContext(ed),
      actions: [...coreActions, ...surfaceActions, ...v11Actions],
      recentKeys: [],
    });
    const items = sections.flatMap((s) => s.items);
    const orange = items.find((i) => i.key === "color.text.apply:orange");
    expect(orange?.label).toBe("Orange text");
    expect(orange?.swatch).toEqual({ kind: "text", token: "orange" });
    const yellow = items.find((i) => i.key === "color.highlight.apply:yellow");
    expect(yellow?.label).toBe("Yellow highlight");
    expect(yellow?.swatch).toEqual({ kind: "highlight", token: "yellow" });
    const yours = sections.find((s) => s.heading === "Your formats");
    expect(yours?.items.map((i) => i.actionId).sort()).toEqual([
      "formats.apply",
      "formats.save",
    ]);
    const format = sections.find((s) => s.heading === "Format");
    expect(format?.items.some((i) => i.actionId.startsWith("formats."))).toBe(
      false,
    );
    // Registry icons fill the leading slot.
    expect(items.find((i) => i.actionId === "mark.bold")?.icon).toBeDefined();
  });

  it("gives each Your formats row its bundle for the chip", () => {
    const saved = saveFormat("Warning", { bold: true, textColor: "red" });
    if (!saved.ok) throw new Error(saved.reason);
    try {
      const ed = setup();
      ed.commands.setTextSelection({ from: 18, to: 23 });
      const yours = buildPaletteSections({
        ctx: computeContext(ed),
        actions: v11Actions,
        recentKeys: [],
      }).find((s) => s.heading === "Your formats");
      const row = yours?.items.find((i) => i.label === "Warning");
      expect(row?.bundle).toEqual({ bold: true, textColor: "red" });
      expect(row?.swatch).toBeUndefined();
    } finally {
      removeFormat(saved.format.id);
      resetSavedFormatsCacheForTests();
    }
  });

  describe("Restore ‘X’ after a removal", () => {
    afterEach(() => {
      resetSavedFormatsCacheForTests();
      localStorage.clear();
    });

    const sectionsNow = () => {
      const ed = editor ?? setup();
      ed.commands.setTextSelection({ from: 18, to: 23 });
      return buildPaletteSections({
        ctx: computeContext(ed),
        actions: [...coreActions, ...surfaceActions, ...v11Actions],
        recentKeys: [],
      });
    };
    const restoreRows = (sections: ReturnType<typeof sectionsNow>) =>
      sections
        .flatMap((s) => s.items.map((i) => ({ ...i, heading: s.heading })))
        .filter((i) => i.actionId === "formats.restore");

    it("is nowhere until a format is removed", () => {
      expect(restoreRows(sectionsNow())).toEqual([]);
    });

    it("leads Suggested here, bare, with the format's chip, and only there", () => {
      const saved = saveFormat("Warning", { bold: true });
      if (!saved.ok) throw new Error(saved.reason);
      removeFormat(saved.format.id);
      const sections = sectionsNow();
      const rows = restoreRows(sections);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        heading: "Suggested here",
        label: "Restore ‘Warning’",
        arg: saved.format.id,
        bundle: { bold: true },
      });
      expect(rows[0].disabledReason).toBeUndefined();
      const suggested = sections.find((s) => s.heading === "Suggested here");
      expect(suggested?.items[0]?.actionId).toBe("formats.restore");
      // Never kept in Recent: its key is no action id.
      expect(PALETTE_RECENT_CHOICE.validate(recentKeyOf(rows[0]))).toBe(false);
    });

    it("names only the last removal, and goes once the format is back", () => {
      const one = saveFormat("One", { bold: true });
      const two = saveFormat("Two", { italic: true });
      if (!one.ok || !two.ok) throw new Error("save failed");
      removeFormat(one.format.id);
      removeFormat(two.format.id);
      expect(restoreRows(sectionsNow()).map((r) => r.label)).toEqual([
        "Restore ‘Two’",
      ]);
      // The pill's Undo (or the palette's run) puts it back.
      const restore = v11Actions.find((a) => a.id === "formats.restore");
      expect(restore?.run(editor as Editor, two.format.id)).toBe(true);
      expect(restoreRows(sectionsNow())).toEqual([]);
    });

    it("says why when the name came back meanwhile", () => {
      const saved = saveFormat("Note", { bold: true });
      if (!saved.ok) throw new Error(saved.reason);
      removeFormat(saved.format.id);
      saveFormat("Note", { italic: true });
      const rows = restoreRows(sectionsNow());
      expect(rows[0]?.disabledReason).toBe(
        "‘Note’ is in Your formats already.",
      );
    });
  });

  it("keeps disabled entries with their reason", () => {
    const format = sectionsAt(10).find((s) => s.heading === "Format");
    const larger = format?.items.find((i) => i.actionId === "size.increase");
    expect(larger?.disabledReason).toBe("Headings scale automatically.");
  });

  it("lists runnable entries before unavailable ones in every group, so the default highlight runs", () => {
    const sections = sectionsAt(10, ["size.increase", "mark.bold"]);
    expect(sections[0]?.heading).toBe("Recent");
    expect(sections[0]?.items.map((i) => i.actionId)).toEqual([
      "mark.bold",
      "size.increase",
    ]);
    for (const section of sections) {
      const flags = section.items.map((i) => Boolean(i.disabledReason));
      expect(flags).toEqual([...flags].sort((a, b) => Number(a) - Number(b)));
    }
    const first = sections[0]?.items[0];
    expect(first?.disabledReason).toBeUndefined();
  });

  it("refuses mutating actions in a read-only document but keeps view actions", () => {
    const ed = setup();
    ed.setEditable(false);
    const sections = buildPaletteSections({
      ctx: computeContext(ed),
      actions: ACTIONS,
      recentKeys: [],
    });
    const items = sections.flatMap((s) => s.items);
    expect(items.find((i) => i.actionId === "mark.bold")?.disabledReason).toBe(
      READ_ONLY_REASON,
    );
    expect(
      items.find((i) => i.actionId === "view.outline")?.disabledReason,
    ).toBeUndefined();
  });

  it("lists option rows (templates) under Insert and never lists itself", () => {
    const sections = sectionsAt(20);
    const insert = sections.find((s) => s.heading === "Insert");
    expect(insert?.items.map((i) => i.label)).toContain(
      "Insert diagram: Pie chart",
    );
    const all = sections.flatMap((s) => s.items);
    expect(all.some((i) => i.actionId === "palette.open")).toBe(false);
    const keys = all.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("opens Format with Repeat and Paint format (Copy formatting) unless suggested; Undo and Redo get their own group", () => {
    const ed = setup();
    rememberBundle({ bold: true });
    ed.commands.setTextSelection({ from: 18, to: 23 });
    const sections = buildPaletteSections({
      ctx: computeContext(ed),
      actions: [...coreActions, ...v11Actions],
      recentKeys: [],
    });
    // Repeat can run here, so it is suggested and not repeated in Format.
    const suggested = sections.find((s) => s.heading === "Suggested here");
    expect(suggested?.items[0]?.actionId).toBe("repeat.apply");
    const format = sections.find((s) => s.heading === "Format");
    expect(format?.items[0]?.actionId).toBe("repeat.copy");
    ed.commands.setTextSelection(20);
    const caret = buildPaletteSections({
      ctx: computeContext(ed),
      actions: [...coreActions, ...v11Actions],
      recentKeys: [],
    }).find((s) => s.heading === "Format");
    // Unavailable at a caret: Repeat stays home, last of its group.
    expect(caret?.items.map((i) => i.actionId)).toContain("repeat.apply");
    expect(format?.items.some((i) => i.actionId.startsWith("history."))).toBe(
      false,
    );
    const history = sections.find((s) => s.heading === "History");
    expect(history?.items.map((i) => i.actionId).sort()).toEqual([
      "history.redo",
      "history.undo",
    ]);
    expect(sections.at(-1)?.heading).toBe("History");
  });

  it("does not suggest Repeat when what it would apply is plain, and says so", () => {
    const ed = setup();
    rememberBundle({ bold: false, italic: false, textColor: null });
    ed.commands.setTextSelection({ from: 18, to: 23 });
    const sections = buildPaletteSections({
      ctx: computeContext(ed),
      actions: [...coreActions, ...v11Actions],
      recentKeys: [],
    });
    const suggested = sections.find((s) => s.heading === "Suggested here");
    expect(
      suggested?.items.some((i) => i.actionId === "repeat.apply") ?? false,
    ).toBe(false);
    const repeat = sections
      .find((s) => s.heading === "Format")
      ?.items.find((i) => i.actionId === "repeat.apply");
    expect(repeat?.disabledReason).toBeUndefined();
    expect(repeat?.detail).toBe("Plain (removes formatting)");
  });

  it("names style and align rows by their own target, marking the current one", () => {
    const ed = setup();
    ed.commands.setTextSelection(20);
    const items = buildPaletteSections({
      ctx: computeContext(ed),
      actions: coreActions,
      recentKeys: [],
    }).flatMap((s) => s.items);
    const byKey = (key: string) => items.find((i) => i.key === key);
    expect(byKey("style.heading1")?.label).toBe("Heading 1");
    expect(byKey("style.heading1")?.current).toBeUndefined();
    expect(byKey("style.paragraph")?.label).toBe("Normal text");
    expect(byKey("style.paragraph")?.current).toBe(true);
    expect(byKey("align.center")?.label).toBe("Align center");
    expect(byKey("align.center")?.current).toBeUndefined();
    expect(byKey("align.left")?.current).toBe(true);
  });
});
