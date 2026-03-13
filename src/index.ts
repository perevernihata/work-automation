import { loadConfig } from "./config.js";
import {
  setIdle,
  setScanning,
  setReviewing,
  setLastScan,
  getStatus,
} from "./daemon-status.js";
import { extractSnippets } from "./diff-parser.js";
import { listOpenPRs, getPRDiff, getPRComments } from "./github.js";
import { extractTicketKey, fetchJiraTicket } from "./jira.js";
import { reviewDiff } from "./reviewer.js";
import { loadState, saveState, needsReview, markReviewed } from "./state.js";
import { addReview } from "./store.js";
import { createServer } from "./server.js";
import { serve } from "@hono/node-server";
import type { AppConfig, PRInfo, ReviewState } from "./types.js";

const PORT = Number(process.env.PORT) || 3847;
const DELAY_BETWEEN_REVIEWS_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const retryQueue = new Set<string>();

function prKey(pr: PRInfo): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`;
}

async function scanOnce(config: AppConfig, state: ReviewState): Promise<number> {
  let reviewed = 0;

  setScanning();

  const toReview: PRInfo[] = [];

  for (const repo of config.repos) {
    console.log(`  Checking ${repo.owner}/${repo.repo}...`);

    let prs;
    try {
      prs = await listOpenPRs(config, repo);
    } catch (err) {
      console.error(`  Error listing PRs for ${repo.owner}/${repo.repo}:`, err);
      continue;
    }

    for (const pr of prs) {
      if (needsReview(state, pr) || retryQueue.has(prKey(pr))) {
        toReview.push(pr);
      }
    }
  }

  if (toReview.length === 0) {
    console.log("  No new or updated PRs.");
    setLastScan(0);
    return 0;
  }

  console.log(`  ${toReview.length} PR(s) to review — processing one at a time.`);

  let failed = 0;

  for (let i = 0; i < toReview.length; i++) {
    const pr = toReview[i];
    const key = prKey(pr);

    setReviewing(
      { number: pr.number, title: pr.title, repo: `${pr.owner}/${pr.repo}` },
      i + 1,
      toReview.length,
      reviewed,
      failed
    );

    try {
      console.log(`\n  [${i + 1}/${toReview.length}] PR #${pr.number}: ${pr.title}`);

      // Extract and fetch Jira ticket
      const ticketKey = extractTicketKey(pr);
      let jiraTicket = null;
      if (ticketKey) {
        console.log(`  Jira ticket: ${ticketKey} — fetching...`);
        jiraTicket = await fetchJiraTicket(ticketKey);
        if (jiraTicket) {
          console.log(`  ✓ ${jiraTicket.key}: ${jiraTicket.summary} [${jiraTicket.status}]`);
        }
      } else {
        console.log(`  No Jira ticket found in PR title.`);
      }

      console.log(`  Fetching diff and comments...`);

      const [diff, existingComments] = await Promise.all([
        getPRDiff(config, pr),
        getPRComments(config, pr),
      ]);

      if (existingComments.length > 0) {
        console.log(`  Found ${existingComments.length} existing comment(s) — will avoid duplicates.`);
      }

      // Find local repo path for codebase access
      const repoConfig = config.repos.find(
        (r) => r.owner === pr.owner && r.repo === pr.repo
      );

      console.log(`  Sending to Claude for review...`);
      if (repoConfig?.localPath) {
        console.log(`  Codebase access: ${repoConfig.localPath}`);
      }
      const { review, meta } = await reviewDiff(diff, pr, existingComments, jiraTicket, repoConfig?.localPath);

      if (review.summary.startsWith("Review failed:")) {
        console.warn(`  ⚠ ${review.summary}`);
        console.log(`  Will retry on next poll cycle.`);
        retryQueue.add(key);
        failed++;
        await sleep(DELAY_BETWEEN_REVIEWS_MS);
        continue;
      }

      // Inject a "missing Jira ticket" concern if no ticket was found
      if (!jiraTicket) {
        review.concerns.push({
          file: "",
          severity: "critical",
          message: `This PR doesn't appear to be linked to a Jira ticket — could you add the ticket key to the title (e.g. "AMIP-1234: ...")? It helps with traceability and makes it easier to understand what this change is for.`,
        });
        if (review.overallSeverity === "low") {
          review.overallSeverity = "medium";
        }
      }

      const snippets = extractSnippets(diff, review.concerns);
      addReview(pr, review, snippets, jiraTicket, meta);
      markReviewed(state, pr);
      retryQueue.delete(key);
      saveState(config.stateFilePath, state);
      reviewed++;

      const turnsInfo = meta ? ` · ${meta.numTurns} turns · ${(meta.durationMs / 1000).toFixed(1)}s · $${meta.costUsd.toFixed(3)}` : '';
      console.log(
        `  ✓ Reviewed (${review.overallSeverity}, ${review.concerns.length} concerns${turnsInfo})`
      );

      if (i < toReview.length - 1) {
        console.log(`  Waiting ${DELAY_BETWEEN_REVIEWS_MS / 1000}s before next review...`);
        await sleep(DELAY_BETWEEN_REVIEWS_MS);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Failed: ${msg}`);
      console.log(`  Will retry on next poll cycle.`);
      retryQueue.add(key);
      failed++;
      await sleep(DELAY_BETWEEN_REVIEWS_MS);
    }
  }

  setLastScan(reviewed);
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

  const app = createServer(config);

  // Status endpoint
  app.get("/api/status", (c) => {
    return c.json(getStatus());
  });

  // Scan endpoint
  let scanning = false;
  app.post("/api/scan", async (c) => {
    if (scanning) return c.json({ message: "Scan already in progress" });
    scanning = true;
    try {
      const count = await scanOnce(config, state);
      setIdle(retryQueue.size, new Date(Date.now() + config.pollIntervalMs));
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
  setIdle(retryQueue.size, new Date(Date.now() + config.pollIntervalMs));

  if (retryQueue.size > 0) {
    console.log(`\n  ${retryQueue.size} PR(s) queued for retry on next cycle.`);
  }

  // Background polling
  setInterval(async () => {
    if (scanning) return;
    scanning = true;
    console.log("\n  Polling for new PRs...");
    await scanOnce(config, state);
    setIdle(retryQueue.size, new Date(Date.now() + config.pollIntervalMs));
    scanning = false;
    if (retryQueue.size > 0) {
      console.log(`  ${retryQueue.size} PR(s) queued for retry.`);
    }
  }, config.pollIntervalMs);

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
