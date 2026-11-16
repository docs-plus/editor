// Hello-world main process for the S3 packaging spike. Settings: see
// probe-context.ts.
import { writeFileSync } from "node:fs";
import path from "node:path";

import { app, BrowserWindow } from "electron";

import { exit, log, settings } from "./probe-context";
import { runUpdateProbe } from "./update-probe";

app.setPath("userData", settings.userData);

// Net-log of every request the browser process makes (electron-updater uses
// Electron's net module): the "no github.com" evidence.
app.commandLine.appendSwitch(
  "log-net-log",
  path.join(
    settings.userData,
    `netlog-${app.getVersion()}-${process.pid}.json`,
  ),
);

app.whenReady().then(async () => {
  writeFileSync(path.join(settings.userData, "version.txt"), app.getVersion());
  log(
    `start mode=${settings.mode} pref=${settings.channelPref ?? "unset"} signed=${settings.signedFeed} ` +
      `electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node} ` +
      `platform=${process.platform} arch=${process.arch} exec=${process.execPath} ` +
      `appimage=${process.env.APPIMAGE ?? "-"} argv=${JSON.stringify(process.argv.slice(1))}`,
  );

  const win = new BrowserWindow({
    width: 480,
    height: 320,
    title: "TinyDocy",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(__dirname, "..", "static", "index.html"));
  log(`window shown renderer-pid=${win.webContents.getOSProcessId()}`);

  const timeoutMs = Number(process.env.TINYDOCY_TIMEOUT_MS ?? 180_000);
  setTimeout(() => exit("timeout"), timeoutMs).unref();

  switch (settings.mode) {
    case "smoke":
      setTimeout(() => exit("smoke-done"), 3000);
      break;
    case "hold":
      break;
    case "update":
    case "check":
      await runUpdateProbe(settings);
      break;
  }
});

app.on("window-all-closed", () => app.quit());
