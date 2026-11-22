/**
 * Starts `desktop/dev/storage-host.ts` as a child process: one host, so one
 * library, per caller (a Playwright worker for the `local` project). It
 * exits when this process's pipe to it closes, so a killed runner leaves
 * no host behind.
 */
import type { Subprocess } from "bun";

export type SpawnedStorageHost = {
  url: string;
  token: string;
  stop(): Promise<void>;
};

const running = new Set<Subprocess>();
let exitHookInstalled = false;

export async function spawnStorageHost(options: {
  /** The dev server's origin, the only one the host accepts. */
  origin: string;
  timeoutMs?: number;
}): Promise<SpawnedStorageHost> {
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on("exit", () => {
      for (const proc of running) proc.kill("SIGKILL");
    });
  }
  const proc = Bun.spawn(["bun", "desktop/dev/storage-host.ts"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: {
      ...process.env,
      DESKTOP_BRIDGE_ORIGIN: options.origin,
      DESKTOP_BRIDGE_EXIT_ON_STDIN_EOF: "1",
    },
  });
  running.add(proc);

  const reader = proc.stdout.getReader();
  let text = "";
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  while (!text.includes("\n")) {
    if (Date.now() > deadline) {
      proc.kill("SIGKILL");
      throw new Error("storage host did not start");
    }
    const { value, done } = await reader.read();
    if (done) throw new Error(`storage host exited (${await proc.exited})`);
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  const { url, token } = JSON.parse(text.slice(0, text.indexOf("\n"))) as {
    url: string;
    token: string;
  };

  return {
    url,
    token,
    async stop() {
      proc.stdin.end();
      const timer = setTimeout(() => proc.kill("SIGKILL"), 5_000);
      await proc.exited;
      clearTimeout(timer);
      running.delete(proc);
    },
  };
}
