/**
 * Sub-agent extension for Alfred — delegate long-running tasks to a separate agent
 * so the main chat stays responsive.
 *
 * Tool: delegate_task — runs a task in an in-memory sub-agent session and returns
 * the result. Use for multi-step or long-running work (summaries, refactors, etc.)
 * so Alfred can acknowledge quickly and then report back when done.
 *
 * Loads the same blocks/ context as proactive/Discord (memory-loader) so delegated
 * work matches /alfred as the single source of truth (prd.md).
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const DEFAULT_TIMEOUT_MS = 300_000; // 5 min
const DELEGATE_TASK_TIMEOUT_MS =
  parseInt(process.env.DELEGATE_TASK_TIMEOUT_MS ?? "", 10) || DEFAULT_TIMEOUT_MS;

const SUB_AGENT_PREAMBLE =
  "Complete this task directly. Do not use the delegate_task tool—you are already a sub-agent. ";

function extractTextFromMessage(msg: { content?: unknown }): string {
  if (!msg?.content) return "";
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((b): b is { type: string; text?: string } => typeof b === "object" && b != null)
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text!)
      .join("");
  }
  return "";
}

let delegationInProgress = false;

function loadMemoryAppendForCwd(cwd: string): string | undefined {
  const script =
    process.env.ALFRED_MEMORY_LOADER_PATH?.trim() || join(cwd, "memory-loader.sh");
  const memoryRoot = process.env.ALFRED_MEMORY_ROOT?.trim() || cwd;
  try {
    const out = execFileSync(script, {
      encoding: "utf8",
      maxBuffer: 2_000_000,
      env: { ...process.env, ALFRED_MEMORY_ROOT: memoryRoot },
    }).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "delegate_task",
    label: "Delegate Task",
    description:
      "Run a long-running or multi-step task in a sub-agent. Use this when the task would take many tool calls or a long time—it keeps the main chat responsive. First acknowledge the user briefly, then call this tool with a clear task description. When it returns, summarize the result for the user.",
    promptSnippet:
      "delegate_task: Run heavy/long tasks in a sub-agent so you stay responsive; acknowledge first, then delegate, then summarize the result",
    parameters: Type.Object({
      task: Type.String({
        description: "Clear description of the work for the sub-agent to perform",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (delegationInProgress) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Another delegation is already in progress. Please wait for it to finish, or ask the user to try again shortly.",
            },
          ],
          details: { busy: true },
          isError: true,
        };
      }

      delegationInProgress = true;
      const cwd = ctx.cwd || "/alfred";
      const taskWithPreamble = SUB_AGENT_PREAMBLE + params.task;

      try {
        const memoryAppend = loadMemoryAppendForCwd(cwd);
        const resourceLoader = new DefaultResourceLoader({
          cwd,
          agentDir: getAgentDir(),
          ...(memoryAppend ? { appendSystemPrompt: memoryAppend } : {}),
        });
        await resourceLoader.reload();
        const { session } = await createAgentSession({
          cwd,
          sessionManager: SessionManager.inMemory(),
          resourceLoader,
        });

        let lastAssistantText = "";

        const unsub = session.subscribe((event: Record<string, unknown>) => {
          const etype = event.type as string;
          if (etype === "message_end" && event.message) {
            const m = event.message as { role?: string; content?: unknown };
            if (m.role === "assistant") {
              lastAssistantText = extractTextFromMessage(m);
            }
          }
          if (etype === "turn_end" && event.message) {
            const m = event.message as { role?: string; content?: unknown };
            if (m.role === "assistant") {
              lastAssistantText = extractTextFromMessage(m);
            }
          }
          if (etype === "agent_end" && event.messages) {
            const msgs = event.messages as { role?: string; content?: unknown }[];
            const last = [...msgs].reverse().find((m) => m.role === "assistant");
            if (last) {
              lastAssistantText = extractTextFromMessage(last);
            }
          }
        });

        const timeoutId = setTimeout(() => {
          session.abort();
        }, DELEGATE_TASK_TIMEOUT_MS);

        if (signal?.aborted) {
          clearTimeout(timeoutId);
          unsub();
          session.dispose();
          delegationInProgress = false;
          return {
            content: [{ type: "text" as const, text: "Delegation was cancelled." }],
            details: {},
            isError: true,
          };
        }

        signal?.addEventListener?.("abort", () => {
          session.abort();
        });

        try {
          await session.prompt(taskWithPreamble);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          clearTimeout(timeoutId);
          unsub();
          session.dispose();
          delegationInProgress = false;
          return {
            content: [
              {
                type: "text" as const,
                text: `Sub-agent failed: ${msg}`,
              },
            ],
            details: { error: msg },
            isError: true,
          };
        }

        clearTimeout(timeoutId);
        unsub();
        session.dispose();
        delegationInProgress = false;

        const text =
          lastAssistantText.trim() ||
          "The sub-agent completed but did not return any text. The task may have been carried out via tool calls only.";

        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      } catch (err) {
        delegationInProgress = false;
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to start sub-agent: ${msg}`,
            },
          ],
          details: { error: msg },
          isError: true,
        };
      }
    },
  });
}
