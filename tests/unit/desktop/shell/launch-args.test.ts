import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  classifyArg,
  MAX_INTENTS,
  parseLaunchArgs,
  userArgs,
} from "@/desktop/main/launch-args";

const existing = new Set([
  resolve("/docs/notes.md"),
  resolve("/docs/Page.HTML"),
  resolve("/docs/backup.tinydoc"),
  resolve("/work/rel.md"),
]);
const options = {
  cwd: resolve("/work"),
  isFile: (p: string) => existing.has(p),
};
const id = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("parseLaunchArgs", () => {
  test("accepts the two deep links and existing openable files", () => {
    const { intents, refused } = parseLaunchArgs(
      [
        "tinydocy://",
        `tinydocy://local/${id}`,
        `TINYDOCY://local/${id.toUpperCase()}/`,
        resolve("/docs/notes.md"),
        resolve("/docs/Page.HTML"),
        resolve("/docs/backup.tinydoc"),
        "rel.md",
      ],
      options,
    );
    expect(refused).toBe(0);
    expect(intents).toEqual([
      { kind: "focus" },
      { kind: "openDoc", docId: id },
      { kind: "openDoc", docId: id },
      { kind: "openFile", path: resolve("/docs/notes.md"), type: "md" },
      { kind: "openFile", path: resolve("/docs/Page.HTML"), type: "html" },
      {
        kind: "openFile",
        path: resolve("/docs/backup.tinydoc"),
        type: "tinydoc",
      },
      { kind: "openFile", path: resolve("/work/rel.md"), type: "md" },
    ]);
  });

  test("refuses bad links, other schemes, missing or unknown files", () => {
    const bad = [
      "tinydocy://local/not-a-uuid",
      `tinydocy://local/${id}?x=1`,
      `tinydocy://local/${id}#frag`,
      `tinydocy://share/${id}`,
      `tinydocy://local/${id}/extra`,
      "tinydocy:javascript:alert(1)",
      "https://example.com/a.md",
      "file:///docs/notes.md",
      "javascript:alert(1)",
      resolve("/docs/missing.md"),
      resolve("/docs/notes.txt"),
      resolve("/docs/.md"),
      `${resolve("/docs/notes.md")}\0.md`,
      "x".repeat(5000),
      "",
    ];
    const { intents, refused } = parseLaunchArgs(bad, options);
    expect(intents).toEqual([]);
    expect(refused).toBe(bad.length);
  });

  test("skips switches silently (Chromium, Playwright)", () => {
    const { intents, refused } = parseLaunchArgs(
      ["--inspect=0", "--remote-debugging-port=0", "--no-sandbox"],
      options,
    );
    expect(intents).toEqual([]);
    expect(refused).toBe(0);
  });

  test("caps the number of intents per launch", () => {
    const many = Array.from({ length: MAX_INTENTS + 5 }, () => "tinydocy://");
    const { intents, refused } = parseLaunchArgs(many, options);
    expect(intents).toHaveLength(MAX_INTENTS);
    expect(refused).toBe(5);
  });

  test("an isFile that throws is a refusal", () => {
    expect(
      classifyArg("/x/a.md", {
        cwd: "/",
        isFile: () => {
          throw new Error("EACCES");
        },
      }),
    ).toBeNull();
  });

  test("fuzz: random input yields only well-formed intents and never throws", () => {
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const parts = [
      "tinydocy:",
      "//",
      "local/",
      id,
      "/",
      ".md",
      "..",
      "\\",
      "%2e",
      "-",
      "C:",
      "?",
      "\0",
      "a",
    ];
    for (let i = 0; i < 20_000; i++) {
      const arg = Array.from(
        { length: 1 + Math.floor(next() * 6) },
        () => parts[Math.floor(next() * parts.length)],
      ).join("");
      const result = classifyArg(arg, options);
      if (result === null || result === "skip") continue;
      if (result.kind === "openDoc") expect(result.docId).toBe(id);
      if (result.kind === "openFile")
        expect(existing.has(result.path)).toBe(true);
    }
  });
});

describe("userArgs", () => {
  test("drops the executable, and the app folder when unpackaged", () => {
    expect(userArgs(["/Applications/TinyDocy", "tinydocy://"], false)).toEqual([
      "tinydocy://",
    ]);
    expect(
      userArgs(
        ["electron", "--inspect=0", "dist/desktop-app", "tinydocy://"],
        true,
      ),
    ).toEqual(["--inspect=0", "tinydocy://"]);
  });
});
