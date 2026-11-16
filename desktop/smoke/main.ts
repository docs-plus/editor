// D-A12 desktop smoke: the Electron build still has what the desktop app
// depends on. Electron 37.2.0 shipped without `node:sqlite`
// (electron/electron#47671), so every Electron bump runs this first.
//
// Four checks, in order: `node:sqlite` loads, WAL works, a worker thread
// opens the same database and round-trips a row, and a privileged custom
// scheme serves a page. Exit 0 when all pass; otherwise exit 1 with
// `SMOKE_FAIL <check>` on stderr.
//
// SMOKE_BREAK=wal opens an in-memory database instead (journal_mode stays
// `memory`), to see the failure path.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

import { app, BrowserWindow, protocol } from "electron";

type Check = "sqlite" | "wal" | "worker" | "protocol";

const TIMEOUT_MS = 60_000;
const SCHEME = "app";
const ORIGIN = `${SCHEME}://smoke`;

// The scheme must be privileged before `ready` (P2.5 retargets this check to
// the D-A11 origin and the real export).
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setPath("userData", mkdtempSync(path.join(tmpdir(), "tinydocy-smoke-")));
app.disableHardwareAcceleration();

const workDir = mkdtempSync(path.join(tmpdir(), "tinydocy-smoke-db-"));
// Not `__dirname`: Bun.build inlines the source directory for a
// `"type": "module"` package. The app path is the directory of main.cjs.
const appDir = app.getAppPath();

const cleanUp = () => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(app.getPath("userData"), { recursive: true, force: true });
};

const fail = (check: Check | "timeout", detail: unknown): never => {
  process.stderr.write(`SMOKE_FAIL ${check} ${String(detail)}\n`);
  cleanUp();
  // process.exit, not a throw: an uncaught exception in main opens a dialog.
  process.exit(1);
};

const pass = (check: Check, detail: string) => {
  process.stdout.write(`SMOKE_OK ${check} ${detail}\n`);
};

const run = async <T>(check: Check, step: () => T | Promise<T>) => {
  try {
    return await step();
  } catch (error) {
    return fail(check, error);
  }
};

const loadSqlite = () =>
  run("sqlite", () => {
    // `undefined`, not a throw, when this build has no `node:sqlite`.
    const sqlite = process.getBuiltinModule("node:sqlite");
    if (!sqlite) throw new Error("node:sqlite is not built in");
    pass("sqlite", `SQLite ${process.versions.sqlite}`);
    return sqlite;
  });

const checkWal = (sqlite: typeof import("node:sqlite"), dbPath: string) =>
  run("wal", () => {
    const broken = process.env.SMOKE_BREAK === "wal";
    const db = new sqlite.DatabaseSync(broken ? ":memory:" : dbPath);
    const row = db.prepare("PRAGMA journal_mode = WAL").get() as
      | { journal_mode: string }
      | undefined;
    if (row?.journal_mode !== "wal") {
      db.close();
      throw new Error(`journal_mode is ${row?.journal_mode}`);
    }
    db.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    db.prepare("INSERT INTO smoke (id, body) VALUES (1, 'from main')").run();
    pass("wal", "journal_mode=wal");
    return db;
  });

const checkWorker = (db: DatabaseSync, dbPath: string) =>
  run(
    "worker",
    () =>
      new Promise<void>((resolve, reject) => {
        const worker = new Worker(path.join(appDir, "worker.cjs"), {
          workerData: { dbPath },
        });
        worker.once("error", reject);
        worker.once("message", (message: { read?: string; error?: string }) => {
          void worker.terminate();
          if (message.error) return reject(new Error(message.error));
          const back = db
            .prepare("SELECT body FROM smoke WHERE id = 2")
            .get() as { body: string } | undefined;
          if (message.read !== "from main" || back?.body !== "from worker") {
            return reject(
              new Error(`read ${message.read}, wrote back ${back?.body}`),
            );
          }
          pass("worker", "row round-tripped");
          resolve();
        });
      }),
  );

const checkProtocol = () =>
  run("protocol", async () => {
    const page = readFileSync(path.join(appDir, "..", "fixture", "index.html"));
    protocol.handle(SCHEME, (request) => {
      const url = new URL(request.url);
      if (url.host !== "smoke" || url.pathname !== "/index.html") {
        return new Response("not found", { status: 404 });
      }
      return new Response(page, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    await win.loadURL(`${ORIGIN}/index.html`);
    const title = await win.webContents.executeJavaScript("document.title");
    win.destroy();
    if (title !== "smoke") throw new Error(`document.title is ${title}`);
    pass("protocol", `${ORIGIN} served the fixture`);
  });

const main = async () => {
  const dbPath = path.join(workDir, "smoke.sqlite");
  const sqlite = await loadSqlite();
  const db = await checkWal(sqlite, dbPath);
  await checkWorker(db, dbPath);
  db.close();
  await checkProtocol();
  cleanUp();
  app.exit(0);
};

setTimeout(() => fail("timeout", `${TIMEOUT_MS} ms`), TIMEOUT_MS).unref();
app.whenReady().then(main, (error) => fail("protocol", error));
