/**
 * Reads the hosts out of a Chromium net-log (`--log-net-log`), for the
 * offline proof in `offline.spec.ts`. Pure: it takes the file's text. A log
 * cut short by a kill (no closing `]}`) is closed before parsing.
 *
 * It fails closed: every param that can name a peer is read (URLs, `host`,
 * socket addresses, address lists), URLs go through the real URL parser
 * (so `user@host` yields the host, not the userinfo), and a value that
 * looks like it names a peer but doesn't parse is reported in `unparsed`,
 * which the spec requires to be empty.
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

/** The app's own origin is served by main, never over the network. */
const APP_SCHEME = "app:";

type HostRead = { host: string } | { skip: true } | { unparsed: true };

/** One param value: a host, nothing to report, or something we couldn't read. */
export function readHost(value: string): HostRead {
  const text = value.trim();
  if (text === "") return { skip: true };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      if (url.protocol === APP_SCHEME) return { skip: true };
      return url.hostname
        ? { host: url.hostname.toLowerCase() }
        : { unparsed: true };
    } catch {
      return { unparsed: true };
    }
  }
  // host:port, [v6]:port
  const hostPort = /^(\[[0-9a-f:.]+\]|[a-z0-9._-]+):\d+$/i.exec(text);
  if (hostPort) return { host: hostPort[1].toLowerCase() };
  // A bare IPv6 address (with at least two colons).
  if (/^[0-9a-f]*:[0-9a-f]*:[0-9a-f:.]*$/i.test(text))
    return { host: `[${text.toLowerCase()}]`.replace("[::1]", "[::1]") };
  // A bare DNS name or IPv4 address, as resolver and socket events report it.
  if (/^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.?$/i.test(text))
    return { host: text.replace(/\.$/, "").toLowerCase() };
  // Anything else with an @, a slash or a colon names something we can't read.
  return /[@/:]/.test(text) ? { unparsed: true } : { skip: true };
}

/** Backwards-compatible: the host, or null. */
export function hostOf(value: string): string | null {
  const read = readHost(value);
  return "host" in read ? read.host : null;
}

const HOST_KEYS = [
  "url",
  "host",
  "original_url",
  "location",
  "address",
  "remote_address",
  "source_address",
  "local_address",
  "endpoint",
  "server",
] as const;
const LIST_KEYS = ["address_list", "addresses", "aliases"] as const;

export type NetLogScan = { hosts: string[]; unparsed: string[] };

export function scanNetLog(text: string): NetLogScan {
  const hosts = new Set<string>();
  const unparsed = new Set<string>();
  const take = (value: unknown) => {
    if (typeof value !== "string") return;
    const read = readHost(value);
    if ("host" in read) hosts.add(read.host);
    else if ("unparsed" in read) unparsed.add(value.slice(0, 200));
  };
  for (const event of parseNetLog(text).events ?? []) {
    const params = event.params ?? {};
    for (const key of HOST_KEYS) take(params[key]);
    for (const key of LIST_KEYS) {
      const list = params[key];
      if (Array.isArray(list)) for (const item of list) take(item);
    }
  }
  return { hosts: [...hosts].sort(), unparsed: [...unparsed].sort() };
}

/** Every host the log mentions, sorted. */
export function hostsInNetLog(text: string): string[] {
  return scanNetLog(text).hosts;
}

/** Hosts that leave the machine: not loopback and not on the exact-name allowlist. */
export function nonLoopback(
  hosts: readonly string[],
  allow: readonly string[] = [],
): string[] {
  const allowed = new Set(allow);
  return hosts.filter(
    (host) => !LOOPBACK_HOSTS.has(host) && !allowed.has(host),
  );
}
