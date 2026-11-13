import type { NoticeOptions } from "@/lib/announce";

/**
 * `announce()` for eager code (the editor chunk): the announcer and its
 * pill store load only when there is something to say, such as a
 * failure. A chunk that cannot load either stays silent.
 */
export function announceLater(message: string, options?: NoticeOptions): void {
  import("@/lib/announce").then(
    ({ announce }) => announce(message, options),
    () => undefined,
  );
}
