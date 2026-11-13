import { announce } from "@/lib/announce";
import {
  removeFormat,
  restoreFormat,
  type SavedFormat,
} from "@/lib/saved-formats";

/**
 * Removes a saved format at once (no confirm row), with Undo on the pill
 * for 5 s (design pass §4): Undo puts it back where it was.
 */
export function removeFormatWithUndo(format: SavedFormat, index: number): void {
  removeFormat(format.id);
  announce(`Removed ‘${format.name}’`, {
    done: true,
    action: {
      label: "Undo",
      run: () => {
        if (restoreFormat(format, index)) {
          announce(`Restored ‘${format.name}’`, { done: true });
        }
      },
    },
  });
}
