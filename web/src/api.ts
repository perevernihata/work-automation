import type { ReviewsResponse, DaemonStatus } from "./types";

export async function fetchReviews(): Promise<ReviewsResponse> {
  const resp = await fetch("/api/reviews");
  return resp.json();
}

export async function fetchStatus(): Promise<DaemonStatus> {
  const resp = await fetch("/api/status");
  return resp.json();
}

export async function triggerScan(): Promise<{ message?: string }> {
  const resp = await fetch("/api/scan", { method: "POST" });
  return resp.json();
}

export async function approveComment(
  id: string,
  body?: string
): Promise<{ success?: boolean; error?: string }> {
  const resp = await fetch(`/api/comments/${id}/approve`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify({ body }) : undefined,
  });
  return resp.json();
}

export async function rejectComment(
  id: string
): Promise<{ success?: boolean; error?: string }> {
  const resp = await fetch(`/api/comments/${id}/reject`, { method: "POST" });
  return resp.json();
}

export async function approveAllComments(
  reviewId: string
): Promise<{ success?: boolean; errors?: string[] }> {
  const resp = await fetch(`/api/reviews/${reviewId}/approve-all`, {
    method: "POST",
  });
  return resp.json();
}

export async function askQuestion(
  id: string,
  question: string
): Promise<{ answer?: string; error?: string }> {
  const resp = await fetch(`/api/comments/${id}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  return resp.json();
}
