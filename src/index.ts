// Legacy entry point — runs both daemon and web server in one process.
// Prefer running them separately:
//   npx tsx src/daemon.ts   — polls and reviews PRs
//   npx tsx src/web.ts      — serves the dashboard UI

import "./daemon.js";
import { loadConfig } from "./config.js";
import { loadDaemonStatus } from "./daemon-status.js";
import { createServer } from "./server.js";
import { serve } from "@hono/node-server";

const PORT = Number(process.env.PORT) || 3847;
const config = loadConfig();
const app = createServer(config);

app.get("/api/status", (c) => {
  return c.json(loadDaemonStatus());
});

app.post("/api/scan", (c) => {
  return c.json({ message: "Use the daemon process for scanning." });
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`  Dashboard: http://localhost:${PORT}\n`);
});
