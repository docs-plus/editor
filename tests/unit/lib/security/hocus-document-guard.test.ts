import { describe, expect, it } from "vitest";

import { isDocumentUpdateFrame } from "@/lib/security/hocus-document-guard";

/** Hocuspocus frame: varString document name, varUint type, payload. */
function frame(name: string, ...varUints: number[]): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  return Uint8Array.from([nameBytes.length, ...nameBytes, ...varUints, 0]);
}

describe("isDocumentUpdateFrame (A04-2)", () => {
  it("counts sync step 2 and update frames", () => {
    expect(isDocumentUpdateFrame(frame("doc", 0, 1))).toBe(true);
    expect(isDocumentUpdateFrame(frame("doc", 0, 2))).toBe(true);
  });

  it("ignores step 1, awareness, auth and malformed frames", () => {
    expect(isDocumentUpdateFrame(frame("doc", 0, 0))).toBe(false);
    expect(isDocumentUpdateFrame(frame("doc", 1))).toBe(false);
    expect(isDocumentUpdateFrame(frame("doc", 2))).toBe(false);
    expect(isDocumentUpdateFrame(new Uint8Array())).toBe(false);
    expect(isDocumentUpdateFrame(Uint8Array.from([200]))).toBe(false);
  });
});
