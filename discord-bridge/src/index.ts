/**
 * Alfred Discord Bridge — talk to Alfred via DMs.
 *
 * Session is created lazily on first DM (agent on-demand).
 * Reused for subsequent messages, resumed from disk on restart.
 *
 * Required: DISCORD_BOT_TOKEN
 */
import { createAgentSession, SessionManager, type AgentSession } from "@mariozechner/pi-coding-agent";
import { Client, DMChannel, Events, GatewayIntentBits, Partials, type Message } from "discord.js";
import http from "node:http";
import crypto from "node:crypto";
import {
  createTask,
  getTask,
  updateTask,
  type TaskCompletionPayload,
  type TaskRecord,
  verifyTaskCallback,
  getPublicTaskInfo,
} from "./tasks.js";

const ALFRED_CWD = "/alfred";
const SESSION_DIR = "/alfred/.pi/sessions/discord";
const DISCORD_MSG_LIMIT = 2000;
const CHUNK_SIZE = 1900;
const STREAM_FLUSH_CHARS = 400; // Send to Discord when we have this many chars (don't wait for 1900)
const STREAM_FLUSH_MS = 2500; // Also flush every N ms so short replies appear
const DEFAULT_PROMPT_TIMEOUT_MS = 300_000; // 5 min
const REASSURANCE_INTERVAL_MS = 60_000; // Send "still working" every 60s
const DEFAULT_WEBHOOK_PORT = 8080;

const PROMPT_TIMEOUT_MS = parseInt(process.env.DISCORD_PROMPT_TIMEOUT_MS ?? "", 10) || DEFAULT_PROMPT_TIMEOUT_MS;

let session: AgentSession | null = null;
let processing = false;
const messageQueue: { message: Message; content: string }[] = [];

function getTaskWebhookSecret(): string | null {
  const s = process.env.TASK_WEBHOOK_SECRET;
  if (typeof s === "string" && s.trim().length > 0) return s.trim();
  return null;
}

