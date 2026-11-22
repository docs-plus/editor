/**
 * The default sync server goes into the desktop CSP's `connect-src`
 * (SEC-007), so the build refuses anything that could add a directive or a
 * source: it must parse as a URL with only a scheme, host and optional
 * port, and release builds must use `wss:`.
 */
export type Flavor = "release" | "test";

export function validateSyncUrl(raw: string, flavor: Flavor): string {
  const value = raw.trim();
  if (/[\s;,'"]/.test(value)) throw new Error("sync URL has a separator");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("sync URL does not parse");
  }
  const allowed = flavor === "release" ? ["wss:"] : ["wss:", "ws:"];
  if (!allowed.includes(url.protocol))
    throw new Error(`sync URL must use ${allowed.join(" or ")}`);
  if (url.username || url.password || url.search || url.hash)
    throw new Error("sync URL may not carry credentials, a query or a hash");
  if (url.pathname !== "/" && url.pathname !== "")
    throw new Error("sync URL may not carry a path");
  return `${url.protocol}//${url.host}`;
}
