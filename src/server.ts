import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  getReviews,
  updateCommentStatus,
  getComment,
  getPendingCount,
  type PendingComment,
} from "./store.js";
import { postInlineComment } from "./github.js";
import type { AppConfig } from "./types.js";

function formatCommentBody(comment: PendingComment): string {
  const { concern } = comment;
  // Just post the message directly — it's already written in a human tone by the reviewer prompt
  return concern.message;
}

async function postComment(
  config: AppConfig,
  comment: PendingComment
): Promise<void> {
  const body = formatCommentBody(comment);
  const { concern, prInfo } = comment;
  await postInlineComment(config, prInfo, body, concern.file, concern.line);
  updateCommentStatus(comment.id, "approved");
}

export function createServer(config: AppConfig) {
  const app = new Hono();

  // Serve static frontend
  app.use("/static/*", serveStatic({ root: "./" }));

  // API: list all reviews
  app.get("/api/reviews", (c) => {
    return c.json({
      reviews: getReviews(),
      pendingCount: getPendingCount(),
    });
  });

  // API: approve a comment — posts it to GitHub
  app.post("/api/comments/:id/approve", async (c) => {
    const { id } = c.req.param();
    const comment = getComment(id);
    if (!comment) return c.json({ error: "Comment not found" }, 404);
    if (comment.status !== "pending")
      return c.json({ error: `Already ${comment.status}` }, 400);

    try {
      await postComment(config, comment);
      return c.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  // API: reject a comment
  app.post("/api/comments/:id/reject", async (c) => {
    const { id } = c.req.param();
    const comment = getComment(id);
    if (!comment) return c.json({ error: "Comment not found" }, 404);
    if (comment.status !== "pending")
      return c.json({ error: `Already ${comment.status}` }, 400);

    updateCommentStatus(id, "rejected");
    return c.json({ success: true });
  });

  // API: approve all pending comments for a review
  app.post("/api/reviews/:id/approve-all", async (c) => {
    const { id } = c.req.param();
    const reviews = getReviews();
    const review = reviews.find((r) => r.id === id);
    if (!review) return c.json({ error: "Review not found" }, 404);

    const pending = review.comments.filter((co) => co.status === "pending");
    const errors: string[] = [];

    for (const comment of pending) {
      try {
        await postComment(config, comment);
      } catch (err) {
        errors.push(
          `Comment ${comment.id}: ${err instanceof Error ? err.message : err}`
        );
      }
    }

    if (errors.length > 0) return c.json({ errors }, 207);
    return c.json({ success: true });
  });

  // Serve the main HTML page
  app.get("/", async (c) => {
    const fs = await import("node:fs/promises");
    const html = await fs.readFile("static/index.html", "utf-8");
    return c.html(html);
  });

  return app;
}

export function startServer(config: AppConfig, port = 3847) {
  const app = createServer(config);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`  Dashboard: http://localhost:${port}`);
  });
}
