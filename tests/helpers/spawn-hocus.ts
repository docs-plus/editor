import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const READY_LINE = "Hocuspocus listening";
const READY_TIMEOUT_MS = 15_000;
const PORT_ATTEMPTS = 3;

/** The raised socket limits the e2e dev servers run with (playwright.config.ts). */
const E2E_LIMITS = {
  DOC_CREATION_RATE_LIMIT: "2000",
  WS_CONNECTION_LIMIT: "200",
  WS_SOCKETS_PER_IP: "600",
  WS_UPGRADE_RATE_LIMIT: "6000",
};

export type SpawnedHocus = {
  url: string;
  dbPath: string;
  /** Everything the server wrote to stdout and stderr so far. */
  logs(): string;
  /** SIGTERM, then waits for exit and for the output to drain. */
  stop(): Promise<void>;
};

function randomPort(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}

/** A fresh temp directory holding `db.sqlite`, removed by `stop()`. */
export function createTempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "hocus-")), "db.sqlite");
}

async function startOnce(
  port: number,
  env: Record<string, string>,
): Promise<SpawnedHocus | null> {
  const dbPath = env.DB_PATH ?? createTempDbPath();
  const merged: Record<string, string | undefined> = {
    ...process.env,
    // Env from other test files in this process must not leak into the server.
    HOCUS_MIN_CLIENT_SCHEMA: undefined,
    HOCUS_ALLOWED_ORIGINS: undefined,
    NODE_ENV: "test",
    HOCUS_HOST: "127.0.0.1",
    HOCUS_PORT: String(port),
    DB_PATH: dbPath,
    HOCUS_THROTTLE: "0",
    HOCUS_LOGGER: "0",
    HOCUS_ALLOW_ISOLATED_TABS_DOCS: "1",
    ...E2E_LIMITS,
    ...env,
  };
  const childEnv = Object.fromEntries(
    Object.entries(merged).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const proc = Bun.spawn(["bun", "scripts/hocus-server.ts"], {
    cwd: REPO_ROOT,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  let output = "";
  let onOutput = () => {};
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      output += decoder.decode(chunk, { stream: true });
      onOutput();
    }
  };
  const drained = Promise.all([drain(proc.stdout), drain(proc.stderr)]);

  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS);
    onOutput = () => {
      if (!output.includes(READY_LINE)) return;
      clearTimeout(timer);
      resolve(true);
    };
    onOutput();
    proc.exited.then(() => {
      clearTimeout(timer);
      resolve(output.includes(READY_LINE));
    });
  });

  const cleanup = () => {
    if (!env.DB_PATH)
      rmSync(path.dirname(dbPath), { recursive: true, force: true });
  };

  if (!ready) {
    proc.kill("SIGKILL");
    await proc.exited;
    await drained;
    cleanup();
    if (output.includes("EADDRINUSE") || /address.*in use/i.test(output)) {
      return null;
    }
    throw new Error(`hocus-server did not start:\n${output}`);
  }

  return {
    url: `ws://127.0.0.1:${port}`,
    dbPath,
    logs: () => output,
    async stop() {
      if (proc.exitCode === null) proc.kill("SIGTERM");
      await proc.exited;
      await drained;
    },
  };
}

/**
 * Runs `bun scripts/hocus-server.ts` on a random port (20000–40000) with a
 * temp `DB_PATH`, throttle and logger off, isolated tab lists allowed and the
 * raised e2e socket limits, then `env` on top. Resolves once it listens.
 * The temp DB stays readable after `stop()`; callers that passed `DB_PATH`
 * own its cleanup.
 */
export async function spawnHocus(
  env: Record<string, string> = {},
): Promise<SpawnedHocus> {
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const server = await startOnce(randomPort(), env);
    if (server) return server;
  }
  throw new Error("hocus-server: no free port after retries");
}
