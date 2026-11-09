# Service Worker Runbook

TinyDocy ships one service worker so the app opens offline and through a
flaky connection. This page covers what it does, how to turn it off in an
emergency, and the deployment rules that keep it updatable.

## What it does

- **Source:** `lib/pwa/service-worker.ts` (plus `lib/pwa/sw-config.ts` and
  `lib/pwa/sw-routing.ts`). Next 16's native Turbopack entry compiles it to
  **`/_next/static/service-worker/sw.js`**. The only registration call is in
  `components/pwa/service-worker-registration.tsx`.
- **Registers in production builds only,** after `load` plus idle time.
  `next dev` never registers and removes a worker left on localhost.
- **Navigations** are network-first (navigation preload, 3 s timeout). On a
  5xx or no answer, the worker serves the last good copy of `/`, `/about` or
  `/privacy`, else the precached `/offline` page. A page copy is stored only
  after every `/_next/static` file it references is cached.
- **`/_next/static/*`** is cache-first in `tinydocy-static` (capped at 300
  entries). Pages live in `tinydocy-shell-v1`.
- **Never touched:** `/api/*`, RSC requests, HEAD, Range, metadata routes,
  every cross-origin request (analytics, X, embeds, user images) and the
  collaboration WebSocket. Documents are never stored.
- **Updates:** `skipWaiting()` + `clients.claim()`, no prompt. Old
  `tinydocy-*` caches outside the current pair are deleted on activate.

## Emergency off switch

There are two layers. For a real incident, flip both in one deploy.

### Layer 1: stop registering (`NEXT_PUBLIC_SERVICE_WORKER=0`)

1. Add `NEXT_PUBLIC_SERVICE_WORKER=0` to `.env.production`.
2. `bun run build`, then `bunx pm2 restart editor-next`. The value is inlined
   at build time; setting it in `ecosystem.config.cjs` does nothing.
3. On the next load, every page unregisters the worker and deletes the
   `tinydocy-*` caches.

The tab that ran the cleanup stays controlled by the old worker until it is
reloaded (browsers never release a live page), so the old worker can refill
`tinydocy-static` during that session. The following load is clean.

### Layer 2: the worker removes itself (`KILL_SWITCH`)

Use it when the deployed worker itself misbehaves (for example it serves a
broken page, so layer 1's page code may never run).

1. In `lib/pwa/service-worker.ts`, set `const KILL_SWITCH: boolean = true;`.
2. Build, deploy and restart as above.
3. Browsers fetch the new `sw.js` on their next navigation (it is served with
   `max-age=0, must-revalidate` and registered with `updateViaCache: "none"`).
   The new worker deletes the `tinydocy-*` caches, unregisters, and reloads the
   tabs it controls once.

When both layers ship together, layer 1 usually unregisters first. Then the
tab is not reloaded and the end state is the same as layer 1 alone.

### Confirm in DevTools

Application panel, on the affected origin:

- **Service workers:** no worker listed for the origin (after a reload).
- **Cache storage:** no `tinydocy-shell-v1` or `tinydocy-static`.
- **Network:** with "Disable cache" off, `/` and `/_next/static/*` rows no
  longer say "(ServiceWorker)".
- Layer 2 only: at most one automatic reload within about 10 s of the first
  load.

To turn the worker back on, revert the flag and the constant, then rebuild.

## Deployment rules

- **Never rename or move `sw.js`.** Installed clients keep checking the URL
  they registered. A moved worker leaves the old one running until it is
  unregistered by hand.
- **Never add a `Cache-Control` header rule** for
  `/_next/static/service-worker/*` or for `/:path*` in `next.config.ts`. Next
  sets `Cache-Control: public, max-age=0, must-revalidate` on `sw.js` only when
  no other rule has set one; a broader rule would let browsers keep a stale
  worker.
- **Do not switch the CSP to nonces** while the worker stores HTML: a stored
  page would replay its nonce.
- **Reverse proxy (Traefik) and any CDN:** confirm that
  `https://tiny.docs.plus/_next/static/service-worker/sw.js` arrives with
  `Cache-Control: public, max-age=0, must-revalidate` and
  `Service-Worker-Allowed: /`, and that no caching middleware sits in front of
  it. Compression is fine. The repo has no Traefik config, so check it on the
  host:

  ```sh
  curl -sI https://tiny.docs.plus/_next/static/service-worker/sw.js \
    | grep -iE 'cache-control|service-worker-allowed'
  ```

- **Changing what a stored page means** (the copy format or `SHELL_PATHS`):
  bump `SHELL_CACHE` in `lib/pwa/sw-config.ts`. Keep `STATIC_CACHE` stable so
  tabs opened before a deploy can still load their lazy chunks.

## Local checks

```sh
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1234 bun run build && PORT=3847 bun run start
HOCUS_THROTTLE=0 bun run hocus
PWA_BASE_URL=http://localhost:3847 CI= bun run test:pwa
```
