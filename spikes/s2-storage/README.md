# Spike S2: `node:sqlite` storage worker (throwaway)

Phase 1 spike S2 (`docs/superpowers/plans/2026-11-16-phase-1-spikes.md`). Never merged to `main`.

```bash
cd spikes/s2-storage && bun install && bun run build
bun electron dist/main.cjs --mode=pragmas --db /tmp/s2.sqlite
bun electron dist/main.cjs --mode=roundtrip --db /tmp/rt.sqlite
bun electron dist/main.cjs --mode=commit-loop --thread=worker|main --count=2000 [--fullfsync=0] [--synchronous=OFF]
bun kill-harness.ts --kills 200 --target append|compaction [--synchronous=OFF] [--dense]
```

Every Electron mode prints one `RESULT <json>` line (exit 0) or `FAIL <reason>` (exit 1). Linux needs `xvfb-run -a`.

## For S5 (commit arms)

- `commit-loop.ts` exports `startCommitLoop(db, size)`: back-to-back 4 KB commits on the calling thread, yielding with `setImmediate` between commits, until `stop()` returns the stats. `electron-main-commits` calls it on main with `openDatabase({ path, synchronous: "FULL" })` from `engine.ts`.
- `electron-worker-commits`: start `dist/worker.cjs` (`new Worker(path.join(app.getAppPath(), "worker.cjs"))`), send `{ id, type: "open", path, synchronous: "FULL" }`, then `{ id, type: "loop-start", size: 4096 }` and `{ id, type: "loop-stop" }` (the reply's `result` holds the stats).
- Bun.build inlines `__dirname` for a `"type": "module"` package: locate sibling bundles with `app.getAppPath()`, not `__dirname`.
