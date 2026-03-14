import { useCallback } from "react";
import type { PRReview } from "../types";
import { approveAllComments, rejectComment } from "../api";
import { Concern } from "./Concern";

interface Props {
  review: PRReview;
  onAction: () => Promise<void>;
  openSnippets: Set<string>;
  openEditors: Set<string>;
  openAsks: Set<string>;
  onToggleSnippet: (id: string) => void;
  onToggleEditor: (id: string) => void;
  onToggleAsk: (id: string) => void;
}

export function Detail({
  review,
  onAction,
  openSnippets,
  openEditors,
  openAsks,
  onToggleSnippet,
  onToggleEditor,
  onToggleAsk,
}: Props) {
  const pr = review.prInfo;
  const pending = review.comments.filter((c) => c.status === "pending");

  const handleApproveAll = useCallback(async () => {
    try {
      await approveAllComments(review.id);
      await onAction();
    } catch (e) {
      alert("Failed: " + (e as Error).message);
    }
  }, [review.id, onAction]);

  const handleDismissAll = useCallback(async () => {
    const pendingComments = review.comments.filter(
      (c) => c.status === "pending"
    );
    for (const c of pendingComments) {
      await rejectComment(c.id);
    }
    await onAction();
  }, [review, onAction]);

  // Bulk actions
  let bulkActions = null;
  if (pending.length > 1) {
    bulkActions = (
      <>
        <button className="btn btn-approve-all" onClick={handleApproveAll}>
          Approve all ({pending.length})
        </button>
        <button className="btn btn-dismiss-all" onClick={handleDismissAll}>
          Dismiss all
        </button>
      </>
    );
  } else if (pending.length === 1) {
    bulkActions = (
      <>
        <button className="btn btn-approve-all" onClick={handleApproveAll}>
          Approve
        </button>
        <button className="btn btn-dismiss-all" onClick={handleDismissAll}>
          Dismiss
        </button>
      </>
    );
  }

  // Jira
  const jt = review.jiraTicket;
  let jiraHtml;
  if (jt) {
    jiraHtml = (
      <div className="jira-bar">
        <a className="jira-key" href={jt.url} target="_blank" rel="noreferrer">
          {jt.key}
        </a>
        <span className="jira-summary">{jt.summary}</span>
        <span className="jira-status">{jt.status}</span>
        <span
          style={{ color: "var(--text-dim)", fontSize: 11 }}
        >{`${jt.type} \u00B7 ${jt.priority} \u00B7 ${jt.assignee}`}</span>
      </div>
    );
  } else {
    jiraHtml = (
      <div className="jira-missing">
        No Jira ticket linked &mdash; PR title doesn&apos;t contain a
        recognizable ticket key
      </div>
    );
  }

  // Review meta
  const m = review.meta;
  let metaHtml = null;
  if (m) {
    const duration =
      m.durationMs < 60000
        ? `${(m.durationMs / 1000).toFixed(1)}s`
        : `${(m.durationMs / 60000).toFixed(1)}m`;
    const tokens = m.inputTokens + m.outputTokens;
    const tokensStr =
      tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
    const browsed = m.numTurns > 1;

    metaHtml = (
      <div className="review-meta">
        <div className="meta-item">
          <span className="meta-label">Duration:</span>
          <span className="meta-value">{duration}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Turns:</span>
          <span className="meta-value">{m.numTurns}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Tokens:</span>
          <span className="meta-value">{tokensStr}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Cost:</span>
          <span className="meta-value">${m.costUsd.toFixed(3)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Codebase:</span>
          <span className="meta-value">
            {browsed ? "Yes \u2014 browsed files" : "Diff only"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="detail-header">
        <div>
          <div className="detail-title">
            <a href={pr.url} target="_blank" rel="noreferrer">
              #{pr.number}: {pr.title}
            </a>
          </div>
          <div className="detail-meta">
            {pr.owner}/{pr.repo} &middot; by @{pr.author} &middot;{" "}
            <span
              className={`severity-badge severity-${review.review.overallSeverity}`}
            >
              {review.review.overallSeverity}
            </span>{" "}
            &middot; {review.comments.length} concern
            {review.comments.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div className="detail-actions">{bulkActions}</div>
      </div>
      {jiraHtml}
      {metaHtml}
      <div className="detail-summary">{review.review.summary}</div>
      <div className="concern-list">
        {review.comments.map((comment) => (
          <Concern
            key={comment.id}
            comment={comment}
            pr={pr}
            onAction={onAction}
            openSnippets={openSnippets}
            openEditors={openEditors}
            openAsks={openAsks}
            onToggleSnippet={onToggleSnippet}
            onToggleEditor={onToggleEditor}
            onToggleAsk={onToggleAsk}
          />
        ))}
      </div>
    </>
  );
}
