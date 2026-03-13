import type { Concern } from "./types.js";

interface DiffHunk {
  file: string;
  startLine: number;
  lines: { num: number | null; text: string; type: "add" | "del" | "ctx" }[];
}

function parseHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diff.split("\n");
  let currentFile = "";
  let currentHunk: DiffHunk | null = null;
  let newLine = 0;

  for (const line of lines) {
    // New file
    const fileMatch = line.match(/^diff --git a\/.+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      currentHunk = null;
      continue;
    }

    // Hunk header: @@ -old,count +new,count @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10);
      currentHunk = { file: currentFile, startLine: newLine, lines: [] };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        num: newLine,
        text: line.slice(1),
        type: "add",
      });
      newLine++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ num: null, text: line.slice(1), type: "del" });
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({
        num: newLine,
        text: line.slice(1),
        type: "ctx",
      });
      newLine++;
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — skip
    }
  }

  return hunks;
}

export interface CodeSnippet {
  lines: { num: number | null; text: string; type: "add" | "del" | "ctx" }[];
  startLine: number;
  endLine: number;
}

const CONTEXT_LINES = 5;

export function extractSnippets(
  diff: string,
  concerns: Concern[]
): Map<number, CodeSnippet> {
  const hunks = parseHunks(diff);
  const snippets = new Map<number, CodeSnippet>();

  for (let i = 0; i < concerns.length; i++) {
    const concern = concerns[i];
    if (!concern.file) continue;

    // Find hunks for this file
    const fileHunks = hunks.filter((h) => h.file === concern.file);
    if (fileHunks.length === 0) continue;

    if (concern.line) {
      // Find the hunk containing this line
      for (const hunk of fileHunks) {
        const hunkLines = hunk.lines.filter((l) => l.num !== null);
        const minLine = hunkLines[0]?.num ?? 0;
        const maxLine = hunkLines[hunkLines.length - 1]?.num ?? 0;

        if (concern.line >= minLine && concern.line <= maxLine) {
          // Extract a window around the target line
          const targetIdx = hunk.lines.findIndex(
            (l) => l.num === concern.line
          );
          if (targetIdx === -1) continue;

          const start = Math.max(0, targetIdx - CONTEXT_LINES);
          const end = Math.min(hunk.lines.length, targetIdx + CONTEXT_LINES + 1);
          const slice = hunk.lines.slice(start, end);

          const nums = slice.filter((l) => l.num !== null).map((l) => l.num!);
          snippets.set(i, {
            lines: slice,
            startLine: nums[0] ?? concern.line - CONTEXT_LINES,
            endLine: nums[nums.length - 1] ?? concern.line + CONTEXT_LINES,
          });
          break;
        }
      }
    }

    // If no line or didn't find it, show the first hunk for this file (trimmed)
    if (!snippets.has(i) && fileHunks.length > 0) {
      const hunk = fileHunks[0];
      const slice = hunk.lines.slice(0, CONTEXT_LINES * 2 + 1);
      const nums = slice.filter((l) => l.num !== null).map((l) => l.num!);
      snippets.set(i, {
        lines: slice,
        startLine: nums[0] ?? hunk.startLine,
        endLine: nums[nums.length - 1] ?? hunk.startLine + slice.length,
      });
    }
  }

  return snippets;
}
