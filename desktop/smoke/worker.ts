// Worker half of the D-A12 smoke: open the database main created, read
// main's row and write one back.
import { parentPort, workerData } from "node:worker_threads";

const { dbPath } = workerData as { dbPath: string };

try {
  const sqlite = process.getBuiltinModule("node:sqlite");
  if (!sqlite) throw new Error("node:sqlite is not built in");
  const db = new sqlite.DatabaseSync(dbPath);
  const row = db.prepare("SELECT body FROM smoke WHERE id = 1").get() as
    | { body: string }
    | undefined;
  db.prepare("INSERT INTO smoke (id, body) VALUES (2, 'from worker')").run();
  db.close();
  parentPort?.postMessage({ read: row?.body });
} catch (error) {
  parentPort?.postMessage({ error: String(error) });
}
