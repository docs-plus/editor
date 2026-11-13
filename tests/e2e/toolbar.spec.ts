import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import {
  TOOLBAR_MAX_WAIT_MS,
  TOOLBAR_SETTLE_MS,
} from "@/hooks/use-tiptap-editor";
import { generateLargeDocument } from "@/tests/helpers/document-generators";

import { openToolbarTestDoc } from "./helpers/a11y";
import { EditorPage } from "./helpers/editor-page";

const toolbarButton = (page: Page, name: string) =>
  page.getByRole("toolbar").getByRole("button", { name, exact: true });

/**
 * Runs every later animation frame ~80 ms late, as on a loaded machine.
 * Tiptap's `focus()` waits a frame, so a keystroke right after a menu pick
 * arrives before it; the menu must hand focus back without waiting.
 */
async function delayAnimationFrames(page: Page) {
  await page.evaluate(() => {
    const timers = new Map<number, number>();
    let nextId = 1;
    window.requestAnimationFrame = (callback) => {
      const id = nextId++;
      timers.set(
        id,
        window.setTimeout(() => {
          timers.delete(id);
          callback(performance.now());
        }, 80),
      );
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      window.clearTimeout(timers.get(id));
      timers.delete(id);
    };
  });
}

test.describe("toolbar focus and disabled controls", () => {
  test("focus stays in the toolbar when the document turns read-only", async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    const indent = toolbarButton(page, "Indent");
    await page.keyboard.press("Shift");
    await indent.focus();
    await expect(indent).toBeFocused();

    await page.evaluate(() => window.__tiptap_editor?.setEditable(false));

    await expect
      .poll(() =>
        page.evaluate(
          () => !!document.activeElement?.closest('[role="toolbar"]'),
        ),
      )
      .toBe(true);
  });

  test("arrowing in the toolbar never pulls focus back from the editor later", async ({
    page,
  }) => {
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.setContent({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Section " }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Last " }] },
      ],
    });
    await page.keyboard.press("Shift");
    await toolbarButton(page, "Bold").focus();
    await page.keyboard.press("ArrowRight");
    await expect(toolbarButton(page, "Italic")).toBeFocused();

    await page.locator(".tiptap p", { hasText: "Last" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type("one ");
    await page.locator(".tiptap h2", { hasText: "Section" }).click();
    await page.keyboard.press("End");
    // The toolbar re-renders for the heading (new icon, Indent's reason):
    // that DOM change must not move focus back to Italic.
    await expect(toolbarButton(page, "Heading 2")).toBeVisible();
    await page.keyboard.type("two");

    await expect(page.locator(".tiptap p")).toHaveText("Last one ");
    await expect(page.locator(".tiptap h2")).toHaveText("Section two");
    await expect(page.locator(".tiptap")).toBeFocused();
  });

  test("a disabled Undo explains itself via aria-describedby", async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    const undo = toolbarButton(page, "Undo");
    await expect(undo).toHaveAttribute("aria-disabled", "true");
    await expect
      .poll(() =>
        undo.evaluate((el) =>
          (el.getAttribute("aria-describedby") ?? "")
            .split(" ")
            .map((id) => document.getElementById(id)?.textContent)
            .filter(Boolean),
        ),
      )
      .toContain("Nothing to undo");
  });

  test("an aria-disabled menu trigger stays closed", async ({ page }) => {
    await openToolbarTestDoc(page);
    // Lists cannot apply to a selected horizontal rule, so the trigger is disabled.
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.doc.content.size, {
          type: "horizontalRule",
        })
        .run();
      let rulePos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "horizontalRule") rulePos = pos;
      });
      editor.commands.setNodeSelection(rulePos);
    });
    const list = toolbarButton(page, "List");
    await expect(list).toHaveAttribute("aria-disabled", "true");
    const menu = page.getByRole("menu");

    await list.click({ force: true });
    await expect(menu).toHaveCount(0);

    await page.keyboard.press("Shift");
    await list.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await expect(menu).toHaveCount(0);
  });

  test("text style menu is a menu button named by its value with radio items", async ({
    page,
  }) => {
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.buildDocument([
      { level: 1, text: "Title" },
      { level: 2, text: "Section" },
    ]);
    await page.keyboard.press("ArrowUp");
    const trigger = toolbarButton(page, "Heading 2");
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).not.toHaveAttribute("aria-pressed", /.*/);
    await trigger.click();
    const checked = page.getByRole("menuitemradio", { name: "Heading 2" });
    await expect(checked).toHaveAttribute("aria-checked", "true");
    await checked.click();
    // Still a heading: picking the checked item is a no-op.
    await expect(toolbarButton(page, "Heading 2")).toBeVisible();
  });

  test("picking a text style closes the menu and returns focus to the editor", async ({
    page,
  }) => {
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.buildDocument([{ level: 1, text: "Title" }]);
    await page.keyboard.type("Body");
    await toolbarButton(page, "Normal text").click();
    await delayAnimationFrames(page);
    await page.getByRole("menuitemradio", { name: "Heading 2" }).click();
    await page.keyboard.type("X");
    await expect(page.locator(".tiptap h2")).toHaveText("BodyX");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("in the title, text styles are disabled and say why", async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    await toolbarButton(page, "Title").click();
    const items = page.getByRole("menuitemradio");
    await expect(items).toHaveCount(7);
    for (const item of await items.all()) {
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).toHaveAccessibleDescription("Title is always H1");
    }
    await page.keyboard.press("Escape");
    await expect(toolbarButton(page, "Title")).toBeVisible();
  });

  test("picking a list type closes the menu and returns focus to the editor", async ({
    page,
  }) => {
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.buildDocument([{ level: 1, text: "Title" }]);
    await page.keyboard.type("Item");
    await toolbarButton(page, "List").click();
    await delayAnimationFrames(page);
    await page.getByRole("menuitemradio", { name: "Bullet List" }).click();
    await page.keyboard.type("X");
    await expect(page.locator(".tiptap ul li")).toHaveText("ItemX");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});

