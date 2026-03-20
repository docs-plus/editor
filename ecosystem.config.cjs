/**
 * PM2 ecosystem config for production.
 * Next.js on 3847, Hocuspocus on 3848 (avoids common 3000/1234 conflicts).
 *
 * Optional env for editor-hocus (inherit from host or set here): TRUSTED_PROXY,
 * WS_CONNECTION_LIMIT, DOC_CREATION_RATE_LIMIT, HOCUS_THROTTLE*, HOCUS_LOGGER,
 * HOCUS_REDIS*, etc.
 * See README "Guardrail env vars" + "Hocuspocus server".
 */
module.exports = {
  apps: [
    {
      name: "editor-next",
      cwd: __dirname,
      script: "bun",
      args: "run start",
      env: { NODE_ENV: "production", PORT: 3847 },
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
        DB_PATH: "db.sqlite",
        HOCUS_REDIS: "1",
        HOCUS_REDIS_HOST: "127.0.0.1",
        HOCUS_REDIS_PORT: "6380",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
    },
  ],
};
