import type { HocuspocusProvider } from "@hocuspocus/provider";
import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import * as Y from "yjs";

import { buildDocumentEditorExtensions } from "@/components/document-editor/document-editor-config";

/** The real ProseMirror schema the document editor builds, for schema tests. */
export function getEditorSchema(): Schema {
  return getSchema(
    buildDocumentEditorExtensions({
      documentId: "schema-test",
      ydoc: new Y.Doc(),
      provider: {} as HocuspocusProvider,
      onFoldChange() {},
      onFilterChange() {},
      onTocUpdate() {},
    }),
  );
}
