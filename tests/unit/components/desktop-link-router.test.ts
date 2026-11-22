import { afterEach, describe, expect, test } from "bun:test";

import {
  installLinkRouter,
  leavingLinkOf,
} from "@/components/desktop/link-router";
import type { TinydocyBridge } from "@/desktop/shared/ipc-contract";

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.body.innerHTML = "";
});

function fakeBridge() {
  const calls: Array<{ channel: string; args: unknown }> = [];
  const bridge = {
    build: "test",
    invoke: async (channel: string, args: unknown) => {
      calls.push({ channel, args });
      return { ok: true, value: { opened: true } };
    },
    on: () => () => undefined,
  } as unknown as TinydocyBridge;
  return { bridge, calls };
}

function clickOn(element: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent("click", { bubbles: true, ...init });
  Object.defineProperty(event, "target", { value: element });
  return event;
}

describe("desktop link router (N2)", () => {
  test("window.open goes to shell.openLink and returns null", () => {
    const { bridge, calls } = fakeBridge();
    const original = window.open;
    uninstall = installLinkRouter(bridge);
    expect(window.open("https://example.com/a")).toBeNull();
    expect(window.open(new URL("https://example.com/b"))).toBeNull();
    expect(calls).toEqual([
      { channel: "shell.openLink", args: { url: "https://example.com/a" } },
      { channel: "shell.openLink", args: { url: "https://example.com/b" } },
    ]);
    uninstall();
    uninstall = null;
    expect(window.open).toBe(original);
  });

  test("a _blank or modifier click on a link outside the editor leaves the app", () => {
    document.body.innerHTML = `
      <a id="blank" href="https://example.com/privacy" target="_blank"><span id="inner">P</span></a>
      <a id="plain" href="https://example.com/plain">plain</a>
      <div class="ProseMirror"><a id="doc" href="https://example.com/doc" target="_blank">doc</a></div>`;
    const el = (id: string) => document.getElementById(id) as Element;
    expect(leavingLinkOf(clickOn(el("inner")))).toBe(
      "https://example.com/privacy",
    );
    expect(leavingLinkOf(clickOn(el("plain")))).toBeNull();
    expect(leavingLinkOf(clickOn(el("plain"), { metaKey: true }))).toBe(
      "https://example.com/plain",
    );
    expect(leavingLinkOf(clickOn(el("plain"), { button: 1 }))).toBe(
      "https://example.com/plain",
    );
    // The editor's links are the hyperlink extension's (its popover).
    expect(leavingLinkOf(clickOn(el("doc")))).toBeNull();
  });
});
