import type { Editor } from "@tiptap/core";
import { TableOfContents } from "@tiptap/extension-table-of-contents";

import { applyActiveState, collectTocItems } from "./table-of-contents-items";
import { createTocIdPlugin } from "./toc-id-plugin";

type Runtime = {
  frame: number;
  scrollFrame: number;
  activeKey: string;
  scrollTarget: HTMLElement | Window | null;
  onScroll: () => void;
};

const runtimes = new WeakMap<Editor, Runtime>();

function resolveScrollTarget(
  scrollParent: (() => HTMLElement | Window) | HTMLElement | Window | undefined,
): HTMLElement | Window | null {
  if (!scrollParent) return null;
  return typeof scrollParent === "function" ? scrollParent() : scrollParent;
}

function scrollTopOf(target: HTMLElement | Window | null): number {
  if (!target) return 0;
  return target instanceof HTMLElement ? target.scrollTop : target.scrollY;
}

/**
 * Drop-in `TableOfContents` with the same ids, attributes and `onUpdate`
 * data, minus the costs that made long documents slow:
 *
 * - The stock extension rebuilds on every document change and reads
 *   `domAtPos(...).offsetTop` per heading, forcing a full synchronous layout
 *   after each keystroke, then dispatches an extra transaction. Here,
 *   rebuilds are coalesced into one per animation frame, use `nodeDOM`, and
 *   read layout once per rebuild.
 * - The stock id plugin walks the whole document, inline content included,
 *   after every change; see {@link createTocIdPlugin}.
 * - On scroll the stock extension recomputes every item and calls
 *   `onUpdate` (a React re-render) per scroll event. Here, scroll work runs
 *   once per frame and `onUpdate` fires only when the active heading changes.
 */
export const FastTableOfContents = TableOfContents.extend({
  onCreate() {
    if (typeof window === "undefined" || !this.editor.view) return;
    const { editor, options, storage } = this;
    const anchorTypes = options.anchorTypes ?? ["heading"];

    // Same id assignment as the stock extension: fill missing or duplicate
    // `data-toc-id`s once; the bundled plugin handles headings added later.
    const { tr } = editor.state;
    const seen = new Set<string>();
    editor.state.doc.descendants((node, pos) => {
      if (!anchorTypes.includes(node.type.name)) return !node.isTextblock;
      if (node.textContent.length === 0) return false;
      const existing = node.attrs["data-toc-id"] as string | null;
      if (!existing || seen.has(existing)) {
        const id = options.getId?.(node.textContent) ?? crypto.randomUUID();
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          "data-toc-id": id,
          id,
        });
      } else {
        seen.add(existing);
      }
      return false;
    });
    if (tr.docChanged) editor.view.dispatch(tr);

    const runtime: Runtime = {
      frame: 0,
      scrollFrame: 0,
      activeKey: "",
      scrollTarget: resolveScrollTarget(options.scrollParent),
      onScroll: () => {
        if (runtime.scrollFrame) return;
        runtime.scrollFrame = requestAnimationFrame(() => {
          runtime.scrollFrame = 0;
          if (editor.isDestroyed) return;
          const position = scrollTopOf(runtime.scrollTarget);
          storage.scrollPosition = position;
          const next = applyActiveState(storage.content, position);
          if (next.key === runtime.activeKey) return;
          runtime.activeKey = next.key;
          storage.content = next.items;
          options.onUpdate?.(next.items, false);
        });
      },
    };
    runtimes.set(editor, runtime);
    runtime.scrollTarget?.addEventListener("scroll", runtime.onScroll, {
      passive: true,
    });
    rebuild(this.editor, this.options, this.storage);
  },

  addProseMirrorPlugins() {
    return [
      createTocIdPlugin({
        anchorTypes: this.options.anchorTypes ?? ["heading"],
        getId: this.options.getId,
      }),
    ];
  },

  onTransaction({ transaction }) {
    if (!transaction.docChanged) return;
    const runtime = runtimes.get(this.editor);
    if (!runtime || runtime.frame) return;
    const { editor, options, storage } = this;
    runtime.frame = requestAnimationFrame(() => {
      runtime.frame = 0;
      if (!editor.isDestroyed) rebuild(editor, options, storage);
    });
  },

  onDestroy() {
    const runtime = runtimes.get(this.editor);
    if (!runtime) return;
    cancelAnimationFrame(runtime.frame);
    cancelAnimationFrame(runtime.scrollFrame);
    runtime.scrollTarget?.removeEventListener("scroll", runtime.onScroll);
    runtimes.delete(this.editor);
  },
});

type Options = (typeof FastTableOfContents)["options"];
type Storage = ReturnType<
  NonNullable<(typeof FastTableOfContents)["config"]["addStorage"]>
>;

function rebuild(editor: Editor, options: Options, storage: Storage): void {
  const isInitialCreation = storage.content.length === 0;
  const items = collectTocItems(editor, {
    anchorTypes: options.anchorTypes ?? ["heading"],
    getLevel: options.getLevel,
    getIndex: options.getIndex,
  });
  const runtime = runtimes.get(editor);
  const position = scrollTopOf(runtime?.scrollTarget ?? null);
  storage.scrollPosition = position;
  const next = applyActiveState(items, position);
  if (runtime) runtime.activeKey = next.key;
  storage.content = next.items;
  storage.anchors = next.items.map((item) => item.dom);
  options.onUpdate?.(next.items, isInitialCreation);
}
