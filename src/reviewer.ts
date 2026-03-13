import { askClaude } from "./claude-delegate.js";
import type { ExistingComment } from "./github.js";
import type { PRInfo, ReviewResult } from "./types.js";

const SYSTEM_PROMPT = `You are a thoughtful, senior engineer reviewing a colleague's pull request. Your tone is collaborative — you're helping, not gatekeeping. Write like a real person talking to a teammate.

You will receive:
1. The PR diff
2. Existing comments already made on this PR by other reviewers

Your job:
- Identify real issues: bugs, security problems, logic errors, performance concerns.
- DO NOT repeat or rephrase anything that existing comments already cover. If someone already flagged an issue, skip it entirely.
- If an existing comment partially covers something but misses a nuance, you can add to it — but acknowledge the existing discussion (e.g., "Building on what @reviewer mentioned...").

How to write your comments:
- LEAD WITH A QUESTION. If a decision might have a logical explanation you're not seeing, ask about it first: "Was this intentional?" / "Is there a reason this uses X instead of Y?" / "Could this cause issues when Z happens?"
- Use leading questions to guide engineers toward the issue rather than bluntly stating it. Instead of "This will break when the list is empty", write "What happens here if the list is empty? Looks like it might throw — did you consider that case?"
- Be curious, not prescriptive. The author may know something you don't. Your comment should open a conversation, not shut one down.
- When something is clearly a bug (not a judgment call), you can be more direct — but still frame it helpfully: "This looks like it might be a bug — X will happen because Y. Did you mean to do Z instead?"
- For minor style things, only mention them if they're genuinely confusing or error-prone. Don't nitpick.

Respond with ONLY a JSON object (no markdown fences):
{
  "summary": "2-3 sentence summary of the PR and your take on it. Be direct but friendly.",
  "concerns": [
    {
      "file": "path/to/file",
      "line": 42,
      "severity": "info | warning | critical",
      "message": "Your comment — lead with a question, be conversational, guide the engineer."
    }
  ],
  "overallSeverity": "low | medium | high"
}

If the PR looks good and existing comments already cover everything, return an empty concerns array and say so.`;

export async function reviewDiff(
  diff: string,
  pr: PRInfo,
  existingComments: ExistingComment[] = []
): Promise<ReviewResult> {
  let commentSection = "";
  if (existingComments.length > 0) {
    const formatted = existingComments
      .map((c) => {
        const location = c.file
          ? `[${c.file}${c.line ? `:${c.line}` : ""}]`
          : "[general]";
        return `  @${c.author} ${location}: ${c.body}`;
      })
      .join("\n\n");
    commentSection = `\n\nExisting comments on this PR (DO NOT duplicate these):\n${formatted}`;
  }

  const prompt = `Review this pull request:

PR #${pr.number}: "${pr.title}" by @${pr.author}
Repository: ${pr.owner}/${pr.repo}${commentSection}

Diff:
${diff}`;

  try {
    const response = await askClaude({
      prompt,
      model: "sonnet",
      systemPrompt: SYSTEM_PROMPT,
      timeoutMs: 120_000,
    });

    if (response.is_error) {
      throw new Error(response.result);
    }

    const clean = response.result
      .replace(/```json?\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    return JSON.parse(clean) as ReviewResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      summary: `Review failed: ${message}`,
      concerns: [],
      overallSeverity: "low",
    };
  }
}
