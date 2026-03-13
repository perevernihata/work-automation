import { loadConfig } from "./config.js";
import { listOpenPRs, getPRDiff, getPRComments } from "./github.js";
import { reviewDiff } from "./reviewer.js";
import { loadState, saveState, needsReview, markReviewed } from "./state.js";
import { addReview } from "./store.js";
import { createServer } from "./server.js";
import { serve } from "@hono/node-server";
import type { AppConfig, ReviewState } from "./types.js";

const PORT = Number(process.env.PORT) || 3847;

async function scanOnce(config: AppConfig, state: ReviewState): Promise<number> {
  let reviewed = 0;

  for (const repo of config.repos) {
    console.log(`  Checking ${repo.owner}/${repo.repo}...`);

    let prs;
    try {
      prs = await listOpenPRs(config, repo);
    } catch (err) {
      console.error(`  Error listing PRs for ${repo.owner}/${repo.repo}:`, err);
      continue;
    }

    const pending = prs.filter((pr) => needsReview(state, pr));
    if (pending.length === 0) {
      console.log("  No new or updated PRs.");
      continue;
    }

    console.log(`  Found ${pending.length} PR(s) to review.`);

    for (const pr of pending) {
      try {
        console.log(`  Fetching diff and comments for PR #${pr.number}...`);
        const [diff, existingComments] = await Promise.all([
          getPRDiff(config, pr),
          getPRComments(config, pr),
        ]);

        if (existingComments.length > 0) {
          console.log(`  Found ${existingComments.length} existing comment(s) — will avoid duplicates.`);
        }

        console.log(`  Reviewing PR #${pr.number} with Claude...`);
        const review = await reviewDiff(diff, pr, existingComments);

        addReview(pr, review);
        markReviewed(state, pr);
        saveState(config.stateFilePath, state);
        reviewed++;

        console.log(
          `  ✓ PR #${pr.number} reviewed (${review.overallSeverity}, ${review.concerns.length} concerns)`
        );
      } catch (err) {
        console.error(`  Error reviewing PR #${pr.number}:`, err);
      }
    }
  }

  return reviewed;
}

async function main() {
  const config = loadConfig();
  const state = loadState(config.stateFilePath);

  console.log("\n  PR Review Dashboard");
  console.log("  ─────────────────────────────");
  console.log(
    `  Watching: ${config.repos.map((r) => `${r.owner}/${r.repo}`).join(", ")}`
  );
  console.log(
    `  Poll interval: ${config.pollIntervalMs / 1000 / 60} minutes`
  );

  // Set up web server with scan endpoint
  const app = createServer(config);

  // Add scan endpoint
  let scanning = false;
  app.post("/api/scan", async (c) => {
    if (scanning) return c.json({ message: "Scan already in progress" });
    scanning = true;
    try {
      const count = await scanOnce(config, state);
      return c.json({ message: `Scanned. ${count} new review(s).` });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        500
      );
    } finally {
      scanning = false;
    }
  });

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`  Dashboard: http://localhost:${PORT}\n`);
  });

  // Initial scan
  console.log("  Running initial scan...");
  await scanOnce(config, state);

  // Background polling
  setInterval(async () => {
    if (scanning) return;
    console.log("\n  Polling for new PRs...");
    await scanOnce(config, state);
  }, config.pollIntervalMs);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n  Saving state and exiting...");
    saveState(config.stateFilePath, state);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
