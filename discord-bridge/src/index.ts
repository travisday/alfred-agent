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
  type Message,
} from "discord.js";

const ALFRED_CWD = "/alfred";
const SESSION_DIR = "/alfred/.pi/sessions/discord";
const DISCORD_MSG_LIMIT = 2000;
const CHUNK_SIZE = 1900;

let session: AgentSession | null = null;

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
  if (!message.channel.isDMBased()) return;

  const channel = message.channel as DMChannel;
  const content = message.content?.trim();
  if (!content) return;

  try {
    const s = await getOrCreateSession();

    if (s.isStreaming) {
      await channel.send({
        content: "Still working on that—give me a moment.",
        reply: { messageReference: message },
      });
      return;
    }

    await channel.sendTyping();

    let buffer = "";
    let firstChunkSent = false;

    const unsub = s.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent) {
        const ev = event.assistantMessageEvent;
        if (ev.type === "text_delta" && ev.delta) {
          buffer += ev.delta;
          if (buffer.length >= CHUNK_SIZE) {
            const chunks = chunkText(buffer);
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) {
              const opts = !firstChunkSent
                ? { reply: { messageReference: message } }
                : {};
              firstChunkSent = true;
              channel.send({ content: chunk, ...opts });
            }
          }
        }
      }
    });

    await s.prompt(content);

    unsub();

    if (buffer.trim()) {
      const replyTo = firstChunkSent ? undefined : message;
      await sendToDiscord(channel, buffer, replyTo);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Discord bridge] Error:", err);
    await channel.send({
      content: `Something went wrong: ${msg.slice(0, 500)}`,
      reply: { messageReference: message },
    });
  }
}

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
