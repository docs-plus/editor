/**
 * Main's open-document registry (desktop architecture §6.2, D-A3): a
 * document is open in at most one window. It replaces leases. Content
 * writes from a window that doesn't hold the document are refused, and
 * main and the worker write content (import-into, restore, purge) only to
 * documents nobody holds.
 *
 * Pure: windows are numbers (`BrowserWindow.id`).
 */
export type ClaimResult = { ok: true } | { ok: false; holder: number };

export class OpenDocRegistry {
  private readonly byDoc = new Map<string, number>();

  /** Idempotent for the holder; another window gets the holder back. */
  claim(docId: string, windowId: number): ClaimResult {
    const holder = this.byDoc.get(docId);
    if (holder !== undefined && holder !== windowId)
      return { ok: false, holder };
    this.byDoc.set(docId, windowId);
    return { ok: true };
  }

  holder(docId: string): number | undefined {
    return this.byDoc.get(docId);
  }

  holds(docId: string, windowId: number): boolean {
    return this.byDoc.get(docId) === windowId;
  }

  /** Releases one claim; false if this window didn't hold it. */
  release(docId: string, windowId: number): boolean {
    if (!this.holds(docId, windowId)) return false;
    this.byDoc.delete(docId);
    return true;
  }

  /** A window closed or its renderer died: drop every claim it held. */
  releaseWindow(windowId: number): string[] {
    const released: string[] = [];
    for (const [docId, holder] of this.byDoc) {
      if (holder === windowId) {
        this.byDoc.delete(docId);
        released.push(docId);
      }
    }
    return released;
  }

  /** Every claim, for replaying into a restarted worker. */
  entries(): Array<{ docId: string; windowId: number }> {
    return [...this.byDoc].map(([docId, windowId]) => ({ docId, windowId }));
  }
}
