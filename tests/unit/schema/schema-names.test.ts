import { describe, expect, it } from "bun:test";

import {
  isAllowedMarkKey,
  isAllowedNodeName,
  SCHEMA_MARK_NAMES,
  SCHEMA_NODE_NAMES,
} from "@/lib/schema-names";

import { getEditorSchema } from "../../helpers/editor-schema";

const schema = getEditorSchema();

describe("schema-name allowlist", () => {
  it("allowlists every node and mark the editor can write", () => {
    expect(
      Object.keys(schema.nodes).filter((n) => !SCHEMA_NODE_NAMES.has(n)),
    ).toEqual([]);
    expect(
      Object.keys(schema.marks).filter((m) => !SCHEMA_MARK_NAMES.has(m)),
    ).toEqual([]);
  });

  it("allows nothing beyond the schema except legacy and pending marks", () => {
    expect([...SCHEMA_NODE_NAMES].filter((n) => !(n in schema.nodes))).toEqual(
      [],
    );
    expect(
      [...SCHEMA_MARK_NAMES].filter((m) => !(m in schema.marks)).sort(),
    ).toEqual(["code", "fontSize", "link", "textColor"]);
  });

  it("accepts hashed keys of allowed marks only", () => {
    expect(isAllowedMarkKey("hyperlink--abcd1234")).toBe(true);
    expect(isAllowedMarkKey("bold")).toBe(true);
    expect(isAllowedMarkKey("zzz--abcd1234")).toBe(false);
  });

  it("accepts known node names only", () => {
    expect(isAllowedNodeName("paragraph")).toBe(true);
    expect(isAllowedNodeName("zzz")).toBe(false);
  });
});
