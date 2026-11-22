/**
 * Reads the hosts out of a Chromium net-log (`--log-net-log`), for the
 * offline proof in `offline.spec.ts`. Pure: it takes the file's text. A log
 * cut short by a kill (no closing `]}`) is closed before parsing.
 *
 * Hosts come from event params only (`url`, `host`, `original_url`,
 * `location`), which cover URL requests, sockets and DNS lookups
 * (`HOST_RESOLVER_*` events carry `host`, so a lookup that never connects,
 * such as Windows' `wpad`, still shows).
 */

export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1",
]);

type NetLog = { events?: Array<{ params?: Record<string, unknown> }> };

export function parseNetLog(text: string): NetLog {
  try {
    return JSON.parse(text) as NetLog;
  } catch {
    const trimmed = text.replace(/,?\s*$/, "");
    return JSON.parse(`${trimmed}]}`) as NetLog;
  }
}

export function hostOf(value: string): string | null {
  const url = /^(?:https?|wss?):\/\/(\[[0-9a-f:]+\]|[^/:?#\s]+)/i.exec(value);
  if (url) return url[1].toLowerCase();
  const hostPort = /^([a-z0-9.-]+|\[[0-9a-f:]+\]):\d+$/i.exec(value);
  if (hostPort) return hostPort[1].toLowerCase();
  // A bare DNS name, as HOST_RESOLVER events report it.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(value)
    ? value.toLowerCase()
    : null;
}

const HOST_KEYS = ["url", "host", "original_url", "location"] as const;

/** Every host the log mentions, sorted. */
export function hostsInNetLog(text: string): string[] {
  const hosts = new Set<string>();
  for (const event of parseNetLog(text).events ?? []) {
    const params = event.params ?? {};
    for (const key of HOST_KEYS) {
      const value = params[key];
      if (typeof value !== "string") continue;
      const host = hostOf(value);
      if (host) hosts.add(host);
    }
  }
  return [...hosts].sort();
}

/** Hosts that leave the machine: not loopback and not the app's own origin. */
export function nonLoopback(
  hosts: readonly string[],
  allow: readonly RegExp[] = [],
): string[] {
  return hosts.filter(
    (host) =>
      !LOOPBACK_HOSTS.has(host) &&
      host !== "tinydocy" &&
      !allow.some((pattern) => pattern.test(host)),
  );
}
