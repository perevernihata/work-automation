export interface PRInfo {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  headSha: string;
  updatedAt: string;
  url: string;
  changedLines: number;
}

export interface Concern {
  file: string;
  line?: number;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface ReviewResult {
  summary: string;
  concerns: Concern[];
  overallSeverity: "low" | "medium" | "high";
}

export interface SnippetLine {
  num: number | null;
  text: string;
  type: "add" | "del" | "ctx";
}

export interface CodeSnippet {
  lines: SnippetLine[];
  startLine: number;
  endLine: number;
}

export interface QAEntry {
  question: string;
  answer: string;
  askedAt: string;
}

export interface ReviewMeta {
  durationMs: number;
  numTurns: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

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

export interface ReviewsResponse {
  reviews: PRReview[];
  pendingCount: number;
}

export interface DaemonStatus {
  state: "idle" | "scanning" | "reviewing";
  nextPollAt?: string;
  currentPR?: { number: number; title: string };
  progress?: { current: number; total: number; succeeded?: number; failed?: number };
  retryCount?: number;
  lastScanAt?: string;
  lastScanReviewed?: number;
}
