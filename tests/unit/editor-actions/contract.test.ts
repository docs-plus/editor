/**
 * Pins the shared smart-toolbar v1 contract
 * (docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md).
 * A track that must change one of these shapes changes the contract doc
 * in the same commit.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";

import type { Editor } from "@tiptap/core";

import { editorActions } from "@/lib/editor-actions";
import { coreActions } from "@/lib/editor-actions/core-actions";
import {
  canRun,
  createRegistry,
  runAction,
} from "@/lib/editor-actions/registry";
import { surfaceActions } from "@/lib/editor-actions/surface-actions";
import {
  ACTION_GROUPS,
  type AnyAction,
  CONTEXT_KINDS,
  type Ctx,
  defineAction,
} from "@/lib/editor-actions/types";
import { emitUiIntent, onUiIntent } from "@/lib/editor-actions/ui-intents";
import { v11Actions } from "@/lib/editor-actions/v11-actions";
import { computeContext } from "@/lib/editor-context/snapshot";
import { getEditorContextStore } from "@/lib/editor-context/store";
import { HIGHLIGHT_TOKENS } from "@/lib/highlight-tokens";
import {
  CHOICE_SLOTS,
  readChoice,
  STORAGE_KEYS,
  STORAGE_VERSION,
} from "@/lib/remembered-choice";
import { SCHEMA_MARK_NAMES } from "@/lib/schema-names";
import {
  FONT_SIZE_EM,
  FONT_SIZE_LADDER,
  FONT_SIZE_MARK,
  FONT_SIZE_TOKENS,
  HIGHLIGHT_PALETTE,
  isFontSizeToken,
  isTextColorToken,
  TEXT_COLOR_MARK,
  TEXT_COLOR_PALETTE,
  TEXT_COLOR_TOKENS,
} from "@/lib/text-style-tokens";

import { createTestEditor } from "../../helpers/create-test-editor";

/** Id prefixes per track (contract §4). Disjoint. */
const TRACK_PREFIXES = {
  d1: [
    "history.",
    "style.",
    "mark.",
    "format.",
    "list.",
    "align.",
    "indent.",
    "section.",
    "table.",
    "code.",
    "mermaid.",
    "media.",
    "view.",
  ],
  d2: ["color.", "size.", "insert.", "memory."],
  e: ["palette.", "repeat.", "formats.", "template."],
} as const;

const ownsId = (prefixes: readonly string[], id: string) =>
  prefixes.some((prefix) => id.startsWith(prefix));

function fakeAction(overrides: Partial<AnyAction> = {}): AnyAction {
  return {
    id: "mark.test",
    label: "Test",
    group: "mark",
    contexts: "any",
    enabled: () => true,
    run: () => true,
    ...overrides,
  };
}

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function setupEditor(): Editor {
  editor = createTestEditor({
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    },
  });
  return editor;
}

describe("text style tokens (PR C)", () => {
  it("uses the ten palette names for text colour and highlight", () => {
    expect(TEXT_COLOR_TOKENS).toEqual(HIGHLIGHT_TOKENS);
    expect(Object.keys(TEXT_COLOR_PALETTE)).toEqual([...TEXT_COLOR_TOKENS]);
    expect(Object.keys(HIGHLIGHT_PALETTE)).toEqual([...HIGHLIGHT_TOKENS]);
  });

  it("pins the font size marks and the stepper ladder", () => {
    expect(FONT_SIZE_TOKENS).toEqual(["xs", "sm", "lg", "xl"]);
    expect(FONT_SIZE_LADDER).toEqual(["xs", "sm", "md", "lg", "xl"]);
    expect(FONT_SIZE_EM).toEqual({
      xs: 0.75,
      sm: 0.875,
      md: 1,
      lg: 1.25,
      xl: 1.5,
    });
  });

  it("validates tokens by allowlist only", () => {
    expect(isTextColorToken("red")).toBe(true);
    expect(isTextColorToken("red;background:url(x)")).toBe(false);
    expect(isTextColorToken("#ff0000")).toBe(false);
    expect(isFontSizeToken("md")).toBe(false);
    expect(isFontSizeToken("lg")).toBe(true);
  });

  // PR C flips this when its server half adds the names (spec §3.1).
  it("keeps the pending marks out of the ingress allowlist", () => {
    expect(TEXT_COLOR_MARK).toBe("textColor");
    expect(FONT_SIZE_MARK).toBe("fontSize");
    expect(SCHEMA_MARK_NAMES.has(TEXT_COLOR_MARK)).toBe(false);
    expect(SCHEMA_MARK_NAMES.has(FONT_SIZE_MARK)).toBe(false);
  });
});

describe("action types (PR D1)", () => {
  it("lists context kinds in precedence order", () => {
    expect(CONTEXT_KINDS).toEqual([
      "readonly",
      "media",
      "mermaid",
      "code",
      "table",
      "title",
      "heading",
      "list",
      "paragraph",
    ]);
  });

  it("pins the action groups", () => {
    expect(ACTION_GROUPS).toEqual([
      "history",
      "style",
      "mark",
      "color",
      "size",
      "list",
      "align",
      "indent",
      "insert",
      "section",
      "table",
      "code",
      "media",
      "format",
      "view",
      "memory",
    ]);
  });

  it("keeps typed args assignable to the registry element type", () => {
    const typed = defineAction<"red">({
      id: "color.test",
      label: "Red",
      group: "color",
      contexts: ["paragraph"],
      enabled: () => true,
      run: (_editor, arg) => arg === "red",
    });
    const asAny: AnyAction = typed;
    expect(createRegistry([asAny]).get("color.test")).toBe(asAny);
  });
});

