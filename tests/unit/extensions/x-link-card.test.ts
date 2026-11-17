/**
 * Desktop X posts (#99): desktop builds draw the kit's `x` node as a static
 * link card and never reach X; the web keeps the kit's oEmbed embed.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";

import { describeXPost } from "@/extensions/hyper-multimedia/x-link-card";
import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type KitModule =
  typeof import("@/extensions/hyper-multimedia/hyper-multimedia-kit");

const POST = "https://x.com/docsplus/status/1234567890123456789";

let editor: Editor | undefined;
let fetchCalls: string[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchCalls = [];
  // The kit's web view asks X for the oEmbed, then loads widgets.js. Keep
  // it off the network: the request never answers, so it stops there.
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    fetchCalls.push(String(input instanceof Request ? input.url : input));
    return new Promise<Response>(() => {});
  }) as unknown as typeof fetch;
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  globalThis.fetch = originalFetch;
  for (const script of document.querySelectorAll("script")) script.remove();
  delete process.env.NEXT_PUBLIC_APP_TARGET;
  resetModules();
});

async function createEditor(src = POST): Promise<Editor> {
  const { HyperMultimediaKit } = await importFresh<KitModule>(
    "@/extensions/hyper-multimedia/hyper-multimedia-kit",
  );
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({
    element,
    extensions: [StarterKit, HyperMultimediaKit],
    content: {
      type: "doc",
      content: [
        { type: "x", attrs: { src } },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    },
  });
  return editor;
}

/** Lets the kit's async oEmbed and script loaders run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const xRequests = () =>
  [
    ...fetchCalls,
    ...[...document.querySelectorAll("script[src]")].map(
      (script) => (script as HTMLScriptElement).src,
    ),
  ].filter((url) => /publish\.x\.com|twitter\.com/.test(url));

describe("describeXPost", () => {
  it("reads the author from the URL path", () => {
    expect(describeXPost(POST)).toEqual({
      href: POST,
      author: "@docsplus",
      label: "x.com/docsplus/status/1234567890123456789",
    });
    expect(
      describeXPost("https://twitter.com/jack/status/20?s=20")?.author,
    ).toBe("@jack");
  });

  it("has no author for X's own /i/status links", () => {
    expect(describeXPost("https://x.com/i/status/1234567890")?.author).toBe(
      null,
    );
  });

  it.each([
    "javascript:alert(1)",
    "https://example.com/docsplus/status/1",
    "https://x.com/docsplus",
    "",
    null,
    42,
  ])("refuses %p", (src) => {
    expect(describeXPost(src)).toBeNull();
  });
});

describe("HyperMultimediaKit x node", () => {
  it("web: keeps the kit's embed view, which asks X for the oEmbed", async () => {
    const view = (await createEditor()).view.dom;
    await settle();

    expect(view.querySelector(".hypermultimedia--x__content")).not.toBeNull();
    expect(view.querySelector("[data-x-link-card]")).toBeNull();
    expect(
      fetchCalls.some((url) => url.startsWith("https://publish.x.com/")),
    ).toBe(true);
  });

  it("desktop: draws a static link card and never reaches X", async () => {
    process.env.NEXT_PUBLIC_APP_TARGET = "desktop";
    const ed = await createEditor();
    await settle();

    const card = ed.view.dom.querySelector<HTMLElement>("[data-x-link-card]");
    expect(card).not.toBeNull();
    expect(
      ed.view.dom.querySelector(".hypermultimedia--x__content"),
    ).toBeNull();
    expect(card?.contentEditable).toBe("false");
    expect(card?.querySelector(".x-link-card__title")?.textContent).toBe(
      "Post by @docsplus",
    );
    // A button, so the Hyperlink extension's anchor clicks leave it alone.
    expect(card?.querySelector("a")).toBeNull();
    const open = card?.querySelector<HTMLButtonElement>(".x-link-card__open");
    expect(open?.type).toBe("button");
    expect(open?.dataset.href).toBe(POST);
    expect(xRequests()).toEqual([]);
    expect(fetchCalls).toEqual([]);
  });

  it("desktop: keeps the node and its HTML, so the web still embeds it", async () => {
    process.env.NEXT_PUBLIC_APP_TARGET = "desktop";
    const ed = await createEditor();

    expect(ed.getJSON().content?.[0]).toMatchObject({
      type: "x",
      attrs: { src: POST },
    });
    expect(ed.getHTML()).toContain('<blockquote class="twitter-tweet"');
  });

  it("desktop: redraws the card when the URL changes", async () => {
    process.env.NEXT_PUBLIC_APP_TARGET = "desktop";
    const ed = await createEditor();
    const next = "https://x.com/i/status/42";
    ed.commands.command(({ tr }) => {
      tr.setNodeAttribute(0, "src", next);
      return true;
    });

    const card = ed.view.dom.querySelector("[data-x-link-card]");
    expect(card?.querySelector(".x-link-card__title")?.textContent).toBe(
      "Post on X",
    );
    expect(
      card?.querySelector<HTMLElement>(".x-link-card__open")?.dataset.href,
    ).toBe(next);
    expect(xRequests()).toEqual([]);
  });

  it("desktop: shows no link for a URL the kit would not embed", async () => {
    process.env.NEXT_PUBLIC_APP_TARGET = "desktop";
    const ed = await createEditor();
    ed.commands.command(({ tr }) => {
      tr.setNodeAttribute(0, "src", "javascript:alert(1)");
      return true;
    });

    const card = ed.view.dom.querySelector("[data-x-link-card]");
    expect(card?.querySelector(".x-link-card__open")).toBeNull();
    expect(card?.querySelector(".x-link-card__url")?.textContent).toBe(
      "Unsupported link",
    );
  });

  it("desktop: the open button opens the post in a new window, and only that", async () => {
    process.env.NEXT_PUBLIC_APP_TARGET = "desktop";
    const ed = await createEditor();
    const opened: unknown[][] = [];
    const originalOpen = window.open;
    window.open = ((...args: unknown[]) => {
      opened.push(args);
      return null;
    }) as typeof window.open;
    try {
      ed.view.dom
        .querySelector<HTMLButtonElement>(".x-link-card__open")
        ?.click();
    } finally {
      window.open = originalOpen;
    }

    expect(opened).toEqual([[POST, "_blank", "noopener,noreferrer"]]);
    expect(xRequests()).toEqual([]);
  });
});
