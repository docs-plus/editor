/**
 * The §6.2 fallback for `asset:` images (image store spec §6), and pins on
 * the HyperMultimedia 2.3 internals it relies on. When a package update
 * breaks a pin, check whether U1 (2.4: `resolveSrc`, `isHostSrc`,
 * `refreshMediaSrc`) has landed: if so, delete `asset-image.ts` and wire the
 * upstream options instead (docs/research/2026-11-22-hypermultimedia-2.4-u1-upstream-note.md).
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import {
  HyperMultimediaKit as BaseKit,
  isSafeMediaSrc,
  type MediaActionContext,
  resolveMediaActions,
  wrapMediaWithLoadingShell,
} from "@docs.plus/extension-hypermultimedia";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";

import { saveAltText } from "@/extensions/hyper-multimedia/alt-text-popover";
import {
  type AssetScope,
  isHostSrc,
  loadAssetImages,
  refreshMediaSrc,
} from "@/extensions/hyper-multimedia/asset-image";
import { ASSET_IMAGE_COPY } from "@/extensions/hyper-multimedia/asset-image-view";
import { HyperMultimediaKit } from "@/extensions/hyper-multimedia/hyper-multimedia-kit";
import { getNotice } from "@/lib/announce";
import { formatAssetRef, isAssetRef } from "@/lib/assets/asset-ref";
import { MemoryBlobStore } from "@/lib/platform/memory-blob-store";
import { contractImage } from "@/tests/helpers/blob-store-contract";
import { settle } from "@/tests/helpers/platform-fakes";

/** Bun's own `URL.createObjectURL` refuses happy-dom Blobs: count instead. */
let created = 0;
let revoked = 0;
const live = new Set<string>();
const original = {
  create: URL.createObjectURL,
  revoke: URL.revokeObjectURL,
};
beforeEach(() => {
  created = 0;
  revoked = 0;
  live.clear();
  URL.createObjectURL = () => {
    created += 1;
    const url = `blob:counted/${created}`;
    live.add(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked += 1;
    live.delete(url);
  };
});
afterEach(() => {
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
});

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) {
    if (!editor.isDestroyed) editor.destroy();
  }
});

function makeEditor(
  assets: (() => AssetScope | null) | null,
  content: string | Record<string, unknown> = "<p></p>",
): Editor {
  const editor = new Editor({
    extensions: [StarterKit, HyperMultimediaKit.configure({ assets })],
    content,
  });
  editors.push(editor);
  return editor;
}

function baseEditor(content: string): Editor {
  const editor = new Editor({ extensions: [StarterKit, BaseKit], content });
  editors.push(editor);
  return editor;
}

const imageHtml = (src: string, attrs = "") =>
  `<img src="${src}" alt="a diagram" width="40" height="20"${attrs}>`;

function images(editor: Editor): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") found.push(node.attrs);
  });
  return found;
}

function imagePos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, at) => {
    if (node.type.name === "image" && pos < 0) pos = at;
  });
  return pos;
}

const imageDom = (editor: Editor) =>
  editor.view.nodeDOM(imagePos(editor)) as HTMLElement;

async function desktopScope() {
  const store = new MemoryBlobStore({
    syncUrl: (hex) => `app://tinydocy/_asset/${hex}`,
  });
  const { hex } = await store.put("doc", contractImage(1), "image/png");
  return {
    scope: { store, docId: "doc" },
    store,
    hex,
    src: formatAssetRef(hex),
  };
}

async function webScope() {
  const store = new MemoryBlobStore();
  const { hex } = await store.put("doc", contractImage(1), "image/png");
  return {
    scope: { store, docId: "doc" },
    store,
    hex,
    src: formatAssetRef(hex),
  };
}

describe("isHostSrc (the editor chunk's cheap check)", () => {
  it("agrees with isAssetRef, except that it lets malformed sha256 refs through", () => {
    const hex = "ab".repeat(32);
    const agree = [
      `asset:sha256-${hex}`,
      "asset:blake3-abc",
      "asset:sha256-../x",
      `asset:sha256-${hex}?x`,
      ` asset:sha256-${hex}`,
      "asset:",
      "https://example.com/a.png",
      "data:image/png;base64,AA==",
      null,
    ];
    for (const src of agree) expect(isHostSrc(src)).toBe(isAssetRef(src));
    // Shown as "needs a newer version" by the lazy view, never fetched.
    expect(isHostSrc(`asset:sha256-${hex.toUpperCase()}`)).toBe(true);
    expect(isAssetRef(`asset:sha256-${hex.toUpperCase()}`)).toBe(false);
  });
});

