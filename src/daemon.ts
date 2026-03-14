import { loadConfig } from "./config.js";
import {
  setIdle,
  setScanning,
  setReviewing,
  setLastScan,
  saveDaemonStatus,
} from "./daemon-status.js";
import { extractSnippets } from "./diff-parser.js";
import { listOpenPRs, getPRDiff, getPRComments } from "./github.js";
import { extractTicketKey, fetchJiraTicket } from "./jira.js";
import { reviewDiff } from "./reviewer.js";
import { loadState, saveState, needsReview, markReviewed } from "./state.js";
import { addReview, pruneClosedPRs } from "./store.js";
import type { AppConfig, PRInfo, ReviewState } from "./types.js";

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
  saveDaemonStatus();

  const toReview: PRInfo[] = [];
  const allOpenKeys = new Set<string>();

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
      allOpenKeys.add(prKey(pr));
      if (needsReview(state, pr) || retryQueue.has(prKey(pr))) {
        toReview.push(pr);
      }
    }
  }

  // Prune reviews for PRs that are no longer open (merged/closed)
  const pruned = pruneClosedPRs(allOpenKeys);
  if (pruned > 0) {
    console.log(`  Pruned ${pruned} review(s) for merged/closed PRs.`);
  }

  if (toReview.length === 0) {
    console.log("  No new or updated PRs.");
    setLastScan(0);
    saveDaemonStatus();
    return 0;
  }

  toReview.sort((a, b) => a.changedLines - b.changedLines);

  console.log(`  ${toReview.length} PR(s) to review — smallest first.`);

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
    saveDaemonStatus();

    try {
      console.log(`\n  [${i + 1}/${toReview.length}] PR #${pr.number}: ${pr.title}`);

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

      // Check if someone already commented about the ticket/title
      const alreadyMentionedTicket = existingComments.some(
        (c) => c.body.toLowerCase().includes("ticket") && (c.body.toLowerCase().includes("title") || c.body.toLowerCase().includes("jira"))
      );

      if (!alreadyMentionedTicket) {
        if (!jiraTicket && !ticketKey) {
          review.concerns.push({
            file: "",
            severity: "critical",
            message: `This PR doesn't appear to be linked to a Jira ticket — could you add the ticket key to the title (e.g. "AMIP-1234: ...")? It helps with traceability and makes it easier to understand what this change is for.`,
          });
          if (review.overallSeverity === "low") {
            review.overallSeverity = "medium";
          }
        } else if (ticketKey && !pr.title.includes(ticketKey)) {
          review.concerns.push({
            file: "",
            severity: "warning",
            message: `The Jira ticket key in the PR title doesn't follow the standard format. Could you update the title to start with "${ticketKey}: ..." instead of "${pr.title.slice(0, 40)}..."? It makes it easier to find PRs by ticket number.`,
          });
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
  saveDaemonStatus();
  return reviewed;
}

async function main() {
  const config = loadConfig();
  const state = loadState(config.stateFilePath);

  console.log("\n  PR Review Daemon");
  console.log("  ─────────────────────────────");
  console.log(
    `  Watching: ${config.repos.map((r) => `${r.owner}/${r.repo}`).join(", ")}`
  );
  console.log(
    `  Poll interval: ${config.pollIntervalMs / 1000 / 60} minutes\n`
  );

  // Initial scan
  console.log("  Running initial scan...");
  await scanOnce(config, state);
  setIdle(retryQueue.size, new Date(Date.now() + config.pollIntervalMs));
  saveDaemonStatus();

  if (retryQueue.size > 0) {
    console.log(`\n  ${retryQueue.size} PR(s) queued for retry on next cycle.`);
  }

  // Background polling
  let scanning = false;
  setInterval(async () => {
    if (scanning) return;
    scanning = true;
    console.log("\n  Polling for new PRs...");
    await scanOnce(config, state);
    setIdle(retryQueue.size, new Date(Date.now() + config.pollIntervalMs));
    saveDaemonStatus();
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
