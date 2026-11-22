import { afterEach, describe, expect, it, vi } from "bun:test";

import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type DeleteRouteModule = typeof import("@/app/api/documents/[id]/route.web");

/**
 * P4.1 pins: the Next.js close route (still serving production until the
 * Traefik route moves to Hocus) refuses share and sync names, as the Hocus
 * route does.
 */
describe("DELETE /api/documents/[id] and share names", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetModules();
  });

  it.each([
    "share:7f3a1c2e-1111-4111-8111-111111111111",
    "sync:7f3a1c2e-1111-4111-8111-111111111111",
  ])("refuses %s", async (id) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { DELETE } = await importFresh<DeleteRouteModule>(
      "@/app/api/documents/[id]/route.web",
    );
    const response = await DELETE(
      new Request(`http://localhost/api/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid document id" });
  });
});
