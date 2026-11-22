import { afterEach, describe, expect, it } from "bun:test";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";

import { useYjsDocument } from "@/hooks/use-yjs-document";
import type {
  DocHandle,
  DocHandleState,
  DocSession,
} from "@/lib/platform/doc-session";
import { DocSessionProvider } from "@/lib/platform/doc-session-context";
import { createLocalSession } from "@/lib/platform/local-session";
import { MemoryDocStore } from "@/lib/platform/memory-doc-store";
import { settle } from "@/tests/helpers/platform-fakes";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookResult = ReturnType<typeof useYjsDocument>;

const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

/** Records every result of the hook it renders. */
function Probe({ id, results }: { id: string; results: HookResult[] }) {
  results.push(useYjsDocument(id));
  return null;
}

/** Renders the hook under `session` and returns the latest result. */
function renderHook(session: DocSession | null, documentId: string) {
  const results: HookResult[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const render = (id: string) =>
    act(() => {
      const probe = <Probe id={id} results={results} />;
      root.render(
        session ? (
          <DocSessionProvider value={session}>{probe}</DocSessionProvider>
        ) : (
          probe
        ),
      );
    });
  render(documentId);
  return {
    latest: () => results.at(-1) as HookResult,
    rerender: render,
    unmount: () => act(() => root.unmount()),
  };
}

/** A DocSession whose handles the test drives by hand. */
function manualSession() {
  const opened: string[] = [];
  const released: string[] = [];
  const handles = new Map<
    string,
    DocHandle & { set(change: Partial<DocHandleState>): void }
  >();
  const session: DocSession = {
    open(docId) {
      opened.push(docId);
      const doc = new Y.Doc();
      let state: DocHandleState = {
        ready: false,
        authoritative: false,
        readOnlyReason: null,
        error: null,
      };
      const listeners = new Set<() => void>();
      const handle = {
        docId,
        doc,
        awareness: {} as DocHandle["awareness"],
        provider: null,
        getState: () => state,
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        flush: async () => {},
        release: () => released.push(docId),
        set(change: Partial<DocHandleState>) {
          state = { ...state, ...change };
          for (const listener of listeners) listener();
        },
      };
      handles.set(docId, handle);
      return handle;
    },
    flush: async () => {},
  };
  return { session, opened, released, handle: (id: string) => handles.get(id) };
}

describe("useYjsDocument", () => {
  it("opens the document through the DocSession in context", () => {
    const manual = manualSession();
    const hook = renderHook(manual.session, "doc-a");
    expect(manual.opened).toEqual(["doc-a"]);
    const handle = manual.handle("doc-a");
    expect(hook.latest()).toEqual({
      ydoc: handle?.doc,
      awareness: handle?.awareness,
      provider: null,
      synced: false,
      serverSynced: false,
      rejectedReason: null,
    });
  });

  it("maps ready, authoritative and readOnlyReason to the editor's names", () => {
    const manual = manualSession();
    const hook = renderHook(manual.session, "doc-a");
    act(() =>
      manual.handle("doc-a")?.set({
        ready: true,
        authoritative: true,
        readOnlyReason: "document_too_large",
      }),
    );
    expect(hook.latest()).toMatchObject({
      synced: true,
      serverSynced: true,
      rejectedReason: "document_too_large",
    });
  });

  it("releases the old document when the id changes, and on unmount", () => {
    const manual = manualSession();
    const hook = renderHook(manual.session, "doc-a");
    hook.rerender("doc-b");
    expect(manual.opened).toEqual(["doc-a", "doc-b"]);
    expect(manual.released).toEqual(["doc-a"]);
    expect(hook.latest().ydoc).toBe(manual.handle("doc-b")?.doc as Y.Doc);
    hook.unmount();
    expect(manual.released).toEqual(["doc-a", "doc-b"]);
  });

  it("opens a local document end to end", async () => {
    const session = createLocalSession({ store: new MemoryDocStore() });
    const hook = renderHook(session, "local-doc");
    expect(hook.latest().synced).toBe(false);
    await act(async () => {
      await settle();
    });
    expect(hook.latest()).toMatchObject({
      synced: true,
      serverSynced: true,
      provider: null,
      rejectedReason: null,
    });
    expect(hook.latest().awareness?.doc).toBe(hook.latest().ydoc as Y.Doc);
  });

  it("throws a clear error without a DocSessionProvider", () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = () => {};
    try {
      renderHook(null, "doc-a");
    } catch (error) {
      errors.push(error);
    } finally {
      console.error = original;
    }
    expect(String(errors[0])).toContain("DocSessionProvider");
  });
});
