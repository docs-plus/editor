/**
 * `scripts/i18n/extract.ts` (languages design §3.2, §3.3, §3.11): finds
 * `t()` calls in files that import it, reads the action registry, and
 * writes `locales/en/<ns>.json` plus translator notes.
 */
import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { namespaceOf } from "@/scripts/i18n/catalog";
import { extractMessages, writeExtraction } from "@/scripts/i18n/extract";

const roots: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "i18n-extract-"));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

const IMPORT = `import { t } from "@/lib/i18n/t-core";\n`;
const ACTIONS = [
  { id: "mark.bold", label: "Bold", keywords: ["strong", "heavy"] },
  { id: "history.undo", label: "Undo" },
];

describe("namespaceOf", () => {
  it("takes the first segment, and maps registry keys", () => {
    expect(namespaceOf("library.trash.empty")).toBe("library");
    expect(namespaceOf("action.mark.bold.label")).toBe("actions");
    expect(namespaceOf("reason:Not here.")).toBe("reasons");
    expect(namespaceOf("trash.empty")).toBeNull();
    expect(namespaceOf("core")).toBeNull();
  });
});

describe("extractMessages", () => {
  it("collects t() calls by namespace, with notes", () => {
    const root = fixture({
      "components/a.tsx": `${IMPORT}
export const A = () => t("library.trash.empty", "Trash is empty");
// i18n: {title} is a document title the user wrote.
const b = t('library.moved', 'Moved “{title}”', { title });
const c = t(
  "core.status.saved",
  \`Saved\`,
);
`,
    });
    const result = extractMessages(root, { actions: [] });
    expect(result.errors).toEqual([]);
    expect(result.catalogs.get("library")).toEqual({
      "library.moved": "Moved “{title}”",
      "library.trash.empty": "Trash is empty",
    });
    expect(result.catalogs.get("core")).toEqual({
      "core.status.saved": "Saved",
    });
    expect(result.notes.get("library")).toEqual({
      "library.moved": "{title} is a document title the user wrote.",
    });
  });

  it("ignores files that don't import t, and lib/i18n itself", () => {
    const root = fixture({
      "components/other.ts": `const t = (a: string, b: string) => a;\nt("x.y", "No");\n`,
      "lib/i18n/t-core.ts": `export function t(key: string, english: string) {}\n`,
    });
    expect(extractMessages(root, { actions: [] }).catalogs.size).toBe(0);
  });

  it("writes registry labels and keywords into actions", () => {
    const result = extractMessages(fixture({}), { actions: ACTIONS });
    expect(result.catalogs.get("actions")).toEqual({
      "action.history.undo.label": "Undo",
      "action.mark.bold.keywords": "strong, heavy",
      "action.mark.bold.label": "Bold",
    });
  });

  it("reports non-literal calls, unknown namespaces, bad ICU and conflicts", () => {
    const root = fixture({
      "components/bad.tsx": `${IMPORT}
t(key, "Dynamic");
t("trash.empty", "No namespace");
t("core.broken", "{count, plural, one {x}}");
t("core.same", "One");
t("core.same", "Two");
`,
    });
    const { errors } = extractMessages(root, { actions: [] });
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain("components/bad.tsx:3");
    expect(errors[0]).toContain("literal");
    expect(errors[1]).toContain("trash.empty");
    expect(errors[2]).toContain("core.broken");
    expect(errors[3]).toContain("core.same");
  });
});

describe("writeExtraction", () => {
  it("writes sorted catalogs and notes, and removes emptied ones", () => {
    const root = fixture({
      "locales/en/print.json": `{ "print.old": "Old" }\n`,
    });
    writeExtraction(root, {
      catalogs: new Map([["core", { "core.b": "B", "core.a": "A" }]]),
      notes: new Map([["core", { "core.a": "Note" }]]),
      errors: [],
    });
    expect(readFileSync(join(root, "locales/en/core.json"), "utf8")).toBe(
      `{\n  "core.a": "A",\n  "core.b": "B"\n}\n`,
    );
    expect(
      JSON.parse(
        readFileSync(join(root, "locales/en/core.notes.json"), "utf8"),
      ),
    ).toEqual({ "core.a": "Note" });
    expect(existsSync(join(root, "locales/en/print.json"))).toBe(false);
  });
});
