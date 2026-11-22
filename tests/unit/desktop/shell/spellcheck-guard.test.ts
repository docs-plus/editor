/**
 * #100 / SEC-002: the spellcheck guard is installed before any session
 * exists and configures every session it sees. Electron is faked; the
 * Linux branch is what keeps the Hunspell fetch off.
 */
import { expect, mock, test } from "bun:test";

type Listener = (...args: unknown[]) => void;
const appListeners = new Map<string, Listener[]>();
const ready = false;

function fakeSession() {
  const calls: string[] = [];
  return {
    calls,
    setSpellCheckerDictionaryDownloadURL: (url: string) =>
      calls.push(`url ${url}`),
    setSpellCheckerLanguages: (langs: string[]) =>
      calls.push(`langs ${langs.length}`),
    setSpellCheckerEnabled: (on: boolean) => calls.push(`enabled ${on}`),
    on: (event: string) => calls.push(`on ${event}`),
  };
}
const defaultSession = fakeSession();

mock.module("electron", () => ({
  app: {
    on: (event: string, listener: Listener) => {
      appListeners.set(event, [...(appListeners.get(event) ?? []), listener]);
    },
    isReady: () => ready,
  },
  session: { defaultSession },
  // Bun keeps the export names of the first `electron` mock in the shared
  // test process, so every mock of it exports the same names
  // (device-refusals.test.ts needs `shell`).
  shell: { openExternal: async () => {} },
}));

test("installs on session-created before ready, and configures each session", async () => {
  const { installSpellcheckGuard } = await import("@/desktop/main/spellcheck");
  installSpellcheckGuard();
  expect(appListeners.get("session-created")).toHaveLength(1);
  expect(defaultSession.calls).toEqual([]); // not ready yet: nothing touched

  const created = fakeSession();
  appListeners.get("session-created")?.[0](created);
  if (process.platform === "linux") {
    expect(created.calls.slice(0, 3)).toEqual([
      "url http://127.0.0.1:9/",
      "langs 0",
      "enabled false",
    ]);
  }
  expect(created.calls).toContain("on spellcheck-dictionary-download-begin");
});
