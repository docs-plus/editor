import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

import {
  BUBBLE_ACTION_IDS,
  type BubbleView,
  chooseBubblePlacement,
  clearsBubbleSuppression,
  isBubbleDismissKey,
  shouldShowBubble,
} from "@/components/smart-toolbar/bubble/bubble-rules";
import { editorActions } from "@/lib/editor-actions";

import { createTestEditor } from "../../helpers/create-test-editor";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

const DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
    {
      type: "paragraph",
      content: [
        text("plain "),
        text("linked", [
          { type: "hyperlink", attrs: { href: "https://example.com" } },
        ]),
        text(" tail"),
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "js" },
      content: [text("const a = 1;")],
    },
    {
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [text("graph TD; A-->B")],
    },
    { type: "horizontalRule" },
    { type: "paragraph", content: [text("after")] },
  ],
};

/** Position of the first occurrence of `needle` in the document text. */
function posOf(ed: Editor, needle: string, nth = 0): number {
  let found = -1;
  let seen = 0;
  ed.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0;
    const index = node.text?.indexOf(needle) ?? -1;
    if (index >= 0) {
      if (seen === nth) found = pos + index;
      seen += 1;
    }
    return found < 0;
  });
  if (found < 0) throw new Error(`"${needle}" not in doc`);
  return found;
}

function viewFor(
  ed: Editor,
  { editable = true, focused = true } = {},
): BubbleView {
  return {
    state: ed.state,
    editable,
    hasFocus: () => focused,
  };
}

function select(ed: Editor, from: number, to: number) {
  ed.view.dispatch(
    ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)),
  );
}

describe("shouldShowBubble", () => {
  it("checks emptiness before reading anything else", () => {
    editor = createTestEditor({ content: DOC });
    const state = editor.state;
    const view = {
      state,
      get editable(): boolean {
        throw new Error("read editable");
      },
      hasFocus: () => {
        throw new Error("read focus");
      },
    } as BubbleView;
    expect(shouldShowBubble(view, document.createElement("div"), false)).toBe(
      false,
    );
  });

  const root = () => document.createElement("div");

  it("shows for a focused text range", () => {
    editor = createTestEditor({ content: DOC });
    const from = posOf(editor, "plain");
    select(editor, from, from + 5);
    expect(shouldShowBubble(viewFor(editor), root(), false)).toBe(true);
  });

  it("hides when read-only", () => {
    editor = createTestEditor({ content: DOC });
    const from = posOf(editor, "plain");
    select(editor, from, from + 5);
    expect(
      shouldShowBubble(viewFor(editor, { editable: false }), root(), false),
    ).toBe(false);
  });

  it("hides while suppressed", () => {
    editor = createTestEditor({ content: DOC });
    const from = posOf(editor, "plain");
    select(editor, from, from + 5);
    expect(shouldShowBubble(viewFor(editor), root(), true)).toBe(false);
  });

  it("hides when neither the editor nor the bubble has focus", () => {
    editor = createTestEditor({ content: DOC });
    const from = posOf(editor, "plain");
    select(editor, from, from + 5);
    expect(
      shouldShowBubble(viewFor(editor, { focused: false }), root(), false),
    ).toBe(false);
  });

  it("stays while focus is inside the bubble", () => {
    editor = createTestEditor({ content: DOC });
    const from = posOf(editor, "plain");
    select(editor, from, from + 5);
    const el = root();
    const button = document.createElement("button");
    el.appendChild(button);
    document.body.appendChild(el);
    button.focus();
    try {
      expect(
        shouldShowBubble(viewFor(editor, { focused: false }), el, false),
      ).toBe(true);
    } finally {
      el.remove();
    }
  });

  it("stays while the bubble's own popover is open (it portals to body)", () => {
    editor = createTestEditor({ content: DOC });
    const from = posOf(editor, "plain");
    select(editor, from, from + 5);
    const el = root();
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("data-popup-open", "");
    el.appendChild(trigger);
    expect(
      shouldShowBubble(viewFor(editor, { focused: false }), el, false),
    ).toBe(true);
  });

  it("does not stay for an open tooltip alone", () => {
    editor = createTestEditor({ content: DOC });
    const from = posOf(editor, "plain");
    select(editor, from, from + 5);
    const el = root();
    // Base UI marks a tooltip trigger `data-popup-open` too.
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("data-popup-open", "");
    el.appendChild(trigger);
    expect(
      shouldShowBubble(viewFor(editor, { focused: false }), el, false),
    ).toBe(false);
  });

  it("hides for a node selection", () => {
    editor = createTestEditor({ content: DOC });
    let hrPos = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "horizontalRule") hrPos = offset;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, hrPos),
      ),
    );
    expect(shouldShowBubble(viewFor(editor), root(), false)).toBe(false);
  });

  it("hides inside a code block", () => {
    editor = createTestEditor({ content: DOC });
    const from = posOf(editor, "const");
    select(editor, from, from + 5);
    expect(shouldShowBubble(viewFor(editor), root(), false)).toBe(false);
  });

  it("hides inside a Mermaid block", () => {
    editor = createTestEditor({ content: DOC });
    const from = posOf(editor, "graph");
    select(editor, from, from + 5);
    expect(shouldShowBubble(viewFor(editor), root(), false)).toBe(false);
  });

  it("hides when a range ends in a code block", () => {
    editor = createTestEditor({ content: DOC });
    select(editor, posOf(editor, "tail"), posOf(editor, "const") + 3);
    expect(shouldShowBubble(viewFor(editor), root(), false)).toBe(false);
  });

  it("hides inside one hyperlink", () => {
    editor = createTestEditor({ content: DOC });
    const from = posOf(editor, "linked");
    select(editor, from + 1, from + 4);
    expect(shouldShowBubble(viewFor(editor), root(), false)).toBe(false);
  });

  it("hides for exactly the whole hyperlink", () => {
    editor = createTestEditor({ content: DOC });
    const from = posOf(editor, "linked");
    select(editor, from, from + "linked".length);
    expect(shouldShowBubble(viewFor(editor), root(), false)).toBe(false);
  });

  it("shows across a hyperlink and plain text", () => {
    editor = createTestEditor({ content: DOC });
    select(editor, posOf(editor, "plain"), posOf(editor, "linked") + 3);
    expect(shouldShowBubble(viewFor(editor), root(), false)).toBe(true);
  });

  it("hides for a range with no text (across block boundaries only)", () => {
    editor = createTestEditor({ content: DOC });
    const hrEnd = posOf(editor, "after");
    // From the end of the Mermaid block to the start of "after": no text.
    select(editor, posOf(editor, "B", 0) + "B".length, hrEnd);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe("");
    expect(shouldShowBubble(viewFor(editor), root(), false)).toBe(false);
  });
});