test.describe("indent in lists", () => {
  test("indent button nests a list item and outdent lifts it back", async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("- one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("two");

    await toolbarButton(page, "Indent").click();
    await expect(page.locator(".tiptap ul ul li")).toHaveText("two");

    await toolbarButton(page, "Outdent").click();
    await expect(page.locator(".tiptap ul ul")).toHaveCount(0);
  });
});

test.describe("focus not obscured by the sticky toolbar", () => {
  const toolbarBottom = async (page: Page) => {
    const box = await page.getByRole("toolbar").boundingBox();
    return box!.y + box!.height;
  };

  test("scrollIntoView keeps a heading below the toolbar", async ({ page }) => {
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.setContent(generateLargeDocument(30));
    await page.evaluate(() => {
      const wrapper = document.querySelector(".document-editor-wrapper");
      if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
    });

    const heading = page.locator(".tiptap").getByRole("heading").nth(10);
    await heading.evaluate((el) => el.scrollIntoView({ block: "start" }));

    const bottom = await toolbarBottom(page);
    expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(bottom - 1);
  });

  test("the caret is never hidden behind the toolbar", async ({ page }) => {
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.setContent(generateLargeDocument(30));

    // Park paragraph 20 right under the toolbar, then let ProseMirror scroll
    // the selection into view (native ArrowUp scrolling is not deterministic).
    const pos = await page.evaluate(() => {
      const ed = window.__tiptap_editor!;
      let seen = 0;
      let found = 0;
      ed.state.doc.descendants((node, p) => {
        if (found || node.type.name !== "paragraph") return;
        if (++seen === 20) found = p + 1;
      });
      const dom = ed.view.nodeDOM(found - 1) as HTMLElement;
      const wrapper = document.querySelector(".document-editor-wrapper")!;
      wrapper.scrollTop +=
        dom.getBoundingClientRect().top - wrapper.getBoundingClientRect().top;
      return found;
    });
    await page.evaluate(
      (p) =>
        window.__tiptap_editor
          ?.chain()
          .setTextSelection(p)
          .scrollIntoView()
          .run(),
      pos,
    );

    const caretTop = await page.evaluate(() => {
      const ed = window.__tiptap_editor!;
      return ed.view.coordsAtPos(ed.state.selection.from).top;
    });
    expect(caretTop).toBeGreaterThanOrEqual(await toolbarBottom(page));
  });
});

