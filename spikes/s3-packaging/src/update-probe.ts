// Runs checkForUpdates and quitAndInstall(true, true) against the generic
// feed, logging the channel and allowDowngrade state at every step.
//
// Channel mapping (prefs.updates.channel -> electron-updater):
//   unset   the default is computed from app.getVersion(): a prerelease
//           version is Beta, anything else Stable. It is never stored, and
//           the channel setter is not called: the build's app-update.yml
//           already carries it (electron-builder's detectUpdateChannel writes
//           `channel: beta` for -beta.N versions).
//   Stable  channel = "latest", allowPrerelease = false
//   Beta    channel = "beta",   allowPrerelease = true
// The channel setter turns allowDowngrade on, so allowDowngrade = false is
// the last assignment before every checkForUpdates.
import type { AppUpdater } from "electron-updater";
import { autoUpdater } from "electron-updater";
import { prerelease } from "semver";

import {
  type ChannelPref,
  exit,
  log,
  type ProbeSettings,
} from "./probe-context";
import { SignedGenericProvider } from "./signed-provider";

declare const __FEED_URL__: string;
declare const __MANIFEST_PUBLIC_KEY__: string;

export const defaultChannelPref = (version: string): ChannelPref =>
  prerelease(version) ? "beta" : "stable";

const state = (u: AppUpdater) =>
  `allowDowngrade=${u.allowDowngrade} channel=${u.channel ?? "null"} allowPrerelease=${u.allowPrerelease}`;

export const applyChannelPref = (
  u: AppUpdater,
  pref: ChannelPref | undefined,
) => {
  if (pref === undefined) {
    log(
      `channel pref unset: default computed=${defaultChannelPref(u.currentVersion.version)} (not stored, setter not called) ${state(u)}`,
    );
    return;
  }
  u.channel = pref === "beta" ? "beta" : "latest";
  log(`after channel setter (pref=${pref}) ${state(u)}`);
  u.allowPrerelease = pref === "beta";
};

export const runUpdateProbe = async (settings: ProbeSettings) => {
  const u = autoUpdater;
  log(`after construction ${state(u)}`);
  u.logger = {
    info: (m: unknown) => log(`[updater] ${String(m)}`),
    warn: (m: unknown) => log(`[updater:warn] ${String(m)}`),
    error: (m: unknown) => log(`[updater:error] ${String(m)}`),
    debug: (m: unknown) => log(`[updater:debug] ${String(m)}`),
  };
  // Full downloads only, so Range/blockmap behaviour cannot flake the rows.
  u.disableDifferentialDownload = true;
  u.autoDownload = settings.mode === "update";
  u.autoInstallOnAppQuit = false;

  if (settings.signedFeed) {
    if (!__MANIFEST_PUBLIC_KEY__) {
      log("signed feed requested but no public key was built in");
      exit("no-public-key");
      return;
    }
    u.setFeedURL({
      provider: "custom",
      updateProvider: SignedGenericProvider,
      url: __FEED_URL__,
      publicKeyPem: __MANIFEST_PUBLIC_KEY__,
    } as never);
    log(`signed provider set ${state(u)}`);
  }

  applyChannelPref(u, settings.channelPref);

  u.on("checking-for-update", () => log("event checking-for-update"));
  u.on("update-available", (info) =>
    log(`event update-available version=${info.version}`),
  );
  u.on("update-not-available", (info) => {
    log(`event update-not-available latest=${info.version}`);
    exit("update-not-available");
  });
  u.on("error", (err) => {
    log(`event error ${err?.message?.split("\n")[0]}`);
    exit("error");
  });
  u.on("update-downloaded", (info) => {
    log(
      `event update-downloaded version=${info.version} file=${info.downloadedFile}`,
    );
    log("calling quitAndInstall(true, true)");
    setImmediate(() => u.quitAndInstall(true, true));
  });

  if (!settings.downgradeControl) u.allowDowngrade = false;
  log(
    `before checkForUpdates ${state(u)}${settings.downgradeControl ? " (negative control: reset skipped)" : ""}`,
  );
  const result = await u.checkForUpdates().catch((err: Error) => {
    log(`checkForUpdates rejected ${err.message.split("\n")[0]}`);
    exit("check-rejected");
    return null;
  });
  if (result == null) return;
  log(
    `check result version=${result.updateInfo.version} isUpdateAvailable=${result.isUpdateAvailable}`,
  );
  if (settings.mode === "check")
    exit(`check-done available=${result.isUpdateAvailable}`, 1000);
};
