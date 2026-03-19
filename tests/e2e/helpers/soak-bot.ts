import type { Page } from "@playwright/test";

import { pick, randomInt } from "@/lib/random";

import type { EditorPage } from "./editor-page";
import { getPlaywrightModifierKey } from "./playwright-modifier-key";

const MOD = getPlaywrightModifierKey();

export interface SoakAction {
  name: string;
  weight: number;
  execute: (ep: EditorPage, page: Page) => Promise<void>;
}

const WORDS = [
  "the",
  "quick",
  "brown",
  "fox",
  "jumps",
  "over",
  "lazy",
  "dog",
  "hello",
  "world",
  "test",
  "edit",
  "document",
  "section",
  "content",
];

function randomLowercase(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < len; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function randomSentence(): string {
  const n = randomInt(3, 8);
  const picked: string[] = [];
  for (let i = 0; i < n; i++) {
    picked.push(pick(WORDS));
  }
  return `${picked.join(" ")}.`;
}

export const DEFAULT_ACTIONS: SoakAction[] = [
  {
    name: "type",
    weight: 55,
    execute: async (ep) => {
      const len = randomInt(5, 20);
      await ep.typeText(randomLowercase(len));
    },
  },
  {
    name: "fold",
    weight: 10,
    execute: async (_ep, page) => {
      const toggles = page.locator(".toc-sidebar-fold-toggle");
      const count = await toggles.count();
      if (count === 0) return;
      const target = toggles.nth(Math.floor(Math.random() * count));
      await target.click({ timeout: 2000 });
    },
  },
  {
    name: "unfold",
    weight: 5,
    execute: async (_ep, page) => {
      const toggles = page.locator(".toc-sidebar-fold-toggle");
      const count = await toggles.count();
      if (count === 0) return;
      const target = toggles.nth(Math.floor(Math.random() * count));
      await target.click({ timeout: 2000 });
    },
  },
  {
    name: "scroll",
    weight: 10,
    execute: async (_ep, page) => {
      const toBottom = Math.random() < 0.5;
      if (toBottom) {
        await page.keyboard.press("End");
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        );
      } else {
        await page.keyboard.press("Home");
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    },
  },
  {
    name: "filter",
    weight: 5,
    execute: async (ep, page) => {
      await page.click(".tiptap");
      await ep.openFilter();
      const input = page.locator(".filter-panel-input");
      await input.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
      if (await input.isVisible()) {
        const word = WORDS[Math.floor(Math.random() * WORDS.length)];
        await ep.typeFilter(word);
        await ep.commitFilter();
        await page.waitForTimeout(500);
        await ep.clearFilter();
      }
    },
  },
  {
    name: "drag",
    weight: 3,
    execute: async (ep) => {
      await ep.typeText(randomLowercase(1));
    },
  },
  {
    name: "undo",
    weight: 5,
    execute: async (_ep, page) => {
      await page.keyboard.press(`${MOD}+z`);
    },
  },
  {
    name: "redo",
    weight: 2,
    execute: async (_ep, page) => {
      await page.keyboard.press(`${MOD}+Shift+z`);
    },
  },
  {
    name: "insert",
    weight: 3,
    execute: async (_ep, page) => {
      const text = randomSentence();
      await page.evaluate((t: string) => {
        window.__tiptap_editor?.commands.insertContent(t);
      }, text);
    },
  },
  {
    name: "heading-level",
    weight: 2,
    execute: async (_ep, page) => {
      const level = randomInt(2, 6);
      await page.keyboard.press(`${MOD}+Alt+${level}`);
    },
  },
];

export function pickAction(actions: SoakAction[]): SoakAction {
  const totalWeight = actions.reduce((sum, a) => sum + a.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const action of actions) {
    roll -= action.weight;
    if (roll <= 0) return action;
  }
  return actions[actions.length - 1];
}

export interface SoakRunOptions {
  delayBetweenMs?: number;
  intervalMs?: number;
  onInterval?: (elapsedMs: number) => Promise<void>;
}

export interface SoakStats {
  actionCounts: Record<string, number>;
  totalActions: number;
  errors: Array<{ action: string; error: string; timestamp: number }>;
}

export class SoakBot {
  private actions: SoakAction[];

  constructor(
    private editorPage: EditorPage,
    private page: Page,
    actions?: SoakAction[],
  ) {
    this.actions = actions ?? DEFAULT_ACTIONS;
  }

  async runFor(
    durationMs: number,
    options?: SoakRunOptions,
  ): Promise<SoakStats> {
    const delayBetween = options?.delayBetweenMs ?? 200;
    const intervalMs = options?.intervalMs ?? 30_000;
    const onInterval = options?.onInterval;
    const stats: SoakStats = {
      actionCounts: {},
      totalActions: 0,
      errors: [],
    };
    const start = Date.now();
    let lastIntervalCheck = start;

    while (Date.now() - start < durationMs) {
      const action = pickAction(this.actions);
      try {
        await action.execute(this.editorPage, this.page);
        stats.actionCounts[action.name] =
          (stats.actionCounts[action.name] ?? 0) + 1;
        stats.totalActions++;
      } catch (err) {
        stats.errors.push({
          action: action.name,
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now() - start,
        });
        if (stats.errors.length >= 10) break;
      }

      const now = Date.now();
      if (onInterval && now - lastIntervalCheck >= intervalMs) {
        await onInterval(now - start);
        lastIntervalCheck = now;
      }

      await new Promise((r) => setTimeout(r, delayBetween));
    }

    return stats;
  }
}
