import { readFileSync, writeFileSync } from "node:fs";

const STATUS_PATH = "./daemon-status.json";

export interface DaemonStatus {
  state: "idle" | "scanning" | "reviewing";
  currentPR?: { number: number; title: string; repo: string };
  progress?: { current: number; total: number; succeeded: number; failed: number };
  retryCount: number;
  nextPollAt?: string;
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

export function loadDaemonStatus(): DaemonStatus {
  try {
    const raw = readFileSync(STATUS_PATH, "utf-8");
    return JSON.parse(raw) as DaemonStatus;
  } catch {
    return { state: "idle", retryCount: 0 };
  }
}

export function saveDaemonStatus(): void {
  writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2) + "\n");
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
