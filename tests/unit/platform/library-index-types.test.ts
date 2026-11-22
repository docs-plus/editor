import { describe, expect, it } from "bun:test";

import type {
  DocumentIndex,
  LibraryIndex,
} from "@/lib/platform/document-index";
import type { GlobalTabsIndex } from "@/lib/platform/web/global-tabs-index";
import type { MemoryDocumentIndex } from "@/tests/helpers/memory-document-index";

/**
 * The web sandbox refuses the library operations by type: `GlobalTabsIndex`
 * is a `DocumentIndex` and not a `LibraryIndex`, so the library components
 * (which take a `LibraryIndex`) can't be handed the public tab list. `tsc`
 * checks these lines (`bun run typecheck`).
 */
type IsLibrary<T> = T extends LibraryIndex ? true : false;
type IsDocumentIndex<T> = T extends DocumentIndex ? true : false;

const sandboxIsDocumentIndex: IsDocumentIndex<GlobalTabsIndex> = true;
const sandboxIsNotLibrary: IsLibrary<GlobalTabsIndex> = false;
const memoryIsLibrary: IsLibrary<MemoryDocumentIndex> = true;

describe("LibraryIndex and the web sandbox", () => {
  it("keeps GlobalTabsIndex a plain DocumentIndex", () => {
    expect([
      sandboxIsDocumentIndex,
      sandboxIsNotLibrary,
      memoryIsLibrary,
    ]).toEqual([true, false, true]);
  });
});
