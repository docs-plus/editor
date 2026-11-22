/**
 * The library harness: the shared `components/library` UI on a
 * `MemoryDocumentIndex`, served without Next.js so nothing here reaches the
 * web build (no route, no chunk, no CSS). The `library` Playwright project
 * starts it; by hand: `bun tests/harness/library/serve.ts`, then open
 * http://127.0.0.1:3871/.
 *
 * The page bundle comes from `Bun.build`; the stylesheet is `app/globals.css`
 * compiled by the same `@tailwindcss/postcss` plugin Next uses, so shadcn
 * components look as they do in the app.
 *
 * `LIBRARY_HARNESS_PROD=1` builds minified production React, for the list
 * speed targets (development React overstates first paint several times).
 */
import path from "node:path";

import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

const ROOT = path.resolve(import.meta.dir, "../../..");
const HERE = import.meta.dir;
const PORT = Number(process.env.LIBRARY_HARNESS_PORT ?? 3871);
const PROD = process.env.LIBRARY_HARNESS_PROD === "1";

async function buildScript(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [path.join(HERE, "main.tsx")],
    target: "browser",
    minify: PROD,
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        PROD ? "production" : "development",
      ),
      "process.env.NEXT_PUBLIC_APP_TARGET": JSON.stringify("desktop"),
    },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "library harness: build failed");
  }
  const js = result.outputs.find((output) => output.kind === "entry-point");
  const css = result.outputs.filter((output) => output.path.endsWith(".css"));
  if (!js) throw new Error("library harness: no entry bundle");
  cssFromScript = (await Promise.all(css.map((file) => file.text()))).join(
    "\n",
  );
  return js.text();
}

let cssFromScript = "";

async function buildStyles(): Promise<string> {
  const from = path.join(ROOT, "app/globals.css");
  const source = await Bun.file(from).text();
  const result = await postcss([tailwind({ base: ROOT })]).process(source, {
    from,
  });
  return result.css;
}

const [script, globals] = await Promise.all([buildScript(), buildStyles()]);
const html = (await Bun.file(path.join(HERE, "index.html")).text()).replace(
  "<!-- styles -->",
  '<link rel="stylesheet" href="/globals.css" /><link rel="stylesheet" href="/library.css" />',
);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/main.js") {
      return new Response(script, {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }
    if (pathname === "/globals.css") {
      return new Response(globals, {
        headers: { "content-type": "text/css; charset=utf-8" },
      });
    }
    if (pathname === "/library.css") {
      return new Response(cssFromScript, {
        headers: { "content-type": "text/css; charset=utf-8" },
      });
    }
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(
  `library harness (${PROD ? "production" : "development"}) on http://${server.hostname}:${server.port}/`,
);
