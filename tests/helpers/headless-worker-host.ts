/**
 * Started as a plain `bun` process (so the test preload's DOM is absent):
 * runs `headless-worker.ts` in a `node:worker_threads` Worker and prints its
 * result as JSON.
 */
import { Worker } from "node:worker_threads";

const worker = new Worker(new URL("./headless-worker.ts", import.meta.url));
worker.once("message", (result) => {
  process.stdout.write(JSON.stringify(result));
  void worker.terminate();
});
worker.once("error", (error: Error) => {
  process.stderr.write(String(error.stack ?? error));
  process.exit(1);
});
