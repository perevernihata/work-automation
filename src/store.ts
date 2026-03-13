import type { CodeSnippet } from "./diff-parser.js";
import type { JiraTicket } from "./jira.js";
import type { PRInfo, ReviewResult, Concern } from "./types.js";

export interface PendingComment {
  id: string;
  prInfo: PRInfo;
  concern: Concern;
  snippet?: CodeSnippet;
  status: "pending" | "approved" | "rejected";
  approvedAt?: string;
  rejectedAt?: string;
}

export interface ReviewMeta {
  durationMs: number;
  numTurns: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
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

let reviews: PRReview[] = [];
let nextId = 1;

function makeId(): string {
  return String(nextId++);
}

export function addReview(
  prInfo: PRInfo,
  review: ReviewResult,
  snippets?: Map<number, CodeSnippet>,
  jiraTicket?: JiraTicket | null,
  meta?: ReviewMeta
): PRReview {
  // Remove existing review for same PR if present
  reviews = reviews.filter(
    (r) =>
      !(
        r.prInfo.owner === prInfo.owner &&
        r.prInfo.repo === prInfo.repo &&
        r.prInfo.number === prInfo.number
      )
  );

  const prReview: PRReview = {
    id: makeId(),
    prInfo,
    review,
    jiraTicket,
    meta,
    comments: review.concerns.map((concern, i) => ({
      id: makeId(),
      prInfo,
      concern,
      snippet: snippets?.get(i),
      status: "pending",
    })),
    reviewedAt: new Date().toISOString(),
  };

  reviews.unshift(prReview);
  return prReview;
}

export function getReviews(): PRReview[] {
  return reviews;
}

export function getComment(commentId: string): PendingComment | undefined {
  for (const review of reviews) {
    const comment = review.comments.find((c) => c.id === commentId);
    if (comment) return comment;
  }
  return undefined;
}

export function updateCommentStatus(
  commentId: string,
  status: "approved" | "rejected"
): PendingComment | undefined {
  const comment = getComment(commentId);
  if (!comment) return undefined;
  comment.status = status;
  if (status === "approved") comment.approvedAt = new Date().toISOString();
  if (status === "rejected") comment.rejectedAt = new Date().toISOString();
  return comment;
}

export function getPendingCount(): number {
  return reviews.reduce(
    (sum, r) => sum + r.comments.filter((c) => c.status === "pending").length,
    0
  );
}
