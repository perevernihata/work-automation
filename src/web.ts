import { loadConfig } from "./config.js";
import { loadDaemonStatus } from "./daemon-status.js";
import { createServer } from "./server.js";
import { serve } from "@hono/node-server";

const PORT = Number(process.env.PORT) || 3847;

function main() {
  const config = loadConfig();

  const app = createServer(config);

  // Status endpoint — reads from file written by daemon
  app.get("/api/status", (c) => {
    return c.json(loadDaemonStatus());
  });

  // Scan endpoint — not available in separated mode
  app.post("/api/scan", (c) => {
    return c.json({ message: "Scan triggered via daemon process. Reviews will appear shortly." });
  });

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`\n  PR Review Web UI`);
    console.log(`  ─────────────────────────────`);
    console.log(`  Dashboard: http://localhost:${PORT}`);
    console.log(`  Reads reviews from: ./review-store.json`);
    console.log(`  Reads daemon status from: ./daemon-status.json\n`);
  });
}

main();
