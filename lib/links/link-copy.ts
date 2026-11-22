/**
 * Every string document links show or announce (search-linking §4.6 and §8,
 * as amended by the linking review): one place, so the copy, the consent
 * window and the tests agree, and a later `t()` pass has one file to wrap.
 *
 * The owner decisions Q4–Q10 are pending; this follows the
 * recommendations, kept to the flags below so they are easy to flip:
 * - Q1 (B): "deleted" and "not in your library" show as one state.
 */
import type { LinkStateName } from "@/lib/links/resolve";

export const MERGE_DELETED_INTO_NOT_AVAILABLE = true;

/** A link state as people see it (after the merge above). */
export type LinkPresentation =
  | "resolves"
  | "here"
  | "in_trash"
  | "deleted"
  | "not_available"
  | "unknown_form";

/**
 * The one map from what the resolver knows to what people see: icon,
 * `data-link-state`, label and message all key on this. `merge` defaults to
 * the Q1 flag and is a parameter only so tests can cover both answers.
 */
export function presentationOf(
  state: LinkStateName,
  merge = MERGE_DELETED_INTO_NOT_AVAILABLE,
): LinkPresentation {
  switch (state) {
    case "deleted":
      return merge ? "not_available" : "deleted";
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
  deleted: "Deleted",
  not_available: "Not in your library",
  unknown_form: "Needs a newer version",
};

export const LINK_COPY = {
  notAvailable:
    "This links to a document that isn't in your library. It may have been deleted.",
  deleted: "This document was deleted.",
  unknownForm: "This link needs a newer version of TinyDocy.",
  headingRemoved: "The section this link pointed to was removed.",
  /** After a follow (§8): one announcement per follow. */
  opened: (title: string, heading?: string | null): string =>
    heading ? `Opened ${title}, at ${heading}.` : `Opened ${title}.`,
  /** After a `here#` jump. */
  atHeading: (heading: string): string => `At ${heading}.`,
  /** The P4.4 consent window (§4.4 "Shared (Live)", §8). */
  consent: (count: number): string =>
    `This document links to ${count} of your documents. People you share with will see the link text but can't open them.`,
} as const;
