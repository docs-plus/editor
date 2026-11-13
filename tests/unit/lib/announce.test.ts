import { describe, expect, it } from "bun:test";

import { announce } from "@/lib/announce";

// Other files share this DOM: count only status nodes added here.
const foreign = new Set(document.body.querySelectorAll('[role="status"]'));
const regions = () =>
  Array.from(document.body.querySelectorAll('[role="status"]')).filter(
    (node) => !foreign.has(node),
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("announce", () => {
  it("speaks through one persistent polite status node", async () => {
    announce("Saved format ‘Callout’");
    expect(regions()).toHaveLength(1);
    const node = regions()[0] as HTMLElement;
    expect(node.getAttribute("aria-live")).toBe("polite");
    expect(node.className).toBe("sr-only");
    // Set after a moment: a node filled in the tick it is created is
    // often not read.
    expect(node.textContent).toBe("");
    await settle();
    expect(node.textContent).toBe("Saved format ‘Callout’");

    // The same message again: cleared first, so it is read again.
    announce("Saved format ‘Callout’");
    expect(node.textContent).toBe("");
    await settle();
    expect(node.textContent).toBe("Saved format ‘Callout’");
    expect(regions()).toHaveLength(1);
  });

  it("only the last of quick calls is spoken, and a removed node comes back", async () => {
    announce("first");
    announce("second");
    await settle();
    const node = regions()[0] as HTMLElement;
    expect(node.textContent).toBe("second");

    node.remove();
    announce("third");
    await settle();
    expect(regions()).toHaveLength(1);
    expect(regions()[0]?.textContent).toBe("third");
  });
});
