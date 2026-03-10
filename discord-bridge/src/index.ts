/**
 * Alfred Discord Bridge — talk to Alfred via DMs.
 */
import { createAgentSession, SessionManager, type AgentSession } from "@mariozechner/pi-coding-agent";
import { Client, DMChannel, Events, GatewayIntentBits, Partials, type Message } from "discord.js";
import http from "node:http";
import crypto from "node:crypto";
import {
  createTask,
  getTask,
  listTasksByDiscordUser,
  recoverNonTerminalTasks,
  updateTask,
  type TaskCompletionPayload,
  type TaskRecord,
  verifyTaskCallback,
  getPublicTaskInfo,
} from "./tasks.js";
import { sendTaskCompletionCallback } from "./workerClient.js";

const ALFRED_CWD = "/alfred";
const SESSION_DIR = "/alfred/.pi/sessions/discord";
const CHUNK_SIZE = 1900;
const STREAM_FLUSH_CHARS = 400;
const STREAM_FLUSH_MS = 2500;
const DEFAULT_PROMPT_TIMEOUT_MS = 300_000;
const DEFAULT_TASK_TIMEOUT_MS = 1_800_000;
const REASSURANCE_INTERVAL_MS = 60_000;
const DEFAULT_WEBHOOK_PORT = 8080;
const NOTIFICATION_MAX_RETRIES = 5;
const BACKGROUND_REQUIRED_TOKEN = "__ALFRED_BACKGROUND_REQUIRED__";

const PROMPT_TIMEOUT_MS = parseInt(process.env.DISCORD_PROMPT_TIMEOUT_MS ?? "", 10) || DEFAULT_PROMPT_TIMEOUT_MS;
const TASK_TIMEOUT_MS = parseInt(process.env.DISCORD_TASK_TIMEOUT_MS ?? "", 10) || DEFAULT_TASK_TIMEOUT_MS;
const DM_POLICY = (process.env.DISCORD_DM_POLICY ?? "open").trim().toLowerCase();
const OWNER_USER_ID = (process.env.DISCORD_OWNER_USER_ID ?? "").trim();
const ALLOWED_USER_IDS = new Set(
  (process.env.DISCORD_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
);

let session: AgentSession | null = null;
let processing = false;
const messageQueue: { message: Message; content: string }[] = [];
const completionRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function getTaskWebhookSecret(): string | null {
  const s = process.env.TASK_WEBHOOK_SECRET;
  if (typeof s === "string" && s.trim().length > 0) return s.trim();
  return null;
}

function getWebhookBaseUrl(): string {
  const configured = process.env.TASK_WEBHOOK_BASE_URL?.trim();
  if (configured) return configured;
  const port = parseInt(process.env.TASK_WEBHOOK_PORT ?? "", 10) || DEFAULT_WEBHOOK_PORT;
  return `http://127.0.0.1:${port}`;
}

function computeHmacSignature(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function isTerminalTaskStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function formatErrorForUser(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("timed out") || msg.includes("timeout")) {
    return "That took too long. Try a simpler question or try again.";
  }
  if (msg.includes("API key") || msg.includes("authentication") || msg.includes("401") || msg.includes("403")) {
    return "There's an issue with AI provider credentials. Check API keys in Railway.";
  }
  if (msg.includes("rate limit") || msg.includes("429")) {
    return "Rate limited. Please wait a moment and try again.";
  }
  if (msg.includes("model") && msg.includes("not found")) {
    return "Model configuration is invalid. Check provider/model settings.";
  }
  if (msg.includes("network") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
    return "Network error. Alfred will retry when you send another message.";
  }
  return msg.length > 200 ? `${msg.slice(0, 200)}...` : msg;
}

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

async function getOrCreateSession(forceNew = false): Promise<AgentSession> {
  if (session && !forceNew) return session;
  if (session) {
    session.dispose();
    session = null;
  }

  const sessionManager = SessionManager.create(ALFRED_CWD, SESSION_DIR);
  console.log("[Discord bridge] Creating new Pi session");
  const { session: s, modelFallbackMessage } = await createAgentSession({
    cwd: ALFRED_CWD,
    sessionManager,
  });

  if (modelFallbackMessage) {
    console.log("[Discord bridge] Model fallback:", modelFallbackMessage);
  }
  console.log("[Discord bridge] Model:", s.model?.provider, s.model?.id ?? "NONE");
  session = s;
  return session;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.slice(0, CHUNK_SIZE);
    const lastNewline = slice.lastIndexOf("\n");
    const breakAt = lastNewline > CHUNK_SIZE / 2 ? lastNewline + 1 : CHUNK_SIZE;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }
  return chunks;
}

