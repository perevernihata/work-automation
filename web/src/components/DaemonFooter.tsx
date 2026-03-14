import type { DaemonStatus } from "../types";

interface Props {
  status: DaemonStatus | null;
}

export function DaemonFooter({ status }: Props) {
  if (!status) return <div className="daemon-footer" />;

  const s = status;
  let label = "";
  const dotClass = s.state;

  if (s.state === "idle") {
    if (s.nextPollAt) {
      const diff = Math.max(
        0,
        Math.round((new Date(s.nextPollAt).getTime() - Date.now()) / 1000)
      );
      const min = Math.floor(diff / 60);
      const sec = diff % 60;
      label = `Idle \u2014 next scan in ${min}:${String(sec).padStart(2, "0")}`;
    } else {
      label = "Idle";
    }
  } else if (s.state === "scanning") {
    label = "Scanning for new PRs...";
  } else if (s.state === "reviewing" && s.currentPR) {
    label = `Reviewing #${s.currentPR.number}: ${s.currentPR.title}`;
  }

  let progressHtml = null;
  if (s.progress && s.state === "reviewing") {
    const pct = Math.round((s.progress.current / s.progress.total) * 100);
    progressHtml = (
      <div className="daemon-progress">
        <div className="daemon-progress-bar" style={{ width: `${pct}%` }} />
      </div>
    );
  }

  const metaParts: string[] = [];
  if (s.progress && s.state === "reviewing") {
    const p = s.progress;
    let parts = `${p.current}/${p.total}`;
    if (p.succeeded) parts += ` \u00B7 ${p.succeeded} done`;
    if (p.failed) parts += ` \u00B7 ${p.failed} failed`;
    metaParts.push(parts);
  }
  if (s.retryCount && s.retryCount > 0) {
    metaParts.push(`${s.retryCount} queued for retry`);
  }
  if (s.lastScanAt) {
    const ago = Math.round(
      (Date.now() - new Date(s.lastScanAt).getTime()) / 60000
    );
    const agoText = ago < 1 ? "just now" : `${ago}m ago`;
    metaParts.push(
      `last scan ${agoText} (${s.lastScanReviewed ?? 0} reviewed)`
    );
  }

  return (
    <div className="daemon-footer">
      <div className="daemon-state">
        <span className={`daemon-dot ${dotClass}`} />
        <span className="daemon-label">{label}</span>
      </div>
      {progressHtml}
      {metaParts.length > 0 && (
        <div className="daemon-meta">
          <span>{metaParts.join(" \u00B7 ")}</span>
        </div>
      )}
    </div>
  );
}
