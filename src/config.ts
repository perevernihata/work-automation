import { execSync } from "node:child_process";
import type { AppConfig, RepoConfig } from "./types.js";

// ── Edit this list to watch your repos ──────────────────────────────
const REPOS: RepoConfig[] = [
  {
    owner: "AMInsights",
    repo: "ami-platform-monorepo",
    localPath: "/Users/ivanperevernykhata/temp/ami-platform-monorepo",
  },
  {
    owner: "Zatafy",
    repo: "zatafy-monorepo",
    localPath: "/Users/ivanperevernykhata/temp/zatafy-monorepo",
  },
];

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function getGitHubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execSync("gh auth token", { encoding: "utf-8" }).trim();
  } catch {
    console.error(
      "Could not get GitHub token. Either set GITHUB_TOKEN or authenticate with `gh auth login`."
    );
    process.exit(1);
  }
}

function loadJiraToken(): void {
  if (process.env.JIRA_API_TOKEN) return;
  // Extract JIRA_API_TOKEN from the zatafy monorepo .envrc
  try {
    const raw = execSync(
      'grep "^export JIRA_API_TOKEN=" /Users/ivanperevernykhata/temp/zatafy-monorepo/.envrc | cut -d= -f2-',
      { encoding: "utf-8" }
    ).trim();
    if (raw) {
      process.env.JIRA_API_TOKEN = raw;
      console.log("  Jira token loaded from zatafy-monorepo/.envrc");
    }
  } catch {
    console.warn(
      "  Warning: JIRA_API_TOKEN not found. Jira integration will be disabled."
    );
  }
}

export function loadConfig(): AppConfig {
  loadJiraToken();

  if (REPOS.length === 0) {
    console.error(
      "No repos configured. Edit src/config.ts and add repos to the REPOS array."
    );
    process.exit(1);
  }

  return {
    repos: REPOS,
    pollIntervalMs: POLL_INTERVAL_MS,
    stateFilePath: "./review-state.json",
    githubToken: getGitHubToken(),
  };
}
