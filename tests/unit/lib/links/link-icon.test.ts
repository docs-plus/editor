import { describe, expect, it, mock } from "bun:test";

import { createLinkIcon, DASHED_LINK_STATES } from "@/lib/links/link-icon";
import type { LinkState } from "@/lib/links/resolve";

const KEY = "a".repeat(32);
const TOC = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b";

const STATES: Record<LinkState["state"], LinkState> = {
  resolves: {
    state: "resolves",
    docId: "d",
    title: "T",
    path: [],
    tocId: null,
  },
  here: { state: "here", tocId: TOC },
  in_trash: { state: "in_trash", docId: "d", title: "T", tocId: null },
  deleted: { state: "deleted" },
  not_in_library: { state: "not_in_library" },
  unknown_form: { state: "unknown_form" },
};

/** The lucide icon each state draws, told apart by a path unique to it. */
const SIGNATURE: Record<LinkState["state"], string> = {
  resolves: "M16 13H8",
  here: "M16 13H8",
  in_trash: "M3 6h18",
  deleted: "m14.5 12.5-5 5",
  not_in_library: "M12 17h.01",
  unknown_form: "M12 17h.01",
};

describe("createLinkIcon (search-linking §4.6)", () => {
  it("gives external links no icon and never asks the index", () => {
    const getState = mock(() => STATES.resolves);
    const icon = createLinkIcon(getState);
    expect(icon({ href: "https://example.com" })).toBeNull();
    expect(icon({ href: "mailto:a@b.c" })).toBeNull();
    expect(getState).not.toHaveBeenCalled();
  });

  for (const [name, state] of Object.entries(STATES)) {
    it(`draws ${name}`, () => {
      const icon = createLinkIcon(() => state);
      const el = icon({ href: `tinydocy:doc/${KEY}` });
      expect(el).toBeInstanceOf(HTMLElement);
      if (!el) return;
      expect(el.tagName).toBe("SPAN");
      expect(el.className).toBe("doc-link-icon");
      expect(el.dataset.linkState).toBe(name);
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect(el.textContent).toBe("");
      expect(el.parentNode).toBeNull();
      const svg = el.querySelector("svg");
      expect(svg?.namespaceURI).toBe("http://www.w3.org/2000/svg");
      expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg?.getAttribute("width")).toBe("1em");
      expect(svg?.getAttribute("height")).toBe("1em");
      expect(svg?.getAttribute("stroke")).toBe("currentColor");
      expect(svg?.getAttribute("stroke-width")).toBe("2");
      expect(svg?.getAttribute("stroke-linecap")).toBe("round");
      expect(svg?.getAttribute("stroke-linejoin")).toBe("round");
      const paths = Array.from(svg?.querySelectorAll("path") ?? []).map((p) =>
        p.getAttribute("d"),
      );
      expect(paths).toContain(SIGNATURE[name as LinkState["state"]]);
    });
  }

  it("returns a fresh element every call", () => {
    const icon = createLinkIcon(() => STATES.resolves);
    const a = icon({ href: `tinydocy:doc/${KEY}` });
    const b = icon({ href: `tinydocy:doc/${KEY}` });
    expect(a).not.toBe(b);
    document.body.append(a as HTMLElement);
    expect(icon({ href: `tinydocy:doc/${KEY}` })?.parentNode).toBeNull();
    a?.remove();
  });

  it("reads an our-scheme href the host can't resolve as an unknown form", () => {
    const icon = createLinkIcon(() => null);
    expect(icon({ href: "TINYDOCY:odd" })?.dataset.linkState).toBe(
      "unknown_form",
    );
  });

  it("dashes only the broken states", () => {
    expect([...DASHED_LINK_STATES].sort()).toEqual([
      "deleted",
      "not_in_library",
      "unknown_form",
    ]);
  });
});
