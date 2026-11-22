import { afterEach, describe, expect, it } from "bun:test";

import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

afterEach(() => resetModules());

describe("the Aa sheet's Text row", () => {
  it("gets Text's icon on the registry action when the sheet loads", async () => {
    const { editorActions } = await importFresh<
      typeof import("@/lib/editor-actions")
    >("@/lib/editor-actions");
    const { TypeIcon } = await import("@/lib/icons");
    // The editor chunk's registry carries none (the icon would grow it).
    expect(editorActions.get("style.paragraph")?.icon).toBeUndefined();
    // Same module instances as above (`importFresh` reset them first).
    await import("@/components/smart-toolbar/phone/format-sheet");
    expect(editorActions.get("style.paragraph")?.icon).toBe(TypeIcon);
  });
});
