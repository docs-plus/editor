/**
 * PM2 ecosystem config for production.
 * Next.js on 3847, Hocuspocus on 3848 (avoids common 3000/1234 conflicts).
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
      name: "editor-hocus",
      cwd: __dirname,
      script: "bunx",
      args: "@hocuspocus/cli --port 3848 --sqlite db.sqlite",
      env: { NODE_ENV: "production" },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
    },
  ],
};
