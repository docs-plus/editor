import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Mermaid } from "@docs.plus/extension-mermaid";
import type { Editor, Extension, JSONContent } from "@tiptap/core";
import { Typography } from "@tiptap/extension-typography";
import type { Node as PmNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

import { SafeCodeBlock } from "@/components/document-editor/safe-code-block";
import { slashAlias } from "@/components/smart-toolbar/insert/insert-menu-body";
import { editorActions } from "@/lib/editor-actions";
import { formatKeyCombo } from "@/lib/editor-actions/key-combo";
import { runAction } from "@/lib/editor-actions/registry";
import { computeContext } from "@/lib/editor-context/snapshot";
import { lowlight } from "@/lib/lowlight";
import {
  buildSlashItems,
  hintNeedsSpace,
  matchSlashItems,
} from "@/lib/slash-menu/slash-items";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

/**
 * One registry, several surfaces (bubble and quick insert spec §8.5): the
 * labels, icons, shortcuts and Markdown hints come from `lib/editor-actions`
 * alone. Each surface below lists the ids it names and its files.
 *
 * Bubble and Turn into are not on `main` yet: their phase adds its entry
 * (ids and files) to `SURFACES`.
 */

const ROOT = join(import.meta.dir, "../../..");

let editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

const TITLE: JSONContent = {
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text: "Title" }],
};

/**
 * The test editor with the app's own input-rule extensions in place of
 * the helper's: `SafeCodeBlock` for the stock code block, and `Typography`,
 * which turns "--" into "—" before the divider's rule sees the third dash
 * (`buildDocumentEditorExtensions`).
 */
const APP_INPUT_RULES = [
  ...DEFAULT_EXTENSIONS.filter((ext) => ext.name !== "codeBlock"),
  SafeCodeBlock.configure({ lowlight }),
  Typography,
] as Extension[];

/** A title and one empty paragraph, the caret in it. */
function emptyLineEditor(withMermaid = false): Editor {
  const editor = createTestEditor({
    extensions: [
      ...APP_INPUT_RULES,
      ...(withMermaid ? [Mermaid] : []),
    ] as Extension[],
    content: { type: "doc", content: [TITLE, { type: "paragraph" }] },
  });
  editors.push(editor);
  const pos = editor.state.doc.child(0).nodeSize + 1;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
  return editor;
}

/** The "/" menu's rows at an empty line. */
function slashItems(withMermaid = false) {
  const editor = emptyLineEditor(withMermaid);
  return buildSlashItems(computeContext(editor), editorActions.list(), {
    rows: 3,
    cols: 3,
  });
}

interface Surface {
  name: string;
  /** Repository-relative files that render the surface. */
  files: readonly string[];
  /** Every registry id the surface names. */
  ids: () => readonly string[];
}

const SURFACES: readonly Surface[] = [
  {
    name: '"/" menu and the + on an empty line',
    files: [
      "components/smart-toolbar/slash/slash-menu.tsx",
      "components/smart-toolbar/slash/empty-line-plus.tsx",
      "lib/slash-menu/slash-items.ts",
      "lib/slash-menu/slash-badges.ts",
      "lib/slash-menu/run-slash-pick.ts",
    ],
    ids: () => [
      ...new Set(slashItems(true).map((item) => item.actionId)),
      ...new Set(slashItems().map((item) => item.actionId)),
    ],
  },
  {
    name: "row Insert menu",
    files: [
      "components/smart-toolbar/insert-menu.tsx",
      "components/smart-toolbar/insert/insert-menu-body.tsx",
    ],
    ids: () => editorActions.list({ group: "insert" }).map(({ id }) => id),
  },
  {
    name: "phone list and indent cells",
    files: [
      "components/smart-toolbar/phone/phone-menu-cells.tsx",
      "components/smart-toolbar/phone/phone-menu-bodies.tsx",
    ],
    ids: () => ["list.bullet", "list.ordered", "list.task", "indent.indent"],
  },
];

/** `UiIntent` types share the id shape but are not actions. */
const INTENT_TYPES = new Set(["insert.open"]);

const source = (file: string) => readFileSync(join(ROOT, file), "utf8");
const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Section headings that a block's one-word label may share (BQ11). */
const SECTION_HEADINGS = new Set(["Text"]);