describe("isBubbleDismissKey", () => {
  it.each([
    ["Escape", {}, true],
    ["a", {}, true],
    ["Backspace", {}, true],
    ["Enter", {}, true],
    ["Tab", {}, true],
    ["A", { shiftKey: true }, true],
    ["ArrowRight", { shiftKey: true }, false],
    ["ArrowLeft", {}, false],
    ["Shift", { shiftKey: true }, false],
    ["Control", { ctrlKey: true }, false],
    ["Alt", { altKey: true }, false],
    ["Meta", { metaKey: true }, false],
    ["b", { metaKey: true }, false],
    ["b", { ctrlKey: true }, false],
    ["F10", { altKey: true }, false],
    ["F10", {}, false],
    ["Home", {}, false],
    ["End", { shiftKey: true }, false],
    ["PageDown", {}, false],
  ] as const)("%s %o -> %s", (key, mods, expected) => {
    expect(
      isBubbleDismissKey(new KeyboardEvent("keydown", { key, ...mods })),
    ).toBe(expected);
  });
});

describe("clearsBubbleSuppression", () => {
  it.each([
    ["ArrowRight", { shiftKey: true }, true],
    ["Home", { shiftKey: true }, true],
    ["a", { metaKey: true }, true],
    ["a", { ctrlKey: true }, true],
    ["ArrowRight", {}, false],
    ["b", { metaKey: true }, false],
    ["a", {}, false],
  ] as const)("%s %o -> %s", (key, mods, expected) => {
    expect(
      clearsBubbleSuppression(new KeyboardEvent("keydown", { key, ...mods })),
    ).toBe(expected);
  });
});

describe("chooseBubblePlacement", () => {
  const selection = { top: 300, bottom: 320, left: 100, right: 200 };
  const bubble = { width: 160, height: 36 };

  it("places above by default", () => {
    expect(
      chooseBubblePlacement({ selection, bubble, obstacles: [], topLimit: 52 }),
    ).toBe("top");
  });

  it("flips below under the sticky toolbar", () => {
    expect(
      chooseBubblePlacement({
        selection,
        bubble,
        obstacles: [],
        topLimit: 280,
      }),
    ).toBe("bottom");
  });

  it("flips below a remote caret label in the band", () => {
    expect(
      chooseBubblePlacement({
        selection,
        bubble,
        obstacles: [{ top: 270, bottom: 288, left: 120, right: 180 }],
        topLimit: 52,
      }),
    ).toBe("bottom");
  });

  it("ignores a label elsewhere on the line", () => {
    expect(
      chooseBubblePlacement({
        selection,
        bubble,
        obstacles: [{ top: 270, bottom: 288, left: 600, right: 650 }],
        topLimit: 52,
      }),
    ).toBe("top");
  });

  it("ignores a label touching the band edge only", () => {
    expect(
      chooseBubblePlacement({
        selection,
        bubble,
        obstacles: [{ top: 230, bottom: 256, left: 120, right: 180 }],
        topLimit: 52,
      }),
    ).toBe("top");
  });
});

describe("BUBBLE_ACTION_IDS", () => {
  it("names registry actions that exist, so every bubble action is also in the row", () => {
    for (const id of BUBBLE_ACTION_IDS) {
      expect(editorActions.get(id)?.id).toBe(id);
    }
  });
});
