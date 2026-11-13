/**
 * Whether the primary pointer is coarse (touch). Read once when a popover
 * body mounts: those bodies render on the client only, so there is no
 * hydration mismatch, and a device does not switch pointers mid-popover.
 */
export function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}
