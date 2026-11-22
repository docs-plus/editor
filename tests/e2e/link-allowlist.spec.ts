/**
 * A link off the web allowlist (https, http, mailto) that arrives through Yjs,
 * as a collaborator's update would deliver it, renders with no `href` and
 * never opens: not by Mod-click, not by middle-click. Before the allowlist an
 * `ms-msdt:` link was a live anchor that Mod-click handed to the OS.
 */
import { expect, type Page, test } from "@playwright/test";

import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";

declare global {
  interface Window {
    __opened?: unknown[][];
  }
}

/**
 * Appends `text` carrying a hyperlink to `href` to the paragraph holding
 * `anchorText`, through the shared Y.XmlFragment (a remote-style write).
 */
async function insertLinkThroughYjs(
  page: Page,
  anchorText: string,
  text: string,
  href: string,
): Promise<void> {
  await page.evaluate(
    ({ anchorText, text, href }) => {
      interface YNode {
        nodeName?: string;
        length: number;
        toArray?: () => YNode[];
        toString: () => string;
        insert: (index: number, text: string, attrs: object) => void;
      }
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("no editor");
      const plugin = editor.state.plugins.find((p) =>
        (p as unknown as { key: string }).key.startsWith("y-sync"),
      );
      const fragment = plugin?.getState(editor.state)?.type as YNode;
      const find = (node: YNode): YNode | null => {
        for (const child of node.toArray?.() ?? []) {
          if (!child.toArray && child.toString().includes(anchorText)) {
            return child;
          }
          const found = find(child);
          if (found) return found;
        }
        return null;
      };
      const target = find(fragment);
      if (!target) throw new Error(`no Y.XmlText holds "${anchorText}"`);
      target.insert(target.length, text, { hyperlink: { href } });
    },
    { anchorText, text, href },
  );
}

test("a link off the allowlist from Yjs has no href and never opens", async ({
  page,
  context,
}) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  await typeInNewParagraphAtEnd(page, "Body ");

  await insertLinkThroughYjs(page, "Body", "evil", "ms-msdt:/id x");
  await insertLinkThroughYjs(page, "Body", " web", "https://example.com/");

  const evil = page.locator(".tiptap a", { hasText: "evil" });
  const web = page.locator(".tiptap a", { hasText: "web" });
  await expect(evil).toHaveCount(1);
  await expect(evil).not.toHaveAttribute("href");
  await expect(web).toHaveAttribute("href", "https://example.com/");

  await page.evaluate(() => {
    window.__opened = [];
    window.open = (...args: unknown[]) => {
      window.__opened?.push(args);
      return null;
    };
  });
  const popups: unknown[] = [];
  context.on("page", (popup) => popups.push(popup));
  const pagesBefore = context.pages().length;

  await evil.click({ modifiers: ["ControlOrMeta"] });
  await evil.click({ button: "middle" });
  // Give a late popup or open call time to show up before asserting none did.
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__opened)).toEqual([]);
  expect(popups).toHaveLength(0);
  expect(context.pages()).toHaveLength(pagesBefore);

  // Control: the https link still opens, so the harness sees real opens.
  await web.click({ modifiers: ["ControlOrMeta"] });
  await expect
    .poll(() => page.evaluate(() => window.__opened?.[0]?.[0]))
    .toBe("https://example.com/");

  // A plain click opens the preview, which shows the href as text only:
  // nothing on the page links to it.
  await page.keyboard.press("Escape");
  await evil.click();
  await expect(page.getByText("ms-msdt:/id x")).toBeVisible();
  await expect(page.locator('a[href*="ms-msdt"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__opened)).toHaveLength(1);
});
