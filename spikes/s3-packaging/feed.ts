// Generic update feed: a Bun static server on 127.0.0.1:8787 that serves
// <root> under /feed/ and logs every request (method, path, query, status,
// Range header) to stdout and to --log.
//   bun feed.ts --root dist/feeds/<scenario> [--log feed.log] [--port 8787]
import { appendFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

export interface FeedHandle {
  stop: () => void;
  url: string;
}

export const startFeed = (
  root: string,
  logFile?: string,
  port = 8787,
): FeedHandle => {
  const base = path.resolve(root);
  const log = (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(`[feed] ${stamped}`);
    if (logFile) appendFileSync(logFile, `${stamped}\n`);
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req) {
      const url = new URL(req.url);
      const range = req.headers.get("range");
      const respond = (status: number, body?: Response) => {
        log(
          `${req.method} ${url.pathname}${url.search} ${status}${range ? ` range=${range}` : ""}`,
        );
        return body ?? new Response(null, { status });
      };
      if (!url.pathname.startsWith("/feed/")) return respond(404);
      const rel = decodeURIComponent(url.pathname.slice("/feed/".length));
      const file = path.resolve(base, rel);
      if (!file.startsWith(base + path.sep) || !existsSync(file)) {
        return respond(404);
      }
      if (!statSync(file).isFile()) return respond(404);
      // Full bodies only: the probe sets disableDifferentialDownload, so a
      // Range request in the log would itself be a finding.
      return respond(200, new Response(Bun.file(file)));
    },
  });
  log(`serving ${base} at http://127.0.0.1:${server.port}/feed/`);
  return {
    stop: () => server.stop(true),
    url: `http://127.0.0.1:${server.port}/feed/`,
  };
};

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      log: { type: "string" },
      port: { type: "string", default: "8787" },
    },
  });
  if (!values.root) throw new Error("--root is required");
  startFeed(values.root, values.log, Number(values.port));
}
