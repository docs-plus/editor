/**
 * Reading mode (preferences design §2.1 row 13): per window or tab, never
 * stored, so it resets when the tab closes. `PageFrame` reads it and makes
 * the document read-only through the editor's `readOnly` prop (WriteGate
 * and `setEditable`), so reading never writes to the document.
 */

let reading = false;
const listeners = new Set<() => void>();

export const isReadingMode = (): boolean => reading;

export function setReadingMode(on: boolean): void {
  if (on === reading) return;
  reading = on;
  for (const listener of [...listeners]) listener();
}

export function subscribeReadingMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
