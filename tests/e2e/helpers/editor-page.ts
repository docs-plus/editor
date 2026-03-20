import type { Page } from "@playwright/test";
import type { JSONContent } from "@tiptap/core";

import { getPlaywrightModifierKey } from "./playwright-modifier-key";

export class EditorPage {
  constructor(private page: Page) {}

  async goto(docId?: string): Promise<void> {
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
      await this.page.waitForSelector(".tiptap", {
        state: "visible",
        timeout: 15000,
      });
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

    await this.page.waitForSelector(".tiptap", {
      state: "visible",
      timeout: 10000,
    });
  }

  async waitForSync(): Promise<void> {
    await this.page.waitForFunction(
      () =>
        document.querySelector(".tiptap")?.getAttribute("contenteditable") ===
        "true",
      { timeout: 10000 },
    );
    await this.page.waitForTimeout(500);
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

  async openFilter(): Promise<void> {
    await this.page.click(".tiptap");
    const modifier = getPlaywrightModifierKey();
    await this.page.keyboard.press(`${modifier}+Shift+f`);
    const filterBar = this.page.getByRole("search", {
      name: "Document filter",
    });
    if ((await filterBar.count()) === 0) {
      await this.page
        .getByRole("button", { name: "Toggle document filter" })
        .click();
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
    await this.page.click(".tiptap");
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
