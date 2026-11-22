import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";

import { isTombstoned } from "@/lib/security/activity-store";
import { createHocusHttpRoutes } from "@/lib/security/hocus-http-routes";
import { createFailedTokenLimiter } from "@/lib/sharing/failed-tokens";
import {
  createShareHttp,
  PREFIX_48_BUDGET_FACTOR,
  type ServerInfo,
  type ShareHttpLimits,
  type ShareHttpOptions,
} from "@/lib/sharing/share-http";
import { mintShareId, shareDocumentName } from "@/lib/sharing/share-name";
import { getShare } from "@/lib/sharing/share-store";
import { createShareDb } from "@/tests/helpers/share-db";
import {
  makeShareSecrets,
  rawSecretForms,
  type ShareSecrets,
} from "@/tests/helpers/share-secrets";

const BASE = "http://hocus.test";
const IP = "203.0.113.20";
const LIBRARY_ORIGIN = "https://my.tiny.docs.plus";
const DAY_MS = 24 * 60 * 60 * 1000;

const INFO: ServerInfo = {
  apiVersion: 1,
  serverVersion: "0.1.0",
  serverSchema: 2,
  minClientSchema: 2,
  minDesktopSchema: 3,
  allowedSchemas: [2, 3],
  maxDocBytes: 2_097_152,
  maxFrameBytes: 2_097_152,
  yjsFormat: 1,
  features: { shares: "on" },
};

const LIMITS: ShareHttpLimits = {
  maxTotalShares: 100,
  expiryMs: 30 * DAY_MS,
  mutationsPerMinute: 1000,
  readsPerMinute: 1000,
  creationsPerHourPerIp: 100,
  creationsPerHour: 1000,
  minSchema: 3,
  maxSchema: 3,
};

let db: Database;
let closed: string[];
let logs: string[];

function createHttp(overrides: Partial<ShareHttpOptions> = {}) {
  return createShareHttp({
    db,
    mode: "on",
    allowedOrigins: [LIBRARY_ORIGIN],
    limits: LIMITS,
    info: INFO,
    closeDocument: (name) => closed.push(name),
    ipHashKey: "test-key",
    auth: {
      db,
      mode: "on",
      expiryMs: LIMITS.expiryMs,
      failedTokens: createFailedTokenLimiter({ perShare: 30, perPrefix: 30 }),
    },
    ...overrides,
  });
}

