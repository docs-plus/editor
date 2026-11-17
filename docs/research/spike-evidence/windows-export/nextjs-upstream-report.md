# Upstream report draft: Next.js static export on Windows writes segment files under the wrong path

**Status: draft, not filed or posted.** The owner decides whether and where to post it. Nothing here has been sent to vercel/next.js.

## Recommended action: comment on the existing issue, don't open a new one

The bug is already tracked upstream:

- **vercel/next.js#85374** (open since 2025-10-26), "Next.js >=16.0.0: Mismatch in RSC file paths causes 404 errors in static exports on Windows". Its latest comment gives the same root cause we found.
- vercel/next.js#92339 was closed on 2026-08-31 as a duplicate of vercel/next.js#85374.
- Two fix PRs are open and waiting for review: **vercel/next.js#92340** (2026-04-04) and **vercel/next.js#99058** (2026-09-22, "fix(next-export): normalize segment paths on Windows in static export (#85374)").

A new issue would be closed as a duplicate. What would help upstream is a confirmation on the current release and canary, with a hosted, one-click repro. Suggested comment for vercel/next.js#85374 (the owner posts it, or doesn't):

---

> Still reproduces on **16.4.6** (`latest`) and **16.5.0-canary.49**, built on GitHub's `windows-latest` runner (Windows Server 2025). `16.5.0-canary.53` has the same `collectSegmentPaths` and `convertSegmentPathToStaticExportFilename` source.
>
> Minimal app: a root layout, `/` with a `<Link href="/about">` and `/about`, `output: "export"`, nothing else. The same app built on `ubuntu-24.04` and `macos-26` writes flat files. On Windows:
>
> | | Linux / macOS | Windows |
> |---|---|---|
> | `/about` page segment | `out/about/__next.about.__PAGE__.txt` | `out/about/__next.about/__PAGE__.txt` |
> | `/_not-found` page segment | `out/_not-found/__next._not-found.__PAGE__.txt` | `out/_not-found/__next._not-found/__PAGE__.txt` |
> | `GET /about/__next.about.__PAGE__.txt` from a plain static server | 200 | 404 |
>
> Root cause, as described above: `collectSegmentPathsImpl` in `packages/next/src/export/index.ts` pushes `path.relative(segmentsDirectory, …)`, which is `about\__PAGE__.segment.rsc` on Windows. `convertSegmentPathToStaticExportFilename` only replaces `/`, so the backslash survives and `path.join` turns it into a directory. #99058 fixes both ends. Could a maintainer review it?
>
> Workaround for anyone shipping a static export: build `out/` on Linux or macOS.

---

## Fallback: a full issue, if the owner prefers a new report

Use this only if vercel/next.js#85374 is closed without a fix. The Next.js bug template asks for a public repro link and `next info` output.

**Title:** Static export on Windows writes segment-prefetch files into `__next.<segment>/` directories, so prefetch requests 404

**Link to the code that reproduces this issue:** **Owner TBD.** It needs a public repository holding only the app below (a fork-free copy of `spikes/windows-export/repro/` from `docs-plus/editor`, branch `spike/windows-export`). Until then, the existing public repro https://github.com/yukiyokotani/nextjs-static-export-segment-404-reproduce shows the same thing (built and deployed from `windows-latest`).

**To reproduce**

1. Create an app with only these files:
   - `next.config.mjs`: `export default { output: "export" };`
   - `app/layout.jsx`: a root layout that renders `<html><body>{children}</body></html>`
   - `app/page.jsx`: `import Link from "next/link"; export default () => <Link href="/about">About</Link>;`
   - `app/about/page.jsx`: `export default () => <h1>About</h1>;`
   - `package.json`: `next@16.4.6`, `react@19.3.1`, `react-dom@19.3.1`
2. On Windows, run `next build`.
3. List the `.txt` files under `out/about/` and `out/_not-found/`.
4. Serve `out/` with any static server, open `/` and hover the link (or wait for the viewport prefetch). Watch the network panel.

**Current behaviour**

`out/about/__next.about/__PAGE__.txt` and `out/_not-found/__next._not-found/__PAGE__.txt` are written as files inside directories. The client router requests `/about/__next.about.__PAGE__.txt?_rsc=…`, which 404s. Navigation still works, because the router falls back to the full payload (`about.txt`), but every segment prefetch for a nested route fails.

**Expected behaviour**

The same flat names as on Linux and macOS: `out/about/__next.about.__PAGE__.txt` and `out/_not-found/__next._not-found.__PAGE__.txt`, so the requested URL exists.

**Cause**

In `packages/next/src/export/index.ts`, `collectSegmentPathsImpl` returns `path.relative(segmentsDirectory, path.join(directory, name))`. On Windows that is `about\__PAGE__.segment.rsc`. `convertSegmentPathToStaticExportFilename` (`packages/next/src/shared/lib/segment-cache/segment-value-encoding.ts`) does `` `__next${segmentPath.replace(/\//g, '.')}.txt` ``, so the backslash is kept and the later `path.join(segmentsDirDest, segmentFilename)` treats it as a separator. Normalising the collected path to `/` (for example `.split(path.sep).join('/')`) fixes it. The root route is unaffected because its page segment has no parent directory.

**Provide environment information**

From `next info` on the runner that reproduced it (Bun 1.4.4 runs `next`; `next info` reports Bun's Node compatibility version):

```text
Operating System:
  Platform: win32
  Arch: x64
  Version: Windows Server 2025 Datacenter
  Available memory (MB): 16379
  Available CPU cores: 4
Binaries:
  Node: 26.3.0
  npm: 10.9.9
  Yarn: 1.22.22
  pnpm: N/A
Relevant Packages:
  next: 16.4.6
  eslint-config-next: N/A
  react: 19.3.1
  react-dom: 19.3.1
  typescript: N/A
Next.js Config:
  output: export
```

**Which area(s) are affected?** Output (export/standalone)

**Which stage(s) are affected?** `next build` (local)

**Additional context**

- Reproduced on GitHub-hosted `windows-latest` with Next 16.4.6 and 16.5.0-canary.49. Not reproduced on `ubuntu-24.04` or `macos-26` with either version. Run: https://github.com/docs-plus/editor/actions/runs/44041439341
- `16.5.0-canary.53` (2026-11-16) has the same source in both functions.
- Duplicates: #85374 (open), #92339 (closed as duplicate). Fix PRs: #92340, #99058.
