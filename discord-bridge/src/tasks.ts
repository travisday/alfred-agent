import type { DMChannel, Message } from "discord.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TaskRecord {
  id: string;
  status: TaskStatus;
  discordUserId: string;
  discordChannelId: string;
  originMessageId: string;
  notifyOnCompletion: boolean;
  notifyChannel: "same_channel";
  callbackToken: string;
  summary?: string;
  detailsUrl?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  notificationState?: "pending" | "sent" | "failed";
  notificationAttempts?: number;
  notificationLastError?: string;
}

interface PersistedTasksFile {
  version: 1;
  tasks: TaskRecord[];
}

const TASKS_FILE = process.env.DISCORD_TASKS_FILE ?? "/alfred/.pi/sessions/discord/tasks.json";

const tasks = new Map<string, TaskRecord>();

function loadTasksFromDisk(): void {
  try {
    if (!fs.existsSync(TASKS_FILE)) return;
    const raw = fs.readFileSync(TASKS_FILE, "utf8");
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw) as PersistedTasksFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) return;
    for (const t of parsed.tasks) {
      tasks.set(t.id, t);
    }
    console.log("[Discord bridge] Loaded", tasks.size, "tasks from", TASKS_FILE);
  } catch (err) {
    console.error("[Discord bridge] Failed to load tasks file:", err);
  }
}

let saveScheduled = false;

function scheduleSave(): void {
  if (saveScheduled) return;
  saveScheduled = true;
  setTimeout(() => {
    saveScheduled = false;
    try {
      const dir = path.dirname(TASKS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload: PersistedTasksFile = {
        version: 1,
        tasks: Array.from(tasks.values()),
      };
      fs.writeFileSync(TASKS_FILE, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
      console.error("[Discord bridge] Failed to persist tasks file:", err);
    }
  }, 500);
}

loadTasksFromDisk();

export interface CreateTaskOptions {
  message: Message;
  channel: DMChannel;
  notifyOnCompletion?: boolean;
}

export function createTask(opts: CreateTaskOptions): TaskRecord {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const callbackToken = crypto.randomBytes(32).toString("hex");
  const record: TaskRecord = {
    id,
    status: "pending",
    discordUserId: opts.message.author.id,
    discordChannelId: opts.channel.id,
    originMessageId: opts.message.id,
    notifyOnCompletion: opts.notifyOnCompletion ?? true,
    notifyChannel: "same_channel",
    callbackToken,
    createdAt: now,
    updatedAt: now,
    notificationState: "pending",
    notificationAttempts: 0,
  };
  tasks.set(id, record);
  scheduleSave();
  return record;
}

export function getPublicTaskInfo(task: TaskRecord, baseUrl: string | undefined): {
  taskId: string;
  callbackToken: string;
  webhookUrl: string;
} {
  const origin = baseUrl ?? `http://127.0.0.1:${process.env.TASK_WEBHOOK_PORT ?? "8080"}`;
  const url = new URL("/webhooks/task-completed", origin);
  return {
    taskId: task.id,
    callbackToken: task.callbackToken,
    webhookUrl: url.toString(),
  };
}

export function getTask(id: string): TaskRecord | undefined {
  return tasks.get(id);
}

export function updateTask(
  id: string,
  patch: Partial<
    Pick<
      TaskRecord,
      | "status"
      | "summary"
      | "detailsUrl"
      | "completedAt"
      | "notificationState"
      | "notificationAttempts"
      | "notificationLastError"
    >
  >
): TaskRecord | undefined {
  const existing = tasks.get(id);
  if (!existing) return undefined;
  const next: TaskRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  tasks.set(id, next);
  scheduleSave();
  return next;
}

export function listTasksByDiscordUser(discordUserId: string, limit = 20): TaskRecord[] {
  return Array.from(tasks.values())
    .filter((t) => t.discordUserId === discordUserId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, limit));
}

export function recoverNonTerminalTasks(): number {
  let recovered = 0;
  for (const task of tasks.values()) {
    if (task.status === "pending" || task.status === "running") {
      const updated = updateTask(task.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        summary: "Task interrupted by process restart before completion callback.",
      });
      if (updated) recovered++;
    }
  }
  return recovered;
}

export interface TaskCompletionPayload {
  task_id: string;
  status: TaskStatus;
  summary?: string;
  details_url?: string;
  metadata?: Record<string, unknown>;
}

export function verifyTaskCallback(task: TaskRecord, providedToken: string | null): boolean {
  if (!providedToken) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(task.callbackToken), Buffer.from(providedToken));
  } catch {
    return false;
  }
}

