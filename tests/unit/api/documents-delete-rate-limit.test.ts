import { afterEach, describe, expect, it, vi } from "vitest";

type DeleteRouteModule = typeof import("@/app/api/documents/[id]/route");

async function loadDeleteRoute(): Promise<DeleteRouteModule> {
  vi.resetModules();
  return import("@/app/api/documents/[id]/route");
}

describe("DELETE /api/documents/[id] rate limiting", () => {
  afterEach(() => {
    delete process.env.HTTP_MUTATION_RATE_LIMIT;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns 429 with Retry-After when rate limit is exceeded", async () => {
    process.env.HTTP_MUTATION_RATE_LIMIT = "1";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { DELETE } = await loadDeleteRoute();
    const request = new Request("http://localhost/api/documents/bad", {
      method: "DELETE",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });

    const first = await DELETE(request, {
      params: Promise.resolve({ id: "../bad-document-id" }),
    });
    expect(first.status).toBe(400);

    const second = await DELETE(request, {
      params: Promise.resolve({ id: "../bad-document-id" }),
    });
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeTruthy();

    const body = await second.json();
    expect(body.error).toBe("Rate limit exceeded");
    expect(warnSpy).toHaveBeenCalled();
  });
});
