export interface DaemonStatus {
  state: "idle" | "scanning" | "reviewing";
  /** Currently reviewing this PR, if any */
  currentPR?: { number: number; title: string; repo: string };
  /** Progress in current scan cycle */
  progress?: { current: number; total: number; succeeded: number; failed: number };
  /** Number of PRs that will be retried */
  retryCount: number;
  /** When the next poll will happen */
  nextPollAt?: string;
  /** Last completed scan */
  lastScanAt?: string;
  lastScanReviewed?: number;
}

const status: DaemonStatus = {
  state: "idle",
  retryCount: 0,
};

export function getStatus(): DaemonStatus {
  return { ...status };
}

export function setIdle(retryCount: number, nextPollAt?: Date) {
  status.state = "idle";
  status.currentPR = undefined;
  status.progress = undefined;
  status.retryCount = retryCount;
  if (nextPollAt) status.nextPollAt = nextPollAt.toISOString();
}

export function setScanning() {
  status.state = "scanning";
  status.currentPR = undefined;
  status.progress = undefined;
}

export function setReviewing(
  pr: { number: number; title: string; repo: string },
  current: number,
  total: number,
  succeeded: number,
  failed: number
) {
  status.state = "reviewing";
  status.currentPR = pr;
  status.progress = { current, total, succeeded, failed };
}

export function setLastScan(reviewed: number) {
  status.lastScanAt = new Date().toISOString();
  status.lastScanReviewed = reviewed;
}
