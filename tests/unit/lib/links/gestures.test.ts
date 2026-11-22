import { afterEach, describe, expect, it } from "bun:test";

import { type LinkGestures, trackLinkGestures } from "@/lib/links/gestures";

let tracker: LinkGestures | null = null;

afterEach(() => {
  tracker?.dispose();
  tracker = null;
});

const mouse = (type: string, init: MouseEventInit = {}) =>
  document.body.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, ...init }),
  );

const key = (init: KeyboardEventInit) =>
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, key: "Enter", ...init }),
  );

describe("trackLinkGestures (search-linking §4.3)", () => {
  it("starts in this tab", () => {
    tracker = trackLinkGestures(window);
    expect(tracker.wantsNewTab()).toBe(false);
  });

  it("Mod alone stays in this tab", () => {
    tracker = trackLinkGestures(window);
    mouse("mousedown", { metaKey: true, ctrlKey: true });
    expect(tracker.wantsNewTab()).toBe(false);
  });

  it("Mod+Shift asks for a new tab", () => {
    tracker = trackLinkGestures(window);
    mouse("mousedown", { metaKey: true, shiftKey: true });
    expect(tracker.wantsNewTab()).toBe(true);
  });

  it("the middle button asks for a new tab", () => {
    tracker = trackLinkGestures(window);
    mouse("auxclick", { button: 1 });
    expect(tracker.wantsNewTab()).toBe(true);
  });

  it("pointerdown counts too", () => {
    tracker = trackLinkGestures(document);
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, shiftKey: true }),
    );
    expect(tracker.wantsNewTab()).toBe(true);
  });

  it("the next gesture overwrites the last", () => {
    tracker = trackLinkGestures(window);
    mouse("mousedown", { shiftKey: true });
    expect(tracker.wantsNewTab()).toBe(true);
    mouse("mousedown", { metaKey: true });
    expect(tracker.wantsNewTab()).toBe(false);
    key({ shiftKey: true, metaKey: true });
    expect(tracker.wantsNewTab()).toBe(true);
    key({ metaKey: true });
    expect(tracker.wantsNewTab()).toBe(false);
  });

  it("records in the capture phase, before a handler stops the event", () => {
    tracker = trackLinkGestures(window);
    const stop = (event: Event) => event.stopPropagation();
    document.body.addEventListener("mousedown", stop, true);
    mouse("mousedown", { shiftKey: true });
    document.body.removeEventListener("mousedown", stop, true);
    expect(tracker.wantsNewTab()).toBe(true);
  });

  it("records the link the gesture landed on", () => {
    tracker = trackLinkGestures(window);
    const link = document.createElement("a");
    link.href = "tinydocy:doc/x";
    const inner = document.createElement("span");
    link.append(inner);
    document.body.append(link);
    expect(tracker.lastAnchor()).toBeNull();
    inner.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, metaKey: true }),
    );
    expect(tracker.lastAnchor()).toBe(link);
    // A gesture elsewhere (Alt+Enter in the editor) clears it.
    key({ altKey: true });
    expect(tracker.lastAnchor()).toBeNull();
    link.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    expect(tracker.lastAnchor()).toBe(link);
    link.remove();
  });

  it("ignores anchors without an href", () => {
    tracker = trackLinkGestures(window);
    const anchor = document.createElement("a");
    document.body.append(anchor);
    anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(tracker.lastAnchor()).toBeNull();
    anchor.remove();
  });

  it("stops listening once disposed", () => {
    tracker = trackLinkGestures(window);
    tracker.dispose();
    mouse("mousedown", { shiftKey: true });
    expect(tracker.wantsNewTab()).toBe(false);
  });
});