describe("surface ids and labels come from the registry", () => {
  const prefixes = [
    ...new Set(editorActions.list().map(({ id }) => id.split(".")[0])),
  ];
  const idLiteral = new RegExp(
    `["'\`]((?:${prefixes.map(escapeRegExp).join("|")})\\.[A-Za-z0-9]+)["'\`]`,
    "g",
  );

  for (const surface of SURFACES) {
    it(`${surface.name}: every id it names exists`, () => {
      const ids = surface.ids();
      expect(ids.length).toBeGreaterThan(0);
      const missing = ids.filter((id) => !editorActions.get(id));
      for (const file of surface.files) {
        for (const [, id] of source(file).matchAll(idLiteral)) {
          if (!INTENT_TYPES.has(id) && !editorActions.get(id)) {
            missing.push(`${id} (${file})`);
          }
        }
      }
      expect(missing).toEqual([]);
    });

    it(`${surface.name}: no hard-coded registry label or shortcut`, () => {
      const actions = surface
        .ids()
        .flatMap((id) => editorActions.get(id) ?? []);
      const strings = new Set<string>();
      for (const action of actions) {
        // The "/" menu's "Text" section heading (spec §8.5) is not the
        // `style.paragraph` label, though both read "Text" (BQ11).
        if (!SECTION_HEADINGS.has(action.label)) strings.add(action.label);
        if (action.shortcut) {
          strings.add(action.shortcut);
          strings.add(formatKeyCombo(action.shortcut, true));
          strings.add(formatKeyCombo(action.shortcut, false));
        }
      }
      const found: string[] = [];
      for (const file of surface.files) {
        const text = source(file);
        for (const value of strings) {
          const literal = escapeRegExp(value);
          // A quoted string, or JSX text (">Heading 2<").
          const pattern = new RegExp(
            `(["'\`])${literal}\\1|>\\s*${literal}\\s*<`,
          );
          if (pattern.test(text)) found.push(`"${value}" in ${file}`);
        }
      }
      expect(found).toEqual([]);
    });
  }
});

/** Types the text one character at a time, through the input rules. */
function typeText(editor: Editor, text: string): void {
  for (const char of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handle) =>
      handle(view, from, to, char, () =>
        view.state.tr.insertText(char, from, to),
      ),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
}

/** The block structure, without text or ids ("heading:2", "bulletList"). */
function shape(node: PmNode): string {
  if (node.isText) return "";
  const level = node.type.name === "heading" ? `:${node.attrs.level}` : "";
  const inner: string[] = [];
  node.forEach((child) => {
    const part = shape(child);
    if (part) inner.push(part);
  });
  return `${node.type.name}${level}${inner.length ? `(${inner.join(",")})` : ""}`;
}

describe('the "/" menu\'s Markdown hints trigger their blocks', () => {
  const hinted = slashItems().filter((item) => item.hint);

  it("covers every hinted block", () => {
    expect(hinted.map((item) => item.actionId).sort()).toEqual(
      [
        "insert.codeBlock",
        "insert.divider",
        "insert.quote",
        "list.bullet",
        "list.ordered",
        "list.task",
        "style.heading1",
        "style.heading2",
        "style.heading3",
        "style.heading4",
        "style.heading5",
        "style.heading6",
      ].sort(),
    );
  });

  for (const item of hinted) {
    const hint = item.hint ?? "";
    const typed = hintNeedsSpace(hint) ? `${hint} ` : hint;
    it(`typing "${typed}" makes what ${item.actionId} makes`, () => {
      const viaHint = emptyLineEditor();
      typeText(viaHint, typed);
      const viaAction = emptyLineEditor();
      const action = editorActions.get(item.actionId);
      if (!action) throw new Error(`no action ${item.actionId}`);
      expect(runAction(viaAction, action, item.arg)).toBe(true);
      expect(shape(viaHint.state.doc)).toBe(shape(viaAction.state.doc));
      // The hint converted the line: none of it stays as text.
      expect(viaHint.state.doc.textContent).toBe("Title");
    });
  }

  it('"## " makes a heading level 2', () => {
    const editor = emptyLineEditor();
    typeText(editor, "## ");
    expect(editor.state.selection.$head.parent.type.name).toBe("heading");
    expect(editor.state.selection.$head.parent.attrs.level).toBe(2);
  });
});

describe('Insert menu rows hint their "/" alias', () => {
  for (const action of editorActions.list({ group: "insert" })) {
    if (!action.id.startsWith("insert.")) continue;
    it(`${slashAlias(action)} finds ${action.id} first`, () => {
      const alias = slashAlias(action);
      expect(alias).toMatch(/^\/[a-z]+$/);
      const [first] = matchSlashItems(slashItems(true), alias.slice(1));
      const expected =
        action.id === "insert.mermaid"
          ? ["insert.mermaid", "template.mermaid"]
          : [action.id];
      expect(expected).toContain(first?.actionId);
    });
  }
});
