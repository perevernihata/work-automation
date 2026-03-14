import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  getReviews,
  updateCommentStatus,
  getComment,
  getPendingCount,
  addQA,
  type PendingComment,
} from "./store.js";
import { askClaude } from "./claude-delegate.js";
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

  // API: approve a comment — posts it to GitHub (optionally with edited body)
  app.post("/api/comments/:id/approve", async (c) => {
    const { id } = c.req.param();
    const comment = getComment(id);
    if (!comment) return c.json({ error: "Comment not found" }, 404);
    if (comment.status !== "pending")
      return c.json({ error: `Already ${comment.status}` }, 400);

    // Allow overriding the comment body
    let bodyOverride: string | undefined;
    try {
      const json = await c.req.json();
      if (json.body && typeof json.body === "string") {
        bodyOverride = json.body;
      }
    } catch {
      // No body sent — use default
    }

    try {
      if (bodyOverride) {
        // Post with edited text
        const { concern, prInfo } = comment;
        await postInlineComment(config, prInfo, bodyOverride, concern.file, concern.line);
        updateCommentStatus(id, "approved", bodyOverride);
      } else {
        await postComment(config, comment);
      }
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

  // API: ask a follow-up question about a comment
  app.post("/api/comments/:id/ask", async (c) => {
    const { id } = c.req.param();
    const comment = getComment(id);
    if (!comment) return c.json({ error: "Comment not found" }, 404);

    let question: string;
    try {
      const json = await c.req.json();
      question = json.question;
      if (!question || typeof question !== "string") {
        return c.json({ error: "question is required" }, 400);
      }
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    const { concern, prInfo } = comment;
    const snippetText = comment.snippet?.lines
      ?.map((l) => {
        const marker = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
        const num = l.num != null ? String(l.num).padStart(4) : "    ";
        return `${num} ${marker} ${l.text}`;
      })
      .join("\n") ?? "";

    // Find the local repo path for codebase access
    const repoConfig = config.repos.find(
      (r) => r.owner === prInfo.owner && r.repo === prInfo.repo
    );

    const prompt = `I'm reviewing PR #${prInfo.number}: "${prInfo.title}" in ${prInfo.owner}/${prInfo.repo}.

A reviewer left this comment on ${concern.file}${concern.line ? `:${concern.line}` : ""}:

"${concern.message}"

${snippetText ? `Code context:\n\`\`\`\n${snippetText}\n\`\`\`` : ""}

My follow-up question: ${question}

Answer concisely. If you need to look at the codebase to answer, use the Read/Glob/Grep tools.`;

    try {
      const response = await askClaude({
        prompt,
        model: "sonnet",
        systemPrompt: "You are a helpful senior engineer answering follow-up questions about a code review comment. Be concise and specific. If the question is about where information came from, explain your reasoning and cite specific files or documentation.",
        timeoutMs: 120_000,
        addDirs: repoConfig?.localPath ? [repoConfig.localPath] : undefined,
        allowedTools: ["Read", "Glob", "Grep"],
      });

      if (response.is_error) {
        return c.json({ error: response.result }, 500);
      }

      addQA(id, question, response.result);
      return c.json({ answer: response.result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
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
