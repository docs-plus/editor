import type { Page } from "@playwright/test";
import type { JSONContent } from "@tiptap/core";

function getModifierKey(): "Meta" | "Control" {
  return process.platform === "darwin" ? "Meta" : "Control";
}

export class EditorPage {
  constructor(private page: Page) {}

  async goto(docId?: string): Promise<void> {
    const id =
      docId ?? `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tabsState = {
      tabs: [
        { id: "playground", title: "Playground", createdAt: 0 },
        { id, title: "Untitled", createdAt: Date.now() },
      ],
      activeTabId: id,
    };

    await this.page.goto("/");
    await this.page.evaluate((state: typeof tabsState) => {
      localStorage.setItem("tinydocy-tabs", JSON.stringify(state));
    }, tabsState);

    await this.page.reload();

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
    ).map((n) => ({
      tocId: getTocId(n)!,
      level: n.attrs?.level as number | undefined,
      text: (n.content?.[0] as { text?: string } | undefined)?.text,
    }));
  }

  getHeadingByTocId(id: string) {
    return this.page.locator(`[data-toc-id="${id}"]`);
  }

  async clickFoldChevron(tocId: string): Promise<void> {
    const json = (await this.getEditorJSON()) as {
      content?: Array<{
        type?: string;
        attrs?: Record<string, unknown>;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };
    const getTocId = (n: { attrs?: Record<string, unknown> }) =>
      (n.attrs?.["data-toc-id"] ?? n.attrs?.id) as string | undefined;
    const heading = json?.content?.find(
      (n) => n.type === "heading" && getTocId(n) === tocId,
    );
    const text =
      (heading?.content?.[0] as { text?: string } | undefined)?.text ?? "";
    const row = this.page
      .locator(".toc-sidebar-item-row")
      .filter({ hasText: text })
      .first();
    const toggle = row.locator(".toc-sidebar-fold-toggle");
    await toggle.click();
  }

  async isSectionFolded(tocId: string): Promise<boolean> {
    const heading = this.page.locator(`[data-toc-id="${tocId}"]`);
    const classes = await heading.getAttribute("class");
    return classes?.includes("heading-section-folded") ?? false;
  }

  getCrinkleElement(tocId: string) {
    return this.page.locator(
      `[data-toc-id="${tocId}"] + .heading-fold-crinkle`,
    );
  }

  async openFilter(): Promise<void> {
    const modifier = getModifierKey();
    await this.page.keyboard.press(`${modifier}+Shift+f`);
  }

  async typeFilter(query: string): Promise<void> {
    const filterInput = this.page.locator(".filter-panel-input");
    await filterInput.fill(query);
  }

  async commitFilter(): Promise<void> {
    const filterInput = this.page.locator(".filter-panel-input");
    await filterInput.press("Enter");
  }

  async clearFilter(): Promise<void> {
    const clearBtn = this.page.locator(".filter-panel-clear");
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
    const item = this.page.locator(".toc-sidebar-item", { hasText: text });
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
        const mod = getModifierKey();
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
    const mod = getModifierKey();
    await this.page.keyboard.press(`${mod}+z`);
  }

  async redo(): Promise<void> {
    const mod = getModifierKey();
    await this.page.keyboard.press(`${mod}+Shift+z`);
  }

  /** Inserts text at cursor via editor API (not clipboard paste — does not exercise paste handlers). */
  async insertTextAtCursor(text: string): Promise<void> {
    await this.page.evaluate((t: string) => {
      window.__tiptap_editor?.commands.insertContent(t);
    }, text);
  }

  async changeHeadingLevel(level: number): Promise<void> {
    const mod = getModifierKey();
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
