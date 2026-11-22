"use client";

/**
 * The desktop renderer's composition root (architecture §2, §4): it puts a
 * `local-session` DocSession into context and opens one document. The only
 * module allowed to import `lib/platform/desktop/**` (architecture §3.3).
 *
 * Storage today is the dev bridge only (NEXT_PUBLIC_DESKTOP_BRIDGE=dev, the
 * `local` Playwright project): `local-session` over `createRpcDocStore`
 * over a loopback socket to `desktop/dev/storage-host.ts`. The packaged
 * app's `IpcDocStore` over `window.tinydocy` (P2.5) slots in beside it.
 * The library UI (P2.7) replaces the single document.
 */
import { useEffect, useState } from "react";

import { DocumentEditor } from "@/components/document-editor/document-editor";
import { PageFrame } from "@/components/prefs/page-frame";
// The page rules the first paint doesn't need; this root is a lazy chunk
// itself, so they load with it, before the editor renders.
import "@/components/prefs/page-text-styles";
import type { DocSession } from "@/lib/platform/doc-session";
import { DocSessionProvider } from "@/lib/platform/doc-session-context";
import { type DocStore, isDocStoreError } from "@/lib/platform/doc-store";

type Opened = { session: DocSession; docId: string; flush(): Promise<void> };

type DevBridgeConfig = { url: string; token: string };

declare global {
  interface Window {
    /** Set by the `local` Playwright project, one host per worker. */
    __TINYDOCY_DEV_BRIDGE?: DevBridgeConfig;
    /** Dev bridge only: saves every open document now (tests, reload). */
    __TINYDOCY_FLUSH?: () => Promise<void>;
  }
}

/** The document opened until the library UI exists; `?doc=` overrides it. */
const DEFAULT_DOC_ID = "desktop-dev";

const RELEASE_RETRIES = 5;
const RELEASE_RETRY_MS = 100;

/**
 * Retries `load` on `already_open` for about half a second. A reload opens a
 * new connection, and its `load` can reach the dev storage host before the
 * old connection's close has released the document (two sockets, two
 * queues). Dev bridge only: in the shell, main's registry keeps a window's
 * hold across its own reload.
 */
export function retryWhileReleasing(
  store: DocStore,
  wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
): DocStore {
  return {
    append: (docId, record) => store.append(docId, record),
    compact: (docId, state, upToSeq) => store.compact(docId, state, upToSeq),
    close: (docId) => store.close(docId),
    flush: () => store.flush(),
    async load(docId) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await store.load(docId);
        } catch (error) {
          const releasing =
            isDocStoreError(error) && error.code === "already_open";
          if (!releasing || attempt >= RELEASE_RETRIES) throw error;
          await wait(RELEASE_RETRY_MS);
        }
      }
    },
  };
}

function devBridgeConfig(): DevBridgeConfig | null {
  if (window.__TINYDOCY_DEV_BRIDGE) return window.__TINYDOCY_DEV_BRIDGE;
  const url = process.env.NEXT_PUBLIC_DESKTOP_BRIDGE_URL;
  const token = process.env.NEXT_PUBLIC_DESKTOP_BRIDGE_TOKEN;
  return url && token ? { url, token } : null;
}

export function DesktopRoot() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let close = () => {};
    const docId =
      new URLSearchParams(window.location.search).get("doc") ?? DEFAULT_DOC_ID;

    if (process.env.NEXT_PUBLIC_DESKTOP_BRIDGE === "dev") {
      const config = devBridgeConfig();
      if (!config) {
        setProblem("No storage host. Start bun desktop/dev/storage-host.ts.");
        return;
      }
      // The import()s sit inside the literal branch, so a release build
      // (flag inlined as "") has no bridge chunk; the export checks it.
      Promise.all([
        import("@/lib/platform/desktop/dev-bridge"),
        import("@/lib/platform/desktop/rpc-doc-store"),
        import("@/lib/platform/local-session"),
      ])
        .then(async ([bridgeModule, rpc, local]) => {
          const bridge = bridgeModule.connectDevBridge(config);
          close = () => bridge.close();
          await bridge.call("create", { docId });
          const session = local.createLocalSession({
            store: retryWhileReleasing(rpc.createRpcDocStore(bridge.call)),
          });
          return { session, docId, flush: () => session.flush() };
        })
        .then(
          (result) => {
            if (cancelled) return close();
            window.__TINYDOCY_FLUSH = result.flush;
            setOpened(result);
          },
          (error: unknown) => {
            if (!cancelled) setProblem(`Library unavailable: ${String(error)}`);
          },
        );
    } else {
      setProblem("Library unavailable.");
    }

    return () => {
      cancelled = true;
      delete window.__TINYDOCY_FLUSH;
      close();
    };
  }, []);

  // Save on hide and blur, as the desktop shell will (architecture §5.2).
  useEffect(() => {
    if (!opened) return;
    const save = () => void opened.flush().catch(() => undefined);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", save);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", save);
      window.removeEventListener("pagehide", save);
    };
  }, [opened]);

  if (problem) {
    return (
      <p role="alert" className="p-4 text-sm">
        {problem}
      </p>
    );
  }
  if (!opened) return null;
  return (
    <DocSessionProvider value={opened.session}>
      <PageFrame>
        {({ readOnly, outlineOverlay }) => (
          <DocumentEditor
            documentId={opened.docId}
            readOnly={readOnly}
            outlineOverlay={outlineOverlay}
          />
        )}
      </PageFrame>
    </DocSessionProvider>
  );
}
