import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";

import { importFresh, resetModules } from "@/tests/helpers/import-fresh";
import { type SpawnedHocus, spawnHocus } from "@/tests/helpers/spawn-hocus";

type ProviderModule = typeof import("@hocuspocus/provider");
type HocuspocusModule = typeof import("@/lib/hocuspocus");

const TIMEOUT_MS = 30_000;
const WAIT_MS = 10_000;

/**
 * A real, unmocked copy of a module: a query suffix loads the same file as
 * a separate module, outside any `mock.module` and the module cache.
 */
function importUnmocked<T>(specifier: string): Promise<T> {
  const file = Bun.resolveSync(specifier, import.meta.dir);
  return import(`${file}?unmocked=${crypto.randomUUID()}`);
}

/**
 * Other test files in this process replace `@hocuspocus/provider` and
 * `@/lib/hocuspocus` with fakes, and `mock.module` outlives `resetModules`.
 * Point both back at real copies so `collab-session` talks to a real server
 * over the socket this test reconnects.
 */
async function useRealHocuspocus(): Promise<HocuspocusModule> {
  const hocuspocus = await importUnmocked<HocuspocusModule>("@/lib/hocuspocus");
  mock.module("@/lib/hocuspocus", () => hocuspocus);
  return hocuspocus;
}

// Whatever earlier files left in place, mocked or not: restored in afterAll.
// Copied, because `mock.module` patches existing namespaces in place.
const previousProvider: ProviderModule = {
  ...(await import("@hocuspocus/provider")),
};
const previousHocuspocus: HocuspocusModule = {
  ...(await import("@/lib/hocuspocus")),
};

const realProvider = await importUnmocked<ProviderModule>(
  "@hocuspocus/provider",
);
mock.module("@hocuspocus/provider", () => realProvider);
const { WebSocketStatus } = realProvider;

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await Bun.sleep(20);
  }
}

/** Sum of `refused` over the gate's per-minute `client_schema` lines. */
function countRefused(logs: string): number {
  return logs
    .split("\n")
    .filter((line) => line.includes('"client_schema"'))
    .reduce((sum, line) => sum + (JSON.parse(line).refused ?? 0), 0);
}

let hocus: SpawnedHocus | null = null;
let cleanup: (() => void) | null = null;

afterEach(async () => {
  cleanup?.();
  cleanup = null;
  await hocus?.stop();
  hocus = null;
  delete window.__HOCUS_URL;
  delete window.__HOCUS_SCHEMA;
  resetModules();
});

afterAll(() => {
  mock.module("@hocuspocus/provider", () => previousProvider);
  mock.module("@/lib/hocuspocus", () => previousHocuspocus);
});

describe("client_outdated refusal on a real socket", () => {
  it(
    "a refused session never re-attaches across reconnects",
    async () => {
      hocus = await spawnHocus({ HOCUS_MIN_CLIENT_SCHEMA: "2" });
      window.__HOCUS_URL = hocus.url;
      window.__HOCUS_SCHEMA = "1";
      // The session's module graph uses this copy: one shared socket.
      const { getSharedHocuspocusSocket } = await useRealHocuspocus();
      const { acquireCollabSession, CLIENT_OUTDATED_REASON } =
        await importFresh<typeof import("@/lib/collab-session")>(
          "@/lib/collab-session",
        );
      const session = acquireCollabSession(crypto.randomUUID());
      const socket = getSharedHocuspocusSocket();
      cleanup = () => {
        session.provider.destroy();
        socket.destroy();
      };
      const failures: string[] = [];
      session.provider.on(
        "authenticationFailed",
        ({ reason }: { reason: string }) => failures.push(reason),
      );

      await waitFor(() => session.rejectedReason === CLIENT_OUTDATED_REASON);
      // `connect()` is a no-op until the close has landed. Its promise
      // settles on the first server message, and with no document attached
      // the server sends none: wait for the socket to open instead.
      socket.disconnect();
      await waitFor(() => socket.status === WebSocketStatus.Disconnected);
      void socket.connect();
      await waitFor(() => socket.status === WebSocketStatus.Connected);
      await Bun.sleep(1500);

      expect(failures).toEqual([CLIENT_OUTDATED_REASON]);
      cleanup();
      cleanup = null;
      const server = hocus;
      hocus = null;
      await server.stop();
      expect(countRefused(server.logs())).toBe(1);
    },
    TIMEOUT_MS,
  );
});
