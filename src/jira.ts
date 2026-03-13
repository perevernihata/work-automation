import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PRInfo } from "./types.js";

const execFileAsync = promisify(execFile);

// Known Jira project prefixes — add more as needed
const PROJECT_PREFIXES = ["AMIP", "ZT"];

export interface JiraTicket {
  key: string;
  summary: string;
  status: string;
  type: string;
  assignee: string;
  priority: string;
  description: string;
  url: string;
}

/**
 * Extract a Jira ticket key from PR title or branch name.
 * Handles formats like:
 *   "AMIP-3721: change the zero line..."
 *   "[AMIP-3718] Refactor..."
 *   "Amip 3714 add compare funds..."  (space instead of dash)
 *   "AMIP-327: combine performance..."  (any number of digits)
 *   Branch: "AMIP-3714-Add-Compare-Funds-to-Dashboard"
 */
export function extractTicketKey(pr: PRInfo): string | null {
  const prefixPattern = PROJECT_PREFIXES.join("|");

  // Standard format: AMIP-1234 or [AMIP-1234]
  const standard = new RegExp(`((?:${prefixPattern})-\\d+)`, "i");

  // Check title first, then branch (encoded in the PR URL as the source ref)
  for (const text of [pr.title, pr.url]) {
    const match = text.match(standard);
    if (match) {
      return normalizeKey(match[1]);
    }
  }

  // Relaxed format: "Amip 1234" or "amip1234" (space or no separator)
  const relaxed = new RegExp(`(${prefixPattern})\\s*(\\d+)`, "i");
  const match = pr.title.match(relaxed);
  if (match) {
    return normalizeKey(`${match[1]}-${match[2]}`);
  }

  return null;
}

function normalizeKey(raw: string): string {
  // Uppercase the project prefix: "amip-1234" -> "AMIP-1234"
  const parts = raw.split("-");
  if (parts.length === 2) {
    return `${parts[0].toUpperCase()}-${parts[1]}`;
  }
  return raw.toUpperCase();
}

/**
 * Fetch ticket details from Jira CLI.
 * Needs JIRA_API_TOKEN in the environment.
 */
export async function fetchJiraTicket(key: string): Promise<JiraTicket | null> {
  try {
    const { stdout } = await execFileAsync(
      "jira",
      ["issue", "view", key, "--plain", "--comments", "0"],
      {
        timeout: 15_000,
        env: { ...process.env },
        cwd: process.env.HOME,
      }
    );

    return parseJiraOutput(key, stdout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Jira fetch failed for ${key}: ${msg}`);
    return null;
  }
}

/**
 * Parse the jira CLI plain output into a structured ticket.
 */
function parseJiraOutput(key: string, raw: string): JiraTicket {
  // Strip ANSI escape codes
  const clean = raw.replace(/\x1b\[[0-9;]*m/g, "").replace(/\[[\d;]*m/g, "");

  // First line has metadata like: Bug  Code Review  Fri, 13 Mar 26  Abdul Rafay  AMIP-3721  0 comments
  // The summary is on the line starting with "# "
  const summaryMatch = clean.match(/^#\s+(.+)$/m);
  const summary = summaryMatch ? summaryMatch[1].trim() : key;

  // Extract fields from the emoji-prefixed metadata
  const typeMatch = clean.match(/(?:🐞|⭐|📖|🎯|💡)\s+(\S+)/);
  const statusMatch = clean.match(/(?:🚧|✅|🔵)\s+([\w\s]+?)(?:\s+⌛|$)/m);
  const assigneeMatch = clean.match(/👷\s+(.+?)(?:\s+🔑|$)/m);
  const priorityMatch = clean.match(/🚀\s+(\S+)/);

  // Description
  const descStart = clean.indexOf("Description");
  let description = "";
  if (descStart !== -1) {
    const afterDesc = clean.slice(descStart + "Description".length);
    // Take until "[attachment]" or "View this issue" or end
    const descEnd = afterDesc.search(/\[attachment\]|View this issue|$/m);
    description = afterDesc
      .slice(0, descEnd > 0 ? descEnd : undefined)
      .replace(/-+/g, "")
      .trim();
  }

  // URL
  const urlMatch = clean.match(/(https:\/\/\S+\/browse\/\S+)/);
  const url = urlMatch
    ? urlMatch[1]
    : `https://changing-digital.atlassian.net/browse/${key}`;

  return {
    key,
    summary,
    status: statusMatch ? statusMatch[1].trim() : "Unknown",
    type: typeMatch ? typeMatch[1].trim() : "Unknown",
    assignee: assigneeMatch ? assigneeMatch[1].trim() : "Unassigned",
    priority: priorityMatch ? priorityMatch[1].trim() : "Medium",
    description: description.slice(0, 500), // cap length
    url,
  };
}
