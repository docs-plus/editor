import { afterEach, describe, expect, it } from "bun:test";

import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type ConfigModule = typeof import("@/lib/sharing/share-config");

const ENV_KEYS = [
  "HOCUS_SHARES",
  "HOCUS_DELETE_ROUTE",
  "MAX_TOTAL_SHARES",
  "HOCUS_SHARE_ORIGINS",
  "SHARE_WS_CONNECTIONS_PER_IP",
] as const;

function loadConfig(): Promise<ConfigModule> {
  return importFresh("@/lib/sharing/share-config");
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  resetModules();
});

describe("share server flags", () => {
  it("ships dark: HOCUS_SHARES defaults to off", async () => {
    delete process.env.HOCUS_SHARES;
    const config = await loadConfig();
    expect(config.HOCUS_SHARES).toBe("off");
  });

  it("ships dark: the Hocus delete route defaults to off", async () => {
    delete process.env.HOCUS_DELETE_ROUTE;
    const config = await loadConfig();
    expect(config.HOCUS_DELETE_ROUTE).toBe(false);
  });

  it("reads on, readonly and off, and treats anything else as off", async () => {
    const { parseSharesMode } = await loadConfig();
    expect(parseSharesMode("on")).toBe("on");
    expect(parseSharesMode(" READONLY ")).toBe("readonly");
    expect(parseSharesMode("off")).toBe("off");
    expect(parseSharesMode("1")).toBe("off");
    expect(parseSharesMode("true")).toBe("off");
    expect(parseSharesMode(undefined)).toBe("off");
  });

  it("turns the delete route on only for on", async () => {
    process.env.HOCUS_DELETE_ROUTE = "on";
    expect((await loadConfig()).HOCUS_DELETE_ROUTE).toBe(true);
    process.env.HOCUS_DELETE_ROUTE = "1";
    expect((await loadConfig()).HOCUS_DELETE_ROUTE).toBe(false);
  });

  it("caps live shares at 2,000 and share sockets at 10 per IP by default", async () => {
    const config = await loadConfig();
    expect(config.MAX_TOTAL_SHARES).toBe(2000);
    expect(config.SHARE_WS_CONNECTIONS_PER_IP).toBe(10);
    expect(config.SHARE_EXPIRY_DAYS).toBe(30);
    expect(config.SHARE_SCHEMA_FLOOR).toBe(3);
  });

  it("normalises the CORS origins", async () => {
    process.env.HOCUS_SHARE_ORIGINS =
      " https://my.tiny.docs.plus/ , app://tinydocy ,, ";
    const config = await loadConfig();
    expect(config.HOCUS_SHARE_ORIGINS).toEqual([
      "https://my.tiny.docs.plus",
      "app://tinydocy",
    ]);
  });
});