async function sendToDiscord(channel: DMChannel, text: string, replyTo?: Message): Promise<void> {
  const chunks = chunkText(text.trim());
  if (chunks.length === 0) return;
  for (let i = 0; i < chunks.length; i++) {
    const opts = i === 0 && replyTo ? { reply: { messageReference: replyTo } } : {};
    await channel.send({ content: chunks[i], ...opts });
  }
}

function parseTaskCommand(content: string): string | null {
  if (!content.toLowerCase().startsWith("/task")) return null;
  return content.slice("/task".length).trim();
}

function parseStatusCommand(content: string): string | null {
  if (!content.toLowerCase().startsWith("/status")) return null;
  return content.slice("/status".length).trim() || null;
}

function isLikelyLongRunningTask(content: string): boolean {
  const c = content.toLowerCase();
  const keywords = [
    "sub agent",
    "sub-agent",
    "subagent",
    "spawn agent",
    "launch agent",
    "launch a sub agent",
    "need to read",
    "read files",
    "look up",
    "search the repo",
    "investigate",
    "analyze",
    "audit my",
    "when it's done",
    "when its done",
    "let me know when done",
    "run tests",
    "full refactor",
    "debug this project",
    "fix all",
    "scan the repo",
    "implement",
    "deploy",
  ];
  return keywords.some((k) => c.includes(k));
}

function buildForegroundPrompt(content: string): string {
  return [
    "You are in FAST-ANSWER mode for Discord.",
    "If the answer is directly available from current chat context and loaded memory, answer normally.",
    `If you need to read/search files, run commands, or gather additional project context, respond with exactly: ${BACKGROUND_REQUIRED_TOKEN}`,
    "Do not add extra words when returning that token.",
    "",
    content,
  ].join("\n");
}

function canUserAccessDM(userId: string): boolean {
  if (DM_POLICY === "owner_only") return OWNER_USER_ID.length > 0 && userId === OWNER_USER_ID;
  if (DM_POLICY === "allowlist") return ALLOWED_USER_IDS.has(userId);
  return true;
}

async function showTaskStatus(channel: DMChannel, message: Message, maybeTaskId: string | null): Promise<void> {
  const userId = message.author.id;
  if (maybeTaskId) {
    const task = getTask(maybeTaskId);
    if (!task || task.discordUserId !== userId) {
      await channel.send({
        content: "Task not found for your user.",
        reply: { messageReference: message },
      });
      return;
    }
    await channel.send({
      content: `Task \`${task.id}\`\nStatus: \`${task.status}\`\nUpdated: ${task.updatedAt}${task.summary ? `\nSummary: ${task.summary}` : ""}`,
      reply: { messageReference: message },
    });
    return;
  }

  const tasks = listTasksByDiscordUser(userId, 5);
  if (tasks.length === 0) {
    await channel.send({
      content: "No tasks found yet. Use `/task <request>` for background work.",
      reply: { messageReference: message },
    });
    return;
  }

  const lines = tasks.map((t) => `- \`${t.id}\` \`${t.status}\` (${new Date(t.updatedAt).toLocaleString()})`);
  await channel.send({
    content: `Recent tasks:\n${lines.join("\n")}`,
    reply: { messageReference: message },
  });
}

async function sendTaskCompletionNotification(task: TaskRecord): Promise<void> {
  if (!task.notifyOnCompletion || task.notifyChannel !== "same_channel" || !isTerminalTaskStatus(task.status)) return;

  const client = globalDiscordClient;
  if (!client) throw new Error("Discord client not ready");
  const channel = await client.channels.fetch(task.discordChannelId);
  if (!channel || !channel.isDMBased?.()) {
    throw new Error(`Channel missing or not DM (${task.discordChannelId})`);
  }

  const dm = (await channel.fetch()) as DMChannel;
  const statusLabel = task.status.toUpperCase();
  const parts: string[] = [];
  parts.push("**Your Alfred task is done.**");
  parts.push(`Task: \`${task.id}\``);
  parts.push(`Status: \`${statusLabel}\``);
  if (task.summary) parts.push(`Summary: ${task.summary}`);
  if (task.detailsUrl) parts.push(`Details: ${task.detailsUrl}`);

  await dm.send({
    content: parts.join("\n"),
    reply: { messageReference: task.originMessageId },
  });
}

