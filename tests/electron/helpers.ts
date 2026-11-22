/**
 * Launch helpers for the `electron` project. Each launch gets its own
 * `userData` (and so its own single-instance lock and library), the
 * diagnostics ring on stdout, and links that are logged, never opened.
 */
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

export const ROOT = resolve(__dirname, "../..");
const STAGE = join(ROOT, "dist/desktop-app");
export const HOCUS_PORT = "1234";

export type DiagnosticEvent = { t: number; event: string } & Record<
  string,
  number | string | boolean
>;

/** The installed or packaged binary, else Electron running the stage. */
function command(args: string[]): { executable: string; args: string[] } {
  const installed = process.env.TINYDOCY_EXECUTABLE;
  if (installed) return { executable: installed, args };
  const electron = createRequire(join(ROOT, "package.json"))(
    "electron",
  ) as string;
  return { executable: electron, args: [STAGE, ...args] };
}

export const newUserData = () => mkdtempSync(join(tmpdir(), "tinydocy-e2e-"));

export function appEnv(userData: string): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    TINYDOCY_USER_DATA: userData,
    TINYDOCY_DIAGNOSTICS_STDOUT: "1",
    TINYDOCY_EXTERNAL_OPEN: "log",
  };
}

export type Launched = {
  app: ElectronApplication;
  userData: string;
  /** Every stdout line main printed, as it arrives. */
  stdout: string[];
};

export async function launch(
  options: { args?: string[]; userData?: string } = {},
): Promise<Launched> {
  const userData = options.userData ?? newUserData();
  const { executable, args } = command(options.args ?? []);
  const app = await _electron.launch({
    executablePath: executable,
    args,
    env: appEnv(userData),
    timeout: 60_000,
  });
  const stdout: string[] = [];
  app.process().stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n"))
      if (line) stdout.push(line);
  });
  return { app, userData, stdout };
}

export const diagnostics = (app: ElectronApplication) =>
  app.evaluate(
    () =>
      (
        globalThis as unknown as {
          __tinydocyDiagnostics: { events(): unknown[] };
        }
      ).__tinydocyDiagnostics.events() as never,
  ) as Promise<DiagnosticEvent[]>;

export async function waitForEvent(
  app: ElectronApplication,
  event: string,
  predicate: (e: DiagnosticEvent) => boolean = () => true,
  timeoutMs = 30_000,
): Promise<DiagnosticEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await diagnostics(app)).find(
      (e) => e.event === event && predicate(e),
    );
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no ${event} within ${timeoutMs} ms`);
}

/** The app's first document window, loaded from the app origin. */
export async function firstPage(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForURL(/^app:\/\/tinydocy\//, { timeout: 60_000 });
  await page.waitForFunction(() => "tinydocy" in window, undefined, {
    timeout: 30_000,
  });
  return page;
}

/**
 * Starts a second instance with `args` and waits for it to exit: it must
 * hand its arguments to the first instance and quit.
 */
export async function secondInstance(
  userData: string,
  args: string[],
): Promise<number | null> {
  const { executable, args: full } = command(args);
  const child = Bun.spawn([executable, ...full], {
    env: appEnv(userData),
    stdout: "ignore",
    stderr: "ignore",
  });
  const timer = setTimeout(() => child.kill(), 30_000);
  const code = await child.exited;
  clearTimeout(timer);
  if (child.signalCode) throw new Error("the second instance did not exit");
  return code;
}

/** Starts Hocus on the port the renderer was exported with. */
export async function startHocus(dbPath: string) {
  const proc = Bun.spawn(["bun", "scripts/hocus-server.ts"], {
    cwd: ROOT,
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      DB_PATH: dbPath,
      HOCUS_PORT,
      HOCUS_HOST: "127.0.0.1",
      HOCUS_THROTTLE: "0",
      HOCUS_ALLOWED_ORIGINS: "app://tinydocy",
    },
  });
  for (let i = 0; i < 150; i++) {
    const up = await fetch(`http://127.0.0.1:${HOCUS_PORT}/`).then(
      () => true,
      () => false,
    );
    if (up) return proc;
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error("hocus did not start");
}
