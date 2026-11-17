/**
 * Document links stay underlined in every block they can sit in (WCAG 1.4.1:
 * colour is not the only cue), with the underline set 0.15em below the text
 * so it clears descenders. One rule in `paragraph-node.scss` (LINKS) covers
 * them all; this pins it per context.
 */
import { expect, test } from "@playwright/test";

import { MIN_TEXT_CONTRAST } from "@/lib/text-style-contrast";
import { HIGHLIGHT_TOKENS } from "@/lib/text-style-tokens";

import { contrastRatio, resolveRgb, setTheme } from "./helpers/a11y";
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

/**
 * #104: a link inside every highlight keeps AA contrast in both themes. The
 * unit test (`token-contrast.test.ts`) checks the tokens; this checks what
 * renders: the mark sits inside the link (`<a><mark>`) and inherits its
 * colour, over the highlight's own background.
 */
for (const theme of ["light", "dark"] as const) {
  test(`links on every highlight reach 4.5:1 (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForSync();

    await page.evaluate(
      (content) => {
        const e = window.__tiptap_editor;
        e?.commands.insertContentAt(e.state.doc.content.size, content);
      },
      HIGHLIGHT_TOKENS.map((color) =>
        paragraph(
          text(`${color} link`, [
            link,
            { type: "highlight", attrs: { color } },
          ]),
        ),
      ),
    );

    const pairs = await page
      .locator(".tiptap a mark[data-highlight]")
      .evaluateAll((marks) =>
        marks.map((mark) => {
          const style = getComputedStyle(mark);
          return {
            highlight: mark.getAttribute("data-highlight") ?? "",
            color: style.color,
            background: style.backgroundColor,
          };
        }),
      );
    expect(pairs.map(({ highlight }) => highlight)).toEqual([
      ...HIGHLIGHT_TOKENS,
    ]);

    const failing: string[] = [];
    for (const { highlight, color, background } of pairs) {
      const ratio = contrastRatio(
        await resolveRgb(page, color),
        await resolveRgb(page, background),
      );
      if (ratio < MIN_TEXT_CONTRAST) {
        failing.push(`${highlight} ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failing).toEqual([]);
  });
}
