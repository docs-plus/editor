import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "HTTP_MUTATION_RATE_LIMIT",
  "WS_CONNECTION_LIMIT",
  "DOC_CREATION_RATE_LIMIT",
  "MAX_TOTAL_DOCUMENTS",
  "MAX_DOC_SIZE_BYTES",
  "RETENTION_DAYS",
  "TRUSTED_PROXY",
  "NEXT_PUBLIC_MAX_TABS_PER_CLIENT",
  "HOCUS_LOGGER",
  "HOCUS_THROTTLE",
  "HOCUS_THROTTLE_MAX_ATTEMPTS",
  "HOCUS_THROTTLE_BAN_MINUTES",
  "HOCUS_THROTTLE_WINDOW_SECONDS",
  "HOCUS_REDIS",
  "HOCUS_REDIS_HOST",
  "HOCUS_REDIS_PORT",
] as const;

type GuardrailConfigModule = typeof import("@/lib/security/guardrail-config");

function clearGuardrailEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

async function loadConfigModule(): Promise<GuardrailConfigModule> {
  vi.resetModules();
  return import("@/lib/security/guardrail-config");
}

describe("guardrail-config", () => {
  afterEach(() => {
    clearGuardrailEnv();
    vi.resetModules();
  });

  it("uses defaults when env vars are missing", async () => {
    clearGuardrailEnv();
    const config = await loadConfigModule();

    expect(config.HTTP_MUTATION_RATE_LIMIT_PER_MINUTE).toBe(30);
    expect(config.WS_CONNECTION_LIMIT_PER_IP).toBe(10);
    expect(config.DOC_CREATION_RATE_LIMIT_PER_HOUR).toBe(10);
    expect(config.MAX_TOTAL_DOCUMENTS).toBe(2000);
    expect(config.MAX_DOC_SIZE_BYTES).toBe(1_048_576);
    expect(config.RETENTION_DAYS).toBe(30);
    expect(config.TRUSTED_PROXY).toBe(false);
    expect(config.parseClientMaxTabsFromEnv()).toBe(50);
    expect(config.HOCUS_LOGGER_ENABLED).toBe(true);
    expect(config.HOCUS_THROTTLE_ENABLED).toBe(true);
    expect(config.HOCUS_THROTTLE_MAX_ATTEMPTS).toBe(15);
    expect(config.HOCUS_THROTTLE_BAN_MINUTES).toBe(5);
    expect(config.HOCUS_THROTTLE_WINDOW_SECONDS).toBe(60);
    expect(config.HOCUS_REDIS_ENABLED).toBe(false);
    expect(config.HOCUS_REDIS_HOST).toBe("127.0.0.1");
    expect(config.HOCUS_REDIS_PORT).toBe(6380);
  });

  it("parses valid env values", async () => {
    process.env.HTTP_MUTATION_RATE_LIMIT = "45";
    process.env.WS_CONNECTION_LIMIT = "15";
    process.env.DOC_CREATION_RATE_LIMIT = "22";
    process.env.MAX_TOTAL_DOCUMENTS = "5000";
    process.env.MAX_DOC_SIZE_BYTES = "2048";
    process.env.RETENTION_DAYS = "60";
    process.env.TRUSTED_PROXY = "1";
    process.env.NEXT_PUBLIC_MAX_TABS_PER_CLIENT = "80";

    const config = await loadConfigModule();

    expect(config.HTTP_MUTATION_RATE_LIMIT_PER_MINUTE).toBe(45);
    expect(config.WS_CONNECTION_LIMIT_PER_IP).toBe(15);
    expect(config.DOC_CREATION_RATE_LIMIT_PER_HOUR).toBe(22);
    expect(config.MAX_TOTAL_DOCUMENTS).toBe(5000);
    expect(config.MAX_DOC_SIZE_BYTES).toBe(2048);
    expect(config.RETENTION_DAYS).toBe(60);
    expect(config.TRUSTED_PROXY).toBe(true);
    expect(config.parseClientMaxTabsFromEnv()).toBe(80);
  });

  it("falls back to defaults for invalid, zero, negative, or NaN env values", async () => {
    process.env.HTTP_MUTATION_RATE_LIMIT = "0";
    process.env.WS_CONNECTION_LIMIT = "-1";
    process.env.DOC_CREATION_RATE_LIMIT = "abc";
    process.env.MAX_TOTAL_DOCUMENTS = " ";
    process.env.MAX_DOC_SIZE_BYTES = "NaN";
    process.env.RETENTION_DAYS = "-30";
    process.env.NEXT_PUBLIC_MAX_TABS_PER_CLIENT = "0";

    const config = await loadConfigModule();

    expect(config.HTTP_MUTATION_RATE_LIMIT_PER_MINUTE).toBe(30);
    expect(config.WS_CONNECTION_LIMIT_PER_IP).toBe(10);
    expect(config.DOC_CREATION_RATE_LIMIT_PER_HOUR).toBe(10);
    expect(config.MAX_TOTAL_DOCUMENTS).toBe(2000);
    expect(config.MAX_DOC_SIZE_BYTES).toBe(1_048_576);
    expect(config.RETENTION_DAYS).toBe(30);
    expect(config.parseClientMaxTabsFromEnv()).toBe(50);
  });

  it("disables Hocus logger and throttle extensions when set to 0", async () => {
    process.env.HOCUS_LOGGER = "0";
    process.env.HOCUS_THROTTLE = "0";

    const config = await loadConfigModule();

    expect(config.HOCUS_LOGGER_ENABLED).toBe(false);
    expect(config.HOCUS_THROTTLE_ENABLED).toBe(false);
  });

  it("enables and parses Hocus Redis env when configured", async () => {
    process.env.HOCUS_REDIS = "1";
    process.env.HOCUS_REDIS_HOST = "redis.internal";
    process.env.HOCUS_REDIS_PORT = "6391";

    const config = await loadConfigModule();

    expect(config.HOCUS_REDIS_ENABLED).toBe(true);
    expect(config.HOCUS_REDIS_HOST).toBe("redis.internal");
    expect(config.HOCUS_REDIS_PORT).toBe(6391);
  });
});
