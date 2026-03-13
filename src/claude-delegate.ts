import { spawn } from "child_process";

export interface ClaudeResponse {
  type: string;
  subtype: string;
  is_error: boolean;
  result: string;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  total_cost_usd: number;
  session_id: string;
  stop_reason: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  [key: string]: unknown;
}

export interface DelegateOptions {
  /** The prompt to send */
  prompt: string;
  /** Model to use: "opus", "sonnet", "haiku" */
  model?: "opus" | "sonnet" | "haiku";
  /** Max budget in USD */
  maxBudgetUsd?: number;
  /** Timeout in ms (default: 60s) */
  timeoutMs?: number;
  /** System prompt */
  systemPrompt?: string;
  /** Additional directories to give Claude access to */
  addDirs?: string[];
  /** Allowed tools */
  allowedTools?: string[];
}

/**
 * Delegates a prompt to a claude code CLI subprocess.
 * Uses your existing Claude Code subscription — no API key needed.
 */
export function askClaude(options: DelegateOptions): Promise<ClaudeResponse> {
  const {
    prompt,
    model = "sonnet",
    maxBudgetUsd,
    timeoutMs = 60_000,
    systemPrompt,
    addDirs,
    allowedTools,
  } = options;

  const args = ["-p", prompt, "--output-format", "json", "--model", model];

  if (maxBudgetUsd) {
    args.push("--max-budget-usd", String(maxBudgetUsd));
  }
  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }
  if (addDirs) {
    for (const dir of addDirs) {
      args.push("--add-dir", dir);
    }
  }
  if (allowedTools) {
    args.push("--allowedTools", ...allowedTools);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Claude CLI exited ${code}:\nstdout: ${stdout}\nstderr: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ClaudeResponse);
      } catch {
        reject(new Error(`Failed to parse Claude response:\n${stdout}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });
  });
}

/** Ask Claude and return just the text result. */
export async function askClaudeText(
  prompt: string,
  model: DelegateOptions["model"] = "sonnet"
): Promise<string> {
  const response = await askClaude({ prompt, model });
  if (response.is_error) {
    throw new Error(`Claude returned error: ${response.result}`);
  }
  return response.result;
}

/** Ask Claude and parse the result as JSON. */
export async function askClaudeJson<T = unknown>(
  prompt: string,
  model: DelegateOptions["model"] = "sonnet"
): Promise<T> {
  const text = await askClaudeText(prompt, model);
  const clean = text.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(clean) as T;
}
