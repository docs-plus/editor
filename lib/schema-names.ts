/** y-prosemirror stores overlapping marks under `<name>--<8-char hash>`. */
export const HASHED_MARK_SUFFIX = /--[a-zA-Z0-9+/=]{8}$/;

/** Mark name of a stored Yjs text attribute key, without the hash suffix. */
export function markNameFromKey(key: string): string {
  return key.replace(HASHED_MARK_SUFFIX, "");
}

/** Marks stored by earlier releases; the renamer still migrates them on load. */
export const LEGACY_MARK_NAMES = ["link", "code"] as const;

/** Marks reserved for the smart toolbar, allowed before their extensions ship. */
export const PENDING_MARK_NAMES = ["textColor", "fontSize"] as const;

/** Every node the editor schema can write. Keep in sync with `schema-snapshot.json`. */
export const SCHEMA_NODE_NAMES: ReadonlySet<string> = new Set([
  "audio",
  "blockquote",
  "bulletList",
  "codeBlock",
  "doc",
  "hardBreak",
  "heading",
  "horizontalRule",
  "image",
  "imageUpload",
  "listItem",
  "loom",
  "orderedList",
  "paragraph",
  "soundcloud",
  "spotify",
  "table",
  "tableCell",
  "tableHeader",
  "tableRow",
  "taskItem",
  "taskList",
  "text",
  "vimeo",
  "video",
  "x",
  "youtube",
]);

/** Every mark the editor schema can write, plus legacy and pending marks. */
export const SCHEMA_MARK_NAMES: ReadonlySet<string> = new Set([
  "bold",
  "highlight",
  "hyperlink",
  "inlineCode",
  "italic",
  "strike",
  "subscript",
  "superscript",
  "underline",
  ...LEGACY_MARK_NAMES,
  ...PENDING_MARK_NAMES,
]);

export function isAllowedNodeName(name: string): boolean {
  return SCHEMA_NODE_NAMES.has(name);
}

export function isAllowedMarkKey(key: string): boolean {
  return SCHEMA_MARK_NAMES.has(markNameFromKey(key));
}
