// Settings, log and exit shared by main.ts and update-probe.ts.
//
// Settings come from the environment, with ~/.tinydocy-s3.json as the
// fallback (an updated build relaunched by an installer may not inherit the
// environment):
//   TINYDOCY_USER_DATA     userData directory (version.txt, probe.log, net-logs)
//   TINYDOCY_MODE          smoke (quit after 3 s) | hold (stay open) |
//                          update (check, download, quitAndInstall) |
//                          check (check only, never download)
//   TINYDOCY_CHANNEL_PREF  stable | beta | unset (default computed, never stored)
//   TINYDOCY_SIGNED_FEED   1 = use signed-provider.ts instead of app-update.yml
//   TINYDOCY_DOWNGRADE_CONTROL  1 = negative control: skip allowDowngrade=false
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { app } from "electron";

export type ChannelPref = "stable" | "beta";

export interface ProbeSettings {
  userData: string;
  mode: "smoke" | "hold" | "update" | "check";
  channelPref?: ChannelPref;
  signedFeed: boolean;
  downgradeControl: boolean;
}

const FALLBACK_FILE = path.join(homedir(), ".tinydocy-s3.json");

const readSettings = (): ProbeSettings => {
  const env = process.env;
  const fallback: Partial<Record<string, string>> = existsSync(FALLBACK_FILE)
    ? JSON.parse(readFileSync(FALLBACK_FILE, "utf8"))
    : {};
  const pick = (key: string) => env[key] ?? fallback[key];
  const pref = pick("TINYDOCY_CHANNEL_PREF");
  return {
    userData:
      pick("TINYDOCY_USER_DATA") ?? path.join(homedir(), ".tinydocy-s3-data"),
    mode: (pick("TINYDOCY_MODE") as ProbeSettings["mode"]) ?? "smoke",
    channelPref: pref === "stable" || pref === "beta" ? pref : undefined,
    signedFeed: pick("TINYDOCY_SIGNED_FEED") === "1",
    downgradeControl: pick("TINYDOCY_DOWNGRADE_CONTROL") === "1",
  };
};

export const settings = readSettings();
mkdirSync(settings.userData, { recursive: true });

const logFile = path.join(settings.userData, "probe.log");
export const log = (line: string) => {
  const stamped = `${new Date().toISOString()} v${app.getVersion()} pid=${process.pid} ${line}`;
  console.log(stamped);
  appendFileSync(logFile, `${stamped}\n`);
};

let exiting = false;
export const exit = (reason: string, delayMs = 500) => {
  if (exiting) return;
  exiting = true;
  log(`probe-exit reason=${reason}`);
  setTimeout(() => app.quit(), delayMs);
};
