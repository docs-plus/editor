/**
 * Who may send a URL to the system browser (SEC-003). Pure: the Electron
 * glue in `session-hardening.ts` says whether the request came from the
 * app's own top frame, and this decides.
 *
 * - Only `https:` URLs, without credentials.
 * - Only from the app's top frame. A media embed (YouTube…) or any other
 *   subframe is refused silently: it never reaches `shell.openExternal`.
 * - At most {@link EXTERNAL_OPEN_LIMIT} opens per window in
 *   {@link EXTERNAL_OPEN_WINDOW_MS}, so a page can't flood the browser.
 *   The first refusal of a burst is reported (`rateLimitedFirst`), the
 *   rest are not, so the diagnostics ring isn't flooded either.
 */
export const EXTERNAL_OPEN_LIMIT = 3;
export const EXTERNAL_OPEN_WINDOW_MS = 10_000;

export type ExternalOpenRequest = {
  /** The window (`webContents.id`) the request came from. */
  windowId: number;
  url: string;
  fromTopAppFrame: boolean;
  now: number;
};

export type ExternalOpenDecision =
  | { action: "open"; url: string }
  | { action: "refuse"; reason: "scheme" | "frame" }
  | { action: "refuse"; reason: "rate"; rateLimitedFirst: boolean };

/** The `https:` URL to open, normalised, or null. */
export function externalHttpsUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    return null;
  return parsed.href;
}

export class ExternalLinkGate {
  private readonly opened = new Map<number, number[]>();
  private readonly limited = new Set<number>();

  constructor(
    private readonly limit = EXTERNAL_OPEN_LIMIT,
    private readonly windowMs = EXTERNAL_OPEN_WINDOW_MS,
  ) {}

  decide(request: ExternalOpenRequest): ExternalOpenDecision {
    const url = externalHttpsUrl(request.url);
    if (!url) return { action: "refuse", reason: "scheme" };
    if (!request.fromTopAppFrame) return { action: "refuse", reason: "frame" };

    const recent = (this.opened.get(request.windowId) ?? []).filter(
      (at) => request.now - at < this.windowMs,
    );
    if (recent.length >= this.limit) {
      this.opened.set(request.windowId, recent);
      const first = !this.limited.has(request.windowId);
      this.limited.add(request.windowId);
      return { action: "refuse", reason: "rate", rateLimitedFirst: first };
    }
    recent.push(request.now);
    this.opened.set(request.windowId, recent);
    this.limited.delete(request.windowId);
    return { action: "open", url };
  }

  /** The window closed: forget its history. */
  forget(windowId: number): void {
    this.opened.delete(windowId);
    this.limited.delete(windowId);
  }
}
