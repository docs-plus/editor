"use client";

/**
 * The web sandbox's editor: `DocumentEditor` under the sandbox `DocSession`.
 * `EditorApp` loads this module lazily, in place of the editor, so the
 * adapter and the context travel with the editor's chunk instead of the
 * first load. `document-editor.tsx` itself imports no adapter; the desktop
 * and library roots wrap it with their own session (architecture §3.3).
 */
import type { ComponentProps } from "react";

import { DocumentEditor } from "@/components/document-editor/document-editor";
import { DocSessionProvider } from "@/lib/platform/doc-session-context";
import { sandboxDocSession } from "@/lib/platform/web/sandbox-doc-session";

export function SandboxDocumentEditor(
  props: ComponentProps<typeof DocumentEditor>,
) {
  return (
    <DocSessionProvider session={sandboxDocSession}>
      <DocumentEditor {...props} />
    </DocSessionProvider>
  );
}
