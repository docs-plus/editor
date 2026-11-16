// Spike S5: serves the static export `out/` on 127.0.0.1 for the arms that
// load the app over http (the Chrome arms, and Electron when it isn't using
// the S1 shell's own origin).
import { join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../out");
const port = Number(process.env.S5_APP_PORT ?? 3900);

const candidates = (pathname: string) => {
  const clean = normalize(decodeURIComponent(pathname)).replace(
    /^(\.\.[/\\])+/,
    "",
  );
  const base = join(root, clean);
  return [base, `${base}.html`, join(base, "index.html")];
};

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    for (const path of candidates(pathname)) {
      if (!path.startsWith(root)) break;
      const file = Bun.file(path);
      if ((await file.exists()) && !(await file.stat()).isDirectory()) {
        return new Response(file);
      }
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`serving ${root} on http://127.0.0.1:${port}`);
