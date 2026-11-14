import type { Page } from "@playwright/test";
import type { JSONContent } from "@tiptap/core";

import { getPlaywrightModifierKey } from "./playwright-modifier-key";

/** Types `text` into a new paragraph at the end of the document. */
export async function typeInNewParagraphAtEnd(
  page: Page,
  text: string,
): Promise<void> {
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(text);
}

export class EditorPage {
  constructor(private page: Page) {}

  /**
   * Opens `docId` (or a fresh test document). `waitForEditor: false` skips
   * the `.tiptap` waits, for clients that never render an editor (refused).
   */
  async goto(
    docId?: string,
    { waitForEditor = true }: { waitForEditor?: boolean } = {},
  ): Promise<void> {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const id = docId ?? `test-${nonce}`;
    const tabsState =
      id === "playground"
        ? {
            tabs: [{ id: "playground", title: "Playground", createdAt: 0 }],
            activeTabId: "playground",
          }
        : {
            tabs: [
              { id: "playground", title: "Playground", createdAt: 0 },
              { id, title: "Untitled", createdAt: Date.now() },
            ],
            activeTabId: id,
          };

    // Per-test global-tabs doc for E2E isolation (avoids migration race when parallel)
    await this.page.addInitScript((tabsDoc: string) => {
      (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC =
        tabsDoc;
    }, `global-tabs-${id}-${nonce}`);

    // Seed migration storage before first app boot so useSyncedTabs onSynced()
    // consumes deterministic tab state instead of generating a random fallback.
    await this.page.addInitScript((state: typeof tabsState) => {
      localStorage.setItem("tinydocy-tabs", JSON.stringify(state));
    }, tabsState);

    await this.page.goto("/");

    if (id === "playground") {
      if (waitForEditor) {
        await this.page.waitForSelector(".tiptap", {
          state: "visible",
          timeout: 15000,
        });
      }
      return;
    }

    // With synced tabs: migration from localStorage runs when global-tabs is empty.
    // If startup races (rare under soak/reconnect), retry once with explicit
    // localStorage sync + reload to force a deterministic bootstrap.
    try {
      await this.page.waitForSelector(`[data-tab-id="${id}"]`, {
        state: "visible",
        timeout: 15000,
      });
    } catch {
      await this.page.evaluate((state: typeof tabsState) => {
        localStorage.setItem("tinydocy-tabs", JSON.stringify(state));
      }, tabsState);
      await this.page.reload();
      await this.page.waitForSelector(`[data-tab-id="${id}"]`, {
        state: "visible",
        timeout: 15000,
      });
    }

    if (!waitForEditor) return;
    await this.page.waitForSelector(".tiptap", {
      state: "visible",
      timeout: 10000,
    });
  }

  /**
   * Waits for the server's first sync. The editor is editable earlier (it
   * opens from the device copy), and a new document is seeded only after
   * this sync, so typing before it races the seed.
   */
  async waitForSync(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const region = document.querySelector(".document-editor-content");
        return (
          region?.getAttribute("data-server-synced") === "true" &&
          region.querySelector(".tiptap")?.getAttribute("contenteditable") ===
            "true"
        );
      },
      { timeout: 15000 },
    );
    // The seed runs in a React effect after that render; two frames later it
    // has been applied.
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }

  /**
   * Puts the caret at the end of the title and waits for DOM focus.
   *
   * Tiptap's `focus()` calls `view.focus()` in the next frame. Where it
   * thinks it runs on iOS (a touch context on a Mac host: the UA says "Mac"
   * and `ontouchend` exists) it also focuses at once, so the DOM check alone
   * returns before that frame, and the late `view.focus()` pulls focus back
   * from wherever the next key (Alt+F10) moved it. A frame requested after
   * `run()` fires after Tiptap's.
   */
  async focusTitle(): Promise<void> {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const editor = window.__tiptap_editor;
          const title = editor?.state.doc.firstChild;
          if (!editor || !title) return resolve();
          editor
            .chain()
            .focus()
            .setTextSelection(title.nodeSize - 1)
            .run();
          requestAnimationFrame(() => resolve());
        }),
    );
    await this.page.waitForFunction(
      () => document.activeElement?.classList.contains("ProseMirror") ?? false,
    );
  }

  async typeText(text: string, options?: { delay?: number }): Promise<void> {
    await this.page.keyboard.type(text, { delay: options?.delay ?? 0 });
  }

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  async getEditorJSON(): Promise<unknown> {
    return this.page.evaluate(() => window.__tiptap_editor?.getJSON());
  }

  /** Get heading nodes with toc IDs (data-toc-id or id attr). */
  async getHeadingsWithTocIds(): Promise<
    Array<{ tocId: string; level?: number; text?: string }>
  > {
    const json = (await this.getEditorJSON()) as {
      content?: Array<{
        type?: string;
        attrs?: Record<string, unknown>;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };
    const getTocId = (n: { attrs?: Record<string, unknown> }) =>
      (n.attrs?.["data-toc-id"] ?? n.attrs?.id) as string | undefined;
    return (
      json?.content?.filter((n) => n.type === "heading" && getTocId(n)) ?? []
    ).map((n) => {
      const tocId = getTocId(n);
      if (!tocId) {
        throw new Error("Invariant: filtered headings must have toc id");
      }
      return {
        tocId,
        level: n.attrs?.level as number | undefined,
        text: (n.content?.[0] as { text?: string } | undefined)?.text,
      };
    });
  }

  getHeadingByTocId(id: string) {
    return this.page.locator(`.tiptap [data-toc-id="${id}"]`);
  }

  async clickFoldChevron(tocId: string): Promise<void> {
    const row = this.page.locator(
      `.toc-sidebar-item-row[data-toc-id="${tocId}"]`,
    );
    const toggle = row.locator(".toc-sidebar-fold-toggle");
    await toggle.click();
  }

  async isSectionFolded(tocId: string): Promise<boolean> {
    const heading = this.page.locator(`.tiptap [data-toc-id="${tocId}"]`);
    const classes = await heading.getAttribute("class");
    return classes?.includes("heading-section-folded") ?? false;
  }

  getCrinkleElement(tocId: string) {
    return this.page.locator(
      `.tiptap [data-toc-id="${tocId}"] + .heading-fold-crinkle`,
    );
  }

  /** Opens the filter bar; does nothing when it is already open. */
  async openFilter(): Promise<void> {
    const filterInput = this.page.getByLabel("Filter term");
    // The shortcut toggles, so pressing it on an open bar would close it.
    if (await filterInput.isVisible()) return;
    await this.page.click(".tiptap");
    const modifier = getPlaywrightModifierKey();
    await this.page.keyboard.press(`${modifier}+Shift+f`);
    // The shortcut opens the bar after a render; clicking the toggle before
    // that would close it again, so give the shortcut time first.
    try {
      await filterInput.waitFor({ timeout: 2000 });
    } catch {
      await this.page
        .getByRole("button", { name: "Toggle document filter" })
        .click();
      await filterInput.waitFor();
    }
  }

  async typeFilter(query: string): Promise<void> {
    const filterInput = this.page.getByLabel("Filter term");
    await filterInput.fill(query);
  }

  async commitFilter(): Promise<void> {
    const filterInput = this.page.getByLabel("Filter term");
    await filterInput.press("Enter");
  }

  async clearFilter(): Promise<void> {
    const clearBtn = this.page.getByRole("button", {
      name: "Clear all filters",
    });
    await clearBtn.click();
  }

  async getTocItems(): Promise<Array<{ text: string; active: boolean }>> {
    return this.page.evaluate(() => {
      const items = document.querySelectorAll(".toc-sidebar-item");
      return Array.from(items).map((el) => ({
        text: el.textContent?.trim() ?? "",
        active: el.classList.contains("toc-sidebar-item--active"),
      }));
    });
  }

  async clickTocItem(text: string): Promise<void> {
    const item = this.page
      .locator(".toc-sidebar-item", { hasText: text })
      .first();
    await item.waitFor({ state: "visible", timeout: 10000 });
    await item.scrollIntoViewIfNeeded();
    await item.click();
  }

  async buildDocument(
    headings: Array<{ level: number; text: string }>,
  ): Promise<void> {
    // A click lands wherever the seeded document puts the middle of the
    // editor; start in the title instead.
    await this.focusTitle();
    for (let i = 0; i < headings.length; i++) {
      const { level, text } = headings[i];

      if (i === 0) {
        await this.typeText(text);
        await this.pressKey("Enter");
      } else {
        // Heading shortcut is Mod+Alt+level (Meta on Mac, Control on Windows)
        const mod = getPlaywrightModifierKey();
        await this.page.keyboard.press(`${mod}+Alt+${level}`);
        await this.typeText(text);
        await this.pressKey("Enter");
      }
    }
    // Wait for TOC and UniqueID to settle
    await this.page.waitForTimeout(500);
  }

  async setContent(json: unknown): Promise<void> {
    await this.page.evaluate((content: unknown) => {
      window.__tiptap_editor?.commands.setContent(content as JSONContent);
    }, json);
    await this.page.waitForTimeout(200);
  }

  async undo(): Promise<void> {
    const mod = getPlaywrightModifierKey();
    await this.page.keyboard.press(`${mod}+z`);
  }

  async redo(): Promise<void> {
    const mod = getPlaywrightModifierKey();
    await this.page.keyboard.press(`${mod}+Shift+z`);
  }

  /** Inserts text at cursor via editor API (not clipboard paste — does not exercise paste handlers). */
  async insertTextAtCursor(text: string): Promise<void> {
    await this.page.evaluate((t: string) => {
      window.__tiptap_editor?.commands.insertContent(t);
    }, text);
  }

  async changeHeadingLevel(level: number): Promise<void> {
    const mod = getPlaywrightModifierKey();
    await this.page.keyboard.press(`${mod}+Alt+${level}`);
  }

  async scrollToBottom(): Promise<void> {
    await this.page.keyboard.press("End");
    await this.page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight),
    );
  }

  async scrollToTop(): Promise<void> {
    await this.page.keyboard.press("Home");
    await this.page.evaluate(() => window.scrollTo(0, 0));
  }

  async getHeapSize(): Promise<number | null> {
    return this.page.evaluate(() => {
      const perf = performance as Performance & {
        memory?: { usedJSHeapSize: number };
      };
      return perf.memory?.usedJSHeapSize ?? null;
    });
  }

  async getDocumentHeadingCount(): Promise<number> {
    return this.page.evaluate(() => {
      const content = window.__tiptap_editor?.getJSON().content;
      return content?.filter((n) => n.type === "heading").length ?? 0;
    });
  }
}
