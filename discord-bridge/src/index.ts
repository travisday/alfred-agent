/**
 * Alfred Discord Bridge — talk to Alfred via DMs.
 */
import {
  createAgentSession,
  SessionManager,
  ModelRegistry,
  AuthStorage,
  getAgentDir,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { Client, DMChannel, Events, GatewayIntentBits, Partials, type Message } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { AlfredDiscordResourceLoader } from "./resourceLoader.js";

const ALFRED_CWD = "/alfred";
const MEMORY_LOADER_SCRIPT = (process.env.ALFRED_MEMORY_LOADER_PATH ?? "/opt/memory-loader.sh").trim() || "/opt/memory-loader.sh";

/** Pi default session parent dir: ~/.pi/agent/sessions/--<cwd-encoded>--/ */
function getPiDefaultSessionParentDir(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(getAgentDir(), "sessions", safePath);
}

/** Effective interactive session directory (override or Pi default). */
function getInteractiveSessionDir(): string {
  const override = process.env.ALFRED_PI_SESSION_DIR?.trim();
  if (override) return override;
  return getPiDefaultSessionParentDir(ALFRED_CWD);
}
const CHUNK_SIZE = 1900;
const DEFAULT_PROMPT_TIMEOUT_MS = 300_000;
const REASSURANCE_INTERVAL_MS = 60_000;

const PROMPT_TIMEOUT_MS = parseInt(process.env.DISCORD_PROMPT_TIMEOUT_MS ?? "", 10) || DEFAULT_PROMPT_TIMEOUT_MS;
const DM_POLICY = (process.env.DISCORD_DM_POLICY ?? "open").trim().toLowerCase();
const OWNER_USER_ID = (process.env.DISCORD_OWNER_USER_ID ?? "").trim();
const ALLOWED_USER_IDS = new Set(
  (process.env.DISCORD_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
);
const processedMessageIds = new Set<string>();

let sharedResourceLoader: AlfredDiscordResourceLoader | null = null;
let session: AgentSession | null = null;
let processing = false;
type MessageQueueItem = { message: Message; content: string; channel: DMChannel };

const messageQueue: MessageQueueItem[] = [];

function sanitizeErrorMessage(msg: string): string {
  // Remove ANSI color codes and other terminal escapes
  return msg.replace(/\x1b\[[0-9;]*m/g, "")
            .replace(/\[\d+m/g, "")
            .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
            .trim();
}

function formatErrorForUser(err: unknown): string {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const msg = sanitizeErrorMessage(rawMsg);

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
  if (msg.includes("failed_generation") || msg.includes("adjust your prompt")) {
    console.error("[Discord bridge] Original failed_generation error:", rawMsg);
    return "The agent encountered an internal error. Please try rephrasing your request.";
  }
  if (msg.includes("context length") || msg.includes("context window") || msg.includes("max tokens")) {
    return "This request is too long. Try breaking it into smaller parts.";
  }
  if (
    msg.includes("Personal Access Tokens are not supported") ||
    msg.includes("third-party user token")
  ) {
    console.error("[Discord bridge] GitHub Copilot / PAT auth error, original:", rawMsg);
    return (
      "LLM misconfiguration: a GitHub PAT or Copilot path is hitting an API that rejects it. " +
      "Set ALFRED_MODEL to a model you have a key for (e.g. groq/llama-3.3-70b-versatile) and set GROQ_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY in Railway. " +
      "Do not use GITHUB_TOKEN or a repo PAT as an LLM key. See docs/troubleshooting.md."
    );
  }
  // Catch cryptic or truncated errors (very short messages or suspicious patterns like "ae adjust")
  if (msg.length < 15 || /\b[a-z]{1,2}\s+adjust\b/i.test(msg)) {
    console.error("[Discord bridge] Cryptic error detected, original:", rawMsg);
    return "The agent encountered an unexpected error. Please try again.";
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

async function ensureResourceLoader(): Promise<AlfredDiscordResourceLoader> {
  if (!sharedResourceLoader) {
    sharedResourceLoader = new AlfredDiscordResourceLoader({
      cwd: ALFRED_CWD,
      agentDir: getAgentDir(),
      memoryLoaderPath: MEMORY_LOADER_SCRIPT,
    });
    await sharedResourceLoader.reload();
  }
  return sharedResourceLoader;
}

function clearInteractivePiSessionDir(): void {
  fs.rmSync(getInteractiveSessionDir(), { recursive: true, force: true });
}

/** Rebuild system prompt so fresh `blocks/` from memory-loader is applied. */
function refreshPromptContext(s: AgentSession): void {
  s.setActiveToolsByName(s.getActiveToolNames());
}

async function getOrCreateSession(forceNew = false): Promise<AgentSession> {
  if (forceNew && session) {
    session.dispose();
    session = null;
  }

  if (session) return session;

  if (forceNew) {
    clearInteractivePiSessionDir();
  }

  const resourceLoader = await ensureResourceLoader();
  const sessionDirOverride = process.env.ALFRED_PI_SESSION_DIR?.trim();
  const sessionManager = sessionDirOverride
    ? SessionManager.continueRecent(ALFRED_CWD, sessionDirOverride)
    : SessionManager.continueRecent(ALFRED_CWD);
  const { model, modelRegistry } = resolveConfiguredModel();
  console.log("[Discord bridge] Pi interactive session dir:", getInteractiveSessionDir());
  const { session: s, modelFallbackMessage } = await createAgentSession({
    cwd: ALFRED_CWD,
    sessionManager,
    resourceLoader,
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

function canUserAccessDM(userId: string): boolean {
  if (DM_POLICY === "owner_only") return OWNER_USER_ID.length > 0 && userId === OWNER_USER_ID;
  if (DM_POLICY === "allowlist") return ALLOWED_USER_IDS.has(userId);
  return true;
}

async function handleForegroundTask(message: Message, channel: DMChannel, content: string): Promise<void> {
  if (processing) {
    messageQueue.push({ message, content, channel });
    await channel.send({
      content: "Got it. I queued this and will respond after the current request.",
      reply: { messageReference: message },
    });
    return;
  }

  const taskCtx = `[msg:${message.id}]`;
  console.log("[Discord bridge]", taskCtx, "Handling DM");

  processing = true;

  try {
    const s = await getOrCreateSession();
    console.log("[Discord bridge]", taskCtx, "Session acquired, streaming:", s.isStreaming, "messages:", s.messages.length);
    if (s.isStreaming) {
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
      refreshPromptContext(s);
      await Promise.race([s.prompt(content), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId!);
      clearTimeout(reassuranceId!);
    }

    const { text: assistantText, error: agentError } = extractLastTurnAssistantText(
      s.messages as { role?: string; content?: unknown; errorMessage?: string }[]
    );
    if (agentError) throw new Error(agentError);

    const textToSend = assistantText.trim();
    if (textToSend) {
      await sendToDiscord(channel, textToSend, message);
    } else {
      await channel.send({
        content: "I processed that but didn't have anything to say.",
        reply: { messageReference: message },
      });
    }
  } catch (err) {
    const userMsg = formatErrorForUser(err);
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[Discord bridge]", taskCtx, "Foreground task failed:", msg, stack);
    await channel.send({
      content: `Sorry, something went wrong: ${userMsg}`,
      reply: { messageReference: message },
    });
  } finally {
    processing = false;
    const next = messageQueue.shift();
    if (next) {
      setImmediate(() => {
        void handleForegroundTask(next.message, next.channel, next.content);
      });
    }
  }
}

async function handleDM(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (processedMessageIds.has(message.id)) return;
  processedMessageIds.add(message.id);
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

  await handleForegroundTask(message, channel, content);
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

  const alfredModel = process.env.ALFRED_MODEL ?? "";
  console.log(`[Discord bridge] ALFRED_MODEL env: "${alfredModel || '(not set)'}"`);
  console.log(
    `[Discord bridge] Pi session dir: ${getInteractiveSessionDir()}${process.env.ALFRED_PI_SESSION_DIR?.trim() ? " (ALFRED_PI_SESSION_DIR override)" : " (Pi default under agentDir)"}`
  );

  const legacyDirs = ["/alfred/.pi/sessions/discord", "/alfred/state/pi-session"];
  for (const d of legacyDirs) {
    if (fs.existsSync(d)) {
      console.warn(`[Discord bridge] Legacy path still on volume (safe to delete): ${d}`);
    }
  }

  const client = new Client({
    intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.Guilds],
    partials: [Partials.Channel, Partials.Message],
  });

  client.on(Events.ClientReady, (c) => {
    console.log(`[Discord bridge] Logged in as ${c.user.tag}`);
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
