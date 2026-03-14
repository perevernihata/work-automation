import { useState, useRef, useCallback } from "react";
import type { PendingComment, PRInfo } from "../types";
import {
  approveComment,
  rejectComment,
  askQuestion,
} from "../api";
import { getHashSync } from "../utils";

interface Props {
  comment: PendingComment;
  pr: PRInfo;
  onAction: () => Promise<void>;
  openSnippets: Set<string>;
  openEditors: Set<string>;
  openAsks: Set<string>;
  onToggleSnippet: (id: string) => void;
  onToggleEditor: (id: string) => void;
  onToggleAsk: (id: string) => void;
}

function escCode(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildFileLink(pr: PRInfo, concern: PendingComment["concern"]): string {
  const hash = getHashSync(concern.file);
  const anchor = hash
    ? `#diff-${hash}` + (concern.line ? `R${concern.line}` : "")
    : "";
  return `${pr.url}/files${anchor}`;
}

export function Concern({
  comment,
  pr,
  onAction,
  openSnippets,
  openEditors,
  openAsks,
  onToggleSnippet,
  onToggleEditor,
  onToggleAsk,
}: Props) {
  const c = comment.concern;
  const fileLink = buildFileLink(pr, c);
  const location = c.line ? `${c.file}:${c.line}` : c.file;
  const hasSnippet =
    comment.snippet &&
    comment.snippet.lines &&
    comment.snippet.lines.length > 0;
  const isSnippetOpen = openSnippets.has(comment.id);
  const editorOpen = openEditors.has(comment.id);
  const hasQA = comment.qa && comment.qa.length > 0;
  const askOpen = openAsks.has(comment.id) || !!hasQA;

  const [editText, setEditText] = useState(c.message);
  const [askLoading, setAskLoading] = useState(false);
  const [askResult, setAskResult] = useState<{
    error?: string;
    answer?: string;
  } | null>(null);
  const askInputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const handleApprove = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      try {
        const resp = await approveComment(comment.id);
        if (resp.error) {
          alert("Error: " + resp.error);
          return;
        }
        await onAction();
      } catch (err) {
        alert("Failed: " + (err as Error).message);
      }
    },
    [comment.id, onAction]
  );

  const handleReject = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      try {
        const resp = await rejectComment(comment.id);
        if (resp.error) {
          alert("Error: " + resp.error);
          return;
        }
        await onAction();
      } catch (err) {
        alert("Failed: " + (err as Error).message);
      }
    },
    [comment.id, onAction]
  );

  const handleApproveEdited = useCallback(async () => {
    const body = editText.trim();
    if (!body) {
      alert("Comment is empty");
      return;
    }
    try {
      const resp = await approveComment(comment.id, body);
      if (resp.error) {
        alert("Error: " + resp.error);
        return;
      }
      onToggleEditor(comment.id);
      await onAction();
    } catch (err) {
      alert("Failed: " + (err as Error).message);
    }
  }, [comment.id, editText, onAction, onToggleEditor]);

  const handleSendAsk = useCallback(async () => {
    const input = askInputRef.current;
    if (!input) return;
    const question = input.value.trim();
    if (!question) return;

    setAskLoading(true);
    setAskResult(null);
    input.value = "";

    try {
      const result = await askQuestion(comment.id, question);
      if (result.error) {
        setAskResult({ error: result.error });
      } else {
        setAskResult(null);
        // Ensure ask stays open, reload data
        if (!openAsks.has(comment.id)) {
          onToggleAsk(comment.id);
        }
        await onAction();
      }
    } catch (err) {
      setAskResult({ error: (err as Error).message });
    } finally {
      setAskLoading(false);
    }
  }, [comment.id, onAction, openAsks, onToggleAsk]);

  const handleAskKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSendAsk();
      }
    },
    [handleSendAsk]
  );

  const handleToggleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleEditor(comment.id);
      // Focus textarea after opening
      setTimeout(() => editRef.current?.focus(), 0);
    },
    [comment.id, onToggleEditor]
  );

  const handleToggleAsk = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleAsk(comment.id);
      setTimeout(() => askInputRef.current?.focus(), 0);
    },
    [comment.id, onToggleAsk]
  );

  const handleCancelEdit = useCallback(() => {
    onToggleEditor(comment.id);
  }, [comment.id, onToggleEditor]);

  // Actions
  let actions;
  if (comment.status === "pending") {
    actions = (
      <>
        <button className="btn btn-ask" onClick={handleToggleAsk}>
          Ask
        </button>
        <button className="btn btn-edit" onClick={handleToggleEdit}>
          Edit
        </button>
        <button className="btn btn-approve" onClick={handleApprove}>
          Approve
        </button>
        <button className="btn btn-reject" onClick={handleReject}>
          Reject
        </button>
      </>
    );
  } else if (comment.status === "approved") {
    actions = (
      <>
        <button className="btn btn-ask" onClick={handleToggleAsk}>
          Ask
        </button>
        <span className="status-approved">Posted</span>
      </>
    );
  } else {
    actions = (
      <>
        <button className="btn btn-ask" onClick={handleToggleAsk}>
          Ask
        </button>
        <span className="status-rejected">Dismissed</span>
      </>
    );
  }

  // Snippet
  const snippetEl =
    hasSnippet && comment.snippet ? (
      <div
        className={`snippet ${isSnippetOpen ? "open" : ""}`}
      >
        {comment.snippet.lines.map((l, i) => {
          const isTarget = c.line != null && l.num === c.line;
          const cls = [
            "snippet-line",
            l.type === "add" ? "add" : l.type === "del" ? "del" : "",
            isTarget ? "highlight" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const marker =
            l.type === "add" ? "+" : l.type === "del" ? "-" : "\u00A0";
          const num = l.num != null ? l.num : "";

          return (
            <div className={cls} key={i}>
              <span className="snippet-num">{num}</span>
              <span className="snippet-marker">{marker}</span>
              <span
                className="snippet-text"
                dangerouslySetInnerHTML={{ __html: escCode(l.text) }}
              />
            </div>
          );
        })}
        <a
          className="snippet-link"
          href={fileLink}
          target="_blank"
          rel="noreferrer"
        >
          Open in GitHub
        </a>
      </div>
    ) : null;

  // QA history
  const qaHistory =
    comment.qa && comment.qa.length > 0
      ? comment.qa.map((entry, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 12,
                color: "var(--accent)",
                fontWeight: 500,
                marginBottom: 4,
              }}
            >
              Q: {entry.question}
            </div>
            <div className="ask-answer">{entry.answer}</div>
          </div>
        ))
      : null;

  return (
    <div className="concern">
      <div
        className="concern-row"
        onClick={
          hasSnippet ? () => onToggleSnippet(comment.id) : undefined
        }
      >
        <div className={`concern-severity ${c.severity}`} />
        <div className="concern-body">
          <div className="concern-file-row">
            {hasSnippet && (
              <span
                className={`concern-toggle ${isSnippetOpen ? "open" : ""}`}
              >
                &#9654;
              </span>
            )}
            <a
              className="concern-file"
              href={fileLink}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {location}
            </a>
          </div>
          <div className="concern-message">{c.message}</div>
        </div>
        <div className="concern-actions">{actions}</div>
      </div>

      {/* Edit area */}
      <div className={`edit-area ${editorOpen ? "open" : ""}`}>
        <textarea
          className="edit-textarea"
          ref={editRef}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
        />
        <div className="edit-actions">
          <button className="btn" onClick={handleCancelEdit}>
            Cancel
          </button>
          <button className="btn btn-approve" onClick={handleApproveEdited}>
            Post edited
          </button>
        </div>
      </div>

      {/* Ask area */}
      <div className={`ask-area ${askOpen ? "open" : ""}`}>
        {qaHistory}
        <div className="ask-input-row">
          <input
            className="ask-input"
            ref={askInputRef}
            placeholder="Ask a follow-up question about this comment..."
            onKeyDown={handleAskKeyDown}
          />
          <button className="btn btn-ask-send" onClick={handleSendAsk}>
            Send
          </button>
        </div>
        <div>
          {askLoading && (
            <div className="ask-loading">
              <span className="spinner" /> Thinking...
            </div>
          )}
          {askResult?.error && (
            <div
              className="ask-answer"
              style={{
                borderColor: "var(--red)",
                background: "rgba(248,81,73,0.06)",
                marginTop: 10,
              }}
            >
              Error: {askResult.error}
            </div>
          )}
        </div>
      </div>

      {/* Snippet */}
      {snippetEl}
    </div>
  );
}
