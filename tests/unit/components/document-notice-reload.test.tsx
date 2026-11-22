import { afterEach, describe, expect, it } from "bun:test";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { DocumentNotice } from "@/components/document-editor/document-notice";
import type { DocSession } from "@/lib/platform/doc-session";
import { DocSessionProvider } from "@/lib/platform/doc-session-context";
import { settle } from "@/tests/helpers/platform-fakes";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];
const originalReload = window.location.reload;

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  Object.defineProperty(window.location, "reload", {
    configurable: true,
    value: originalReload,
  });
});

function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(element));
  return container;
}

/** A DocSession that records flushes and lets the test finish them. */
function flushingSession() {
  const events: string[] = [];
  let finish = () => {};
  const session: DocSession = {
    open: () => {
      throw new Error("not used");
    },
    flush: () => {
      events.push("flush");
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  };
  return { session, events, finish: () => finish() };
}

describe("DocumentNotice Reload", () => {
  it("saves through the DocSession, then reloads", async () => {
    const { session, events, finish } = flushingSession();
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      value: () => events.push("reload"),
    });
    const container = render(
      <DocSessionProvider value={session}>
        <DocumentNotice reason="client_outdated" />
      </DocSessionProvider>,
    );
    const button = container.querySelector("button");
    expect(button?.textContent).toContain("Reload");

    act(() => button?.click());
    expect(events).toEqual(["flush"]);
    expect(button?.disabled).toBe(true);

    await act(async () => {
      finish();
      await settle();
    });
    expect(events).toEqual(["flush", "reload"]);
  });

  it("offers Reload for the schema guard's outdated state too", () => {
    const { session } = flushingSession();
    const container = render(
      <DocSessionProvider value={session}>
        <DocumentNotice reason="outdated" />
      </DocSessionProvider>,
    );
    expect(container.querySelector("button")?.textContent).toContain("Reload");
  });

  it("shows a refusal without Reload, and needs no DocSession for it", () => {
    const container = render(<DocumentNotice reason="document_too_large" />);
    expect(container.textContent).toContain("over the size limit");
    expect(container.querySelector("button")).toBeNull();
  });
});
