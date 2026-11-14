import type { APIResponse, Page, Route } from "@playwright/test";

/**
 * A string only the chunk that defines each lazy surface contains, under
 * `next dev` (the e2e server). Production minifies these names away.
 */
export const CHUNK_MARKERS = {
  bubble: "function SelectionBubbleView",
  colorPanel: "function ColorPanel",
  insertStep: "function InsertStep",
  palette: "function CommandPalette({",
  engine: "const v11Engine = {",
  menus: "function StyleMenuItems(",
} as const;

const CHUNKS = "**/_next/static/chunks/**";

/**
 * Sends the chunk whose body contains `marker` to `onMatch` (to fail or
 * hold it); every other chunk passes through. Chunk URLs are hashed, so the
 * body is the only stable way to find one. Returns a function that removes
 * the route once the handlers in flight have finished: unrouting under one
 * lets Playwright continue its request, and the handler's own fulfil then
 * throws "Route is already handled".
 */
export async function interceptChunk(
  page: Page,
  marker: string,
  onMatch: (route: Route, response: APIResponse) => Promise<void>,
): Promise<() => Promise<void>> {
  const inFlight = new Set<Promise<void>>();
  const handle = async (route: Route) => {
    const response = await route.fetch();
    if ((await response.text()).includes(marker)) {
      await onMatch(route, response);
    } else {
      await route.fulfill({ response });
    }
  };
  const handler = (route: Route) => {
    const run = handle(route).finally(() => inFlight.delete(run));
    inFlight.add(run);
    return run;
  };
  await page.route(CHUNKS, handler);
  return async () => {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    await page.unroute(CHUNKS, handler);
  };
}
