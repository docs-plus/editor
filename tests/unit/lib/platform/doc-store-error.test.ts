import { describe, expect, it } from "bun:test";

import {
  DOC_STORE_ERROR_CODES,
  DocStoreError,
  isDocStoreError,
  isRetryableDocStoreError,
} from "@/lib/platform/doc-store";

describe("DocStoreError", () => {
  it("carries its code and whether it is retryable", () => {
    const error = new DocStoreError("disk_full");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DocStoreError");
    expect(error.code).toBe("disk_full");
    expect(error.retryable).toBe(true);
    expect(isDocStoreError(error)).toBe(true);
    expect(isDocStoreError(new Error("disk_full"))).toBe(false);
  });

  it("marks only transient storage failures retryable", () => {
    const retryable = DOC_STORE_ERROR_CODES.filter(isRetryableDocStoreError);
    expect(retryable.sort()).toEqual([
      "disk_full",
      "io_error",
      "library_unavailable",
      "quota_exceeded",
      "worker_restarting",
    ]);
    expect(new DocStoreError("already_open").retryable).toBe(false);
  });
});
