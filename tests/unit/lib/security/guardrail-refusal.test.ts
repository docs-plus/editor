import { afterEach, expect, it, mock, spyOn } from "bun:test";

import { Hocuspocus, type onConnectPayload } from "@hocuspocus/server";

import { guardrailRefusal } from "@/lib/security/guardrail-refusal";

afterEach(() => {
  mock.restore();
});

it("refuses through Hocuspocus hooks with only its abuse line", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const error = spyOn(console, "error");
  const hocuspocus = new Hocuspocus({
    async onConnect() {
      throw guardrailRefusal("document_deleted", {
        ip: "203.0.113.7",
        documentName: "doc-1",
      });
    },
  });
  const refusal = await hocuspocus
    .hooks("onConnect", {} as onConnectPayload)
    .catch((thrown: unknown) => thrown);

  expect(refusal).toEqual({ reason: "document_deleted" });
  expect(error).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
    type: "abuse",
    event: "ws_guardrail_rejected",
    reason: "document_deleted",
    ip: "203.0.113.7",
    documentName: "doc-1",
  });
});
