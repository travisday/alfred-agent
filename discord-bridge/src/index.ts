/**
 * Alfred Discord Bridge — talk to Alfred via DMs.
 *
 * Session is created lazily on first DM (agent on-demand).
 * Reused for subsequent messages, resumed from disk on restart.
 *
 * Required: DISCORD_BOT_TOKEN
 */
import {
  createAgentSession,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import {
  Client,
  DMChannel,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";

const ALFRED_CWD = "/alfred";
const SESSION_DIR = "/alfred/.pi/sessions/discord";
const DISCORD_MSG_LIMIT = 2000;
const CHUNK_SIZE = 1900;
const DEFAULT_PROMPT_TIMEOUT_MS = 300_000; // 5 min
const REASSURANCE_INTERVAL_MS = 60_000; // Send "still working" every 60s

const PROMPT_TIMEOUT_MS = parseInt(process.env.DISCORD_PROMPT_TIMEOUT_MS ?? "", 10) || DEFAULT_PROMPT_TIMEOUT_MS;

let session: AgentSession | null = null;
let processing = false;
const messageQueue: { message: Message; content: string }[] = [];

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

async function getOrCreateSession(): Promise<AgentSession> {
  if (session) return session;

  const sessionManager = SessionManager.continueRecent(ALFRED_CWD, SESSION_DIR);
  const { session: s } = await createAgentSession({
    cwd: ALFRED_CWD,
    sessionManager,
  });
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
      return;
    }

    await channel.sendTyping();

    let buffer = "";
    let lastAssistantText = ""; // Fallback from message_end/turn_end when streaming misses
    let firstChunkSent = false;
    const pendingSends: Promise<unknown>[] = [];

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
        if (ae) {
          console.log("[Discord bridge] Event:", etype, "sub:", ae.type);
          if (ae.type === "text_delta" && ae.delta) {
            buffer += ae.delta as string;
            if (buffer.length >= CHUNK_SIZE) {
              const chunks = chunkText(buffer);
              buffer = chunks.pop() ?? "";
              for (const chunk of chunks) {
                const opts = !firstChunkSent
                  ? { reply: { messageReference: message } }
                  : {};
                firstChunkSent = true;
                pendingSends.push(channel.send({ content: chunk, ...opts }));
              }
            }
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
    }

    unsub();
    await Promise.all(pendingSends);
    console.log("[Discord bridge] Prompt complete");

    const textToSend = buffer.trim() || lastAssistantText.trim();
    if (textToSend) {
      if (!buffer.trim() && lastAssistantText.trim()) {
        console.log("[Discord bridge] Used fallback capture (message_end/turn_end/agent_end)");
      }
      const replyTo = firstChunkSent ? undefined : message;
      await sendToDiscord(channel, textToSend, replyTo);
    } else {
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
    console.log(`[Discord bridge] Logged in as ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, handleDM);

  await client.login(token);
}

main().catch((err) => {
  console.error("[Discord bridge] Fatal:", err);
  process.exit(1);
});
