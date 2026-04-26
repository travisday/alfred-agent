/**
 * Alfred Discord Bridge — talk to Alfred via DMs.
 */
import { createAgentSession, SessionManager, ModelRegistry, AuthStorage, type AgentSession } from "@mariozechner/pi-coding-agent";
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

/**
 * Collect assistant text from the most recent turn.
 * Anchors on the last user message so auto-compaction can't invalidate indices.
 * Also surfaces agent errors that session.prompt() silently swallows.
 */
function extractLastTurnAssistantText(
  messages: { role?: string; content?: unknown; errorMessage?: string }[]
): { text: string; error?: string } {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) {
    console.warn("[Discord bridge] extractLastTurnAssistantText: no user message found");
    return { text: "" };
  }

  const textParts: string[] = [];
  let lastError: string | undefined;
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const text = extractTextFromMessage(msg);
    if (text) textParts.push(text);
    if (msg.errorMessage) lastError = msg.errorMessage;
  }

  const joined = textParts.join("\n\n");
  if (!joined && lastError) {
    console.error("[Discord bridge] Agent error (no text):", lastError);
  } else if (!joined) {
    // Debug: dump what we actually see so we can diagnose next time
    const afterUser = messages.slice(lastUserIdx + 1);
    const summary = afterUser.map((m) => `${m.role ?? "?"}${m.errorMessage ? "[err]" : ""}`).join(", ");
    console.warn("[Discord bridge] No assistant text found. Messages after user:", summary || "(none)");
  }

  return { text: joined, error: !joined ? lastError : undefined };
}

function resolveConfiguredModel(): { model?: any; modelRegistry?: ModelRegistry } {
  const alfredModel = (process.env.ALFRED_MODEL ?? "").trim();
  if (!alfredModel) return {};

  const slashIdx = alfredModel.indexOf("/");
  if (slashIdx < 0) {
    console.warn(`[Discord bridge] ALFRED_MODEL="${alfredModel}" missing provider/ prefix, using default`);
    return {};
  }

  const provider = alfredModel.slice(0, slashIdx);
  const modelId = alfredModel.slice(slashIdx + 1);
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const model = modelRegistry.find(provider, modelId);

  if (model) {
    console.log(`[Discord bridge] Resolved ALFRED_MODEL: ${provider}/${modelId}`);
    return { model, modelRegistry };
  }

  console.warn(`[Discord bridge] ALFRED_MODEL="${alfredModel}" not found in model registry, using default`);
  return { modelRegistry };
}

async function getOrCreateSession(forceNew = false): Promise<AgentSession> {
  if (forceNew && session) {
    session.dispose();
    session = null;
  }

  if (session) return session;

  const sessionManager = SessionManager.continueRecent(ALFRED_CWD, SESSION_DIR);
  const { model, modelRegistry } = resolveConfiguredModel();
  console.log("[Discord bridge] Continuing Pi session (or creating new)");
  const { session: s, modelFallbackMessage } = await createAgentSession({
    cwd: ALFRED_CWD,
    sessionManager,
    ...(model && { model }),
    ...(modelRegistry && { modelRegistry }),
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
  if (!content.toLowerCase().startsWith("!task")) return null;
  return content.slice("!task".length).trim();
}

function parseStatusCommand(content: string): string | null {
  if (!content.toLowerCase().startsWith("!status")) return null;
  return content.slice("!status".length).trim() || null;
}

function buildForegroundPrompt(content: string): string {
  return [
    `If this request requires extensive research, multi-file scanning, or long-running operations, respond with exactly: ${BACKGROUND_REQUIRED_TOKEN}`,
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
      content: "No tasks found yet. Use `!task <request>` for background work.",
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
  const parts: string[] = [];
  if (task.summary) {
    parts.push(task.summary);
  } else if (task.status === "failed") {
    parts.push("I hit an issue while working on that request.");
  } else if (task.status === "cancelled") {
    parts.push("I stopped that request before completion.");
  } else {
    parts.push("I finished working on that request.");
  }
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
    "IMPORTANT: Your FINAL message MUST contain a plain-text summary of what you did and what you found.",
    "Do NOT end with only tool calls — always follow up with a text response summarizing the outcome.",
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
    const manager = SessionManager.create(ALFRED_CWD, `/alfred/state/task-sessions/${task.id}`);
    const { model: bgModel, modelRegistry: bgRegistry } = resolveConfiguredModel();
    const { session: taskSession } = await createAgentSession({
      cwd: ALFRED_CWD,
      sessionManager: manager,
      ...(bgModel && { model: bgModel }),
      ...(bgRegistry && { modelRegistry: bgRegistry }),
    });

    const promptPromise = taskSession.prompt(wrappedPrompt);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        taskSession.abort();
        reject(new Error("Background task timed out"));
      }, TASK_TIMEOUT_MS);
    });

    await Promise.race([promptPromise, timeoutPromise]);

    const { text: assistantText, error: agentError } = extractLastTurnAssistantText(
      taskSession.messages as { role?: string; content?: unknown; errorMessage?: string }[]
    );
    if (agentError) throw new Error(agentError);

    taskSession.dispose();

    const summary = (assistantText.trim() || `Finished working on: ${promptText.slice(0, 200)}`).slice(0, 600);
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
    }

    const { text: assistantText, error: agentError } = extractLastTurnAssistantText(
      s.messages as { role?: string; content?: unknown; errorMessage?: string }[]
    );
    if (agentError) throw new Error(agentError);

    const textToSend = assistantText.trim();
    if (textToSend === BACKGROUND_REQUIRED_TOKEN) {
      const bgTask = createTask({ message, channel, notifyOnCompletion: true });
      updateTask(task.id, {
        status: "cancelled",
        summary: "Escalated to background processing because additional context lookup was required.",
        completedAt: new Date().toISOString(),
      });
      await channel.send({
        content: "This needs a deeper lookup. I am on it and will update you when it is done.",
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
        content: "I processed that but didn't have anything to say.",
        reply: { messageReference: message },
      });
      updateTask(task.id, {
        status: "completed",
        summary: "Prompt completed with tool-only output (no text response).",
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

  if (content.toLowerCase() === "!new") {
    try {
      await getOrCreateSession(true);
      await channel.send({ content: "Started a fresh session.", reply: { messageReference: message } });
    } catch {
      await channel.send({ content: "Failed to reset session.", reply: { messageReference: message } });
    }
    return;
  }

  const statusArg = parseStatusCommand(content);
  if (content.toLowerCase().startsWith("!status")) {
    await showTaskStatus(channel, message, statusArg);
    return;
  }

  const taskPrompt = parseTaskCommand(content);
  const forceBackground = taskPrompt !== null;
  const backgroundPrompt = taskPrompt ?? content;
  const shouldBackground = forceBackground;
  if (shouldBackground) {
    if (!backgroundPrompt.trim()) {
      await channel.send({
        content: "Usage: `!task <what to do>`",
        reply: { messageReference: message },
      });
      return;
    }
    const task = createTask({ message, channel, notifyOnCompletion: true });
    console.log("[Discord bridge]", `[task:${task.id} msg:${message.id}]`, "Created background task");
    await channel.send({
      content: "Working on it now. I will update you when it is done.",
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

  const shutdown = () => {
    console.log("[Discord bridge] Shutting down...");
    if (session) {
      session.abort();
      session.dispose();
      session = null;
    }
    client.destroy();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[Discord bridge] Fatal:", err);
  process.exit(1);
});
