import { Octokit } from "@octokit/rest";
import type { AppConfig, PRInfo, RepoConfig } from "./types.js";

let octokit: Octokit;

function getClient(config: AppConfig): Octokit {
  if (!octokit) {
    octokit = new Octokit({ auth: config.githubToken });
  }
  return octokit;
}

export async function listOpenPRs(
  config: AppConfig,
  repo: RepoConfig
): Promise<PRInfo[]> {
  const client = getClient(config);
  const { data } = await client.rest.pulls.list({
    owner: repo.owner,
    repo: repo.repo,
    state: "open",
    sort: "updated",
    direction: "desc",
    per_page: 30,
  });

  return data.map((pr) => ({
    owner: repo.owner,
    repo: repo.repo,
    number: pr.number,
    title: pr.title,
    author: pr.user?.login ?? "unknown",
    headSha: pr.head.sha,
    updatedAt: pr.updated_at,
    url: pr.html_url,
    changedLines: ((pr as Record<string, unknown>).additions as number ?? 0) + ((pr as Record<string, unknown>).deletions as number ?? 0),
  }));
}

export async function getPRDiff(
  config: AppConfig,
  pr: PRInfo
): Promise<string> {
  const client = getClient(config);
  const { data } = await client.rest.pulls.get({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.number,
    mediaType: { format: "diff" },
  });

  // Octokit returns the diff as a string when format is 'diff'
  const diff = data as unknown as string;

  // Truncate very large diffs
  const MAX_DIFF_SIZE = 100_000;
  if (diff.length > MAX_DIFF_SIZE) {
    console.warn(
      `  ⚠ Diff for PR #${pr.number} is ${diff.length} chars, truncating to ${MAX_DIFF_SIZE}`
    );
    return diff.slice(0, MAX_DIFF_SIZE) + "\n\n... [diff truncated]";
  }

  return diff;
}

export interface ExistingComment {
  author: string;
  body: string;
  file?: string;
  line?: number;
  createdAt: string;
}

export async function getPRComments(
  config: AppConfig,
  pr: PRInfo
): Promise<ExistingComment[]> {
  const client = getClient(config);
  const comments: ExistingComment[] = [];

  // Review comments (inline on files)
  const { data: reviewComments } = await client.rest.pulls.listReviewComments({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.number,
    per_page: 100,
  });

  for (const c of reviewComments) {
    comments.push({
      author: c.user?.login ?? "unknown",
      body: c.body,
      file: c.path,
      line: c.line ?? undefined,
      createdAt: c.created_at,
    });
  }

  // Issue-level comments (general PR conversation)
  const { data: issueComments } = await client.rest.issues.listComments({
    owner: pr.owner,
    repo: pr.repo,
    issue_number: pr.number,
    per_page: 100,
  });

  for (const c of issueComments) {
    comments.push({
      author: c.user?.login ?? "unknown",
      body: c.body ?? "",
      createdAt: c.created_at,
    });
  }

  // Pull request reviews (the review body itself)
  const { data: reviews } = await client.rest.pulls.listReviews({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.number,
    per_page: 100,
  });

  for (const r of reviews) {
    if (r.body) {
      comments.push({
        author: r.user?.login ?? "unknown",
        body: r.body,
        createdAt: r.submitted_at ?? "",
      });
    }
  }

  return comments;
}

export async function postInlineComment(
  config: AppConfig,
  pr: PRInfo,
  body: string,
  file: string,
  line?: number
): Promise<void> {
  const client = getClient(config);

  if (file && line) {
    // Post as an inline review comment on the specific file and line
    await client.rest.pulls.createReviewComment({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.number,
      body,
      commit_id: pr.headSha,
      path: file,
      line,
      side: "RIGHT",
    });
  } else if (file) {
    // File known but no line — comment on line 1 of the file
    await client.rest.pulls.createReviewComment({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.number,
      body,
      commit_id: pr.headSha,
      path: file,
      line: 1,
      side: "RIGHT",
    });
  } else {
    // No file context — fall back to a PR-level review comment
    await client.rest.pulls.createReview({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.number,
      body,
      event: "COMMENT",
    });
  }
}
