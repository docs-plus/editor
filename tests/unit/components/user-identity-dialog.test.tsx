import { afterEach, describe, expect, it, mock } from "bun:test";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { saveIdentityDraft } from "@/components/tiptap-ui/user-identity-button";
import { UserIdentityDialog } from "@/components/tiptap-ui/user-identity-dialog";
import {
  CARET_COLORS,
  type NameResult,
  normalizeName,
  saveUserIdentity,
  type UserIdentity,
} from "@/lib/user-identity";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CURRENT: UserIdentity = { name: "Brave Otter", color: "#E57373" };
const FAMILY = "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}";

const mounted: { root: Root; host: HTMLElement }[] = [];

const ownStorageDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  if (ownStorageDescriptor) {
    Object.defineProperty(window, "localStorage", ownStorageDescriptor);
  } else {
    delete (window as { localStorage?: Storage }).localStorage;
  }
  // A successful save clears the module's failed-write state, so a quota
  // test leaves nothing behind for other files sharing this process.
  saveUserIdentity(CURRENT);
  localStorage.clear();
});

function renderDialog() {
  // The button's save path validates; the dialog shows what it returns.
  const onSave = mock(
    (identity: UserIdentity): NameResult => normalizeName(identity.name),
  );
  const onOpenChange = mock((_open: boolean) => {});
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => {
    root.render(
      createElement(UserIdentityDialog, {
        open: true,
        onOpenChange,
        currentUser: CURRENT,
        colors: CARET_COLORS,
        onSave,
      }),
    );
  });
  return { onSave, onOpenChange };
}

const nameInput = () =>
  document.querySelector<HTMLInputElement>("#user-identity-name");

function typeName(value: string) {
  const input = nameInput();
  if (!input) throw new Error("name input not rendered");
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Focuses Save first, as a pointer click does in Chromium. */
function clickSave() {
  const save = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Save",
  );
  if (!save) throw new Error("Save not rendered");
  act(() => {
    save.focus();
    save.click();
  });
}

const errorText = () =>
  document.querySelector("#user-identity-name-error")?.textContent ?? "";

describe("UserIdentityDialog", () => {
  it("refuses an empty name with an inline error and keeps focus", () => {
    const { onOpenChange } = renderDialog();
    typeName("   ");
    clickSave();
    expect(errorText()).toBe("Enter a name.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    const input = nameInput();
    expect(document.activeElement).toBe(input);
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(input?.getAttribute("aria-describedby")).toBe(
      "user-identity-name-error",
    );
    // Announced even when focus never left the field (Safari).
    expect(
      document.querySelector("#user-identity-name-error")?.getAttribute("role"),
    ).toBe("alert");
  });

  it("refuses a 33-character name", () => {
    const { onOpenChange } = renderDialog();
    typeName("a".repeat(33));
    clickSave();
    expect(errorText()).toBe("Use 32 characters or fewer.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("clears the error when the name changes", () => {
    renderDialog();
    typeName("");
    clickSave();
    expect(errorText()).toBe("Enter a name.");
    typeName("A");
    expect(errorText()).toBe("");
    expect(nameInput()?.getAttribute("aria-invalid")).toBeNull();
  });

  it("accepts 32 emoji graphemes: the input has no maxLength", () => {
    const { onSave, onOpenChange } = renderDialog();
    expect(nameInput()?.hasAttribute("maxlength")).toBe(false);
    typeName(FAMILY.repeat(32));
    clickSave();
    expect(onSave).toHaveBeenCalledWith({
      name: FAMILY.repeat(32),
      color: CURRENT.color,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("the lazy dialog chunk", () => {
  it("never imports lib/user-identity at runtime (it would split the editor group)", async () => {
    const source = await Bun.file(
      `${import.meta.dir}/../../../components/tiptap-ui/user-identity-dialog.tsx`,
    ).text();
    const runtimeImports = source.match(
      /^import\s+(?!type\b)[^;]*from\s+"@\/lib\/user-identity";/gm,
    );
    expect(runtimeImports).toBeNull();
  });
});

describe("saveIdentityDraft", () => {
  it("broadcasts the normalised name, not the raw draft", () => {
    const updateUser = mock((_user: UserIdentity) => true);
    const editor = { commands: { updateUser } };
    const { result, saved } = saveIdentityDraft(
      { name: "  Ann  ", color: "#64B5F6" },
      editor,
    );
    expect(result).toEqual({ ok: true, name: "Ann" });
    expect(saved).toEqual({ name: "Ann", color: "#64B5F6" });
    expect(updateUser).toHaveBeenCalledWith({ name: "Ann", color: "#64B5F6" });
  });

  it("broadcasts the saved identity when storage refuses the write", () => {
    localStorage.setItem(
      "tinydocy-user",
      JSON.stringify({ name: "Ann", color: "#E57373" }),
    );
    const stored = localStorage.getItem.bind(localStorage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => ({
        getItem: stored,
        setItem: () => {
          throw new DOMException("full", "QuotaExceededError");
        },
      }),
    });
    const updateUser = mock((_user: UserIdentity) => true);
    const { saved } = saveIdentityDraft(
      { name: "Bo", color: "#64B5F6" },
      { commands: { updateUser } },
    );
    expect(saved).toEqual({ name: "Bo", color: "#64B5F6" });
    expect(updateUser).toHaveBeenCalledWith({ name: "Bo", color: "#64B5F6" });
  });

  it("broadcasts nothing for an invalid name", () => {
    const updateUser = mock((_user: UserIdentity) => true);
    const { result, saved } = saveIdentityDraft(
      { name: "\u200B", color: "#64B5F6" },
      { commands: { updateUser } },
    );
    expect(result).toEqual({ ok: false, error: "empty" });
    expect(saved).toBeUndefined();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
