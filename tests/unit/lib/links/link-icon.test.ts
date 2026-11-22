import { describe, expect, it, mock } from "bun:test";

import {
  LINK_STATE_LABEL,
  type LinkPresentation,
  presentationOf,
} from "@/lib/links/link-copy";
import {
  createLinkIcon,
  DASHED_LINK_STATES,
  refreshLinkIcons,
} from "@/lib/links/link-icon";
import type { LinkState, LinkStateName } from "@/lib/links/resolve";

const KEY = "a".repeat(32);
const TOC = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b";

const STATES: Record<LinkStateName, LinkState> = {
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

/** What each state shows as, with Q1 (B) merging deleted into not available. */
const PRESENTED: Record<LinkStateName, LinkPresentation> = {
  resolves: "resolves",
  here: "here",
  in_trash: "in_trash",
  deleted: "not_available",
  not_in_library: "not_available",
  unknown_form: "unknown_form",
};

/** The lucide glyph each state draws, told apart by a child unique to it. */
const SIGNATURE: Record<LinkStateName, string> = {
  resolves: "path:M16 13H8", // FileText
  here: "line:4,20,9,9", // Hash
  in_trash: "path:M9 15h6", // FileMinus
  deleted: "path:M12 17h.01", // FileQuestion
  not_in_library: "path:M12 17h.01",
  unknown_form: "path:M12 17h.01",
};

const OPENS: ReadonlySet<LinkStateName> = new Set(["resolves", "here"]);

function signatures(el: Element): string[] {
  return [...(el.querySelector("svg")?.children ?? [])].map((child) =>
    child.localName === "line"
      ? `line:${["x1", "x2", "y1", "y2"].map((a) => child.getAttribute(a)).join(",")}`
      : `${child.localName}:${child.getAttribute("d")}`,
  );
}

/** The four attributes refresh must keep in step with the state. */
function a11y(el: Element) {
  return {
    state: el.getAttribute("data-link-state"),
    hidden: el.getAttribute("aria-hidden"),
    role: el.getAttribute("role"),
    label: el.getAttribute("aria-label"),
  };
}

function expectedA11y(name: LinkStateName) {
  const presentation = PRESENTED[name];
  return OPENS.has(name)
    ? { state: presentation, hidden: "true", role: null, label: null }
    : {
        state: presentation,
        hidden: null,
        role: "img",
        label: LINK_STATE_LABEL[presentation] ?? null,
      };
}

describe("presentationOf (linking review, decision 1)", () => {
  it("merges deleted into not available by default", () => {
    for (const [name, presentation] of Object.entries(PRESENTED)) {
      expect(presentationOf(name as LinkStateName)).toBe(presentation);
    }
  });

  it("keeps deleted apart when the merge is off", () => {
    expect(presentationOf("deleted", false)).toBe("deleted");
    expect(presentationOf("not_in_library", false)).toBe("not_available");
  });

  it("labels every state that doesn't open, and none that do", () => {
    expect(LINK_STATE_LABEL.resolves).toBeUndefined();
    expect(LINK_STATE_LABEL.here).toBeUndefined();
    for (const p of [
      "in_trash",
      "deleted",
      "not_available",
      "unknown_form",
    ] as const) {
      expect(LINK_STATE_LABEL[p]).toBeString();
    }
  });
});

describe("createLinkIcon (search-linking §4.6)", () => {
  it("gives external links no icon and never asks the index", () => {
    const getState = mock(() => STATES.resolves);
    const icon = createLinkIcon(getState);
    expect(icon({ href: "https://example.com" })).toBeNull();
    expect(icon({ href: "mailto:a@b.c" })).toBeNull();
    expect(getState).not.toHaveBeenCalled();
  });

  for (const [name, state] of Object.entries(STATES) as [
    LinkStateName,
    LinkState,
  ][]) {
    it(`draws ${name}`, () => {
      const icon = createLinkIcon(() => state);
      const el = icon({ href: `tinydocy:doc/${KEY}` });
      expect(el).toBeInstanceOf(HTMLElement);
      if (!el) return;
      expect(el.tagName).toBe("SPAN");
      expect(el.className).toBe("doc-link-icon");
      expect(a11y(el)).toEqual(expectedA11y(name));
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
      expect(signatures(el)).toContain(SIGNATURE[name]);
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

  it("dashes only the states that don't open", () => {
    expect([...DASHED_LINK_STATES].sort()).toEqual([
      "deleted",
      "not_available",
      "unknown_form",
    ]);
  });
});

describe("refreshLinkIcons", () => {
  /**
   * One link as the extension leaves it: the icon inside the anchor, with
   * the `hyperlink-icon` class it adds, which refresh must keep.
   */
  function mount(state: LinkState) {
    const root = document.createElement("div");
    const a = document.createElement("a");
    a.setAttribute("href", `tinydocy:doc/${KEY}`);
    const icon = createLinkIcon(() => state)({ href: `tinydocy:doc/${KEY}` });
    if (!icon) throw new Error("no icon");
    icon.classList.add("hyperlink-icon");
    a.append(icon, "Q4 budget");
    root.append(a);
    return { root, icon };
  }

  it("leaves an unchanged state alone", () => {
    const { root } = mount(STATES.resolves);
    expect(refreshLinkIcons(root, () => STATES.resolves)).toBe(0);
  });

  it("treats a change inside one presentation as no change", () => {
    const { root } = mount(STATES.not_in_library);
    expect(refreshLinkIcons(root, () => STATES.deleted)).toBe(0);
  });

  for (const [from, to] of [
    ["resolves", "in_trash"],
    ["in_trash", "resolves"],
    ["here", "not_in_library"],
    ["unknown_form", "resolves"],
    ["in_trash", "deleted"],
  ] as const) {
    it(`redraws ${from} → ${to}, aria and all`, () => {
      const { root, icon } = mount(STATES[from]);
      expect(a11y(icon)).toEqual(expectedA11y(from));
      expect(refreshLinkIcons(root, () => STATES[to])).toBe(1);
      expect(root.querySelector(".doc-link-icon")).toBe(icon);
      expect(a11y(icon)).toEqual(expectedA11y(to));
      expect(signatures(icon)).toContain(SIGNATURE[to]);
      expect(signatures(icon)).not.toContain(SIGNATURE[from]);
      expect(icon.querySelectorAll("svg")).toHaveLength(1);
      expect(icon.className).toBe("doc-link-icon hyperlink-icon");
      expect(icon.textContent).toBe("");
    });
  }

  it("round-trips resolves → in_trash → resolves", () => {
    const { root, icon } = mount(STATES.resolves);
    refreshLinkIcons(root, () => STATES.in_trash);
    refreshLinkIcons(root, () => STATES.resolves);
    expect(a11y(icon)).toEqual(expectedA11y("resolves"));
    expect(signatures(icon)).toContain(SIGNATURE.resolves);
  });

  it("skips icons outside a tinydocy link", () => {
    const { root, icon } = mount(STATES.resolves);
    icon.closest("a")?.setAttribute("href", "https://example.com");
    const getState = mock(() => STATES.in_trash);
    expect(refreshLinkIcons(root, getState)).toBe(0);
    expect(getState).not.toHaveBeenCalled();
  });
});
