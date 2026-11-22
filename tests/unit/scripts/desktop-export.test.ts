/**
 * The desktop export's route allowlist and output check
 * (scripts/desktop-export.ts). The export itself is `bun run build:desktop`;
 * these cover what would fail silently: a web route or the dev bridge
 * leaking into desktop.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { DEV_BRIDGE_MARKER } from "@/lib/platform/desktop/dev-bridge-wire";
import { checkDesktopExport } from "@/scripts/desktop-export";

const REPO = join(import.meta.dir, "../../..");

let root: string;

function write(rel: string, content = rel): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "desktop-export-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("desktop routes", () => {
  // next.config.ts gives the desktop target only `*.desktop.tsx`, so these
  // files are its whole route list; a new one is a deliberate choice.
  it("are an allowlist of *.desktop.tsx files", () => {
    const files = readdirSync(join(REPO, "app"), { recursive: true })
      .map(String)
      .filter((file) => /\.desktop\.tsx?$/.test(file))
      .map((file) => file.replaceAll("\\", "/"))
      .sort();
    expect(files).toEqual([
      "about/page.desktop.tsx",
      "error.desktop.tsx",
      "layout.desktop.tsx",
      "page.desktop.tsx",
    ]);
  });
});

describe("checkDesktopExport", () => {
  const PAGE = '<html><head><link rel="icon" href="/icon"/></head></html>';

  function validExport(): void {
    write("out/index.html", PAGE);
    write("out/about.html", PAGE);
    write("out/about/__next.about.__PAGE__.txt", "");
    write("out/_next/static/chunks/a.js", "");
  }

  it("accepts a desktop renderer", () => {
    validExport();
    expect(checkDesktopExport(join(root, "out"))).toEqual([]);
  });

  it("requires the exact boot script in every page (the CSP hashes it)", () => {
    const boot = "(function(){})();";
    validExport();
    write("out/index.html", `${PAGE}<script>${boot}</script>`);
    expect(checkDesktopExport(join(root, "out"), { bootScript: boot })).toEqual(
      ["about.html lacks the boot script"],
    );
  });

  it("reports web-only routes", () => {
    validExport();
    write("out/privacy.html", PAGE);
    write("out/sitemap.xml", "");
    write("out/api/documents/x", "");
    expect(checkDesktopExport(join(root, "out")).sort()).toEqual([
      "web-only output: api",
      "web-only output: privacy.html",
      "web-only output: sitemap.xml",
    ]);
  });

  it("reports web metadata tags and in-app /privacy links", () => {
    validExport();
    write(
      "out/index.html",
      '<head><link rel="manifest" href="/manifest.webmanifest"/><meta property="og:image" content="x"/></head><a href="/privacy">Privacy</a>',
    );
    expect(checkDesktopExport(join(root, "out"))).toEqual([
      'index.html has <link rel="manifest"',
      'index.html has <meta property="og:image"',
      'index.html has href="\\/privacy"',
    ]);
  });

  it("reports the dev bridge in any page or chunk (architecture §11)", () => {
    validExport();
    write(
      "out/_next/static/chunks/b.js",
      `throw new Error("${DEV_BRIDGE_MARKER}: closed")`,
    );
    expect(checkDesktopExport(join(root, "out"))).toEqual([
      `${join("_next", "static", "chunks", "b.js")} has the dev bridge`,
    ]);
  });

  it("reports the Windows segment layout (#103)", () => {
    validExport();
    write("out/about/__next.about/__PAGE__.txt", "");
    expect(checkDesktopExport(join(root, "out"))).toEqual([
      `nested segment directory (Windows layout): ${join("about", "__next.about")}`,
    ]);
  });
});
