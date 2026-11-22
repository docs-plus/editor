import { describe, expect, it } from "bun:test";

import {
  detectEngine,
  ESTIMATE_GROWTH_BYTES,
  ESTIMATE_MIN_INTERVAL_MS,
  isStorageAlmostFull,
  mayRequestPersist,
  readPersisted,
  requestPersistence,
  STATIC_QUOTA_BYTES,
  StorageEstimator,
  type StorageLike,
} from "@/lib/platform/web/library/storage-health";

const MB = 1024 * 1024;

const UA = {
  chrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  firefox:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:133.0) Gecko/20100101 Firefox/133.0",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  iosEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/131.2903.68 Mobile/15E148 Safari/605.1.15",
  iosFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15",
  ipadChrome:
    "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
};

describe("detectEngine", () => {
  it("names the engine from the user agent", () => {
    expect(detectEngine(UA.chrome)).toBe("chromium");
    expect(detectEngine(UA.edge)).toBe("chromium");
    expect(detectEngine(UA.firefox)).toBe("firefox");
    expect(detectEngine(UA.safari)).toBe("webkit");
    expect(detectEngine("curl/8.0")).toBe("unknown");
  });

  it("names every iOS browser WebKit, whatever brand it shows", () => {
    expect(detectEngine(UA.iosChrome)).toBe("webkit");
    expect(detectEngine(UA.iosEdge)).toBe("webkit");
    expect(detectEngine(UA.iosFirefox)).toBe("webkit");
    expect(detectEngine(UA.ipadChrome)).toBe("webkit");
  });
});

describe("persist() (§2.7)", () => {
  it("asks Chromium and Safari silently, Firefox and unknown engines only from a click", () => {
    for (const engine of ["chromium", "webkit"] as const) {
      expect(mayRequestPersist(engine, "first_document")).toBe(true);
      expect(mayRequestPersist(engine, "app_installed")).toBe(true);
      expect(mayRequestPersist(engine, "click")).toBe(true);
    }
    for (const engine of ["firefox", "unknown"] as const) {
      expect(mayRequestPersist(engine, "first_document")).toBe(false);
      expect(mayRequestPersist(engine, "app_installed")).toBe(false);
      expect(mayRequestPersist(engine, "click")).toBe(true);
    }
  });

  it("calls persist() only when allowed and survives a missing or failing API", async () => {
    let calls = 0;
    const storage: StorageLike = {
      persist: async () => {
        calls++;
        return true;
      },
    };
    expect(await requestPersistence(storage, "firefox", "first_document")).toBe(
      null,
    );
    expect(calls).toBe(0);
    expect(await requestPersistence(storage, "firefox", "click")).toBe(true);
    expect(calls).toBe(1);
    expect(await requestPersistence(undefined, "chromium", "click")).toBe(null);
    expect(
      await requestPersistence(
        {
          persist: async () => {
            throw new TypeError("disabled");
          },
        },
        "chromium",
        "click",
      ),
    ).toBe(null);
  });

  it("reads persisted() as false when it is missing or throws", async () => {
    expect(await readPersisted({ persisted: async () => true })).toBe(true);
    expect(await readPersisted({ persisted: async () => false })).toBe(false);
    expect(await readPersisted(undefined)).toBe(false);
    expect(
      await readPersisted({
        persisted: async () => {
          throw new TypeError("disabled");
        },
      }),
    ).toBe(false);
  });
});

describe("storage estimate (§2.6)", () => {
  it("warns only under a believable quota with less than 100 MB left", () => {
    expect(isStorageAlmostFull({ usage: 950 * MB, quota: 1000 * MB })).toBe(
      true,
    );
    expect(isStorageAlmostFull({ usage: 100 * MB, quota: 1000 * MB })).toBe(
      false,
    );
    // Chromium's usage + 10 GiB report never warns.
    expect(
      isStorageAlmostFull({
        usage: STATIC_QUOTA_BYTES,
        quota: STATIC_QUOTA_BYTES + 50 * MB,
      }),
    ).toBe(false);
  });

  it("estimates at startup, then after 5 MB of growth and at most once a minute", async () => {
    let now = 0;
    let calls = 0;
    const estimator = new StorageEstimator(
      {
        estimate: async () => {
          calls++;
          return { usage: calls * MB, quota: 1000 * MB };
        },
      },
      () => now,
    );
    expect(await estimator.estimate()).toEqual({ usage: MB, quota: 1000 * MB });
    expect(calls).toBe(1);

    estimator.noteGrowth(ESTIMATE_GROWTH_BYTES);
    now = ESTIMATE_MIN_INTERVAL_MS - 1;
    await estimator.estimate();
    expect(calls).toBe(1);

    now = ESTIMATE_MIN_INTERVAL_MS;
    expect((await estimator.estimate())?.usage).toBe(2 * MB);
    expect(calls).toBe(2);

    now += 10 * ESTIMATE_MIN_INTERVAL_MS;
    await estimator.estimate();
    expect(calls).toBe(2);
  });

  it("reads a throwing estimate() as unknown", async () => {
    const estimator = new StorageEstimator({
      estimate: async () => {
        throw new TypeError("storage disabled");
      },
    });
    expect(await estimator.estimate()).toBeNull();
    expect(await new StorageEstimator(undefined).estimate()).toBeNull();
  });
});
