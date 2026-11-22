import { describe, expect, it } from "bun:test";

import {
  horizontalIntent,
  isContextMenuKey,
  isFilterKey,
  isNewFolderKey,
  isQuickOpenKey,
  isSelectAllKey,
  isTrashKey,
  isUndoKey,
  manualMoveKey,
  openTarget,
} from "@/lib/library/library-keys";

type Keys = Partial<
  Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "code"
  >
>;
const key = (init: Keys) =>
  ({
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  }) as KeyboardEvent;

describe("library keys (UX §4.6)", () => {
  it("trashes with ⌘⌫ on macOS and Delete elsewhere", () => {
    expect(isTrashKey(key({ key: "Backspace", metaKey: true }), true)).toBe(
      true,
    );
    expect(isTrashKey(key({ key: "Delete" }), true)).toBe(true);
    expect(isTrashKey(key({ key: "Backspace" }), true)).toBe(false);
    expect(isTrashKey(key({ key: "Delete" }), false)).toBe(true);
    expect(isTrashKey(key({ key: "Backspace", ctrlKey: true }), false)).toBe(
      false,
    );
    expect(isTrashKey(key({ key: "Delete", shiftKey: true }), false)).toBe(
      false,
    );
  });

  it("undoes with ⌘Z / Ctrl+Z only", () => {
    expect(isUndoKey(key({ key: "z", metaKey: true }), true)).toBe(true);
    expect(isUndoKey(key({ key: "z", ctrlKey: true }), false)).toBe(true);
    expect(isUndoKey(key({ key: "z", ctrlKey: true }), true)).toBe(false);
    expect(
      isUndoKey(key({ key: "Z", metaKey: true, shiftKey: true }), true),
    ).toBe(false);
    // A Persian layout types another letter; the physical key still counts.
    expect(
      isUndoKey(key({ key: "ظ", code: "KeyZ", ctrlKey: true }), false),
    ).toBe(true);
  });

  it("opens Quick Open with ⌘O / Ctrl+O and a folder with ⌘⇧N", () => {
    expect(isQuickOpenKey(key({ key: "o", metaKey: true }), true)).toBe(true);
    expect(isQuickOpenKey(key({ key: "o", ctrlKey: true }), false)).toBe(true);
    expect(
      isNewFolderKey(key({ key: "N", ctrlKey: true, shiftKey: true }), false),
    ).toBe(true);
  });

  it("opens the context menu with Shift+F10 or the Menu key", () => {
    expect(isContextMenuKey(key({ key: "F10", shiftKey: true }))).toBe(true);
    expect(isContextMenuKey(key({ key: "ContextMenu" }))).toBe(true);
    expect(isContextMenuKey(key({ key: "F10" }))).toBe(false);
  });

  it("maps ⌘ / Ctrl to a new tab and ⌥⌘ / Shift to a new window", () => {
    expect(
      openTarget(
        { metaKey: true, altKey: false, shiftKey: false, ctrlKey: false },
        true,
      ),
    ).toBe("tab");
    expect(
      openTarget(
        { metaKey: true, altKey: true, shiftKey: false, ctrlKey: false },
        true,
      ),
    ).toBe("window");
    expect(
      openTarget(
        { metaKey: false, altKey: false, shiftKey: false, ctrlKey: true },
        false,
      ),
    ).toBe("tab");
    expect(
      openTarget(
        { metaKey: false, altKey: false, shiftKey: true, ctrlKey: false },
        false,
      ),
    ).toBe("window");
    expect(
      openTarget(
        { metaKey: false, altKey: false, shiftKey: false, ctrlKey: false },
        false,
      ),
    ).toBe("current");
  });

  it("follows the visual direction for → and ←", () => {
    expect(horizontalIntent("ArrowRight", "ltr")).toBe("in");
    expect(horizontalIntent("ArrowLeft", "ltr")).toBe("out");
    expect(horizontalIntent("ArrowRight", "rtl")).toBe("out");
    expect(horizontalIntent("ArrowLeft", "rtl")).toBe("in");
    expect(horizontalIntent("ArrowUp", "ltr")).toBeNull();
  });
});

describe("list view keys (P2.7b, UX §4.6)", () => {
  it("⌘F / Ctrl+F filters the list, also on other layouts", () => {
    expect(isFilterKey(key({ key: "f", metaKey: true }), true)).toBe(true);
    expect(
      isFilterKey(key({ key: "ب", code: "KeyF", metaKey: true }), true),
    ).toBe(true);
    expect(isFilterKey(key({ key: "f", ctrlKey: true }), false)).toBe(true);
    expect(
      isFilterKey(key({ key: "f", metaKey: true, shiftKey: true }), true),
    ).toBe(false);
    expect(isFilterKey(key({ key: "f", ctrlKey: true }), true)).toBe(false);
  });

  it("⌘A / Ctrl+A selects all", () => {
    expect(isSelectAllKey(key({ key: "a", metaKey: true }), true)).toBe(true);
    expect(isSelectAllKey(key({ key: "a", ctrlKey: true }), false)).toBe(true);
    expect(isSelectAllKey(key({ key: "a" }), false)).toBe(false);
  });

  it("⌥⌘↑ / ⌥⌘↓ (Ctrl+Alt off macOS) move in a Manual list", () => {
    expect(
      manualMoveKey(key({ key: "ArrowUp", metaKey: true, altKey: true }), true),
    ).toBe("up");
    expect(
      manualMoveKey(
        key({ key: "ArrowDown", ctrlKey: true, altKey: true }),
        false,
      ),
    ).toBe("down");
    expect(manualMoveKey(key({ key: "ArrowDown", altKey: true }), true)).toBe(
      null,
    );
  });
});
