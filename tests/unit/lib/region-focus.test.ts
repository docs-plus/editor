import { afterEach, describe, expect, it } from "bun:test";

import { cycleRegion, trackRegionFocus } from "@/lib/region-focus";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

const LAYOUT = `
  <div data-region aria-label="Open documents"><button id="tab">Tab</button></div>
  <nav data-region aria-label="Files">
    <button id="search">Search</button>
    <ul role="tree"><li id="row1" role="treeitem" tabindex="-1">A</li><li id="row2" role="treeitem" tabindex="0">B</li></ul>
  </nav>
  <main data-region aria-label="Document"><div id="editor" contenteditable="true"></div></main>
  <aside data-region aria-label="Outline" hidden><button id="outline">x</button></aside>
`;

describe("F6 regions (UX §8.2)", () => {
  it("moves to the next region and wraps, skipping hidden ones", () => {
    const root = mount(LAYOUT);
    (root.querySelector("#tab") as HTMLElement).focus();
    expect(cycleRegion(root, false)).toBe("Files");
    expect(document.activeElement?.id).toBe("search");
    expect(cycleRegion(root, false)).toBe("Document");
    expect(document.activeElement?.id).toBe("editor");
    expect(cycleRegion(root, false)).toBe("Open documents");
    expect(cycleRegion(root, true)).toBe("Document");
  });

  it("returns to the element last focused in a region", () => {
    const root = mount(LAYOUT);
    const stop = trackRegionFocus(root);
    (root.querySelector("#row2") as HTMLElement).focus();
    (root.querySelector("#editor") as HTMLElement).focus();
    expect(cycleRegion(root, true)).toBe("Files");
    expect(document.activeElement?.id).toBe("row2");
    stop();
  });

  it("prefers a region's marked entry point", () => {
    const root = mount(`
      <nav data-region aria-label="Files"><button>Search</button><span id="entry" tabindex="-1" data-region-entry>x</span></nav>
      <main data-region aria-label="Document"><button id="doc">d</button></main>`);
    (root.querySelector("#doc") as HTMLElement).focus();
    cycleRegion(root, false);
    expect(document.activeElement?.id).toBe("entry");
  });

  it("flashes the region it lands on", () => {
    const root = mount(LAYOUT);
    (root.querySelector("#tab") as HTMLElement).focus();
    cycleRegion(root, false);
    expect(root.querySelector("nav")?.hasAttribute("data-region-flash")).toBe(
      true,
    );
  });
});
