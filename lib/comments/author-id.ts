/**
 * This browser's comment author id (comments design §6.1, as built in
 * P4.9): 128 random bits as 22 base64url characters, minted on the first
 * comment write and kept under its own key, `tinydocy-author`. It says
 * "same browser", not who someone is: anyone holding an edit link can
 * copy it ("Names aren't verified.").
 *
 * Its own key, not `id` inside `tinydocy-user`: keeping a field there
 * would put code in `lib/user-identity.ts`, which is in the editor chunk,
 * while this module is in the lazy comments chunk and costs it nothing.
 * The id never joins the identity awareness broadcasts. "Forget my
 * choices" leaves it, as it leaves the name and colour.
 */
import { ID_PATTERN, newId } from "@/lib/comments/model";

export const AUTHOR_ID_KEY = "tinydocy-author";

/** Kept for the session when storage is blocked or full. */
let memory: string | null = null;

function readStored(): string | null {
  try {
    const stored = window.localStorage.getItem(AUTHOR_ID_KEY);
    return stored && ID_PATTERN.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** The stored id, minting and storing one on first use. Never throws. */
export function getAuthorId(): string {
  const stored = typeof window === "undefined" ? null : readStored();
  if (stored) {
    memory = stored;
    return stored;
  }
  memory ??= newId();
  try {
    window.localStorage.setItem(AUTHOR_ID_KEY, memory);
  } catch {
    // Blocked or full: the id lasts for this session.
  }
  return memory;
}
