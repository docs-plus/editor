import type { APIResponse, Page, Route } from "@playwright/test";

/**
 * A string only the chunk that defines each lazy surface contains, under
 * `next dev` (the e2e server). Production minifies these names away.
 */
export const CHUNK_MARKERS = {
  bubble: "function SelectionBubbleView",
  colorPanel: "function ColorPanel",
  insertStep: "function InsertStep",
} as const;

const CHUNKS = "**/_next/static/chunks/**";

/**
 * Sends the chunk whose body contains `marker` to `onMatch` (to fail or
 * hold it); every other chunk passes through. Chunk URLs are hashed, so the
 * body is the only stable way to find one. Returns a function that removes
 * the route.
 */
export async function interceptChunk(
  page: Page,
  marker: string,
  onMatch: (route: Route, response: APIResponse) => Promise<void>,
): Promise<() => Promise<void>> {
  const handler = async (route: Route) => {
    const response = await route.fetch();
    if ((await response.text()).includes(marker)) {
      await onMatch(route, response);
    } else {
      await route.fulfill({ response });
    }
  };
  await page.route(CHUNKS, handler);
  return () => page.unroute(CHUNKS, handler);
}
