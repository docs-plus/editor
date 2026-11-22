import { describe, expect, it } from "bun:test";
import path from "node:path";

import { jsonToYDoc } from "@/lib/headless/headless-schema";
import { exportMarkdown } from "@/lib/headless/markdown-export";

import { ALL_NODES_DOC } from "../../../fixtures/all-nodes-document";

const ROOT = path.resolve(import.meta.dir, "../../../..");

/** Modules the headless graph must never reach, in any runtime. */
const FORBIDDEN_INPUT =
  /node_modules\/(react|react-dom|@tiptap\/react|@hocuspocus\/|dompurify|lowlight|highlight\.js|@docs\.plus\/extension-mermaid)\/|^components\/|^lib\/collab-session|^lib\/offline\//;

describe("headless module runtimes", () => {
  it("runs in a worker_thread with no DOM", async () => {
    const child = Bun.spawn(["bun", "tests/helpers/headless-worker-host.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.globals).toEqual({
      window: "undefined",
      document: "undefined",
      DOMParser: "undefined",
    });
    // The worker writes the same Markdown as a DOM environment does.
    expect(result.markdown).toBe(
      exportMarkdown(jsonToYDoc(ALL_NODES_DOC), {
        tags: ["worker"],
        createdAt: 0,
      }),
    );
    expect(result.title).toBe("Kitchen sink");
    expect(result.tags).toEqual(["worker"]);
    // Without a DOMParser, raw HTML (`<u>`, `<sup>`, `<sub>`) stays text;
    // the renderer's HTML step turns it back into marks (onboarding §4.6).
    expect(result.text).toContain("<sup>");
  }, 30_000);

  it("bundles for the browser without React, the editor or Node modules", async () => {
    const result = await Bun.build({
      entrypoints: [
        "lib/headless/markdown-export.ts",
        "lib/headless/markdown-import.ts",
        "lib/filenames.ts",
      ].map((entry) => path.join(ROOT, entry)),
      root: ROOT,
      target: "browser",
      metafile: true,
    });
    expect(result.success).toBe(true);
    const inputs = Object.keys(result.metafile?.inputs ?? {}).map((input) =>
      path.isAbsolute(input) ? path.relative(ROOT, input) : input,
    );
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.filter((input) => FORBIDDEN_INPUT.test(input))).toEqual([]);
    expect(inputs.filter((input) => input.startsWith("node:"))).toEqual([]);
  }, 60_000);
});
