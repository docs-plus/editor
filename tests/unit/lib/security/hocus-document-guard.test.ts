import { describe, expect, it } from "vitest";

import { isDocumentUpdateFrame } from "@/lib/security/hocus-document-guard";

/** Hocuspocus frame: varString document name, varUint fields, payload. */
function frame(name: string, ...varUints: number[]): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  return Uint8Array.from([nameBytes.length, ...nameBytes, ...varUints]);
}

/** Sync frame carrying a Yjs update of `updateBytes` bytes. */
function syncFrame(syncType: number, updateBytes: number): Uint8Array {
  return Uint8Array.from([
    ...frame("doc", 0, syncType, updateBytes),
    ...new Uint8Array(updateBytes),
  ]);
}

describe("isDocumentUpdateFrame (A04-2)", () => {
  it("counts sync step 2 and update frames that carry content", () => {
    expect(isDocumentUpdateFrame(syncFrame(1, 40))).toBe(true);
    expect(isDocumentUpdateFrame(syncFrame(2, 40))).toBe(true);
    expect(isDocumentUpdateFrame(syncFrame(2, 300))).toBe(true);
  });

  it("ignores the empty step 2 every client sends on connect", () => {
    expect(isDocumentUpdateFrame(syncFrame(1, 2))).toBe(false);
    expect(isDocumentUpdateFrame(syncFrame(2, 2))).toBe(false);
  });

  it("ignores step 1, awareness, auth and malformed frames", () => {
    expect(isDocumentUpdateFrame(syncFrame(0, 40))).toBe(false);
    expect(isDocumentUpdateFrame(frame("doc", 1))).toBe(false);
    expect(isDocumentUpdateFrame(frame("doc", 2))).toBe(false);
    expect(isDocumentUpdateFrame(new Uint8Array())).toBe(false);
    expect(isDocumentUpdateFrame(Uint8Array.from([200]))).toBe(false);
  });
});