function computeHmacSignature(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function formatErrorForUser(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // User-friendly mappings for common errors
  if (msg.includes("timed out") || msg.includes("timeout")) {
    return "That took too long. Try a simpler question or try again.";
  }
  if (msg.includes("API key") || msg.includes("authentication") || msg.includes("401") || msg.includes("403")) {
    return "There's an issue with the AI provider credentials. Check your API keys in Railway.";
  }
  if (msg.includes("rate limit") || msg.includes("429")) {
    return "Rate limited—please wait a moment and try again.";
  }
  if (msg.includes("CalDAV") || msg.includes("calendar")) {
    return "Calendar lookup failed. Check CalDAV credentials (CALDAV_USERNAME, CALDAV_APP_PASSWORD) if you use calendar features.";
  }
  if (msg.includes("network") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
    return "Network error. Alfred will retry when you send another message.";
  }
  // Generic fallback - keep it short, no stack traces
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

async function getOrCreateSession(forceNew = false): Promise<AgentSession> {
  if (session && !forceNew) return session;

  if (session) {
    session.dispose();
    session = null;
  }

  // Start fresh — previous sessions from broken runs can corrupt context
  const sessionManager = forceNew
    ? SessionManager.create(ALFRED_CWD, SESSION_DIR)
    : SessionManager.create(ALFRED_CWD, SESSION_DIR);

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

async function sendToDiscord(
  channel: DMChannel,
  text: string,
  replyTo?: Message
): Promise<void> {
  const chunks = chunkText(text.trim());
  if (chunks.length === 0) return;

  for (let i = 0; i < chunks.length; i++) {
    const opts = i === 0 && replyTo ? { reply: { messageReference: replyTo } } : {};
    await channel.send({ content: chunks[i], ...opts });
  }
}

async function handleDM(message: Message): Promise<void> {
  if (message.author.bot) return;

  const isDM = message.channel.isDMBased();
  console.log("[Discord bridge] Message received:", { isDM, channelType: message.channel.type, hasContent: !!message.content?.trim() });

  if (!isDM) {
    console.log("[Discord bridge] Ignoring non-DM message (use DMs to talk to Alfred)");
    return;
  }

  // Fetch channel if partial (needed for DMs when channel wasn't cached)
  const channel = (await message.channel.fetch()) as DMChannel;
  const content = message.content?.trim();

  if (!content) {
    console.log("[Discord bridge] Received DM with empty content - Message Content Intent may be disabled");
    try {
      await channel.send({
        content:
          "I didn't receive your message. Enable **Message Content Intent** in the Discord Developer Portal: Bot → Privileged Gateway Intents → Message Content Intent.",
        reply: { messageReference: message },
      });
    } catch {
      // Ignore send errors
    }
    return;
  }

  // Handle commands
  if (content.toLowerCase() === "/new") {
    console.log("[Discord bridge] User requested new session");
    try {
      await getOrCreateSession(true);
      await channel.send({ content: "Started a fresh session.", reply: { messageReference: message } });
    } catch (err) {
      console.error("[Discord bridge] Failed to create new session:", err);
      await channel.send({ content: "Failed to reset session.", reply: { messageReference: message } });
    }
    return;
  }

  // For now, tasks are implicitly created for each DM that triggers work.
  // In the future this can be toggled via a user command or preference.
  const task = createTask({ message, channel, notifyOnCompletion: true });
  console.log("[Discord bridge] Created task", task.id, "for message", message.id);

  console.log("[Discord bridge] Processing DM:", content.slice(0, 50) + (content.length > 50 ? "..." : ""));

  if (processing) {
    console.log("[Discord bridge] Busy, queueing message (queue length:", messageQueue.length + 1, ")");
    messageQueue.push({ message, content });
    try {
      await channel.send({
        content: "Got it—I'll get to that as soon as I finish this.",
        reply: { messageReference: message },
      });
      console.log("[Discord bridge] Queued, confirmation sent");
    } catch (sendErr) {
      console.error("[Discord bridge] Failed to send queue confirmation:", sendErr);
    }
    return;
  }

  processing = true;
  try {
    console.log("[Discord bridge] Getting/creating Pi session...");
    const s = await getOrCreateSession();
    console.log("[Discord bridge] Session ready, sending prompt");

    if (s.isStreaming) {
      await channel.send({
        content: "Still working on that—give me a moment.",
        reply: { messageReference: message },
      });
      processing = false;
      return;
    }

    await channel.sendTyping();

    let buffer = "";
    let lastAssistantText = ""; // Fallback from message_end/turn_end when streaming misses
    let firstChunkSent = false;
    const pendingSends: Promise<unknown>[] = [];
    let streamFlushId: ReturnType<typeof setInterval> | null = null;

    const flushBuffer = (): void => {
      if (buffer.length === 0) return;
      const chunks = chunkText(buffer);
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const opts = !firstChunkSent
          ? { reply: { messageReference: message } }
          : {};
        firstChunkSent = true;
        pendingSends.push(channel.send({ content: chunk, ...opts }));
      }
    };

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

    const unsub = s.subscribe((event: Record<string, unknown>) => {
      // Log every event type for debugging
      const etype = event.type as string;
      if (etype === "message_update") {
        const ae = event.assistantMessageEvent as Record<string, unknown> | undefined;
        if (ae?.type === "text_delta" && ae.delta) {
          buffer += ae.delta as string;
          if (buffer.length >= STREAM_FLUSH_CHARS) {
            flushBuffer();
          }
        }
      } else {
        console.log("[Discord bridge] Event:", etype, JSON.stringify(event).slice(0, 300));
      }

      // Capture from message_end
      if (etype === "message_end" && event.message) {
        const m = event.message as { role?: string; content?: unknown };
        if (m.role === "assistant") {
          lastAssistantText = extractTextFromMessage(m);
          console.log("[Discord bridge] Captured assistant text from message_end:", lastAssistantText.slice(0, 100));
        }
      }

      // Capture from turn_end
      if (etype === "turn_end" && event.message) {
        const m = event.message as { role?: string; content?: unknown };
        if (m.role === "assistant") {
          lastAssistantText = extractTextFromMessage(m);
          console.log("[Discord bridge] Captured assistant text from turn_end:", lastAssistantText.slice(0, 100));
        }
      }

      // Capture from agent_end
      if (etype === "agent_end" && event.messages) {
        const msgs = event.messages as { role?: string; content?: unknown }[];
        const last = [...msgs].reverse().find((m) => m.role === "assistant");
        if (last) {
          lastAssistantText = extractTextFromMessage(last);
          console.log("[Discord bridge] Captured assistant text from agent_end:", lastAssistantText.slice(0, 100));
        }
      }
    });

    // Flush buffer periodically so short replies appear without waiting for prompt() to resolve
    streamFlushId = setInterval(flushBuffer, STREAM_FLUSH_MS);

    const promptPromise = s.prompt(content);
    let timeoutId: ReturnType<typeof setTimeout>;
    let reassuranceId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        s.abort();
        reject(new Error("Request timed out"));
      }, PROMPT_TIMEOUT_MS);
    });

    // Send "still working" every 60s so user knows we haven't hung
    const sendReassurance = () => {
      channel.sendTyping().catch(() => {});
      reassuranceId = setTimeout(sendReassurance, REASSURANCE_INTERVAL_MS);
    };
    reassuranceId = setTimeout(sendReassurance, REASSURANCE_INTERVAL_MS);

    try {
      await Promise.race([promptPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId!);
      clearTimeout(reassuranceId);
      unsub();
      if (streamFlushId) {
        clearInterval(streamFlushId);
        streamFlushId = null;
      }
      await Promise.all(pendingSends);
    }
    console.log("[Discord bridge] Prompt complete");

    // Prefer lastAssistantText (complete final message) over buffer (streamed, may be incomplete)
    const textToSend = lastAssistantText.trim() || buffer.trim();
    if (textToSend) {
      if (lastAssistantText.trim()) {
        console.log("[Discord bridge] Using complete message from message_end/turn_end/agent_end");
      }
      const replyTo = firstChunkSent ? undefined : message;
      await sendToDiscord(channel, textToSend, replyTo);
    } else if (!firstChunkSent) {
      console.log("[Discord bridge] No text captured from agent (buffer empty, no message_end/turn_end)");
      try {
        await channel.send({
          content: "I didn't get a response from Alfred. Try again or ask something else.",
          reply: { messageReference: message },
        });
      } catch {
        // Ignore
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[Discord bridge] Error:", msg, stack);
    const userMsg = formatErrorForUser(err);
    try {
      await channel.send({
        content: `Sorry, something went wrong: ${userMsg}`,
        reply: { messageReference: message },
      });
    } catch (sendErr) {
      console.error("[Discord bridge] Failed to send error to user:", sendErr);
    }
  } finally {
    processing = false;
    // Process next queued message
    const next = messageQueue.shift();
    if (next) {
      console.log("[Discord bridge] Processing queued message");
      setImmediate(() => handleDM(next.message));
    }
  }
}

async function sendTaskCompletionNotification(task: TaskRecord): Promise<void> {
  if (!task.notifyOnCompletion || task.notifyChannel !== "same_channel") return;

  try {
    const client = globalDiscordClient;
    if (!client) {
      console.error("[Discord bridge] Cannot notify completion, Discord client not ready");
      return;
    }
    const channel = await client.channels.fetch(task.discordChannelId);
    if (!channel || !channel.isDMBased?.()) {
      console.error("[Discord bridge] Cannot notify completion, channel missing or not DM:", task.discordChannelId);
      return;
    }

    const dm = (await channel.fetch()) as DMChannel;
    const statusLabel = task.status.toUpperCase();
    const parts: string[] = [];
    parts.push("**Your Alfred task is done.**");
    parts.push(`Status: \`${statusLabel}\``);
    if (task.summary) {
      parts.push(`Summary: ${task.summary}`);
    }
    if (task.detailsUrl) {
      parts.push(`Details: ${task.detailsUrl}`);
    }
    const text = parts.join("\n");

    await dm.send({
      content: text,
      reply: { messageReference: task.originMessageId },
    });
  } catch (err) {
    console.error("[Discord bridge] Failed to send task completion notification:", err);
  }
}

let globalDiscordClient: Client | null = null;

function startWebhookServer(): void {
  const secret = getTaskWebhookSecret();
  if (!secret) {
    console.warn("[Discord bridge] TASK_WEBHOOK_SECRET not set, task completion webhook disabled");
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
        // 1MB limit
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
          console.warn("[Discord bridge] Invalid HMAC signature on task completion webhook");
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
          console.warn("[Discord bridge] Task not found for completion payload:", parsed.task_id);
          res.statusCode = 404;
          res.end("Task not found");
          return;
        }

        // Optional per-task token in header for additional protection
        const callbackTokenHeader = req.headers["x-task-callback-token"];
        const callbackToken = Array.isArray(callbackTokenHeader)
          ? callbackTokenHeader[0] ?? null
          : callbackTokenHeader ?? null;

        if (!verifyTaskCallback(task, callbackToken)) {
          console.warn("[Discord bridge] Invalid callback token for task", task.id);
          res.statusCode = 401;
          res.end("Invalid callback token");
          return;
        }

        if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
          res.statusCode = 200;
          res.end("Already finalized");
          return;
        }

        const completedAt = new Date().toISOString();
        const updated = updateTask(task.id, {
          status: parsed.status,
          summary: parsed.summary,
          detailsUrl: parsed.details_url,
          completedAt,
        });

        if (!updated) {
          res.statusCode = 500;
          res.end("Failed to update task");
          return;
        }

        void sendTaskCompletionNotification(updated);

        res.statusCode = 200;
        res.end("OK");
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

process.on("unhandledRejection", (reason, promise) => {
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

  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.Guilds,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.on(Events.ClientReady, (c) => {
    globalDiscordClient = client;
    console.log(`[Discord bridge] Logged in as ${c.user.tag}`);
    startWebhookServer();
  });

  client.on(Events.MessageCreate, handleDM);

  await client.login(token);
}

main().catch((err) => {
  console.error("[Discord bridge] Fatal:", err);
  process.exit(1);
});