test.describe("toolbar update timing", () => {
  test("toolbar follows a remote block change within 1 s while the collaborator keeps typing", async ({
    browser,
  }) => {
    const docId = `toolbar-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const contexts: BrowserContext[] = [];
    const openUser = async (name: string) => {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await ctx.newPage();
      await page.addInitScript(
        `window.__HOCUS_TOKEN = ${JSON.stringify(`${name}-${docId}`)}`,
      );
      const editorPage = new EditorPage(page);
      await editorPage.goto(docId);
      await editorPage.waitForSync();
      return { page, editorPage };
    };

    try {
      const a = await openUser("toolbar-a");
      const heading = (level: number, text: string) => ({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text }],
      });
      // The target starts as a heading: Yjs cannot rename an element, so a
      // paragraph-to-heading change arrives as delete + insert and moves B's
      // caret out of it. A level change is an attribute update in place.
      await a.editorPage.setContent({
        type: "doc",
        content: [
          heading(1, "Title"),
          heading(2, "Target heading"),
          {
            type: "paragraph",
            content: [{ type: "text", text: "Typing here" }],
          },
        ],
      });

      const b = await openUser("toolbar-b");
      const target = b.page.locator(".tiptap h2", {
        hasText: "Target heading",
      });
      await expect(target).toBeVisible();
      await target.click();
      await expect(toolbarButton(b.page, "Heading 2")).toBeVisible();

      await a.page.locator(".tiptap p", { hasText: "Typing here" }).click();
      await a.page.keyboard.press("End");
      let typingDone = false;
      const typing = a.page.keyboard
        .type("x".repeat(100), { delay: 50 })
        .then(() => {
          typingDone = true;
        });

      await a.page.waitForTimeout(1000);
      await a.page.evaluate(() => {
        const editor = window.__tiptap_editor;
        if (!editor) throw new Error("editor missing");
        let pos = -1;
        editor.state.doc.descendants((node, p) => {
          if (node.textContent === "Target heading") pos = p;
          return pos < 0;
        });
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...editor.state.doc.nodeAt(pos)?.attrs,
            level: 3,
          }),
        );
      });
      const changedAt = Date.now();

      // Worst case: the max-wait window, plus a keystroke gap, sync and
      // render. The unit test proves the exact 1 s cap; this separates it
      // from ~4 s of starvation.
      await expect(toolbarButton(b.page, "Heading 3")).toBeVisible({
        timeout: TOOLBAR_MAX_WAIT_MS + 500,
      });
      expect(Date.now() - changedAt).toBeLessThan(TOOLBAR_MAX_WAIT_MS + 500);
      expect(typingDone).toBe(false); // A was still typing when B caught up
      await typing;
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.close()));
    }
  });

  test("a typing burst commits the toolbar at most once per settle window", async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.__toolbarCommits = 0;
    });

    const start = Date.now();
    await page.keyboard.type("a".repeat(150), { delay: 20 });
    const burstMs = Date.now() - start;
    await page.waitForTimeout(TOOLBAR_SETTLE_MS + 100);

    const commits = await page.evaluate(() => window.__toolbarCommits ?? 0);
    expect(commits).toBeGreaterThanOrEqual(1); // the counter is wired
    expect(commits).toBeLessThanOrEqual(
      Math.floor(burstMs / TOOLBAR_MAX_WAIT_MS) + 1,
    );
  });
});
