import { afterEach, describe, expect, it, vi } from "bun:test";

import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type DeleteRouteModule = typeof import("@/app/api/documents/[id]/route");

const INVALID_ID_PARAMS = {
  params: Promise.resolve({ id: "../bad-document-id" }),
};

function loadDeleteRoute(): Promise<DeleteRouteModule> {
  return importFresh("@/app/api/documents/[id]/route");
}

function deleteRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/documents/bad", {
    method: "DELETE",
    headers,
  });
}

describe("DELETE /api/documents/[id] rate limiting", () => {
  afterEach(() => {
    delete process.env.HTTP_MUTATION_RATE_LIMIT;
    delete process.env.TRUSTED_PROXY;
    vi.restoreAllMocks();
    resetModules();
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

  it("does not let rotating forwarding headers bypass the limit without a trusted proxy", async () => {
    process.env.HTTP_MUTATION_RATE_LIMIT = "1";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { DELETE } = await loadDeleteRoute();
    const first = await DELETE(
      deleteRequest({
        "x-forwarded-for": "203.0.113.1",
        "x-real-ip": "203.0.113.1",
      }),
      INVALID_ID_PARAMS,
    );
    expect(first.status).toBe(400);

    const second = await DELETE(
      deleteRequest({
        "x-forwarded-for": "203.0.113.2",
        "x-real-ip": "203.0.113.2",
      }),
      INVALID_ID_PARAMS,
    );
    expect(second.status).toBe(429);
  });

  it("limits each proxy-reported client separately behind a trusted proxy", async () => {
    process.env.HTTP_MUTATION_RATE_LIMIT = "1";
    process.env.TRUSTED_PROXY = "1";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { DELETE } = await loadDeleteRoute();
    const clientA = await DELETE(
      deleteRequest({ "x-forwarded-for": "203.0.113.1" }),
      INVALID_ID_PARAMS,
    );
    expect(clientA.status).toBe(400);

    const clientB = await DELETE(
      deleteRequest({ "x-forwarded-for": "203.0.113.2" }),
      INVALID_ID_PARAMS,
    );
    expect(clientB.status).toBe(400);

    // Client A again, spoofing a leftmost entry: still keyed on the proxy-appended address.
    const clientAAgain = await DELETE(
      deleteRequest({ "x-forwarded-for": "198.51.100.9, 203.0.113.1" }),
      INVALID_ID_PARAMS,
    );
    expect(clientAAgain.status).toBe(429);
  });
});
