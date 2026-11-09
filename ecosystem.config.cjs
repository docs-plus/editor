/**
 * PM2 ecosystem config for production.
 * Next.js on 3847, Hocuspocus on 3848 (avoids common 3000/1234 conflicts).
 *
 * Both apps run behind a TLS-terminating reverse proxy (production requires
 * wss://), so TRUSTED_PROXY=1 lets them read the client IP from the proxy's
 * X-Forwarded-For / X-Real-IP. Only the proxy may reach 3847/3848; a client
 * hitting them directly could forge those headers.
 *
 * Optional env for editor-hocus (inherit from host or set here):
 * WS_CONNECTION_LIMIT, DOC_CREATION_RATE_LIMIT, HOCUS_THROTTLE*, HOCUS_LOGGER,
 * HOCUS_REDIS*, etc.
 * See docs/operations/abuse-guardrails-runbook.md.
 *
 * NEXT_PUBLIC_* values (NEXT_PUBLIC_HOCUS_URL, NEXT_PUBLIC_SITE_URL,
 * NEXT_PUBLIC_GA_MEASUREMENT_ID, NEXT_PUBLIC_PRIVACY_*,
 * NEXT_PUBLIC_SERVICE_WORKER) and SEO_NOINDEX are inlined by `bun run build`.
 * Put them in .env.production before building, then `bun run build` and
 * `pm2 restart editor-next`; setting them here has no effect.
 */
module.exports = {
  apps: [
    {
      name: "editor-next",
      cwd: __dirname,
      script: "bun",
      args: "run start",
      env: { NODE_ENV: "production", PORT: 3847, TRUSTED_PROXY: "1" },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
    },
    {
      name: "editor-redis",
      script: "redis-server",
      args: "--port 6380 --save '' --appendonly no",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
    },
    {
      name: "editor-hocus",
      cwd: __dirname,
      script: "bun",
      args: "run hocus",
      env: {
        NODE_ENV: "production",
        HOCUS_PORT: "3848",
        TRUSTED_PROXY: "1",
        DB_PATH: "db.sqlite",
        HOCUS_REDIS: "1",
        HOCUS_REDIS_HOST: "127.0.0.1",
        HOCUS_REDIS_PORT: "6380",
        // Only the public site may open collaboration sockets from a browser.
        HOCUS_ALLOWED_ORIGINS: "https://tiny.docs.plus",
        // Room for the long-document showcase (about 1.4 MB); images are
        // downscaled to 256 KB, so ordinary documents stay far below this.
        MAX_DOC_SIZE_BYTES: "2097152",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
    },
  ],
};