describe("HyperMultimedia 2.3 internals the fallback relies on (pins)", () => {
  it("the base kit has no default options for addOptions to keep", () => {
    // `hyper-multimedia-kit.ts` returns its options without spreading the
    // parent's; restore the spread if this ever fails.
    expect(BaseKit.options as object).toEqual({});
  });

  it("the stock view sets img.src from the node's src", () => {
    const editor = baseEditor(imageHtml("https://example.com/a.png"));
    expect(imageDom(editor).querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/a.png",
    );
  });

  it("the stock view keeps its DOM for a size change and rebuilds for a src change", () => {
    const editor = baseEditor(imageHtml("https://example.com/a.png"));
    const before = imageDom(editor);
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(imagePos(editor), "width", 30),
    );
    expect(imageDom(editor)).toBe(before);
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(
        imagePos(editor),
        "src",
        "https://example.com/b.png",
      ),
    );
    expect(imageDom(editor)).not.toBe(before);
  });

  it("the stock view keeps a stale <img alt> after an alt change (we sync it)", () => {
    const editor = baseEditor(imageHtml("https://example.com/a.png"));
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(imagePos(editor), "alt", "new"),
    );
    expect(imageDom(editor).querySelector("img")?.getAttribute("alt")).toBe(
      "a diagram",
    );
  });

  it("the stock parseHTML drops asset: srcs (U1 change 2 not shipped yet)", async () => {
    const { src } = await desktopScope();
    expect(images(baseEditor(imageHtml(src)))).toHaveLength(0);
  });

  it("the stock Markdown parse keeps asset: srcs (they pass isSafeMediaSrc)", async () => {
    const { src } = await desktopScope();
    expect(isSafeMediaSrc(src, { allowInlineImage: true })).toBe(true);
  });

  it("the loading shell stays pending without bindLoad and shows markError's message", () => {
    const editor = baseEditor("<p></p>");
    const shell = wrapMediaWithLoadingShell(
      editor,
      { kind: "image", width: 40, height: 20 },
      document.createElement("img"),
    );
    expect(shell.dom.dataset.hmLoading).toBe("pending");
    shell.controller.markError("Gone.");
    expect(shell.dom.dataset.hmLoading).toBe("error");
    expect(shell.dom.textContent).toContain("Gone.");
    shell.controller.destroy();
  });
});

describe("before the lazy chunk has loaded (first asset image of the session)", () => {
  it("draws an empty box, loads the chunk, then refreshes into the image", async () => {
    const { scope, src, hex } = await desktopScope();
    const editor = makeEditor(() => scope, imageHtml(src));
    // The first render comes before the chunk has loaded.
    const box = imageDom(editor);
    expect(box.childElementCount).toBe(0);
    const ids = () =>
      resolveMediaActions(editor, "image").map((action) => action.id);
    expect(ids()).not.toContain("alt-text"); // stock toolbar until it loads
    await loadAssetImages();
    await settle();
    expect(ids()).toContain("alt-text");
    expect(imageDom(editor).querySelector("img")?.getAttribute("src")).toBe(
      `app://tinydocy/_asset/${hex}`,
    );
    expect(editor.can().undo()).toBe(false);
  });
});

