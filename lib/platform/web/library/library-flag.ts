/**
 * The web library's build-time switch, `NEXT_PUBLIC_LIBRARY` (web library
 * §2.8). Off unless set to `1`, so the library lands dark: nothing in the
 * web app imports it until W4 adds the route behind this flag.
 *
 * Turning it off later is a kill switch: the route shows
 * {@link LIBRARY_OFF_MESSAGE} with **Export all…**, and it never deletes or
 * wipes the library. There is no server switch, because the server never
 * sees the library.
 */
export const LIBRARY_ENABLED = process.env.NEXT_PUBLIC_LIBRARY?.trim() === "1";

/** The library route's copy while the switch is off (§9 "Library turned off"). */
export const LIBRARY_OFF_MESSAGE =
  "My documents is turned off on this site for now. Your documents are still stored in this browser.";
