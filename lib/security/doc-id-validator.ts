const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const MAX_ID_LENGTH = 64;

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasPathTraversal(value: string): boolean {
  return value.includes("../") || value.includes("..\\");
}

export function isValidUserDocumentId(id: string): boolean {
  if (!id || id.length > MAX_ID_LENGTH) return false;
  if (hasControlChars(id)) return false;
  if (hasPathTraversal(id)) return false;
  return UUID_REGEX.test(id) || SAFE_ID_REGEX.test(id);
}

export function isSystemDocumentId(name: string): boolean {
  return (
    name === "playground" ||
    name === "global-tabs" ||
    name.startsWith("global-tabs-")
  );
}

export function isValidWsDocumentName(name: string): boolean {
  return isValidUserDocumentId(name) || isSystemDocumentId(name);
}
