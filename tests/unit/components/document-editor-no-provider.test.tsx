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

import * as yjsDocumentModule from "@/hooks/use-yjs-document";
import * as hocuspocusModule from "@/lib/hocuspocus";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type YjsDocument = ReturnType<typeof yjsDocumentModule.useYjsDocument>;

/** What the mocked session hands the editor; tests change it, then render. */
let session: YjsDocument;

/** Calls that would create (or reuse) the shared WebSocket. */
let socketRequests = 0;
const socketStub = {
  status: "connected",
  connect() {},
  on() {},
  off() {},
};

// mock.module is process-wide: the real modules go back in afterAll.
const realUseYjsDocument = yjsDocumentModule.useYjsDocument;
const realGetSocket = hocuspocusModule.getSharedHocuspocusSocket;
mock.module("@/hooks/use-yjs-document", () => ({
  ...yjsDocumentModule,
  useYjsDocument: () => session,
}));
mock.module("@/lib/hocuspocus", () => ({
  ...hocuspocusModule,
  getSharedHocuspocusSocket: () => {
    socketRequests++;
    return socketStub;
  },
}));
afterAll(() => {
  mock.module("@/hooks/use-yjs-document", () => ({
    ...yjsDocumentModule,
    useYjsDocument: realUseYjsDocument,
  }));
  mock.module("@/lib/hocuspocus", () => ({
    ...hocuspocusModule,
    getSharedHocuspocusSocket: realGetSocket,
  }));
});

const { DocumentEditor } = await import(
  "@/components/document-editor/document-editor"
);

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

function localSession() {
  const ydoc = new Y.Doc();
  awareness = new Awareness(ydoc);
  return {
    ydoc,
    awareness,
    provider: null,
    synced: true,
    serverSynced: true,
    rejectedReason: null,
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
    root?.render(<DocumentEditor documentId="local-doc" />);
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
    session = localSession();
    await mount();
    expect(container?.querySelector(".document-editor")).not.toBeNull();
    expect(window.__tiptap_editor?.isEditable).toBe(true);
    // The connection chip (and its socket) belongs to a provider only.
    expect(container?.querySelector("[data-collab-status]")).toBeNull();
    expect(socketRequests).toBe(0);
    expect(socketsOpened).toBe(0);
  });

  it("keeps its extensions when a provider attaches", async () => {
    const local = localSession();
    session = local;
    await mount();
    const editor = window.__tiptap_editor;
    const optionCalls = setOptions.mock.calls.length;

    session = { ...local, provider: providerFor(local.awareness) };
    await render();
    expect(window.__tiptap_editor).toBe(editor);
    expect(setOptions.mock.calls.length).toBe(optionCalls);
    // With a provider, the chip and its connection come back.
    expect(socketRequests).toBeGreaterThan(0);
  });

  it("would rebuild them for a new Awareness (control)", async () => {
    const local = localSession();
    session = local;
    await mount();
    const optionCalls = setOptions.mock.calls.length;

    const other = new Awareness(local.ydoc);
    session = { ...local, awareness: other };
    await render();
    other.destroy();
    expect(setOptions.mock.calls.length).toBeGreaterThan(optionCalls);
  });
});
