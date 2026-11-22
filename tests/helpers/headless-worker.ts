/**
 * Runs inside a `node:worker_threads` Worker started by
 * `headless-worker-host.ts`, outside `bun test` (no happy-dom): exports the
 * all-nodes fixture to Markdown and imports it back.
 */
import { parentPort } from "node:worker_threads";

import { jsonToYDoc } from "@/lib/headless/headless-schema";
import { exportMarkdown } from "@/lib/headless/markdown-export";
import { importMarkdown } from "@/lib/headless/markdown-import";

import { ALL_NODES_DOC } from "../fixtures/all-nodes-document";

const markdown = exportMarkdown(jsonToYDoc(ALL_NODES_DOC), {
  tags: ["worker"],
  createdAt: 0,
});
const imported = importMarkdown(markdown);

parentPort?.postMessage({
  globals: {
    window: typeof (globalThis as { window?: unknown }).window,
    document: typeof (globalThis as { document?: unknown }).document,
    DOMParser: typeof (globalThis as { DOMParser?: unknown }).DOMParser,
  },
  markdown,
  title: imported.title,
  tags: imported.tags,
  blocks: imported.doc.content?.length ?? 0,
  text: JSON.stringify(imported.doc),
});
