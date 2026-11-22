import { describe, expect, it } from "bun:test";

import { createLinkIcon } from "@/lib/links/link-icon";
import type { LinkState } from "@/lib/links/resolve";

/**
 * `link-icon.ts` copies lucide-react's drawings inline (the icon modules
 * pull in React). This pins each copy to the installed lucide-react, so a
 * bump that redraws one of them fails here instead of drifting silently
 * from the toolbar's icons.
 */
type LucideNode = readonly (readonly [string, Record<string, string>])[];

/** The icon modules' `__iconData`; their d.ts only declares the default. */
async function lucideNode(name: string): Promise<LucideNode> {
  const mod = (await import(`lucide-react/icons/${name}`)) as unknown as {
    __iconData: { node: LucideNode };
  };
  return mod.__iconData.node.map(([tag, { key: _key, ...attrs }]) => [
    tag,
    attrs,
  ]);
}

function drawn(state: LinkState): LucideNode {
  const icon = createLinkIcon(() => state)({ href: "tinydocy:x" });
  const svg = icon?.querySelector("svg");
  if (!svg) throw new Error(`no icon for ${state.state}`);
  return [...svg.children].map((child) => [
    child.localName,
    Object.fromEntries(
      [...child.attributes].map((attr) => [attr.name, attr.value]),
    ),
  ]);
}

const GLYPHS: readonly (readonly [string, LinkState])[] = [
  [
    "file-text",
    { state: "resolves", docId: "d", title: "T", path: [], tocId: null },
  ],
  ["hash", { state: "here", tocId: "t" }],
  ["file-minus", { state: "in_trash", docId: "d", title: "T", tocId: null }],
  ["file-question-mark", { state: "not_in_library" }],
  ["file-question-mark", { state: "deleted" }],
  ["file-question-mark", { state: "unknown_form" }],
];

describe("link icons match lucide-react", () => {
  for (const [name, state] of GLYPHS) {
    it(`${state.state} draws lucide's ${name}`, async () => {
      expect(drawn(state)).toEqual(await lucideNode(name));
    });
  }
});