function createBody(
  secrets: ShareSecrets,
  extra: Record<string, unknown> = {},
) {
  return {
    lineage: crypto.randomUUID(),
    ...secrets.hashes,
    schema: 3,
    ...extra,
  };
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createShare(
  http: ReturnType<typeof createHttp>,
  secrets: ShareSecrets = makeShareSecrets(),
) {
  const response = await http.handle(
    post("/api/shares", createBody(secrets)),
    IP,
  );
  expect(response.status).toBe(201);
  const { share_id } = (await response.json()) as { share_id: string };
  return { shareId: share_id, secrets };
}

beforeEach(() => {
  db = createShareDb();
  closed = [];
  logs = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe("share endpoints while dark", () => {
  it("answer 404 for every share and delete path when the flags are off", async () => {
    const route = createHocusHttpRoutes({ shares: null, deleteDocument: null });
    for (const [method, path] of [
      ["GET", "/api/info"],
      ["POST", "/api/shares"],
      ["GET", `/api/shares/${mintShareId()}/status`],
      ["DELETE", `/api/shares/${mintShareId()}`],
      ["POST", `/api/shares/${mintShareId()}/reset`],
      ["POST", `/api/shares/${mintShareId()}/view-only`],
      ["OPTIONS", "/api/shares"],
      ["DELETE", "/api/documents/abc"],
    ] as const) {
      const response = await route(
        new Request(`${BASE}${path}`, { method }),
        IP,
      );
      expect(response?.status).toBe(404);
    }
  });

  it("leave every other path to the health check", () => {
    const route = createHocusHttpRoutes({ shares: null, deleteDocument: null });
    for (const path of [
      "/",
      "/robots.txt",
      "/api",
      "/api/infox",
      "/api/sharesx",
    ]) {
      expect(route(new Request(`${BASE}${path}`), IP)).toBeNull();
    }
  });
});

describe("GET /api/info", () => {
  it("reports versions, schemas, limits and the shares switch", async () => {
    const response = await createHttp().handle(
      new Request(`${BASE}/api/info`),
      IP,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(INFO);
  });
});

describe("POST /api/shares", () => {
  it("creates a pending share from three hashes; the server mints only share_id", async () => {
    const http = createHttp();
    const { shareId, secrets } = await createShare(http);
    const share = getShare(db, shareId);
    expect(share?.status).toBe("pending");
    expect(Buffer.from(share?.edit_hash ?? []).toString("base64url")).toBe(
      secrets.hashes.edit_hash,
    );
    expect(share?.created_ip_hash).not.toContain(IP);
  });

  it("takes a lineage as a dashed UUID or as 32 hex digits, stored as sent (L5)", async () => {
    const http = createHttp();
    const create = (lineage: string) =>
      http.handle(
        post("/api/shares", createBody(makeShareSecrets(), { lineage })),
        IP,
      );
    const uuid = "0F8FAD5B-D9CB-469F-A165-70867728950E";
    const hex = "6E2B4C8D9A0F4E1B8C7D6A5B4C3D2E1F";
    for (const lineage of [uuid, hex]) {
      const response = await create(lineage);
      expect(response.status).toBe(201);
      const { share_id } = (await response.json()) as { share_id: string };
      // Lowercased, never converted between the two forms.
      expect(getShare(db, share_id)?.lineage).toBe(lineage.toLowerCase());
    }
    for (const lineage of [
      hex.slice(1),
      `${hex}0`,
      `${hex.slice(0, 31)}g`,
      "0f8fad5b-d9cb-469f-a165-70867728950",
      "0f8fad5bd9cb-469f-a165-70867728950e",
    ]) {
      expect((await create(lineage)).status).toBe(400);
    }
  });

  it("never receives or stores a raw link secret (seam S1)", async () => {
    const http = createHttp();
    const { shareId, secrets } = await createShare(http);
    const status = await http.handle(
      new Request(`${BASE}/api/shares/${shareId}/status`, {
        headers: bearer(secrets.authView),
      }),
      IP,
    );
    expect(status.status).toBe(200);
    const dump = JSON.stringify(
      db.prepare("SELECT * FROM shares").all(),
      (_key, value) =>
        value instanceof Uint8Array
          ? Buffer.from(value).toString("base64url")
          : value,
    );
    for (const form of [
      ...rawSecretForms(secrets),
      secrets.authEdit,
      secrets.authView,
      secrets.ownerToken,
    ]) {
      expect(dump).not.toContain(form);
      expect(logs.join("\n")).not.toContain(form);
    }
  });

  it("refuses a body carrying a secret or any unknown key", async () => {
    const secrets = makeShareSecrets();
    const response = await createHttp().handle(
      post(
        "/api/shares",
        createBody(secrets, { e: secrets.e.toString("base64url") }),
      ),
      IP,
    );
    expect(response.status).toBe(400);
  });

  it("refuses hashes that are not 32 bytes or not distinct", async () => {
    const http = createHttp();
    const secrets = makeShareSecrets();
    const short = createBody(secrets, { edit_hash: secrets.ownerToken });
    const same = createBody(secrets, { view_hash: secrets.hashes.edit_hash });
    for (const body of [short, same]) {
      expect((await http.handle(post("/api/shares", body), IP)).status).toBe(
        400,
      );
    }
  });

  it("refuses a schema below the share floor", async () => {
    const response = await createHttp().handle(
      post("/api/shares", createBody(makeShareSecrets(), { schema: 2 })),
      IP,
    );
    expect(response.status).toBe(400);
  });

  it("takes JSON only", async () => {
    const response = await createHttp().handle(
      new Request(`${BASE}/api/shares`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify(createBody(makeShareSecrets())),
      }),
      IP,
    );
    expect(response.status).toBe(415);
  });

  it("refuses an oversized body", async () => {
    const response = await createHttp().handle(
      post(
        "/api/shares",
        createBody(makeShareSecrets(), { lineage: "x".repeat(2000) }),
      ),
      IP,
    );
    expect(response.status).toBe(400);
  });

  it("stops at MAX_TOTAL_SHARES", async () => {
    const http = createHttp({ limits: { ...LIMITS, maxTotalShares: 1 } });
    await createShare(http);
    const response = await http.handle(
      post("/api/shares", createBody(makeShareSecrets())),
      IP,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "shares_full" });
  });

  it("frees a slot when a share stays pending for over an hour (M3)", async () => {
    let t = Date.UTC(2026, 10, 22);
    const http = createHttp({
      now: () => t,
      limits: { ...LIMITS, maxTotalShares: 1 },
    });
    await createShare(http);
    expect(
      (
        await http.handle(
          post("/api/shares", createBody(makeShareSecrets())),
          IP,
        )
      ).status,
    ).toBe(503);
    t += 61 * 60 * 1000;
    await createShare(http);
  });

  it("limits creations per IPv6 /48 as well as per /64 (M3)", async () => {
    const http = createHttp({
      limits: { ...LIMITS, creationsPerHourPerIp: 1 },
    });
    const create = (ip: string) =>
      http.handle(post("/api/shares", createBody(makeShareSecrets())), ip);
    expect((await create("2001:db8:a:1::/64")).status).toBe(201);
    expect((await create("2001:db8:a:1::/64")).status).toBe(429);
    for (let n = 2; n <= PREFIX_48_BUDGET_FACTOR; n++) {
      expect((await create(`2001:db8:a:${n}::/64`)).status).toBe(201);
    }
    expect((await create("2001:db8:a:99::/64")).status).toBe(429);
    expect((await create("2001:db8:b:1::/64")).status).toBe(201);
  });

  it("limits creations per IP and across the server per hour", async () => {
    const perIp = createHttp({
      limits: { ...LIMITS, creationsPerHourPerIp: 1 },
    });
    await createShare(perIp);
    const second = await perIp.handle(
      post("/api/shares", createBody(makeShareSecrets())),
      IP,
    );
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();

    const global = createHttp({ limits: { ...LIMITS, creationsPerHour: 1 } });
    await createShare(global);
    const other = await global.handle(
      post("/api/shares", createBody(makeShareSecrets())),
      "198.51.100.1",
    );
    expect(other.status).toBe(429);
  });

  it("refuses new shares when HOCUS_SHARES=readonly", async () => {
    const response = await createHttp({ mode: "readonly" }).handle(
      post("/api/shares", createBody(makeShareSecrets())),
      IP,
    );
    expect(response.status).toBe(503);
  });
});

describe("HTTP rate limits per IPv6 /48", () => {
  const prefix48 = (limit: number) => limit * PREFIX_48_BUDGET_FACTOR;

  it("give each /48 its own larger budget; a /64 over its own spends none of it", async () => {
    const http = createHttp({ limits: { ...LIMITS, readsPerMinute: 2 } });
    const read = (n: number, block = "a") =>
      http.handle(
        new Request(`${BASE}/api/info`),
        `2001:db8:${block}:${n}::/64`,
      );
    // A noisy /64 is stopped by its own budget ...
    for (let i = 0; i < 20; i++) {
      expect((await read(1)).status).toBe(i < 2 ? 200 : 429);
    }
    // ... and its neighbours keep the rest of the /48's.
    const neighbours = prefix48(2) / 2 - 1;
    for (let n = 2; n < 2 + neighbours; n++) {
      expect((await read(n)).status).toBe(200);
      expect((await read(n)).status).toBe(200);
    }
    expect((await read(99)).status).toBe(429);
    // Another /48 has its own budget.
    expect((await read(1, "b")).status).toBe(200);
  });

  it("never count an owner's stop against its /48 (M1)", async () => {
    const http = createHttp({ limits: { ...LIMITS, mutationsPerMinute: 1 } });
    const { shareId, secrets } = await createShare(http);
    const create = (n: number) =>
      http.handle(
        post("/api/shares", createBody(makeShareSecrets())),
        `2001:db8:a:${n}::/64`,
      );
    for (let n = 1; n <= prefix48(1); n++) {
      expect((await create(n)).status).toBe(201);
    }
    expect((await create(99)).status).toBe(429);
    const stop = await http.handle(
      new Request(`${BASE}/api/shares/${shareId}`, {
        method: "DELETE",
        headers: bearer(secrets.ownerToken),
      }),
      "2001:db8:a:100::/64",
    );
    expect(stop.status).toBe(200);
  });
});

describe("CORS and CSRF", () => {
  it("answers a preflight from an allowed origin only", async () => {
    const http = createHttp();
    const preflight = (origin: string) =>
      http.handle(
        new Request(`${BASE}/api/shares`, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "POST",
          },
        }),
        IP,
      );
    const allowed = await preflight(LIBRARY_ORIGIN);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      LIBRARY_ORIGIN,
    );
    expect(allowed.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
    expect((await preflight("https://evil.example")).status).toBe(403);
  });

  it("refuses a mutation from another origin, even a simple one", async () => {
    const http = createHttp();
    const { shareId, secrets } = await createShare(http);
    const response = await http.handle(
      new Request(`${BASE}/api/shares/${shareId}`, {
        method: "DELETE",
        headers: {
          origin: "https://evil.example",
          ...bearer(secrets.ownerToken),
        },
      }),
      IP,
    );
    expect(response.status).toBe(403);
    expect(getShare(db, shareId)?.status).toBe("pending");
  });

  it("echoes only allowed origins and never allows credentials", async () => {
    const http = createHttp();
    const response = await http.handle(
      new Request(`${BASE}/api/info`, {
        headers: { origin: "https://evil.example" },
      }),
      IP,
    );
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("owner endpoints", () => {
  it("a flood of wrong tokens never locks the owner out of stopping (M1)", async () => {
    const http = createHttp({
      auth: {
        db,
        mode: "on",
        expiryMs: LIMITS.expiryMs,
        failedTokens: createFailedTokenLimiter({ perShare: 3, perPrefix: 3 }),
      },
    });
    const { shareId, secrets } = await createShare(http);
    const stopWith = (token: string, ip: string) =>
      http.handle(
        new Request(`${BASE}/api/shares/${shareId}`, {
          method: "DELETE",
          headers: bearer(token),
        }),
        ip,
      );
    // Wrong tokens from more addresses than the per-share limit.
    for (let i = 0; i < 10; i++) {
      await stopWith(makeShareSecrets().ownerToken, `198.51.100.${i}`);
    }
    expect(
      (await stopWith(makeShareSecrets().ownerToken, "198.51.100.200")).status,
    ).toBe(429);

    const response = await stopWith(secrets.ownerToken, IP);
    expect(response.status).toBe(200);
    expect(getShare(db, shareId)?.ended_reason).toBe("sharing_stopped");
  });

  it("stop: needs the owner secret, ends the share and closes its connections", async () => {
    const http = createHttp();
    const { shareId, secrets } = await createShare(http);
    const stop = (token: string) =>
      http.handle(
        new Request(`${BASE}/api/shares/${shareId}`, {
          method: "DELETE",
          headers: bearer(token),
        }),
        IP,
      );
    expect((await stop(secrets.authEdit)).status).toBe(404);
    expect((await stop(makeShareSecrets().ownerToken)).status).toBe(404);
    expect(closed).toEqual([]);

    const response = await stop(secrets.ownerToken);
    expect(response.status).toBe(200);
    expect(getShare(db, shareId)?.ended_reason).toBe("sharing_stopped");
    expect(isTombstoned(db, shareDocumentName(shareId))).toBe(true);
    expect(closed).toEqual([shareDocumentName(shareId)]);
    // Ended shares never come back; the owner is told why.
    const again = await stop(secrets.ownerToken);
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ error: "sharing_stopped" });
  });

  it("view-only: keeps the share, closes connections so editors reconnect", async () => {
    const http = createHttp();
    const { shareId, secrets } = await createShare(http);
    const response = await http.handle(
      post(`/api/shares/${shareId}/view-only`, {}, bearer(secrets.ownerToken)),
      IP,
    );
    expect(response.status).toBe(200);
    expect(getShare(db, shareId)?.view_only).toBe(1);
    expect(closed).toEqual([shareDocumentName(shareId)]);
  });

  it("reset: the old link ends as link_reset and a new share_id comes back", async () => {
    const http = createHttp();
    const { shareId, secrets } = await createShare(http);
    const next = makeShareSecrets();
    const response = await http.handle(
      post(
        `/api/shares/${shareId}/reset`,
        { ...next.hashes, schema: 3 },
        bearer(secrets.ownerToken),
      ),
      IP,
    );
    expect(response.status).toBe(201);
    const { share_id } = (await response.json()) as { share_id: string };
    expect(share_id).not.toBe(shareId);
    expect(getShare(db, shareId)?.ended_reason).toBe("link_reset");
    expect(
      Buffer.from(getShare(db, share_id)?.owner_hash ?? []).toString(
        "base64url",
      ),
    ).toBe(next.hashes.owner_hash);
    expect(closed).toEqual([shareDocumentName(shareId)]);
  });

  it("reset and create refuse hashes another share already has (L2)", async () => {
    const http = createHttp();
    const { shareId, secrets } = await createShare(http);
    const reused = await http.handle(
      post(
        `/api/shares/${shareId}/reset`,
        { ...secrets.hashes, schema: 3 },
        bearer(secrets.ownerToken),
      ),
      IP,
    );
    expect(reused.status).toBe(409);
    expect(await reused.json()).toEqual({ error: "hash_in_use" });
    // Nothing changed: the old link still works.
    expect(getShare(db, shareId)?.status).toBe("pending");
    expect(closed).toEqual([]);

    // One reused hash among fresh ones is refused too.
    const fresh = makeShareSecrets();
    const mixed = await http.handle(
      post(
        "/api/shares",
        createBody(fresh, { view_hash: secrets.hashes.view_hash }),
      ),
      IP,
    );
    expect(mixed.status).toBe(409);
  });

  it("status: any token of the share, reasons only for token holders", async () => {
    const http = createHttp();
    const { shareId, secrets } = await createShare(http);
    const status = (token: string) =>
      http.handle(
        new Request(`${BASE}/api/shares/${shareId}/status`, {
          headers: bearer(token),
        }),
        IP,
      );
    expect(await (await status(secrets.ownerToken)).json()).toEqual({
      status: "pending",
      view_only: false,
    });
    expect((await status(makeShareSecrets().authEdit)).status).toBe(404);
    await http.handle(
      new Request(`${BASE}/api/shares/${shareId}`, {
        method: "DELETE",
        headers: bearer(secrets.ownerToken),
      }),
      IP,
    );
    expect(await (await status(secrets.authView)).json()).toEqual({
      status: "ended",
      reason: "sharing_stopped",
    });
  });

  it("pauses wrong owner secrets after too many of them", async () => {
    const http = createHttp({
      auth: {
        db,
        mode: "on",
        expiryMs: LIMITS.expiryMs,
        failedTokens: createFailedTokenLimiter({ perShare: 2, perPrefix: 100 }),
      },
    });
    const { shareId } = await createShare(http);
    const stop = (token: string) =>
      http.handle(
        new Request(`${BASE}/api/shares/${shareId}`, {
          method: "DELETE",
          headers: bearer(token),
        }),
        IP,
      );
    await stop(makeShareSecrets().ownerToken);
    await stop(makeShareSecrets().ownerToken);
    expect((await stop(makeShareSecrets().ownerToken)).status).toBe(429);
    expect(getShare(db, shareId)?.status).toBe("pending");
  });

  it("rejects unknown routes and wrong methods", async () => {
    const http = createHttp();
    const id = mintShareId();
    expect(
      (await http.handle(new Request(`${BASE}/api/shares/not-a-uuid`), IP))
        .status,
    ).toBe(404);
    expect(
      (await http.handle(new Request(`${BASE}/api/shares/${id}/nope`), IP))
        .status,
    ).toBe(404);
    const wrong = await http.handle(new Request(`${BASE}/api/shares`), IP);
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("POST");
  });
});
