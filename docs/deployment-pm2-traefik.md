# Deployment: PM2 + Traefik

Step-by-step guide to run the editor on a server with PM2 and route `editor.docs.plus` via Traefik.

## Architecture

| Service   | Port | Role                          |
|-----------|------|-------------------------------|
| Next.js   | 3847 | Editor UI (HTTP)             |
| Hocuspocus| 3848 | WebSocket + SQLite (collab)  |

Traefik routes:
- `https://editor.docs.plus` → Next.js (3847)
- `wss://editor.docs.plus/collab` → Hocuspocus (3848)

## Step 1: Build on the server

```bash
cd /opt/projects/editor.docs.plus
bun install
bun run build
```

## Step 2: Start with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # optional: enable startup on boot
```

## Step 3: Traefik configuration

Route HTTP to 3847 and WebSocket `/collab` to 3848. Use middleware to strip `/collab` when forwarding to Hocuspocus:

```yaml
http:
  middlewares:
    strip-collab:
      replacePathRegex:
        regex: "^/collab(.*)"
        replacement: "/$1"
  routers:
    editor-http:
      rule: "Host(`editor.docs.plus`)"
      service: editor-next
      entryPoints: [websecure]
    editor-ws:
      rule: "Host(`editor.docs.plus`) && PathPrefix(`/collab`)"
      service: editor-hocus
      middlewares: [strip-collab]
      entryPoints: [websecure]
  services:
    editor-next:
      loadBalancer:
        servers: [{ url: "http://127.0.0.1:3847" }]
    editor-hocus:
      loadBalancer:
        servers: [{ url: "http://127.0.0.1:3848" }]
```

## Step 4: Client WebSocket URL

The app uses `wss://editor.docs.plus/collab` when served from production. Local dev uses `ws://127.0.0.1:1234` (Makefile).

## Quick reference

| Command | Description |
|---------|-------------|
| `pm2 start ecosystem.config.cjs` | Start both apps |
| `pm2 restart all` | Restart after deploy |
| `pm2 logs editor-next` | Next.js logs |
| `pm2 logs editor-hocus` | Hocuspocus logs |
