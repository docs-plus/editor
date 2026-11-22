import { describe, expect, it } from "bun:test";

import { createFileUndoStack, FILE_UNDO_LIMIT } from "@/lib/library/file-undo";

describe("file-operation undo stack (UX §6.2)", () => {
  it("undoes the last operation first and names it", async () => {
    const stack = createFileUndoStack();
    const ran: string[] = [];
    stack.push({ label: "Move", undo: () => void ran.push("move") });
    stack.push({ label: "Move to Trash", undo: () => void ran.push("trash") });
    expect(stack.peekLabel()).toBe("Move to Trash");
    expect(await stack.undo()).toBe(true);
    expect(await stack.undo()).toBe(true);
    expect(await stack.undo()).toBe(false);
    expect(ran).toEqual(["trash", "move"]);
    expect(stack.peekLabel()).toBeNull();
  });

  it("keeps the last 20 entries", async () => {
    const stack = createFileUndoStack();
    const ran: number[] = [];
    for (let i = 0; i < FILE_UNDO_LIMIT + 5; i++) {
      stack.push({ label: `op ${i}`, undo: () => void ran.push(i) });
    }
    while (await stack.undo());
    expect(ran).toHaveLength(FILE_UNDO_LIMIT);
    expect(ran.at(-1)).toBe(5);
  });

  it("runs a specific entry once, from the pill", async () => {
    const stack = createFileUndoStack();
    let runs = 0;
    const entry = stack.push({ label: "Move", undo: () => void runs++ });
    await stack.run(entry);
    await stack.run(entry);
    expect(runs).toBe(1);
    expect(await stack.undo()).toBe(false);
  });

  it("waits for an async undo", async () => {
    const stack = createFileUndoStack();
    let done = false;
    stack.push({
      label: "Move to Trash",
      undo: async () => {
        await Promise.resolve();
        done = true;
      },
    });
    await stack.undo();
    expect(done).toBe(true);
  });
});
