/**
 * The `argv` and `open-file` filter (plan P2.5; hardening checklist P2.5).
 * Accepts only:
 * - `tinydocy://` (bring the app forward),
 * - `tinydocy://local/<uuid>` (open that document),
 * - an existing file ending in `.md`, `.html` or `.tinydoc` (import, P2.8).
 *
 * Everything else is refused and counted, never echoed: a refusal is logged
 * as a code only (architecture §9). Chromium and Playwright switches
 * (`--inspect=0`, `--allow-file-access-from-files`) are skipped silently.
 *
 * Pure: the caller passes `isFile` and the working directory, so the same
 * rules serve the first launch, `second-instance` and macOS `open-file`.
 */
import { isAbsolute, resolve } from "node:path";

import {
  DEEP_LINK_SCHEME,
  OPENABLE_EXTENSIONS,
  type OpenableKind,
} from "../shared/app-identity";

export type LaunchIntent =
  | { kind: "focus" }
  | { kind: "openDoc"; docId: string }
  | { kind: "openFile"; path: string; type: OpenableKind };

export type LaunchArgs = { intents: LaunchIntent[]; refused: number };

export type LaunchArgOptions = {
  /** Resolves relative paths (`second-instance` passes the caller's). */
  cwd: string;
  isFile: (absolutePath: string) => boolean;
};

/** Longer arguments are refused unread. */
export const MAX_ARG_LENGTH = 4096;
/** A launch never opens more than this many things. */
export const MAX_INTENTS = 20;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BARE_LINK = new RegExp(`^${DEEP_LINK_SCHEME}:(//)?/?$`, "i");
const DOC_LINK = new RegExp(`^${DEEP_LINK_SCHEME}://local/(${UUID})/?$`, "i");

function kindOf(path: string): OpenableKind | null {
  const lower = path.toLowerCase();
  for (const [extension, kind] of Object.entries(OPENABLE_EXTENSIONS)) {
    if (lower.endsWith(extension) && lower.length > extension.length)
      return kind;
  }
  return null;
}

/** One argument: an intent, `null` for a refusal, or `"skip"` for a switch. */
export function classifyArg(
  arg: string,
  options: LaunchArgOptions,
): LaunchIntent | null | "skip" {
  if (typeof arg !== "string" || arg.length === 0) return null;
  if (arg.length > MAX_ARG_LENGTH || arg.includes("\0")) return null;
  if (arg.startsWith("-")) return "skip";

  if (arg.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`)) {
    if (BARE_LINK.test(arg)) return { kind: "focus" };
    const match = DOC_LINK.exec(arg);
    return match ? { kind: "openDoc", docId: match[1].toLowerCase() } : null;
  }
  // Any other scheme (`file:`, `https:`, `javascript:`) is refused; a
  // Windows drive path (`C:\…`) is a path, not a scheme.
  if (/^[a-z][a-z0-9+.-]+:/i.test(arg) && !/^[a-z]:[\\/]/i.test(arg))
    return null;

  const type = kindOf(arg);
  if (!type) return null;
  const path = isAbsolute(arg) ? resolve(arg) : resolve(options.cwd, arg);
  if (!isAbsolute(path)) return null;
  let exists = false;
  try {
    exists = options.isFile(path);
  } catch {
    exists = false;
  }
  return exists ? { kind: "openFile", path, type } : null;
}

/**
 * Filters launch arguments. `argv` must already have the executable (and,
 * unpackaged, the app path) removed: see {@link userArgs}.
 */
export function parseLaunchArgs(
  args: readonly string[],
  options: LaunchArgOptions,
): LaunchArgs {
  const intents: LaunchIntent[] = [];
  let refused = 0;
  for (const arg of args) {
    const result = classifyArg(arg, options);
    if (result === "skip") continue;
    if (result === null || intents.length >= MAX_INTENTS) {
      refused++;
      continue;
    }
    intents.push(result);
  }
  return { intents, refused };
}

/**
 * The user's arguments in a full `argv`: without the executable and, when
 * Electron runs an unpackaged app folder (`electron dist/desktop-app`), the
 * first non-switch argument, which is that folder.
 */
export function userArgs(
  argv: readonly string[],
  unpackaged: boolean,
): string[] {
  const rest = argv.slice(1);
  if (!unpackaged) return rest;
  const appIndex = rest.findIndex((arg) => !arg.startsWith("-"));
  return appIndex === -1
    ? rest
    : [...rest.slice(0, appIndex), ...rest.slice(appIndex + 1)];
}
