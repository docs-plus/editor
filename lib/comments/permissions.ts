/**
 * Who may write comments (comments design §6). `canComment()` is its own
 * gate, not `WriteGate`: comment writes bypass ProseMirror, and reading
 * mode blocks text edits but allows comments. Every write to the
 * `comments` map runs it BEFORE `transact` (details rule 1: an update
 * that exists must never be dropped).
 */

/**
 * Build-time switch for the whole feature, off unless
 * `NEXT_PUBLIC_COMMENTS=on`. Stands in for `/api/info.features.comments`
 * until the server reports it (P4.2f-2's `HOCUS_COMMENTS`), so comments
 * land dark: no document can comment while it is off.
 */
export const COMMENTS_FEATURE: "on" | "off" =
  process.env.NEXT_PUBLIC_COMMENTS === "on" ? "on" : "off";

/** The document kinds of §6.3. */
export type CommentDocumentKind =
  | "local"
  | "library"
  | "share"
  | "sandbox"
  | "playground"
  | "tabs";

/** Kinds where comments are on: local desktop, web library and live shares. */
export function commentsAllowedIn(kind: CommentDocumentKind): boolean {
  return kind === "local" || kind === "library" || kind === "share";
}

export type CommentRole = "edit" | "view" | "owner";

export interface CommentGateInput {
  role: CommentRole;
  kind: CommentDocumentKind;
  /**
   * Why the document is read-only, if it is. `"reading"` (reading mode)
   * still allows comments; any other reason (size limit, deleted, newer
   * schema) does not.
   */
  readOnlyReason: string | null;
  /** The feature switch; defaults to `COMMENTS_FEATURE`. */
  feature?: "on" | "off";
}

/** `canComment()` of §6.2 for one moment's state. */
export function canComment({
  role,
  kind,
  readOnlyReason,
  feature = COMMENTS_FEATURE,
}: CommentGateInput): boolean {
  return (
    feature === "on" &&
    role !== "view" &&
    (readOnlyReason === null || readOnlyReason === "reading") &&
    commentsAllowedIn(kind)
  );
}