describe("registry (PR D1)", () => {
  it("gets, lists in order and filters by group and context", () => {
    const a = fakeAction({ id: "mark.a", contexts: ["paragraph"] });
    const b = fakeAction({ id: "list.b", group: "list" });
    const registry = createRegistry([a, b]);
    expect(registry.get("mark.a")).toBe(a);
    expect(registry.has("missing")).toBe(false);
    expect(registry.list()).toEqual([a, b]);
    expect(registry.list({ group: "list" })).toEqual([b]);
    expect(registry.list({ context: "heading" })).toEqual([b]);
  });

  it("throws on a duplicate id", () => {
    expect(() => createRegistry([fakeAction(), fakeAction()])).toThrow(
      /mark\.test/,
    );
  });

  it("composes every track with unique ids inside its own prefixes", () => {
    const tracks = [
      [coreActions, TRACK_PREFIXES.d1],
      [surfaceActions, TRACK_PREFIXES.d2],
      [v11Actions, TRACK_PREFIXES.e],
    ] as const;
    for (const [actions, prefixes] of tracks) {
      for (const action of actions) {
        expect(ownsId(prefixes, action.id)).toBe(true);
      }
    }
    const ids = editorActions.list().map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runs only offered, enabled actions against the live document", () => {
    const target = setupEditor();
    const run = vi.fn(() => true);
    const disabled = fakeAction({ enabled: () => ({ reason: "No" }), run });
    const elsewhere = fakeAction({ contexts: ["table"], run });
    expect(runAction(target, disabled)).toBe(false);
    expect(runAction(target, elsewhere)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(runAction(target, fakeAction({ run }), "arg")).toBe(true);
    expect(run).toHaveBeenCalledWith(target, "arg");
    expect(canRun(fakeAction(), computeContext(target))).toBe(true);
  });
});

describe("context store (PR D1)", () => {
  it("returns a Ctx snapshot memoized by store version", () => {
    const store = getEditorContextStore(setupEditor());
    const ctx: Ctx = store.getContext();
    expect(CONTEXT_KINDS).toContain(ctx.kind);
    expect(store.getContext()).toBe(ctx);
    expect(ctx.memo("k", () => 1)).toBe(1);
    expect(ctx.memo("k", () => 2)).toBe(1);
    expect(getEditorContextStore(editor as Editor)).toBe(store);
  });

  it("returns null views for unknown ids", () => {
    const store = getEditorContextStore(setupEditor());
    expect(store.getView("nope.nothing")).toBeNull();
  });

  it("freezes the slot context while held; release is idempotent", () => {
    const target = setupEditor();
    const store = getEditorContextStore(target);
    const unsubscribe = store.subscribe(() => {});
    const releaseA = store.hold();
    const releaseB = store.hold();
    const frozen = store.getSlotContext();
    target.commands.setTextSelection(1);
    expect(store.getSlotContext()).toBe(frozen);
    releaseA();
    releaseA();
    expect(store.getSlotContext()).toBe(frozen);
    releaseB();
    expect(store.getSlotContext()).toBe(store.getContext());
    expect(store.getContext()).not.toBe(frozen);
    unsubscribe();
  });
});

describe("view identity (PR D1)", () => {
  it("keeps the same view object while its fields are unchanged", async () => {
    // getView reads the composed registry; inject one action for this test.
    const action = fakeAction({ id: "mark.identity", isActive: () => false });
    const registry = await import("@/lib/editor-actions");
    const original = registry.editorActions.get;
    registry.editorActions.get = (id: string) =>
      id === action.id ? action : original(id);
    try {
      const target = setupEditor();
      const store = getEditorContextStore(target);
      const unsubscribe = store.subscribe(() => {});
      const first = store.getView(action.id);
      target.commands.setTextSelection(2);
      expect(store.getView(action.id)).toBe(first);
      unsubscribe();
    } finally {
      registry.editorActions.get = original;
    }
  });
});

describe("ui intents (PR D1)", () => {
  it("reports whether a listener handled the intent", () => {
    const target = setupEditor();
    expect(emitUiIntent(target, { type: "palette.open" })).toBe(false);
    const seen: string[] = [];
    const off = onUiIntent(target, (intent) => {
      seen.push(intent.type);
      return true;
    });
    expect(emitUiIntent(target, { type: "outline.toggle" })).toBe(true);
    off();
    expect(emitUiIntent(target, { type: "outline.toggle" })).toBe(false);
    expect(seen).toEqual(["outline.toggle"]);
  });
});

describe("memory layer (PR D2)", () => {
  it("pins the storage keys and version", () => {
    expect(STORAGE_KEYS).toEqual({
      choices: "tinydocy-choices",
      ui: "tinydocy-ui",
      formats: "tinydocy-formats",
    });
    expect(STORAGE_VERSION).toBe(1);
  });

  it("lists every slot of every track, with its key", () => {
    expect(CHOICE_SLOTS).toEqual({
      textColor: "choices",
      highlight: "choices",
      recentColors: "choices",
      codeLanguage: "choices",
      listType: "choices",
      insertKind: "choices",
      tableSize: "choices",
      repeatBundle: "choices",
      paletteRecent: "choices",
      mermaidTemplate: "choices",
      outlineOpen: "ui",
    });
  });

  it("falls back when nothing valid is stored", () => {
    const spec = {
      slot: "textColor" as const,
      maxRecent: 0,
      validate: isTextColorToken,
      fallback: "red" as const,
    };
    expect(readChoice(spec)).toEqual({ last: "red", recent: [] });
  });
});
