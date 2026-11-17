/**
 * Spike #100: serves bundled Hunspell dictionaries to Chromium's dictionary
 * downloader over loopback, so Linux spellcheck never leaves the machine.
 *
 * The downloader bypasses protocol.handle (S1: `app://` fails), but it does
 * fetch plain http. This server binds 127.0.0.1 on a random port, answers
 * GET/HEAD for `<lang>-<major>-<minor>.bdic` names that exist in the bundle
 * directory (matched case-insensitively: Chromium lower-cases the URL),
 * and nothing else. It serves public dictionaries only, so another local
 * process reaching it learns nothing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

const NAME = /^[a-z]{2,3}(-[a-z0-9]{2,9})*-\d+-\d+\.bdic$/i;

export interface DictServer {
  /** Pass to session.setSpellCheckerDictionaryDownloadURL. */
  url: string;
  requests: { method: string; path: string; status: number; bytes: number }[];
  close(): void;
}

export async function startDictServer(dir: string): Promise<DictServer> {
  const files = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    if (NAME.test(name)) files.set(name.toLowerCase(), join(dir, name));
  }
  const requests: DictServer["requests"] = [];
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const name = decodeURIComponent(path.slice(1)).toLowerCase();
    const file = NAME.test(name) ? files.get(name) : undefined;
    const method = req.method ?? "GET";
    if ((method !== "GET" && method !== "HEAD") || !file) {
      requests.push({ method, path, status: 404, bytes: 0 });
      res.writeHead(404).end();
      return;
    }
    const body = readFileSync(file);
    requests.push({ method, path, status: 200, bytes: body.length });
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    res.end(method === "HEAD" ? undefined : body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    requests,
    close: () => server.close(),
  };
}