describe("asset: images in a library document", () => {
  beforeAll(async () => {
    await loadAssetImages();
  });

  it("parse from HTML and render the store's synchronous URL (desktop)", async () => {
    const { scope, src, hex } = await desktopScope();
    const editor = makeEditor(() => scope, imageHtml(src));
    expect(images(editor)[0]?.src).toBe(src);
    const img = imageDom(editor).querySelector("img");
    expect(img?.getAttribute("src")).toBe(`app://tinydocy/_asset/${hex}`);
    expect(imageDom(editor).classList).toContain(
      "hypermultimedia--image__content",
    );
  });

  it("keep the same view for a resize or alt change, and the ref in the document", async () => {
    const { scope, src } = await desktopScope();
    const editor = makeEditor(() => scope, imageHtml(src));
    const before = imageDom(editor);
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(imagePos(editor), "width", 30),
    );
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(imagePos(editor), "alt", "new"),
    );
    expect(imageDom(editor)).toBe(before);
    expect(images(editor)[0]).toMatchObject({ src, width: 30, alt: "new" });
    expect(editor.getHTML()).toContain(`src="${src}"`);
  });

  it("rebuild when the document's src changes", async () => {
    const { scope, src } = await desktopScope();
    const editor = makeEditor(() => scope, imageHtml(src));
    const before = imageDom(editor);
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(
        imagePos(editor),
        "src",
        "https://example.com/b.png",
      ),
    );
    expect(imageDom(editor)).not.toBe(before);
    expect(imageDom(editor).querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/b.png",
    );
  });

  it("load web bytes through an object URL, then swap in the stock view", async () => {
    const { scope, src } = await webScope();
    const editor = makeEditor(() => scope, imageHtml(src));
    const pending = imageDom(editor);
    expect(pending.classList).toContain("asset-image-state");
    expect(pending.getAttribute("aria-label")).toBe(
      `a diagram: ${ASSET_IMAGE_COPY.loading}`,
    );
    await settle();
    const img = imageDom(editor).querySelector("img");
    expect(img?.getAttribute("src")).toStartWith("blob:");
    expect(images(editor)[0]?.src).toBe(src);
    // The swap is a forward refresh outside history.
    expect(editor.can().undo()).toBe(false);
  });

  it("show the missing state when the bytes are not on this computer", async () => {
    const { scope, src, store, hex } = await webScope();
    store.markMissing(hex);
    const editor = makeEditor(() => scope, imageHtml(src));
    await settle();
    const dom = imageDom(editor);
    expect(dom.classList).toContain("asset-image-state");
    expect(dom.getAttribute("aria-label")).toBe(
      `a diagram: ${ASSET_IMAGE_COPY.missing}`,
    );
    expect(dom.textContent).toContain(ASSET_IMAGE_COPY.missing);
  });

  it("refreshMediaSrc re-resolves a missing image once its bytes arrive", async () => {
    const { scope, src, store, hex } = await webScope();
    store.markMissing(hex);
    const editor = makeEditor(() => scope, imageHtml(src));
    await settle();
    await store.put("doc", contractImage(1), "image/png", "fetched");
    expect(imageDom(editor).textContent).toContain(ASSET_IMAGE_COPY.missing);
    refreshMediaSrc(editor, src);
    await settle();
    expect(
      imageDom(editor).querySelector("img")?.getAttribute("src"),
    ).toStartWith("blob:");
  });

  it("show an unknown algorithm as needing a newer version, never changing it", async () => {
    const { scope } = await desktopScope();
    const editor = makeEditor(() => scope, imageHtml("asset:blake3-abc123"));
    expect(images(editor)[0]?.src).toBe("asset:blake3-abc123");
    expect(imageDom(editor).textContent).toContain(ASSET_IMAGE_COPY.newer);
  });

  it("keep asset: images on paste", async () => {
    const { scope, src } = await desktopScope();
    const editor = makeEditor(() => scope);
    editor.view.pasteHTML(imageHtml(src));
    expect(images(editor).map((attrs) => attrs.src)).toEqual([src]);
  });
});

describe("object URLs on the web are released with their views (R2)", () => {
  it("creates equal revokes after tab switches and editor destroy", async () => {
    const store = new MemoryBlobStore();
    const refs: string[] = [];
    for (let i = 0; i < 4; i++) {
      refs.push(
        formatAssetRef(
          (await store.put("doc", contractImage(i), "image/png")).hex,
        ),
      );
    }
    const scope = { store, docId: "doc" };
    // Twenty tab switches: each mounts a fresh editor and destroys the last.
    for (let round = 0; round < 20; round++) {
      const editor = makeEditor(
        () => scope,
        refs.map((src) => imageHtml(src)).join(""),
      );
      await settle();
      // Remove and re-add an image: its view is destroyed and recreated.
      const pos = imagePos(editor);
      const node = editor.state.doc.nodeAt(pos);
      if (node) {
        editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
        editor.view.dispatch(editor.state.tr.insert(pos, node));
      }
      await settle();
      editor.destroy();
    }
    expect(created).toBeGreaterThan(0);
    expect(revoked).toBe(created);
    expect(live.size).toBe(0);
  }, 30_000);
});

