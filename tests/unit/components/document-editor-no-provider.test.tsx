import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { Editor } from "@tiptap/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import * as hocuspocusModule from "@/lib/hocuspocus";
import type { DocHandle, DocSession } from "@/lib/platform/doc-session";
import { DocSessionProvider } from "@/lib/platform/doc-session-context";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * The open document the fake DocSession hands the editor. The hook reads its
 * doc, awareness and provider on every render, so tests change them, then
 * render again.
 */
let handle: Mutable<DocHandle>;
const docSession: DocSession = {
  open: () => handle,
  flush: async () => {},
};

/** Calls that would create (or reuse) the shared WebSocket. */
let socketRequests = 0;
const socketStub = {
  status: "connected",
  connect() {},
  on() {},
  off() {},
};

// mock.module is process-wide: the real module goes back in afterAll.
const realGetSocket = hocuspocusModule.getSharedHocuspocusSocket;
mock.module("@/lib/hocuspocus", () => ({
  ...hocuspocusModule,
  getSharedHocuspocusSocket: () => {
    socketRequests++;
    return socketStub;
  },
}));
afterAll(() => {
  mock.module("@/lib/hocuspocus", () => ({
    ...hocuspocusModule,
    getSharedHocuspocusSocket: realGetSocket,
  }));
});

// The editor plus the chip the web root hands it: the editor folder imports
// no chip, so nothing there reads collab-session.
const [{ DocumentEditor }, { CollabStatusGroup }] = await Promise.all([
  import("@/components/document-editor/document-editor"),
  import("@/components/tiptap-ui/user-identity-button"),
]);
const STATUS_CHIP = <CollabStatusGroup />;

/** Counts WebSocket constructions, whatever creates them. */
let socketsOpened = 0;
const RealWebSocket = globalThis.WebSocket;
beforeAll(() => {
  globalThis.WebSocket = class extends EventTarget {
    constructor() {
      super();
      socketsOpened++;
    }
  } as unknown as typeof WebSocket;
});
afterAll(() => {
  globalThis.WebSocket = RealWebSocket;
});

/** `useEditor` calls it when an option changes: a full view update. */
const setOptions = spyOn(Editor.prototype, "setOptions");
afterAll(() => setOptions.mockRestore());

let root: Root | undefined;
let container: HTMLElement | undefined;
let awareness: Awareness | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  awareness?.destroy();
  root = undefined;
  container = undefined;
  awareness = undefined;
  socketRequests = 0;
  socketsOpened = 0;
  setOptions.mockClear();
});

const LOCAL_STATE = {
  ready: true,
  authoritative: true,
  readOnlyReason: null,
  error: null,
};

/** A loaded Local document: no provider, its own Awareness. */
function localHandle(): Mutable<DocHandle> {
  const doc = new Y.Doc();
  awareness = new Awareness(doc);
  return {
    docId: "local-doc",
    doc,
    awareness,
    provider: null,
    getState: () => LOCAL_STATE,
    subscribe: () => () => {},
    flush: async () => {},
    release: () => {},
  };
}

/** A provider double sharing the session's Awareness, as Live attaches. */
const providerFor = (shared: Awareness) =>
  ({
    awareness: shared,
    isSynced: true,
    on() {},
    off() {},
  }) as unknown as HocuspocusProvider;

async function render() {
  await act(async () => {
    root?.render(
      <DocSessionProvider value={docSession}>
        <DocumentEditor documentId="local-doc" statusChip={STATUS_CHIP} />
      </DocSessionProvider>,
    );
  });
  // Tiptap creates the editor in an effect and emits `create` on a timer.
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
}

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
}

describe("DocumentEditor without a provider", () => {
  it("mounts an editable editor and opens no socket", async () => {
    handle = localHandle();
    await mount();
    expect(container?.querySelector(".document-editor")).not.toBeNull();
    expect(window.__tiptap_editor?.isEditable).toBe(true);
    // The connection chip (and its socket) belongs to a provider only.
    expect(container?.querySelector("[data-collab-status]")).toBeNull();
    expect(socketRequests).toBe(0);
    expect(socketsOpened).toBe(0);
  });

  it("keeps its extensions when a provider attaches", async () => {
    handle = localHandle();
    await mount();
    const editor = window.__tiptap_editor;
    const optionCalls = setOptions.mock.calls.length;

    handle.provider = providerFor(handle.awareness);
    await render();
    expect(window.__tiptap_editor).toBe(editor);
    expect(setOptions.mock.calls.length).toBe(optionCalls);
    // With a provider, the chip and its connection come back.
    expect(socketRequests).toBeGreaterThan(0);
  });

  it("would rebuild them for a new Awareness (control)", async () => {
    handle = localHandle();
    await mount();
    const optionCalls = setOptions.mock.calls.length;

    const other = new Awareness(handle.doc);
    handle.awareness = other;
    await render();
    other.destroy();
    expect(setOptions.mock.calls.length).toBeGreaterThan(optionCalls);
  });
});
