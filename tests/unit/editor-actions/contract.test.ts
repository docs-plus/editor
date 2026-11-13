/**
 * Pins the shared smart-toolbar v1 contract
 * (docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md).
 * A track that must change one of these shapes changes the contract doc
 * in the same commit.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";

import type { Editor } from "@tiptap/core";

import {
  ActionButton,
  type ActionButtonProps,
} from "@/components/smart-toolbar";
import { editorActions } from "@/lib/editor-actions";
import { coreActions } from "@/lib/editor-actions/core-actions";
import {
  availability,
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
  READ_ONLY_REASON,
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
  subscribeChoices,
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

/** Makes `editorActions.get` also resolve `actions` while `body` runs. */
async function withInjected(
  actions: readonly AnyAction[],
  body: () => void | Promise<void>,
): Promise<void> {
  const registry = await import("@/lib/editor-actions");
  const original = registry.editorActions.get;
  registry.editorActions.get = (id: string) =>
    actions.find((action) => action.id === id) ?? original(id);
  try {
    await body();
  } finally {
    registry.editorActions.get = original;
  }
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

  // PR C's server half adds the names (spec §3.1).
  it("allows the new marks at ingress", () => {
    expect(TEXT_COLOR_MARK).toBe("textColor");
    expect(FONT_SIZE_MARK).toBe("fontSize");
    expect(SCHEMA_MARK_NAMES.has(TEXT_COLOR_MARK)).toBe(true);
    expect(SCHEMA_MARK_NAMES.has(FONT_SIZE_MARK)).toBe(true);
  });
});

describe("action types (PR D1)", () => {
  it("lists context kinds in precedence order", () => {
    expect(CONTEXT_KINDS).toEqual([
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

  // `shortcut` is display-only; each key has one binding, so no two
  // actions may advertise the same combo (Repeat must run once).
  it("never gives one key combo to two actions", () => {
    const combos = editorActions
      .list()
      .flatMap((action) => (action.shortcut ? [action.shortcut] : []));
    expect(new Set(combos).size).toBe(combos.length);
  });

  it("refuses mutating actions centrally in a read-only document", () => {
    const target = setupEditor();
    const run = vi.fn(() => true);
    const mutating = fakeAction({ run });
    const viewOnly = fakeAction({ id: "view.test", mutates: false, run });
    target.setEditable(false);
    const ctx = computeContext(target);
    expect(availability(mutating, ctx)).toEqual({ reason: READ_ONLY_REASON });
    expect(runAction(target, mutating)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(availability(viewOnly, ctx)).toBe(true);
    expect(runAction(target, viewOnly)).toBe(true);
    expect(ctx.kind).not.toBe("readonly" as never);
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

  it("keeps two cache tiers: per snapshot and per doc", () => {
    const target = setupEditor();
    const first = computeContext(target);
    target.commands.setTextSelection(2);
    const second = computeContext(target);
    expect(second.state.doc).toBe(first.state.doc);
    expect(first.memo("m", () => 1)).toBe(1);
    expect(second.memo("m", () => 2)).toBe(2);
    expect(first.docMemo("d", () => 1)).toBe(1);
    expect(second.docMemo("d", () => 2)).toBe(1);
    const check = vi.fn(() => true);
    expect(first.can("toggleBulletList", check)).toBe(true);
    expect(first.can("toggleBulletList", check)).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(target);
  });

  it("is never stale without a subscriber", () => {
    const target = setupEditor();
    const store = getEditorContextStore(target);
    const before = store.getContext();
    expect(store.getContext()).toBe(before);
    target.commands.setTextSelection(2);
    const moved = store.getContext();
    expect(moved).not.toBe(before);
    expect(moved.state).toBe(target.state);
    target.setEditable(false);
    expect(store.getContext().editable).toBe(false);
  });

  it("computes a view once per snapshot", async () => {
    const enabled = vi.fn(() => true as const);
    const action = fakeAction({ id: "mark.counted", enabled });
    await withInjected([action], () => {
      const store = getEditorContextStore(setupEditor());
      const unsubscribe = store.subscribe(() => {});
      const view = store.getView(action.id);
      expect(store.getView(action.id)).toBe(view);
      expect(store.getView(action.id)).toBe(view);
      expect(enabled).toHaveBeenCalledTimes(1);
      unsubscribe();
    });
  });

  it("shows the read-only reason before the offered-elsewhere reason", async () => {
    const action = fakeAction({ id: "mark.tableOnly", contexts: ["table"] });
    await withInjected([action], () => {
      const target = setupEditor();
      target.setEditable(false);
      const view = getEditorContextStore(target).getView(action.id);
      expect(view?.enabled).toEqual({ reason: READ_ONLY_REASON });
    });
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

  it("notifies subscribers on the final release when the slot moved", () => {
    const target = setupEditor();
    const store = getEditorContextStore(target);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const release = store.hold();
    target.commands.setTextSelection(2);
    listener.mockClear();
    release();
    expect(listener).toHaveBeenCalledTimes(1);
    const quiet = store.hold();
    quiet();
    expect(listener).toHaveBeenCalledTimes(1);
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

  it("counts only an explicit true as handled", () => {
    const target = setupEditor();
    const offIgnore = onUiIntent(target, () => false);
    expect(emitUiIntent(target, { type: "palette.open" })).toBe(false);
    const offOwner = onUiIntent(
      target,
      (intent) => intent.type === "outline.toggle",
    );
    expect(emitUiIntent(target, { type: "palette.open" })).toBe(false);
    expect(emitUiIntent(target, { type: "outline.toggle" })).toBe(true);
    offIgnore();
    offOwner();
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

  it("offers an in-tab change feed", () => {
    const unsubscribe = subscribeChoices(() => {});
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });
});

describe("action button (PR D1)", () => {
  it("pins the frozen signature", () => {
    const props: ActionButtonProps = {
      id: "mark.bold",
      editor: null,
      variant: "bubble",
      showLabel: true,
      arg: "red",
    };
    expect(typeof ActionButton).toBe("function");
    expect(props.variant).toBe("bubble");
  });
});
