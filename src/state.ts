import { readFileSync, writeFileSync } from "node:fs";
import type { PRInfo, ReviewState } from "./types.js";

export function loadState(filePath: string): ReviewState {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ReviewState;
  } catch {
    return {};
  }
}

export function saveState(filePath: string, state: ReviewState): void {
  writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n");
}

function stateKey(pr: PRInfo): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`;
}

export function needsReview(state: ReviewState, pr: PRInfo): boolean {
  const entry = state[stateKey(pr)];
  if (!entry) return true;
  return entry.lastReviewedSha !== pr.headSha;
}

export function markReviewed(state: ReviewState, pr: PRInfo): void {
  state[stateKey(pr)] = {
    lastReviewedSha: pr.headSha,
    lastReviewedAt: new Date().toISOString(),
  };
}
