import { askClaude, type ClaudeResponse } from "./claude-delegate.js";
import type { ExistingComment } from "./github.js";
import type { JiraTicket } from "./jira.js";
import type { ReviewMeta } from "./store.js";
import type { PRInfo, ReviewResult } from "./types.js";

export interface ReviewOutput {
  review: ReviewResult;
  meta?: ReviewMeta;
}

function extractMeta(response: ClaudeResponse): ReviewMeta {
  return {
    durationMs: response.duration_ms,
    numTurns: response.num_turns,
    costUsd: response.total_cost_usd,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

const SYSTEM_PROMPT = `You are a thoughtful, senior engineer reviewing a colleague's pull request. Your tone is collaborative — you're helping, not gatekeeping. Write like a real person talking to a teammate.

You will receive:
1. The PR diff
2. Existing comments already made on this PR by other reviewers
3. The linked Jira ticket (if found) — use this to understand the intent and acceptance criteria

You have access to the full codebase via the Read, Glob, and Grep tools. USE THEM when you need to:
- Understand how a changed function is called elsewhere
- Check if a pattern used in the diff is consistent with the rest of the codebase
- Look at related files, types, interfaces, or tests that aren't in the diff
- Verify imports, dependencies, or configuration
Don't just review the diff in isolation — look at the surrounding code when it matters.

Your job:
- Identify real issues: bugs, security problems, logic errors, performance concerns.
- Use the Jira ticket context to understand WHAT the PR is supposed to do. If the implementation doesn't match the ticket's requirements or acceptance criteria, flag it.
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
  "summary": "2-3 sentence summary of the PR and your take on it. Reference the Jira ticket context if relevant. Be direct but friendly.",
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
  existingComments: ExistingComment[] = [],
  jiraTicket?: JiraTicket | null,
  localRepoPath?: string
): Promise<ReviewOutput> {
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

  let jiraSection = "";
  if (jiraTicket) {
    jiraSection = `\n\nLinked Jira ticket: ${jiraTicket.key} — ${jiraTicket.summary}
Type: ${jiraTicket.type} | Status: ${jiraTicket.status} | Priority: ${jiraTicket.priority} | Assignee: ${jiraTicket.assignee}
Description: ${jiraTicket.description || "(no description)"}
URL: ${jiraTicket.url}`;
  } else {
    jiraSection = `\n\nNo Jira ticket linked to this PR. The PR title does not contain a recognizable ticket key.`;
  }

  let codebaseNote = "";
  if (localRepoPath) {
    codebaseNote = `\n\nThe full codebase is available at ${localRepoPath}. Use Read, Glob, and Grep to look up context when needed — don't guess about how code is used elsewhere.`;
  }

  const prompt = `Review this pull request:

PR #${pr.number}: "${pr.title}" by @${pr.author}
Repository: ${pr.owner}/${pr.repo}${jiraSection}${codebaseNote}${commentSection}

Diff:
${diff}`;

  // Give Claude read access to the codebase
  const addDirs: string[] = [];
  if (localRepoPath) {
    addDirs.push(localRepoPath);
  }

  try {
    const response = await askClaude({
      prompt,
      model: "sonnet",
      systemPrompt: SYSTEM_PROMPT,
      timeoutMs: 600_000, // 10 min — large diffs with codebase browsing take time
      addDirs: addDirs.length > 0 ? addDirs : undefined,
      allowedTools: ["Read", "Glob", "Grep"],
    });

    if (response.is_error) {
      throw new Error(response.result);
    }

    const raw = response.result
      .replace(/```json?\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    // Claude may narrate before/after the JSON — extract the JSON object
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in response: ${raw.slice(0, 200)}`);
    }

    return {
      review: JSON.parse(jsonMatch[0]) as ReviewResult,
      meta: extractMeta(response),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      review: {
        summary: `Review failed: ${message}`,
        concerns: [],
        overallSeverity: "low",
      },
    };
  }
}
