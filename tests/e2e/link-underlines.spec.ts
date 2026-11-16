/**
 * Document links stay underlined in every block they can sit in (WCAG 1.4.1:
 * colour is not the only cue), with the underline set 0.15em below the text
 * so it clears descenders. One rule in `paragraph-node.scss` (LINKS) covers
 * them all; this pins it per context.
 */
import { expect, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

const link = { type: "hyperlink", attrs: { href: "https://example.com" } };
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });

/** One link per context, plus a link carrying bold and a text colour. */
const LINKS = [
  paragraph(text("In a paragraph "), text("paragraph link", [link])),
  {
    type: "heading",
    attrs: { level: 2 },
    content: [text("heading link", [link])],
  },
  {
    type: "bulletList",
    content: [
      { type: "listItem", content: [paragraph(text("list link", [link]))] },
    ],
  },
  {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          {
            type: "tableCell",
            content: [paragraph(text("cell link", [link]))],
          },
        ],
      },
    ],
  },
  paragraph(
    text("styled link", [
      link,
      { type: "bold" },
      { type: "textColor", attrs: { color: "red" } },
    ]),
  ),
];

test("document links are underlined with a 0.15em offset in every context", async ({
  page,
}) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();

  // At the end of the document, after the title, so the schema's title rule
  // never reshapes the inserted blocks.
  await page.evaluate((content) => {
    const e = window.__tiptap_editor;
    e?.commands.insertContentAt(e.state.doc.content.size, content);
  }, LINKS);

  const links = await page.locator(".tiptap a").evaluateAll((anchors) =>
    anchors.map((a) => {
      const style = getComputedStyle(a);
      const context = a.closest("h2")
        ? "heading"
        : a.closest("li")
          ? "list"
          : a.closest("td, th")
            ? "table"
            : "paragraph";
      return {
        text: a.textContent,
        context,
        wrapsElement: a.querySelector("*") !== null,
        line: style.textDecorationLine,
        offset: Number.parseFloat(style.textUnderlineOffset),
        fontSize: Number.parseFloat(style.fontSize),
      };
    }),
  );

  // Exactly these five, so an empty or partial render cannot pass.
  expect(links.map(({ text, context }) => ({ text, context }))).toEqual([
    { text: "paragraph link", context: "paragraph" },
    { text: "heading link", context: "heading" },
    { text: "list link", context: "list" },
    { text: "cell link", context: "table" },
    { text: "styled link", context: "paragraph" },
  ]);
  // The styled link wraps its bold and colour marks.
  expect(links[4].wrapsElement).toBe(true);

  expect(links.map(({ text, line }) => ({ text, line }))).toEqual(
    links.map(({ text }) => ({ text, line: "underline" })),
  );
  for (const { text, offset, fontSize } of links) {
    expect(offset, text ?? "").toBeCloseTo(0.15 * fontSize, 1);
  }
});
