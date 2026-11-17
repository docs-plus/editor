import { describe, expect, test } from "bun:test";

import * as Y from "yjs";

import {
  DOC_MIGRATIONS,
  DOC_SCHEMA,
  type DocMigration,
  planDocMigrations,
  runDocMigrations,
} from "@/lib/doc-migrations";

const steps: DocMigration[] = [
  { to: 1, run: (doc) => doc.getMap("m").set("one", true) },
  { to: 2, run: (doc) => doc.getMap("m").set("two", true) },
];

describe("document migrations", () => {
  test("the list starts empty, so today's documents are current", () => {
    expect(DOC_MIGRATIONS).toEqual([]);
    expect(DOC_SCHEMA).toBe(0);
    expect(planDocMigrations(0)).toEqual({ kind: "current" });
  });

  test("a newer document is too new", () => {
    expect(planDocMigrations(1)).toEqual({ kind: "too_new" });
  });

  test("plans only the missing steps", () => {
    const plan = planDocMigrations(1, steps);
    expect(plan).toMatchObject({ kind: "migrate", schemaTo: 2 });
    expect(plan.kind === "migrate" && plan.steps.map((s) => s.to)).toEqual([2]);
  });

  test("refuses a gap in the list", () => {
    expect(() => planDocMigrations(0, [{ to: 2, run: () => {} }])).toThrow();
  });

  test("runs every step in one transaction under the given origin", () => {
    const doc = new Y.Doc();
    const origin = Symbol("migration");
    const seen: unknown[] = [];
    doc.on("update", (_u: Uint8Array, o: unknown) => seen.push(o));
    expect(runDocMigrations(doc, planDocMigrations(0, steps), origin)).toBe(2);
    expect(seen).toEqual([origin]);
    expect(doc.getMap("m").toJSON()).toEqual({ one: true, two: true });
    expect(runDocMigrations(doc, { kind: "current" }, origin)).toBeNull();
  });
});