function scheduleCompletionNotification(taskId: string): void {
  const existing = completionRetryTimers.get(taskId);
  if (existing) clearTimeout(existing);

  const attemptSend = async () => {
    const task = getTask(taskId);
    if (!task || !task.notifyOnCompletion || !isTerminalTaskStatus(task.status)) {
      completionRetryTimers.delete(taskId);
      return;
    }
    if (task.notificationState === "sent") {
      completionRetryTimers.delete(taskId);
      return;
    }

    const attempts = (task.notificationAttempts ?? 0) + 1;
    try {
      await sendTaskCompletionNotification(task);
      updateTask(taskId, {
        notificationState: "sent",
        notificationAttempts: attempts,
        notificationLastError: undefined,
      });
      completionRetryTimers.delete(taskId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateTask(taskId, {
        notificationState: "failed",
        notificationAttempts: attempts,
        notificationLastError: message,
      });
      if (attempts < NOTIFICATION_MAX_RETRIES) {
        const delayMs = 1000 * 2 ** (attempts - 1);
        const retryTimer = setTimeout(() => {
          void attemptSend();
        }, delayMs);
        completionRetryTimers.set(taskId, retryTimer);
      } else {
        completionRetryTimers.delete(taskId);
      }
    }
  };

  void attemptSend();
}

async function runBackgroundTask(task: TaskRecord, promptText: string): Promise<void> {
  const webhookSecret = getTaskWebhookSecret();
  const webhookBaseUrl = getWebhookBaseUrl();
  const publicInfo = getPublicTaskInfo(task, webhookBaseUrl);
  const taskCtx = `[task:${task.id}]`;

  const wrappedPrompt = [
    "This request is running in background task mode.",
    `Task ID: ${publicInfo.taskId}`,
    "When complete, return a concise summary in your final assistant message.",
    "Focus on completing the request end-to-end without waiting for further user input.",
    "",
    promptText,
  ].join("\n");

  const report = async (status: "running" | "completed" | "failed" | "cancelled", summary?: string): Promise<void> => {
    if (webhookSecret) {
      await sendTaskCompletionCallback({
        baseUrl: webhookBaseUrl,
        taskId: publicInfo.taskId,
        status,
        summary,
        webhookSecret,
        callbackToken: publicInfo.callbackToken,
      });
      return;
    }

    const patch: Partial<TaskRecord> = {
      status,
      summary,
      completedAt: isTerminalTaskStatus(status) ? new Date().toISOString() : undefined,
      notificationState: isTerminalTaskStatus(status) ? "pending" : undefined,
    };
    updateTask(task.id, patch);
    if (isTerminalTaskStatus(status)) {
      scheduleCompletionNotification(task.id);
    }
  };

  try {
    await report("running", "Background task started.");
    const manager = SessionManager.create(ALFRED_CWD, `${SESSION_DIR}/tasks/${task.id}`);
    const { session: taskSession } = await createAgentSession({
      cwd: ALFRED_CWD,
      sessionManager: manager,
    });

    let lastAssistantText = "";
    const unsub = taskSession.subscribe((event: Record<string, unknown>) => {
      const etype = event.type as string;
      if (etype === "message_end" && event.message) {
        const m = event.message as { role?: string; content?: unknown };
        if (m.role === "assistant") lastAssistantText = extractTextFromMessage(m);
      }
      if (etype === "agent_end" && event.messages) {
        const msgs = event.messages as { role?: string; content?: unknown }[];
        const last = [...msgs].reverse().find((m) => m.role === "assistant");
        if (last) lastAssistantText = extractTextFromMessage(last);
      }
    });

    const promptPromise = taskSession.prompt(wrappedPrompt);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        taskSession.abort();
        reject(new Error("Background task timed out"));
      }, TASK_TIMEOUT_MS);
    });

    try {
      await Promise.race([promptPromise, timeoutPromise]);
    } finally {
      unsub();
      taskSession.dispose();
    }

    const summary = (lastAssistantText || "Task completed.").slice(0, 600);
    await report("completed", summary);
    console.log("[Discord bridge]", taskCtx, "Background task completed");
  } catch (err) {
    const summary = formatErrorForUser(err);
    await report("failed", summary);
    console.error("[Discord bridge]", taskCtx, "Background task failed:", err);
  }
}

