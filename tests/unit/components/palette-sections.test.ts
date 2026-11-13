import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";

import {
  buildPaletteSections,
  PALETTE_GROUP_OF,
  PALETTE_HEADINGS,
} from "@/components/smart-toolbar/palette/palette-sections";
import {
  rememberBundle,
  resetBundleMemoryForTests,
} from "@/extensions/repeat-formatting/bundle-memory";
import { coreActions } from "@/lib/editor-actions/core-actions";
import {
  ACTION_GROUPS,
  type AnyAction,
  READ_ONLY_REASON,
} from "@/lib/editor-actions/types";
import { v11Actions } from "@/lib/editor-actions/v11-actions";
import { computeContext } from "@/lib/editor-context/snapshot";

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
    expect(suggested?.items.map((i) => i.label)).toContain(
      "Repeat formatting: B",
    );
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

  it("opens Format with Repeat, Copy formatting and Your formats; Undo and Redo get their own group", () => {
    const ed = setup();
    rememberBundle({ bold: true });
    ed.commands.setTextSelection({ from: 18, to: 23 });
    const sections = buildPaletteSections({
      ctx: computeContext(ed),
      actions: [...coreActions, ...v11Actions],
      recentKeys: [],
    });
    const format = sections.find((s) => s.heading === "Format");
    expect(format?.items.slice(0, 2).map((i) => i.actionId)).toEqual([
      "repeat.apply",
      "repeat.copy",
    ]);
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
