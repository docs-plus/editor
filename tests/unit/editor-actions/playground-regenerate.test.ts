/**
 * "Regenerate Playground" in the Alt+/ palette: the keyboard path to the
 * Playground tab's Regenerate button (which is not a Tab stop), offered only
 * in the Playground's editor and never bound to a key (⌘⇧R is Align right).
 */
import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";

import { buildPaletteSections } from "@/components/smart-toolbar/palette/palette-sections";
import { editorActions } from "@/lib/editor-actions";
import {
  isPlaygroundEditor,
  markPlaygroundEditor,
} from "@/lib/editor-actions/playground";
import { availability, runAction } from "@/lib/editor-actions/registry";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
import { onUiIntent } from "@/lib/editor-actions/ui-intents";
import { computeContext } from "@/lib/editor-context/snapshot";

import { createTestEditor } from "../../helpers/create-test-editor";

const ID = "view.regeneratePlayground";

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function make(): Editor {
  editor = createTestEditor({
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ],
    },
  });
  return editor;
}

const action = () => {
  const found = editorActions.get(ID);
  if (!found) throw new Error(`${ID} is not registered`);
  return found;
};

const paletteIds = (target: Editor) =>
  buildPaletteSections({
    ctx: computeContext(target),
    actions: editorActions.list(),
    recentKeys: [],
  }).flatMap((section) =>
    section.items.map((item) => `${section.heading}:${item.actionId}`),
  );

describe("Regenerate Playground", () => {
  it("is a View action with no key", () => {
    expect(action().label).toBe("Regenerate Playground");
    expect(action().group).toBe("view");
    expect(action().shortcut).toBeUndefined();
  });

  it("is offered only in an editor marked as the Playground's", () => {
    const target = make();
    expect(isPlaygroundEditor(target)).toBe(false);
    expect(action().offered?.(computeContext(target))).toBe(false);

    const unmark = markPlaygroundEditor(target);
    expect(isPlaygroundEditor(target)).toBe(true);
    expect(action().offered?.(computeContext(target))).toBe(true);

    unmark();
    expect(isPlaygroundEditor(target)).toBe(false);
  });

  it("is listed in the palette's View group on the Playground only", () => {
    const target = make();
    expect(paletteIds(target)).not.toContain(`View:${ID}`);
    markPlaygroundEditor(target);
    expect(paletteIds(target)).toContain(`View:${ID}`);
  });

  it("asks the shell to regenerate", () => {
    const target = make();
    markPlaygroundEditor(target);
    const intents: string[] = [];
    onUiIntent(target, (intent) => {
      intents.push(intent.type);
      return intent.type === "playground.regenerate";
    });
    expect(runAction(target, action())).toBe(true);
    expect(intents).toEqual(["playground.regenerate"]);
  });

  it("is refused in a read-only document", () => {
    const target = make();
    markPlaygroundEditor(target);
    target.setEditable(false);
    expect(availability(action(), computeContext(target))).toEqual({
      reason: READ_ONLY_REASON,
    });
  });
});
