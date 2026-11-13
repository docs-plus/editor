/**
 * The one composed registry. Frozen file: tracks never edit it; each adds
 * actions to the file it owns (contract §4):
 * - `core-actions.ts`    PR D1
 * - `surface-actions.ts` PR D2
 * - `v11-actions.ts`     PR E
 * Order here is palette order within a group.
 */
import { coreActions } from "@/lib/editor-actions/core-actions";
import { createRegistry } from "@/lib/editor-actions/registry";
import { surfaceActions } from "@/lib/editor-actions/surface-actions";
import { v11Actions } from "@/lib/editor-actions/v11-actions";

export const editorActions = createRegistry([
  ...coreActions,
  ...surfaceActions,
  ...v11Actions,
]);
