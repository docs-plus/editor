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
 *
 * editor-purge is a daily job, not a server: PM2 runs it at `cron_restart`
 * (host-local time), it exits, and it is not restarted until the next run.
 * Only the cron purges: the run PM2 starts when a deploy registers or
 * updates the app finds scripts/deploy.sh's marker and exits.
 */

// The SQLite file and the retention windows. Next.js, Hocus and the purge
// must all see the same values.
const storageEnv = {
  DB_PATH: "db.sqlite",
};

module.exports = {
  apps: [
    {
      name: "editor-next",
      cwd: __dirname,
      script: "bun",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: 3847,
        TRUSTED_PROXY: "1",
        ...storageEnv,
      },
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
        ...storageEnv,
        HOCUS_REDIS: "1",
        HOCUS_REDIS_HOST: "127.0.0.1",
        HOCUS_REDIS_PORT: "6380",
        // Only the public site may open collaboration sockets from a browser.
        HOCUS_ALLOWED_ORIGINS: "https://tiny.docs.plus",
        // Room for the long-document showcase (about 1.4 MB); images are
        // downscaled to 256 KB, so ordinary documents stay far below this.
        MAX_DOC_SIZE_BYTES: "2097152",
        // Rewrites stored legacy highlight colours to tokens on load. Safe
        // since release N tabs are gone (on in production from 2026-11-15).
        HOCUS_REWRITE_LEGACY_HIGHLIGHTS: "1",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
    },
    {
      // Deletes documents idle for RETENTION_DAYS and expired tombstones.
      name: "editor-purge",
      cwd: __dirname,
      script: "bun",
      args: "scripts/purge-retention.ts",
      env: {
        NODE_ENV: "production",
        ...storageEnv,
        // dry-run logs what it would delete and changes nothing; on backs
        // the database up to backups/ (dated copies kept 14 days, the first
        // one forever), then deletes; off skips.
        // Switch to on in a pull request after reviewing dry-run logs.
        PURGE_MODE: "dry-run",
      },
      cron_restart: "17 3 * * *",
      autorestart: false,
      instances: 1,
      exec_mode: "fork",
      watch: false,
    },
  ],
};
