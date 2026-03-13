export interface RepoConfig {
  owner: string;
  repo: string;
}

export interface AppConfig {
  repos: RepoConfig[];
  pollIntervalMs: number;
  stateFilePath: string;
  githubToken: string;
}

export interface PRInfo {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  headSha: string;
  updatedAt: string;
  url: string;
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

export type ReviewState = Record<
  string,
  { lastReviewedSha: string; lastReviewedAt: string }
>;
