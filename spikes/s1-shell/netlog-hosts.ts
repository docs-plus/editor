/**
 * Lists the hosts in a Chromium net-log (works on a log cut short by a kill).
 * Usage: bun spikes/s1-shell/netlog-hosts.ts <netlog.json>
 */
import { readFileSync } from "node:fs";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Parses the log (closing a truncated one) and reads hosts from events only. */
function parseNetLog(text: string): {
  events?: { params?: Record<string, unknown> }[];
} {
  try {
    return JSON.parse(text);
  } catch {
    const trimmed = text.replace(/,?\s*$/, "");
    return JSON.parse(`${trimmed}]}`);
  }
}

function hostOf(value: string): string | null {
  const url = /^(?:https?|wss?):\/\/([^/:?#]+)/i.exec(value);
  if (url) return url[1].toLowerCase();
  const hostPort = /^([a-z0-9.-]+|\[[0-9a-f:]+\]):\d+$/i.exec(value);
  return hostPort ? hostPort[1].toLowerCase() : null;
}

export function hostsInNetLog(path: string): string[] {
  const log = parseNetLog(readFileSync(path, "utf8"));
  const hosts = new Set<string>();
  for (const event of log.events ?? []) {
    const params = event.params ?? {};
    for (const key of ["url", "host", "original_url", "location"]) {
      const value = params[key];
      if (typeof value !== "string") continue;
      const host = hostOf(value);
      if (host) hosts.add(host);
    }
  }
  return [...hosts].sort();
}

export function nonLoopback(hosts: string[], ignore: RegExp[] = []): string[] {
  return hosts.filter(
    (h) =>
      !LOOPBACK.has(h) &&
      !h.endsWith(".invalid") &&
      h !== "tinydocy" &&
      !ignore.some((re) => re.test(h)),
  );
}

if (import.meta.main) {
  const hosts = hostsInNetLog(process.argv[2]);
  console.log(
    JSON.stringify({ all: hosts, nonLoopback: nonLoopback(hosts) }, null, 2),
  );
}
