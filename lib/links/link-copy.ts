/**
 * Every string document links show or announce (search-linking §4.6 and §8,
 * as amended by the linking review): one place, so the copy, the consent
 * window and the tests agree, and a later `t()` pass has one file to wrap.
 *
 * These follow the owner's final decisions Q4–Q7 (2026-11-22):
 * - Q4: deleted and not in your library are ONE "Not available" state
 *   (FileQuestion); its copy leads with "This document isn't on this
 *   device." and [Remove Link] is never the preview's default focus.
 * - Q5: In Trash keeps the file shape (FileMinus).
 * - Q6: a `here#` link draws Hash.
 * - Q7: the document preview never shows the href or the key.
 */
import type { LinkStateName } from "@/lib/links/resolve";

/** A link state as people see it. */
export type LinkPresentation =
  | "resolves"
  | "here"
  | "in_trash"
  | "not_available"
  | "invalid"
  | "unknown_form";

/**
 * The one map from what the resolver knows to what people see: icon,
 * `data-link-state`, label and message all key on this. The resolver still
 * tells a purged key (`deleted`) from an unknown one; people see one state.
 */
export function presentationOf(state: LinkStateName): LinkPresentation {
  switch (state) {
    case "deleted":
    case "not_in_library":
      return "not_available";
    default:
      return state;
  }
}

/** Prefixes the link's accessible name for states that don't open. */
export const LINK_STATE_LABEL: Readonly<
  Partial<Record<LinkPresentation, string>>
> = {
  in_trash: "In Trash",
  not_available: "Not available",
  invalid: "Not a valid link",
  unknown_form: "Needs a newer version",
};

export const LINK_COPY = {
  notAvailable: "This document isn't on this device. It may have been deleted.",
  invalid: "This link isn't valid.",
  unknownForm: "This link needs a newer version of TinyDocy.",
  headingRemoved: "The section this link pointed to was removed.",
  /** After a follow (§8): one announcement per follow. */
  opened: (title: string, heading?: string | null): string =>
    heading ? `Opened ${title}, at ${heading}.` : `Opened ${title}.`,
  /** After a `here#` jump. */
  atHeading: (heading: string): string => `At ${heading}.`,
  /**
   * The P4.4 consent window (§4.4 "Shared (Live)", §8, D-O8): links to
   * documents that aren't shared become plain text unless [Keep Links].
   */
  consent: (count: number): string =>
    `${count} ${count === 1 ? "link" : "links"} to your other documents will become plain text.`,
  keepLinks: "Keep Links",
} as const;
