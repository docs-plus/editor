import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import type { Editor } from "@tiptap/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  type UseHeadingFilterReturn,
  useHeadingFilter,
} from "@/components/tiptap-ui/heading-filter/use-heading-filter";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PREVIEW_WAIT_MS = 300;

const filterPreview = mock((_query: string) => true);
const commands = {
  filterPreview,
  commitFilter: mock(() => true),
  clearFilter: mock(() => true),
  focus: mock(() => true),
};
const editor = { commands } as unknown as Editor;
const filterState = {
  matchedSectionIds: new Set<string>(),
  totalSections: 0,
  slugs: [],
  mode: "or" as const,
};

const renders: UseHeadingFilterReturn[] = [];
const latest = new Proxy({} as UseHeadingFilterReturn, {
  get: (_, key: keyof UseHeadingFilterReturn) => renders.at(-1)?.[key],
});

function Probe() {
  renders.push(useHeadingFilter({ editor, filterState, serverSynced: true }));
  return null;
}

let root: Root;

beforeEach(() => {
  renders.length = 0;
  for (const command of Object.values(commands)) command.mockClear();
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root.unmount());
});

/** Types a query, then runs `finish` before its preview's debounce ends. */
async function typeThen(finish: () => void) {
  act(() => latest.setQuery("alpha"));
  act(finish);
  await Bun.sleep(PREVIEW_WAIT_MS);
  return filterPreview.mock.calls.map(([query]) => query);
}

describe("useHeadingFilter preview debounce", () => {
  it("previews a typed query after the debounce", async () => {
    expect(await typeThen(() => {})).toEqual(["alpha"]);
  });

  it("drops the pending preview when the query is committed", async () => {
    expect(await typeThen(() => latest.commitFilter())).toEqual([]);
    expect(commands.commitFilter).toHaveBeenCalledWith("alpha");
  });

  it("drops the pending preview when the bar closes", async () => {
    expect(await typeThen(() => latest.closeBar())).toEqual([""]);
  });

  it("drops the pending preview when the filters are cleared", async () => {
    expect(await typeThen(() => latest.clearAllFilters())).toEqual([]);
  });
});
