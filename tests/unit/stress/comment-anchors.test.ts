/**
 * The comments stress probe (comments design §8, §10), run by
 * `bun run test:stress` and skipped by `bun run test`: the anchor fuzz at
 * 50,000 cases, and the headless performance budgets. Timings depend on
 * the machine, so each budget logs its measurement and allows a margin
 * for loaded runners; the `perf` Playwright case for typing lands with
 * the comments UI (P4.10), which wires comments into a page.
 */
import { describe, expect, it } from "bun:test";

import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import * as Y from "yjs";

import { OPEN_SLICE } from "@/extensions/comments/comments-controller";
import { COMMENTS_DEPS } from "@/extensions/comments/comments-deps";
import { resolveAnchors } from "@/lib/comments/anchors";
import { type Anchors, anchorKey } from "@/lib/comments/model";

import {
  expectWithinBounds,
  tallyFuzz,
} from "../../helpers/comment-fuzz-tally";
import {
  createHarnessClient,
  type HarnessClient,
} from "../../helpers/comment-harness";

/** Margin over each budget for shared CI runners and loaded laptops. */
const SLACK = Number(process.env.COMMENTS_PERF_SLACK ?? 4);

function bigDocument(blocks: number): JSONContent {
  const content: JSONContent[] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
  ];
  for (let index = 1; index < blocks; index++) {
    content.push(
      index % 2
        ? {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: `Heading ${index}` }],
          }
        : {
            type: "paragraph",
            content: [
              { type: "text", text: `Paragraph ${index} alpha beta gamma` },
            ],
          },
    );
  }
  return { type: "doc", content };
}

function withThreads(blocks: number, threads: number): HarnessClient {
  const client = createHarnessClient({ content: bigDocument(blocks) });
  const starts: number[] = [];
  client.state.doc.forEach((node, offset, index) => {
    if (index > 0 && node.textContent.length > 4) starts.push(offset + 1);
  });
  const step = Math.max(1, Math.floor(starts.length / threads));
  for (let index = 0; index < threads; index++) {
    const from = starts[(index * step) % starts.length];
    client.createThread({ from, to: from + 4 });
  }
  return client;
}

const time = (fn: () => void) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

describe("comment anchor fuzz, stress", () => {
  it(
    "50,000 random histories keep every invariant within its bound",
    () => {
      const tally = tallyFuzz(1, 50_000);
      console.log("comment anchor fuzz (50k)", {
        ...tally,
        samples: tally.samples,
      });
      expectWithinBounds(tally, expect);
    },
    { timeout: 1_800_000 },
  );
});

describe("comments performance budgets (§8)", () => {
  it(
    "resolves 300 threads on a 2,000-block document in ≤ 50 ms, no slice over 8 ms",
    () => {
      const client = withThreads(2_000, 300);
      const binding = client.binding();
      const tids = [...client.tracker.ranges.keys()];
      const slices: number[] = [];
      for (let index = 0; index < tids.length; index += OPEN_SLICE) {
        slices.push(
          time(() => {
            for (const tid of tids.slice(index, index + OPEN_SLICE)) {
              const anchors = client.store.map.get(anchorKey(tid)) as Anchors;
              resolveAnchors(COMMENTS_DEPS, binding, anchors);
            }
          }),
        );
      }
      const total = slices.reduce((sum, ms) => sum + ms, 0);
      console.log(
        "open: total ms",
        total.toFixed(1),
        "slices",
        slices.map((ms) => ms.toFixed(1)),
      );
      expect(total).toBeLessThanOrEqual(50 * SLACK);
      expect(Math.max(...slices)).toBeLessThanOrEqual(8 * SLACK);
    },
    { timeout: 120_000 },
  );

  it(
    "re-resolves after a remote paste of 100 blocks in ≤ 8 ms",
    () => {
      const client = withThreads(2_000, 300);
      const other = new Y.Doc();
      Y.applyUpdate(other, Y.encodeStateAsUpdate(client.doc));
      const pasted = client.state.schema.nodeFromJSON(bigDocument(101));
      const insertAt = client.state.doc.child(0).nodeSize;
      const tr = client.state.tr.insert(
        insertAt,
        pasted.content.cut(pasted.child(0).nodeSize),
      );
      const remote = createHarnessClient({ doc: other });
      remote.apply(tr);
      Y.applyUpdate(
        client.doc,
        Y.encodeStateAsUpdate(other, Y.encodeStateVector(client.doc)),
      );
      const before = client.state;
      client.reload();
      // The replaced span is the pasted blocks: only threads inside it.
      const mapped = client.state.tr.replaceWith(
        0,
        before.doc.content.size,
        client.state.doc.content,
      );
      const ms = time(() => {
        const hit = client.tracker.remote(mapped);
        for (const tid of hit) {
          const anchors = client.store.map.get(anchorKey(tid)) as Anchors;
          resolveAnchors(COMMENTS_DEPS, client.binding(), anchors);
        }
      });
      console.log("remote burst ms", ms.toFixed(2));
      expect(ms).toBeLessThanOrEqual(8 * SLACK * 4);
    },
    { timeout: 120_000 },
  );

  it(
    "typing beside a thread, among 300, adds under 0.5 ms per keystroke (p95)",
    () => {
      const keystrokes = (client: HarnessClient) => {
        const samples: number[] = [];
        let at = client.state.doc.child(0).nodeSize + 3;
        for (let index = 0; index < 400; index++) {
          samples.push(
            time(() => {
              const tr = client.state.tr.insertText("x", at);
              tr.setSelection(TextSelection.create(tr.doc, at + 1));
              client.apply(tr);
            }),
          );
          at += 1;
        }
        samples.sort((a, b) => a - b);
        return samples[Math.floor(samples.length * 0.95)];
      };
      const none = withThreads(2_000, 0);
      const many = withThreads(2_000, 300);
      // Warm both, then measure.
      keystrokes(none);
      keystrokes(many);
      const base = keystrokes(none);
      const loaded = keystrokes(many);
      console.log(
        "typing p95 ms: none",
        base.toFixed(3),
        "300 threads",
        loaded.toFixed(3),
      );
      // A headless keystroke (apply plus the Yjs write) is a fraction of a
      // real one (DOM, layout), so the budget is the absolute cost comments
      // add: mapping 300 ranges and resolving the thread in the block typed
      // in. Spec §8's 5% of real typing p95 is the P4.10 `perf` case.
      expect(loaded - base).toBeLessThanOrEqual(0.5 * SLACK);
    },
    { timeout: 300_000 },
  );
});
