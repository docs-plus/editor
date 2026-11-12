import { describe, expect, it, vi } from "bun:test";

import { reloadAfterFlush } from "@/components/document-editor/document-notice";

describe("reloadAfterFlush", () => {
  it("reloads once the device copies are flushed", async () => {
    const reload = vi.fn();
    await reloadAfterFlush(() => Promise.resolve(), reload, 1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads after the timeout when the flush hangs", async () => {
    const reload = vi.fn();
    const started = Date.now();
    await reloadAfterFlush(() => new Promise<void>(() => {}), reload, 30);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("reloads when the flush fails", async () => {
    const reload = vi.fn();
    await reloadAfterFlush(
      () => Promise.reject(new Error("quota")),
      reload,
      1000,
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
