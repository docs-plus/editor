/** y-prosemirror stores overlapping marks under `<name>--<8-char hash>`. */
export const HASHED_MARK_SUFFIX = /--[a-zA-Z0-9+/=]{8}$/;

/** Mark name of a stored Yjs text attribute key, without the hash suffix. */
export function markNameFromKey(key: string): string {
  return key.replace(HASHED_MARK_SUFFIX, "");
}

/** Marks stored by earlier releases; the renamer still migrates them on load. */
export const LEGACY_MARK_NAMES = ["link", "code"] as const;

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

/**
 * Every mark the editor schema can write, plus legacy marks. New marks are
 * added with the server half of the release that ships them, deployed
 * before its clients: allowing a name earlier lets anyone freeze documents
 * for every client that does not know it.
 */
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
]);

export function isAllowedNodeName(name: string): boolean {
  return SCHEMA_NODE_NAMES.has(name);
}

export function isAllowedMarkKey(key: string): boolean {
  return SCHEMA_MARK_NAMES.has(markNameFromKey(key));
}
