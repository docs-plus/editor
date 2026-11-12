/**
 * Client version sent on the collab WebSocket URL. The server reads `schema`
 * to gate outdated bundles. No browser imports at module level: the server
 * imports this file too.
 */
declare global {
  interface Window {
    /** E2E: overrides the `schema` value sent on the socket URL. */
    __HOCUS_SCHEMA?: string;
  }
}

export const CLIENT_SCHEMA = 2;

export const CLIENT_BUILD: string =
  process.env.NEXT_PUBLIC_BUILD_ID?.trim() || "dev";

export function withClientVersion(wsUrl: string): string {
  const url = new URL(wsUrl);
  const override =
    typeof window !== "undefined" ? window.__HOCUS_SCHEMA : undefined;
  url.searchParams.set("schema", override ?? String(CLIENT_SCHEMA));
  url.searchParams.set("build", CLIENT_BUILD);
  return url.toString();
}
