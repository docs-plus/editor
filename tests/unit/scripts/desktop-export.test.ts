/**
 * The desktop export's move-aside and output check (scripts/desktop-export.ts).
 * The export itself is `bun run build:desktop`; these cover the parts that
 * would fail silently: a lost file, a web route leaking into desktop.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  checkDesktopExport,
  listParked,
  PARKING_DIR,
  parkWebOnlyFiles,
  restoreParked,
  WEB_ONLY_FILES,
} from "@/scripts/desktop-export";

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

describe("parking web-only files", () => {
  it("lists only files that exist in the repo", () => {
    for (const rel of WEB_ONLY_FILES) {
      expect(existsSync(join(REPO, rel))).toBe(true);
    }
  });

  it("parks every file inside the checkout and puts each back unchanged", () => {
    for (const rel of WEB_ONLY_FILES) write(rel);

    expect(parkWebOnlyFiles(root)).toEqual([...WEB_ONLY_FILES]);
    for (const rel of WEB_ONLY_FILES) {
      expect(existsSync(join(root, rel))).toBe(false);
    }
    expect(listParked(root).sort()).toEqual([...WEB_ONLY_FILES].sort());

    expect(restoreParked(root).sort()).toEqual([...WEB_ONLY_FILES].sort());
    for (const rel of WEB_ONLY_FILES) {
      expect(readFileSync(join(root, rel), "utf8")).toBe(rel);
    }
    expect(existsSync(join(root, PARKING_DIR))).toBe(false);
  });

  it("puts back what an interrupted run left before parking again", () => {
    write("app/robots.ts");
    parkWebOnlyFiles(root);
    // The run was killed here. The next one restores first.
    expect(restoreParked(root)).toEqual(["app/robots.ts"]);
    expect(parkWebOnlyFiles(root)).toEqual(["app/robots.ts"]);
  });

  it("refuses when a file is both in app/ and parked", () => {
    write("app/robots.ts", "parked copy");
    parkWebOnlyFiles(root);
    write("app/robots.ts", "new copy");

    expect(() => restoreParked(root)).toThrow(/both in app\/ and in/);
    expect(readFileSync(join(root, "app/robots.ts"), "utf8")).toBe("new copy");
    expect(listParked(root)).toEqual(["app/robots.ts"]);
  });

  it("finds nothing parked in a clean checkout", () => {
    expect(listParked(root)).toEqual([]);
    expect(restoreParked(root)).toEqual([]);
  });
});

describe("route handlers that leave the desktop export", () => {
  // `route.web.ts(x)` is what keeps them out (next.config.ts pageExtensions).
  // A plain `route.ts` here would join the desktop export, or fail it.
  it("are all route.web.ts(x)", () => {
    const routes: string[] = [];
    for (const dir of ["app/api", "app/llms.txt", "app/pwa-icons"]) {
      for (const name of readdirSync(join(REPO, dir), { recursive: true })) {
        const file = String(name).split(/[\\/]/).at(-1) ?? "";
        if (file.startsWith("route.")) routes.push(`${dir}/${name}`);
      }
    }
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((path) => !/\/route\.web\.tsx?$/.test(path))).toEqual(
      [],
    );
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

  it("reports the Windows segment layout (#103)", () => {
    validExport();
    write("out/about/__next.about/__PAGE__.txt", "");
    expect(checkDesktopExport(join(root, "out"))).toEqual([
      `nested segment directory (Windows layout): ${join("about", "__next.about")}`,
    ]);
  });
});
