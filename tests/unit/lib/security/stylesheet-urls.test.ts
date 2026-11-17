import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../../..");
const STYLESHEETS = [
  ...new Bun.Glob(
    "{app,components,extensions,styles}/**/*.{css,scss}",
  ).scanSync({ cwd: ROOT }),
].sort();

const URL_CALL = /url\(\s*(["']?)([^"')]*)\1\s*\)/g;

/** Every `url(...)` target in the app's stylesheets, with its file. */
function stylesheetUrls(): { file: string; target: string }[] {
  return STYLESHEETS.flatMap((file) =>
    [...readFileSync(path.join(ROOT, file), "utf8").matchAll(URL_CALL)].map(
      (match) => ({ file, target: match[2] }),
    ),
  );
}

// The desktop app's CSP allows images from 'self' only, so a `data:` icon in
// CSS is blocked there (#102). Icons are files next to their stylesheet; the
// bundler emits them under /_next/static/media.
describe("stylesheet urls", () => {
  it("scans the app's stylesheets", () => {
    expect(STYLESHEETS).toContain("components/smart-toolbar/phone/phone.scss");
    expect(STYLESHEETS).toContain(
      "components/tiptap-node/list-node/list-node.scss",
    );
    expect(STYLESHEETS).toContain("extensions/heading-drag/heading-drag.scss");
  });

  it("uses no data: URLs", () => {
    const inline = stylesheetUrls().filter(({ target }) =>
      /^data:/i.test(target),
    );
    expect(inline).toEqual([]);
    const svg = STYLESHEETS.filter((file) =>
      readFileSync(path.join(ROOT, file), "utf8").includes("data:image/svg"),
    );
    expect(svg).toEqual([]);
  });

  it("points every relative url() at a file that exists", () => {
    const relative = stylesheetUrls().filter(({ target }) =>
      target.startsWith("."),
    );
    expect(relative.length).toBeGreaterThan(0);
    const missing = relative.filter(
      ({ file, target }) =>
        !existsSync(path.join(ROOT, path.dirname(file), target)),
    );
    expect(missing).toEqual([]);
  });
});
