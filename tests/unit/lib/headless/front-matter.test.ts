import { describe, expect, it } from "bun:test";

import {
  FRONT_MATTER_MAX_BYTES,
  readFrontMatter,
  writeFrontMatter,
} from "@/lib/headless/front-matter";

describe("writeFrontMatter", () => {
  it("writes title, tags and ISO dates in a fenced YAML block", () => {
    expect(
      writeFrontMatter({
        title: "Q4 plan",
        tags: ["planning", "q4"],
        createdAt: Date.UTC(2026, 10, 1, 10),
        modifiedAt: Date.UTC(2026, 10, 20, 12, 30),
      }),
    ).toBe(
      [
        "---",
        'title: "Q4 plan"',
        "tags:",
        '  - "planning"',
        '  - "q4"',
        "created: 2026-11-01T10:00:00.000Z",
        "modified: 2026-11-20T12:30:00.000Z",
        "---",
        "",
      ].join("\n"),
    );
  });

  it("writes an empty tag list and leaves out unknown dates", () => {
    expect(writeFrontMatter({ title: "", tags: [] })).toBe(
      ["---", 'title: ""', "tags: []", "---", ""].join("\n"),
    );
  });

  it("quotes hostile titles so they stay one scalar", () => {
    const title = 'a: b\n---\n"quoted" # not a comment &anchor *alias !tag';
    const block = writeFrontMatter({ title, tags: ["x\ny: z"] });
    expect(block.split("\n").filter((line) => line === "---")).toHaveLength(2);
    const read = readFrontMatter(`${block}body`);
    expect(read.data.get("title")).toBe(title);
    expect(read.data.get("tags")).toEqual(["x\ny: z"]);
    expect(read.body).toBe("body");
  });
});

describe("readFrontMatter", () => {
  it("returns the text unchanged when there is no front matter", () => {
    expect(readFrontMatter("# Hello\n")).toEqual({
      data: new Map(),
      body: "# Hello\n",
      rejected: [],
      tooLarge: false,
    });
  });

  it("reads scalars, quoted strings, flow lists and block lists", () => {
    const { data, body } = readFrontMatter(
      [
        "---",
        "title: Plain title # with comment",
        "single: 'it''s'",
        'double: "line\\nbreak"',
        "tags: [one, 'two', \"three\"]",
        "aliases:",
        "  - first",
        "  - second",
        "date: 2024-05-01",
        "---",
        "Body",
      ].join("\n"),
    );
    expect(data.get("title")).toBe("Plain title");
    expect(data.get("single")).toBe("it's");
    expect(data.get("double")).toBe("line\nbreak");
    expect(data.get("tags")).toEqual(["one", "two", "three"]);
    expect(data.get("aliases")).toEqual(["first", "second"]);
    expect(data.get("date")).toBe("2024-05-01");
    expect(body).toBe("Body");
  });

  it("accepts CRLF, a byte-order mark and a `...` terminator", () => {
    const { data, body } = readFrontMatter(
      "﻿---\r\ntitle: Windows\r\n...\r\nBody\r\n",
    );
    expect(data.get("title")).toBe("Windows");
    expect(body).toBe("Body\r\n");
  });

  it("refuses anchors, aliases, tags, block scalars and nested maps", () => {
    const { data, rejected } = readFrontMatter(
      [
        "---",
        "base: &a value",
        "copy: *a",
        "typed: !!python/object x",
        "block: |",
        "  text",
        "folded: >",
        "  text",
        "nested:",
        "  key: value",
        "flowmap: {a: 1}",
        "ok: fine",
        "---",
        "",
      ].join("\n"),
    );
    expect([...data.keys()]).toEqual(["ok"]);
    expect(rejected.sort()).toEqual(
      ["base", "block", "copy", "flowmap", "folded", "nested", "typed"].sort(),
    );
  });

  it("refuses a flow list holding an alias or a nested list", () => {
    const { data, rejected } = readFrontMatter(
      "---\na: [x, *y]\nb: [[1], 2]\n---\n",
    );
    expect(data.size).toBe(0);
    expect(rejected.sort()).toEqual(["a", "b"]);
  });

  it("keeps the first of duplicate keys and cannot touch the prototype", () => {
    const { data } = readFrontMatter(
      "---\ntitle: first\ntitle: second\n__proto__: polluted\n---\n",
    );
    expect(data.get("title")).toBe("first");
    expect(data.get("__proto__")).toBe("polluted");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("ignores a block over the size cap", () => {
    const huge = `---\ntitle: ${"x".repeat(FRONT_MATTER_MAX_BYTES)}\n---\nBody`;
    const read = readFrontMatter(huge);
    expect(read.tooLarge).toBe(true);
    expect(read.data.size).toBe(0);
    expect(read.body).toBe("Body");
  });

  it("treats an unclosed block as body text", () => {
    const text = "---\ntitle: open\nno end";
    expect(readFrontMatter(text).body).toBe(text);
  });

  it("does not take a thematic break later in the file for front matter", () => {
    const text = "Intro\n\n---\n\ntitle: no\n---\n";
    expect(readFrontMatter(text).data.size).toBe(0);
  });
});
