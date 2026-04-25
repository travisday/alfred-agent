/**
 * Discord notify extension — send DMs via Discord REST API (no second Gateway client).
 *
 * Required env:
 *   DISCORD_BOT_TOKEN
 *   DISCORD_PROACTIVE_USER_ID or DISCORD_OWNER_USER_ID — recipient user ID
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DISCORD_API = "https://discord.com/api/v10";
const CHUNK_SIZE = 1900;
const EVENT_FILE = process.env.ALFRED_EVENT_FILE?.trim() || "/alfred/state/events.jsonl";

let cachedRecipientId: string | null = null;
let cachedDmChannelId: string | null = null;

function logEvent(type: string, message: string, details?: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(EVENT_FILE), { recursive: true });
    appendFileSync(
      EVENT_FILE,
      JSON.stringify({
        t: new Date().toISOString(),
        source: "discord-notify",
        type,
        message,
        ...(details ? { details } : {}),
      }) + "\n"
    );
  } catch {
    // Delivery should not fail just because introspection logging is unavailable.
  }
}

function getBotToken(): string | null {
  const t = process.env.DISCORD_BOT_TOKEN?.trim();
  return t && t.length > 0 ? t : null;
}

function getRecipientId(): string | null {
  const proactive = process.env.DISCORD_PROACTIVE_USER_ID?.trim();
  if (proactive) return proactive;
  const owner = process.env.DISCORD_OWNER_USER_ID?.trim();
  return owner && owner.length > 0 ? owner : null;
}

function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const chunks: string[] = [];
  let remaining = trimmed;
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

async function getOrCreateDmChannel(recipientId: string, token: string): Promise<string> {
  if (cachedDmChannelId && cachedRecipientId === recipientId) {
    return cachedDmChannelId;
  }
  const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: recipientId }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Discord create DM failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = JSON.parse(body) as { id?: string };
  if (!data.id) throw new Error("Discord create DM: missing channel id");
  cachedRecipientId = recipientId;
  cachedDmChannelId = data.id;
  return data.id;
}

async function sendMessage(channelId: string, token: string, content: string): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
  const errBody = await res.text();
  if (!res.ok) {
    throw new Error(`Discord send message failed (${res.status}): ${errBody.slice(0, 500)}`);
  }
}

export default function (pi: ExtensionAPI) {
  const token = getBotToken();
  const recipient = getRecipientId();

  if (!token || !recipient) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify(
        "discord-notify: set DISCORD_BOT_TOKEN and DISCORD_PROACTIVE_USER_ID or DISCORD_OWNER_USER_ID.",
        "warn"
      );
    });
  }

  pi.registerTool({
    name: "send_discord_message",
    label: "Send Discord DM",
    description:
      "REQUIRED for proactive check-ins: send the full summary as a DM to the user via the Alfred Discord bot. The user does not read check-ins from the terminal—Discord is the inbox. Call this with the complete message (bullets OK).",
    promptSnippet: "send_discord_message: Send a DM to the owner via Discord",
    parameters: Type.Object({
      message: Type.String({
        description: "Full message text to send (long text is split automatically).",
      }),
    }),
    async execute(_toolCallId, params) {
      const t = getBotToken();
      const r = getRecipientId();
      if (!t || !r) {
        const msg =
          "discord-notify is not configured: missing DISCORD_BOT_TOKEN or DISCORD_PROACTIVE_USER_ID / DISCORD_OWNER_USER_ID.";
        console.error(`[discord-notify] ${msg}`);
        logEvent("discord_send_unconfigured", msg);
        return {
          content: [{ type: "text", text: msg }],
          details: { ok: false },
        };
      }
      const chunks = chunkText(params.message);
      if (chunks.length === 0) {
        logEvent("discord_send_empty", "send_discord_message called with an empty message");
        return {
          content: [{ type: "text", text: "Message was empty; nothing sent." }],
          details: { ok: true, chunks: 0 },
        };
      }
      try {
        const channelId = await getOrCreateDmChannel(r, t);
        logEvent("discord_send_attempt", `Sending Discord DM in ${chunks.length} chunk(s)`, { chunks: chunks.length });
        for (const chunk of chunks) {
          await sendMessage(channelId, t, chunk);
        }
        logEvent("discord_send_success", `Sent Discord DM in ${chunks.length} chunk(s)`, { chunks: chunks.length });
        return {
          content: [
            {
              type: "text",
              text: `Sent Discord DM (${chunks.length} part${chunks.length === 1 ? "" : "s"}).`,
            },
          ],
          details: { ok: true, chunks: chunks.length },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[discord-notify] Discord send failed: ${msg}`);
        logEvent("discord_send_failed", msg);
        return {
          content: [{ type: "text", text: `Discord send failed: ${msg}` }],
          details: { ok: false },
        };
      }
    },
  });
}