describe("asset: images in the public sandbox (no asset scope)", () => {
  beforeAll(async () => {
    await loadAssetImages();
  });

  it("tell the writer when a pasted library image was dropped", async () => {
    const { src } = await desktopScope();
    const editor = makeEditor(null);
    editor.view.pasteHTML(imageHtml(src));
    await settle();
    expect(getNotice()?.text).toBe(ASSET_IMAGE_COPY.pasteRefused);
  });

  it("drop asset: images from pasted HTML and keep the rest", async () => {
    const { src } = await desktopScope();
    const editor = makeEditor(null);
    editor.view.pasteHTML(
      `<p>before</p>${imageHtml(src)}${imageHtml("https://example.com/a.png")}<p>after</p>`,
    );
    expect(images(editor).map((attrs) => attrs.src)).toEqual([
      "https://example.com/a.png",
    ]);
    expect(editor.getText()).toContain("before");
    expect(editor.getText()).toContain("after");
  });

  it("drop asset: images nested in a list item", async () => {
    const { src } = await desktopScope();
    const editor = makeEditor(null);
    editor.view.pasteHTML(`<ul><li><p>x</p>${imageHtml(src)}</li></ul>`);
    expect(images(editor)).toHaveLength(0);
    expect(editor.getText()).toContain("x");
  });

  it("still drops data: images from pasted HTML, as the stock kit does", () => {
    for (const editor of [makeEditor(null), baseEditor("<p></p>")]) {
      editor.view.pasteHTML(imageHtml("data:image/png;base64,iVBORw0KGgo="));
      expect(images(editor)).toHaveLength(0);
    }
  });

  it("drop asset: images from HTML set as content", async () => {
    const { src } = await desktopScope();
    expect(images(makeEditor(null, imageHtml(src)))).toHaveLength(0);
  });

  it("render a stray asset: image (from a synced document) as missing, without reading any store", async () => {
    const { src } = await desktopScope();
    const editor = makeEditor(null, {
      type: "doc",
      content: [{ type: "image", attrs: { src } }],
    });
    expect(imageDom(editor).textContent).toContain(ASSET_IMAGE_COPY.missing);
  });

  it("leave other images on the stock view", () => {
    const editor = makeEditor(null, imageHtml("https://example.com/a.png"));
    expect(imageDom(editor).classList).toContain(
      "hypermultimedia--image__content",
    );
  });
});

describe("image toolbar actions", () => {
  beforeAll(async () => {
    await loadAssetImages();
  });

  function ctxFor(editor: Editor): MediaActionContext {
    const pos = imagePos(editor);
    return {
      editor,
      nodeType: "image",
      nodePos: pos,
      attrs: editor.state.doc.nodeAt(pos)?.attrs ?? {},
      wrapper: imageDom(editor),
      close: () => {},
    };
  }

  it("adds Alt text… to the overflow menu, before Replace URL", () => {
    const editor = makeEditor(null, imageHtml("https://example.com/a.png"));
    const ids = resolveMediaActions(editor, "image").map((action) => action.id);
    expect(ids).toContain("alt-text");
    expect(ids.indexOf("alt-text")).toBe(ids.indexOf("replace") - 1);
    const alt = resolveMediaActions(editor, "image").find(
      (action) => action.id === "alt-text",
    );
    expect(alt?.placement).toBe("overflow");
    expect(alt?.label(ctxFor(editor))).toBe("Alt text…");
    expect(alt?.icon?.(ctxFor(editor))).toStartWith("<svg");
  });

  it("leaves other media toolbars alone", () => {
    const editor = makeEditor(null);
    const ids = resolveMediaActions(editor, "video").map((action) => action.id);
    expect(ids).not.toContain("alt-text");
  });

  it("saves trimmed alt text on the image, in one undoable step", () => {
    const editor = makeEditor(null, imageHtml("https://example.com/a.png"));
    expect(saveAltText(ctxFor(editor), "  A red square  ")).toBe(true);
    expect(images(editor)[0]?.alt).toBe("A red square");
    expect(imageDom(editor).querySelector("img")?.getAttribute("alt")).toBe(
      "A red square",
    );
    editor.commands.undo();
    expect(images(editor)[0]?.alt).toBe("a diagram");
    expect(imageDom(editor).querySelector("img")?.getAttribute("alt")).toBe(
      "a diagram",
    );
  });

  it("saves on the image's current position after an edit above it moved it", () => {
    const editor = makeEditor(
      null,
      `<p>x</p>${imageHtml("https://example.com/a.png")}`,
    );
    const ctx = ctxFor(editor);
    editor.commands.insertContentAt(1, "more text ");
    expect(imagePos(editor)).not.toBe(ctx.nodePos);
    expect(saveAltText(ctx, "moved")).toBe(true);
    expect(images(editor)[0]?.alt).toBe("moved");
  });

  it("hides View original for asset images only", async () => {
    const { scope, src } = await desktopScope();
    const editor = makeEditor(() => scope, imageHtml(src));
    const viewOriginal = resolveMediaActions(editor, "image").find(
      (action) => action.id === "view-original",
    );
    expect(viewOriginal?.isVisible?.(ctxFor(editor))).toBe(false);
    const web = makeEditor(null, imageHtml("https://example.com/a.png"));
    const webAction = resolveMediaActions(web, "image").find(
      (action) => action.id === "view-original",
    );
    expect(webAction?.isVisible?.(ctxFor(web))).toBe(true);
  });
});
