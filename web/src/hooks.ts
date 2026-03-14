import { useState, useEffect, useCallback, useRef } from "react";
import type { PRReview, ReviewsResponse, DaemonStatus } from "./types";
import { fetchReviews, fetchStatus } from "./api";
import { precomputeHashes } from "./utils";

// ── useReviews: poll reviews every 10s ──
export function useReviews() {
  const [data, setData] = useState<ReviewsResponse>({
    reviews: [],
    pendingCount: 0,
  });

  const reload = useCallback(async () => {
    try {
      const resp = await fetchReviews();
      // Precompute hashes for all files
      const files = new Set<string>();
      for (const r of resp.reviews) {
        for (const c of r.comments) {
          files.add(c.concern.file);
        }
      }
      await precomputeHashes([...files]);
      setData(resp);
    } catch (e) {
      console.error("Failed to load reviews:", e);
    }
  }, []);

  useEffect(() => {
    reload();
    const interval = setInterval(reload, 10_000);
    return () => clearInterval(interval);
  }, [reload]);

  return { data, reload };
}

// ── useStatus: poll daemon status every 2s ──
export function useStatus() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const s = await fetchStatus();
        setStatus(s);
      } catch {
        // ignore
      }
    };
    load();
    const interval = setInterval(load, 2_000);
    return () => clearInterval(interval);
  }, []);

  return status;
}

// ── useUrlState: hash-based state for repo + pr ──
export function useUrlState() {
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const initialized = useRef(false);

  // Restore from URL on mount
  useEffect(() => {
    const hash = location.hash.slice(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      const repo = params.get("repo");
      const pr = params.get("pr");
      if (repo) setActiveRepo(repo);
      if (pr) setSelectedReviewId(pr);
    }
    initialized.current = true;
  }, []);

  // Save to URL whenever state changes
  useEffect(() => {
    if (!initialized.current) return;
    const parts: string[] = [];
    if (activeRepo) parts.push(`repo=${encodeURIComponent(activeRepo)}`);
    if (selectedReviewId) parts.push(`pr=${selectedReviewId}`);
    history.replaceState(
      null,
      "",
      parts.length ? `#${parts.join("&")}` : location.pathname
    );
  }, [activeRepo, selectedReviewId]);

  return { activeRepo, setActiveRepo, selectedReviewId, setSelectedReviewId };
}

// ── Sorting logic ──
const severityWeight: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function sortReviews(reviews: PRReview[]): PRReview[] {
  return [...reviews].sort((a, b) => {
    const aPending = a.comments.filter((c) => c.status === "pending").length;
    const bPending = b.comments.filter((c) => c.status === "pending").length;
    if (aPending === 0 && bPending > 0) return 1;
    if (bPending === 0 && aPending > 0) return -1;
    const aSev = severityWeight[a.review.overallSeverity] || 0;
    const bSev = severityWeight[b.review.overallSeverity] || 0;
    if (aSev !== bSev) return bSev - aSev;
    return bPending - aPending;
  });
}
