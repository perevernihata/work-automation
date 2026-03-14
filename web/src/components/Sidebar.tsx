import { useCallback, useState } from "react";
import type { PRReview, ReviewsResponse, DaemonStatus } from "../types";
import { triggerScan } from "../api";
import { sortReviews } from "../hooks";
import { DaemonFooter } from "./DaemonFooter";

interface Props {
  data: ReviewsResponse;
  activeRepo: string | null;
  selectedReviewId: string | null;
  focusedIndex: number;
  status: DaemonStatus | null;
  onSelectReview: (id: string) => void;
  onSetRepo: (repo: string | null) => void;
  onScanComplete: () => Promise<void>;
}

export function Sidebar({
  data,
  activeRepo,
  selectedReviewId,
  focusedIndex,
  status,
  onSelectReview,
  onSetRepo,
  onScanComplete,
}: Props) {
  const [scanning, setScanning] = useState(false);
  const [statusText, setStatusText] = useState("");

  const handleScan = useCallback(async () => {
    setScanning(true);
    setStatusText("");
    try {
      const result = await triggerScan();
      setStatusText(result.message || "Done");
      await onScanComplete();
    } catch {
      setStatusText("Scan failed");
    } finally {
      setScanning(false);
      setTimeout(() => setStatusText(""), 5000);
    }
  }, [onScanComplete]);

  // Get repos
  const repoMap = new Map<string, number>();
  for (const r of data.reviews) {
    const key = `${r.prInfo.owner}/${r.prInfo.repo}`;
    repoMap.set(key, (repoMap.get(key) || 0) + 1);
  }

  // Filter reviews
  const filtered = activeRepo
    ? data.reviews.filter(
        (r) => `${r.prInfo.owner}/${r.prInfo.repo}` === activeRepo
      )
    : data.reviews;
  const sorted = sortReviews(filtered);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>PR Reviews</h1>
        <div className="sidebar-controls">
          <div className="status-bar">
            {scanning && (
              <>
                <span className="spinner" /> Scanning...
              </>
            )}
            {!scanning && statusText}
          </div>
          <span className="badge">{data.pendingCount}</span>
          <button
            className="scan-btn"
            onClick={handleScan}
            disabled={scanning}
          >
            Scan
          </button>
        </div>
      </div>

      {/* Repo tabs */}
      {repoMap.size > 1 && (
        <div className="repo-tabs">
          <button
            className={`repo-tab ${activeRepo === null ? "active" : ""}`}
            onClick={() => onSetRepo(null)}
          >
            All
            <span className="tab-count">
              {data.reviews.length} PRs &middot; {data.pendingCount} pending
            </span>
          </button>
          {[...repoMap.entries()].map(([repo]) => {
            const repoReviews = data.reviews.filter(
              (r) => `${r.prInfo.owner}/${r.prInfo.repo}` === repo
            );
            const pending = repoReviews.reduce(
              (s, r) =>
                s + r.comments.filter((c) => c.status === "pending").length,
              0
            );
            const short = repo.split("/")[1] || repo;
            const isActive = activeRepo === repo;
            return (
              <button
                key={repo}
                className={`repo-tab ${isActive ? "active" : ""}`}
                onClick={() => onSetRepo(repo)}
              >
                {short}
                <span className="tab-count">
                  {repoReviews.length} PRs
                  {pending ? ` \u00B7 ${pending} pending` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* PR list */}
      <div className="pr-list">
        {sorted.length === 0 ? (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              color: "var(--text-dim)",
              fontSize: 13,
            }}
          >
            No reviews yet. Click Scan or wait for the poller.
          </div>
        ) : (
          sorted.map((review: PRReview, i: number) => {
            const pr = review.prInfo;
            const pendingCount = review.comments.filter(
              (c) => c.status === "pending"
            ).length;
            const doneCount = review.comments.filter(
              (c) => c.status !== "pending"
            ).length;
            const critical = review.comments.filter(
              (c) => c.concern.severity === "critical" && c.status === "pending"
            ).length;
            const warnings = review.comments.filter(
              (c) => c.concern.severity === "warning" && c.status === "pending"
            ).length;
            const isActive = review.id === selectedReviewId;
            const isFocused = i === focusedIndex;

            return (
              <div
                key={review.id}
                className={`pr-item ${isActive ? "active" : ""}`}
                onClick={() => onSelectReview(review.id)}
                style={
                  isFocused && !isActive
                    ? { background: "rgba(88,166,255,0.03)" }
                    : undefined
                }
              >
                <div className="pr-item-title">
                  <span
                    className={`severity-dot ${review.review.overallSeverity}`}
                  />
                  #{pr.number}: {pr.title}
                </div>
                <div className="pr-item-meta">
                  {!activeRepo && <span>{pr.repo}</span>}
                  <span>@{pr.author}</span>
                  {review.jiraTicket && (
                    <span className="pr-item-jira">{review.jiraTicket.key}</span>
                  )}
                </div>
                <div className="pr-item-stats">
                  {critical > 0 && (
                    <span className="stat-chip critical">
                      {critical} critical
                    </span>
                  )}
                  {warnings > 0 && (
                    <span className="stat-chip warning">
                      {warnings} warning
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <span className="stat-chip pending">
                      {pendingCount} pending
                    </span>
                  )}
                  {doneCount > 0 && (
                    <span className="stat-chip done">
                      {doneCount} handled
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <DaemonFooter status={status} />
    </div>
  );
}
