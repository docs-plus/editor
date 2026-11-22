/**
 * The app-level undo stack for file operations (UX §6.2): trash, move,
 * rename and pin, one stack per window. ⌘Z uses it while focus is in the
 * sidebar, a list or Quick Open, and the pill's Undo runs the same entry.
 * Delete Forever and Empty Trash never come here: they confirm instead.
 */
export const FILE_UNDO_LIMIT = 20;

export interface FileUndoEntry {
  /** The menu says "Undo <label>". */
  readonly label: string;
  readonly undo: () => void | Promise<void>;
}

export interface FileUndoStack {
  /** Returns the entry, for the pill's Undo. */
  push(entry: FileUndoEntry): FileUndoEntry;
  /** Undoes the newest entry; false when there is none. */
  undo(): Promise<boolean>;
  /** Undoes this entry if it is still on the stack. */
  run(entry: FileUndoEntry): Promise<boolean>;
  peekLabel(): string | null;
}

export function createFileUndoStack(): FileUndoStack {
  const entries: FileUndoEntry[] = [];
  const run = async (entry: FileUndoEntry) => {
    const at = entries.lastIndexOf(entry);
    if (at < 0) return false;
    entries.splice(at, 1);
    await entry.undo();
    return true;
  };
  return {
    push(entry) {
      entries.push(entry);
      if (entries.length > FILE_UNDO_LIMIT) entries.shift();
      return entry;
    },
    undo() {
      const last = entries.at(-1);
      return last ? run(last) : Promise.resolve(false);
    },
    run,
    peekLabel: () => entries.at(-1)?.label ?? null,
  };
}