async function handleForegroundTask(message: Message, channel: DMChannel, content: string): Promise<void> {
  if (processing) {
    messageQueue.push({ message, content });
    await channel.send({
      content: "Got it. I queued this and will respond after the current request.",
      reply: { messageReference: message },
    });
    return;
  }

  const task = createTask({ message, channel, notifyOnCompletion: false });
  const taskCtx = `[task:${task.id} msg:${message.id}]`;
  console.log("[Discord bridge]", taskCtx, "Created foreground task");

  processing = true;
  updateTask(task.id, { status: "running" });

  try {
    const s = await getOrCreateSession();
    if (s.isStreaming) {
      updateTask(task.id, {
        status: "failed",
        summary: "Session was already streaming another response.",
        completedAt: new Date().toISOString(),
      });
      await channel.send({
        content: "Still working on another request. Try again in a moment.",
        reply: { messageReference: message },
      });
      return;
    }

    await channel.sendTyping();
    let lastAssistantText = "";

    const unsub = s.subscribe((event: Record<string, unknown>) => {
      const etype = event.type as string;
      if (etype === "message_end" && event.message) {
        const m = event.message as { role?: string; content?: unknown };
        if (m.role === "assistant") lastAssistantText = extractTextFromMessage(m);
      }
      if (etype === "turn_end" && event.message) {
        const m = event.message as { role?: string; content?: unknown };
        if (m.role === "assistant") lastAssistantText = extractTextFromMessage(m);
      }
      if (etype === "agent_end" && event.messages) {
        const msgs = event.messages as { role?: string; content?: unknown }[];
        const last = [...msgs].reverse().find((m) => m.role === "assistant");
        if (last) lastAssistantText = extractTextFromMessage(last);
      }
    });

    let timeoutId: ReturnType<typeof setTimeout>;
    let reassuranceId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        s.abort();
        reject(new Error("Request timed out"));
      }, PROMPT_TIMEOUT_MS);
    });

    const sendReassurance = () => {
      channel.sendTyping().catch(() => {});
      reassuranceId = setTimeout(sendReassurance, REASSURANCE_INTERVAL_MS);
    };
    reassuranceId = setTimeout(sendReassurance, REASSURANCE_INTERVAL_MS);

    try {
      await Promise.race([s.prompt(buildForegroundPrompt(content)), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId!);
      clearTimeout(reassuranceId!);
      unsub();
    }

    const textToSend = lastAssistantText.trim();
    if (textToSend === BACKGROUND_REQUIRED_TOKEN) {
      const bgTask = createTask({ message, channel, notifyOnCompletion: true });
      updateTask(task.id, {
        status: "cancelled",
        summary: `Escalated to background task ${bgTask.id} because additional context lookup was required.`,
        completedAt: new Date().toISOString(),
      });
      await channel.send({
        content: `This needs deeper lookup, so I started background task \`${bgTask.id}\`. I will DM you when it is done.`,
        reply: { messageReference: message },
      });
      void runBackgroundTask(bgTask, content);
      return;
    }

    if (textToSend) {
      await sendToDiscord(channel, textToSend, message);
      updateTask(task.id, {
        status: "completed",
        summary: textToSend.slice(0, 600),
        completedAt: new Date().toISOString(),
      });
    } else {
      await channel.send({
        content: "I did not get a response from Alfred. Try again.",
        reply: { messageReference: message },
      });
      updateTask(task.id, {
        status: "failed",
        summary: "No response text captured from model output.",
        completedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    const userMsg = formatErrorForUser(err);
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[Discord bridge]", taskCtx, "Foreground task failed:", msg, stack);
    updateTask(task.id, {
      status: "failed",
      summary: userMsg,
      completedAt: new Date().toISOString(),
    });
    await channel.send({
      content: `Sorry, something went wrong: ${userMsg}`,
      reply: { messageReference: message },
    });
  } finally {
    processing = false;
    const next = messageQueue.shift();
    if (next) {
      setImmediate(() => {
        void handleDM(next.message);
      });
    }
  }
}

async function handleDM(message: Message): Promise<void> {
  if (message.author.bot) return;
  const isDM = message.channel.isDMBased();
  if (!isDM) return;

  const channel = (await message.channel.fetch()) as DMChannel;
  const content = message.content?.trim();
  if (!content) {
    await channel.send({
      content:
        "I did not receive your message. Enable Message Content Intent in Discord Developer Portal.",
      reply: { messageReference: message },
    });
    return;
  }

  if (!canUserAccessDM(message.author.id)) {
    console.warn("[Discord bridge] Rejected unauthorized DM", { userId: message.author.id, policy: DM_POLICY });
    await channel.send({
      content: "DM access is restricted for this Alfred bot instance.",
      reply: { messageReference: message },
    });
    return;
  }

  if (content.toLowerCase() === "/new") {
    try {
      await getOrCreateSession(true);
      await channel.send({ content: "Started a fresh session.", reply: { messageReference: message } });
    } catch {
      await channel.send({ content: "Failed to reset session.", reply: { messageReference: message } });
    }
    return;
  }

  const statusArg = parseStatusCommand(content);
  if (content.toLowerCase().startsWith("/status")) {
    await showTaskStatus(channel, message, statusArg);
    return;
  }

  const taskPrompt = parseTaskCommand(content);
  const forceBackground = taskPrompt !== null;
  const backgroundPrompt = taskPrompt ?? content;
  const shouldBackground = forceBackground || isLikelyLongRunningTask(content);
  if (shouldBackground) {
    if (!backgroundPrompt.trim()) {
      await channel.send({
        content: "Usage: `/task <what to do>`",
        reply: { messageReference: message },
      });
      return;
    }
    const task = createTask({ message, channel, notifyOnCompletion: true });
    console.log("[Discord bridge]", `[task:${task.id} msg:${message.id}]`, "Created background task");
    await channel.send({
      content: `Started background task \`${task.id}\`. I will DM you when it is done.`,
      reply: { messageReference: message },
    });
    void runBackgroundTask(task, backgroundPrompt);
    return;
  }

  await handleForegroundTask(message, channel, content);
}

let globalDiscordClient: Client | null = null;

function startWebhookServer(): void {
  const secret = getTaskWebhookSecret();
  if (!secret) {
    console.warn("[Discord bridge] TASK_WEBHOOK_SECRET not set, webhook mode disabled");
    return;
  }

  const port = parseInt(process.env.TASK_WEBHOOK_PORT ?? "", 10) || DEFAULT_WEBHOOK_PORT;
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/webhooks/task-completed")) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        res.statusCode = 413;
        res.end("Payload too large");
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        const providedSig = req.headers["x-task-signature"];
        const hmac = computeHmacSignature(secret, body);
        const sigString = Array.isArray(providedSig) ? providedSig[0] : providedSig ?? "";
        if (!sigString || !crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(sigString))) {
          res.statusCode = 401;
          res.end("Invalid signature");
          return;
        }

        const parsed = JSON.parse(body) as TaskCompletionPayload;
        if (!parsed.task_id || !parsed.status) {
          res.statusCode = 400;
          res.end("task_id and status are required");
          return;
        }

        const task = getTask(parsed.task_id);
        if (!task) {
          res.statusCode = 404;
          res.end("Task not found");
          return;
        }

        const callbackTokenHeader = req.headers["x-task-callback-token"];
        const callbackToken = Array.isArray(callbackTokenHeader)
          ? callbackTokenHeader[0] ?? null
          : callbackTokenHeader ?? null;
        if (!verifyTaskCallback(task, callbackToken)) {
          res.statusCode = 401;
          res.end("Invalid callback token");
          return;
        }

        const terminal = isTerminalTaskStatus(parsed.status);
        const alreadyTerminal = isTerminalTaskStatus(task.status);
        const updated = updateTask(task.id, {
          status: parsed.status,
          summary: parsed.summary,
          detailsUrl: parsed.details_url,
          completedAt: terminal ? new Date().toISOString() : undefined,
          notificationState: terminal ? task.notificationState ?? "pending" : task.notificationState,
        });

        if (!updated) {
          res.statusCode = 500;
          res.end("Failed to update task");
          return;
        }

        if (terminal && (!alreadyTerminal || updated.notificationState !== "sent")) {
          scheduleCompletionNotification(updated.id);
        }

        res.statusCode = 200;
        res.end(alreadyTerminal ? "Already finalized" : "OK");
      } catch (err) {
        console.error("[Discord bridge] Error handling task completion webhook:", err);
        res.statusCode = 500;
        res.end("Internal error");
      }
    });
  });

  server.listen(port, () => {
    console.log(`[Discord bridge] Task completion webhook listening on port ${port}`);
  });
}

process.on("unhandledRejection", (reason) => {
  console.error("[Discord bridge] Unhandled rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Discord bridge] Uncaught exception:", err);
});

async function main(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error("DISCORD_BOT_TOKEN is not set. Discord bridge disabled.");
    process.exit(1);
  }

  const recoveredCount = recoverNonTerminalTasks();
  if (recoveredCount > 0) {
    console.warn(`[Discord bridge] Recovered ${recoveredCount} non-terminal tasks after restart.`);
  }

  const client = new Client({
    intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.Guilds],
    partials: [Partials.Channel, Partials.Message],
  });

  client.on(Events.ClientReady, (c) => {
    globalDiscordClient = client;
    console.log(`[Discord bridge] Logged in as ${c.user.tag}`);
    startWebhookServer();
  });

  client.on(Events.MessageCreate, (message) => {
    void handleDM(message);
  });

  await client.login(token);
}

main().catch((err) => {
  console.error("[Discord bridge] Fatal:", err);
  process.exit(1);
});
