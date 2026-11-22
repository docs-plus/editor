"use client";

/**
 * The web sandbox's editor: `DocumentEditor` under the sandbox `DocSession`,
 * with the sandbox's status chip. `EditorApp` loads this module lazily, in
 * place of the editor, so the adapter, the context and the chip travel with
 * the editor's chunk instead of the first load (same first paint, no extra
 * chunk). `components/document-editor/` imports no adapter and nothing that
 * reads `collab-session`; the desktop and library roots wrap it with their
 * own session and chip (architecture §3.3).
 */
import type { ComponentProps } from "react";

import { DocumentEditor } from "@/components/document-editor/document-editor";
import { CollabStatusGroup } from "@/components/tiptap-ui/user-identity-button";
import { DocSessionProvider } from "@/lib/platform/doc-session-context";
import { sandboxDocSession } from "@/lib/platform/web/sandbox-doc-session";

/** One element for every render: the editor's props stay referentially stable. */
const STATUS_CHIP = <CollabStatusGroup />;

export function SandboxDocumentEditor(
  props: ComponentProps<typeof DocumentEditor>,
) {
  return (
    <DocSessionProvider value={sandboxDocSession}>
      <DocumentEditor {...props} statusChip={STATUS_CHIP} />
    </DocSessionProvider>
  );
}
