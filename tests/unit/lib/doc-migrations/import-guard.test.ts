import { describe, expect, test } from "bun:test";

import * as Y from "yjs";

import { checkImport } from "@/lib/doc-migrations/import-guard";

function docWith(build: (doc: Y.Doc) => void): Uint8Array {
  const doc = new Y.Doc();
  build(doc);
  return Y.encodeStateAsUpdate(doc);
}

function paragraph(text: string, attrs?: Record<string, unknown>) {
  const p = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  t.insert(0, text, attrs);
  p.insert(0, [t]);
  return p;
}

describe("checkImport", () => {
  test("accepts a document the editor can open", () => {
    const state = docWith((doc) => {
      const heading = new Y.XmlElement("heading");
      heading.setAttribute("level", "1");
      doc
        .getXmlFragment("default")
        .insert(0, [heading, paragraph("hi", { bold: true })]);
    });
    expect(checkImport(state)).toEqual({ ok: true });
  });

  test("accepts the legacy link and code marks (the import migrations rename them)", () => {
    const state = docWith((doc) => {
      doc
        .getXmlFragment("default")
        .insert(0, [
          paragraph("x", { link: { href: "https://a.b" } }),
          paragraph("y", { code: true }),
        ]);
    });
    expect(checkImport(state)).toEqual({ ok: true });
  });

  test("refuses unknown nodes and marks, naming them", () => {
    const state = docWith((doc) => {
      doc
        .getXmlFragment("default")
        .insert(0, [
          new Y.XmlElement("marquee"),
          paragraph("x", { blink: true }),
        ]);
    });
    expect(checkImport(state)).toEqual({
      ok: false,
      code: "unknown_schema",
      names: ["marquee", "blink"],
    });
  });

  test("refuses unknown roots", () => {
    const state = docWith((doc) => {
      doc.getXmlFragment("default").insert(0, [paragraph("x")]);
      doc.getMap("payload").set("a", 1);
    });
    expect(checkImport(state)).toMatchObject({
      ok: false,
      code: "unknown_schema",
      names: ["payload"],
    });
  });

  test("refuses oversized states before decoding them", () => {
    const state = docWith((doc) => {
      doc.getXmlFragment("default").insert(0, [paragraph("x".repeat(100))]);
    });
    expect(checkImport(state, { maxBytes: 10 })).toEqual({
      ok: false,
      code: "import_too_large",
      names: [],
    });
  });

  test("refuses bytes that aren't a Yjs update", () => {
    expect(
      checkImport(new Uint8Array([255, 255, 255, 255, 1, 2, 3])),
    ).toMatchObject({
      ok: false,
      code: "corrupt",
    });
  });
});
