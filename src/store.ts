import { readFileSync, writeFileSync } from "node:fs";
import type { CodeSnippet } from "./diff-parser.js";
import type { JiraTicket } from "./jira.js";
import type { PRInfo, ReviewResult, Concern } from "./types.js";

const STORE_PATH = "./review-store.json";

export interface ReviewMeta {
  durationMs: number;
  numTurns: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface QAEntry {
  question: string;
  answer: string;
  askedAt: string;
}

export interface PendingComment {
  id: string;
  prInfo: PRInfo;
  concern: Concern;
  snippet?: CodeSnippet;
  status: "pending" | "approved" | "rejected";
  approvedAt?: string;
  rejectedAt?: string;
  qa?: QAEntry[];
}

export interface PRReview {
  id: string;
  prInfo: PRInfo;
  review: ReviewResult;
  jiraTicket?: JiraTicket | null;
  meta?: ReviewMeta;
  comments: PendingComment[];
  reviewedAt: string;
}

interface StoreData {
  reviews: PRReview[];
  nextId: number;
}

function loadStore(): StoreData {
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(raw) as StoreData;
  } catch {
    return { reviews: [], nextId: 1 };
  }
}

function saveStore(data: StoreData): void {
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2) + "\n");
}

function makeId(data: StoreData): string {
  return String(data.nextId++);
}

export function addReview(
  prInfo: PRInfo,
  review: ReviewResult,
  snippets?: Map<number, CodeSnippet>,
  jiraTicket?: JiraTicket | null,
  meta?: ReviewMeta
): PRReview {
  const data = loadStore();

  // Remove existing review for same PR if present
  data.reviews = data.reviews.filter(
    (r) =>
      !(
        r.prInfo.owner === prInfo.owner &&
        r.prInfo.repo === prInfo.repo &&
        r.prInfo.number === prInfo.number
      )
  );

  const prReview: PRReview = {
    id: makeId(data),
    prInfo,
    review,
    jiraTicket,
    meta,
    comments: review.concerns.map((concern, i) => ({
      id: makeId(data),
      prInfo,
      concern,
      snippet: snippets?.get(i),
      status: "pending",
    })),
    reviewedAt: new Date().toISOString(),
  };

  data.reviews.unshift(prReview);
  saveStore(data);
  return prReview;
}

export function getReviews(): PRReview[] {
  return loadStore().reviews;
}

export function getComment(commentId: string): PendingComment | undefined {
  const data = loadStore();
  for (const review of data.reviews) {
    const comment = review.comments.find((c) => c.id === commentId);
    if (comment) return comment;
  }
  return undefined;
}

export function updateCommentStatus(
  commentId: string,
  status: "approved" | "rejected",
  postedMessage?: string
): PendingComment | undefined {
  const data = loadStore();
  for (const review of data.reviews) {
    const comment = review.comments.find((c) => c.id === commentId);
    if (comment) {
      comment.status = status;
      if (status === "approved") comment.approvedAt = new Date().toISOString();
      if (status === "rejected") comment.rejectedAt = new Date().toISOString();
      if (postedMessage) comment.concern.message = postedMessage;
      saveStore(data);
      return comment;
    }
  }
  return undefined;
}

export function addQA(
  commentId: string,
  question: string,
  answer: string
): void {
  const data = loadStore();
  for (const review of data.reviews) {
    const comment = review.comments.find((c) => c.id === commentId);
    if (comment) {
      if (!comment.qa) comment.qa = [];
      comment.qa.push({ question, answer, askedAt: new Date().toISOString() });
      saveStore(data);
      return;
    }
  }
}

export function getPendingCount(): number {
  return loadStore().reviews.reduce(
    (sum, r) => sum + r.comments.filter((c) => c.status === "pending").length,
    0
  );
}

/**
 * Remove reviews for PRs that are no longer open.
 * Pass the set of currently open PR keys ("owner/repo#number").
 */
export function pruneClosedPRs(openPRKeys: Set<string>): number {
  const data = loadStore();
  const before = data.reviews.length;
  data.reviews = data.reviews.filter((r) => {
    const key = `${r.prInfo.owner}/${r.prInfo.repo}#${r.prInfo.number}`;
    return openPRKeys.has(key);
  });
  const removed = before - data.reviews.length;
  if (removed > 0) {
    saveStore(data);
  }
  return removed;
}
