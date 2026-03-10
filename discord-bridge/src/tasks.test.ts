import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.DISCORD_TASKS_FILE = path.join(
  os.tmpdir(),
  `alfred-discord-bridge-tasks-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
);

const tasksModule = await import("./tasks.js");

test("create and update task lifecycle", () => {
  const message = {
    id: "msg_1",
    author: { id: "user_1" },
  } as unknown as import("discord.js").Message;
  const channel = { id: "chan_1" } as unknown as import("discord.js").DMChannel;

  const task = tasksModule.createTask({ message, channel, notifyOnCompletion: true });
  assert.equal(task.discordUserId, "user_1");
  assert.equal(task.status, "pending");
  assert.equal(task.notificationState, "pending");

  const running = tasksModule.updateTask(task.id, { status: "running" });
  assert.ok(running);
  assert.equal(running?.status, "running");

  const done = tasksModule.updateTask(task.id, {
    status: "completed",
    summary: "Done",
    completedAt: new Date().toISOString(),
  });
  assert.ok(done);
  assert.equal(done?.status, "completed");
});

test("verify callback token and list tasks by user", () => {
  const message = {
    id: "msg_2",
    author: { id: "user_2" },
  } as unknown as import("discord.js").Message;
  const channel = { id: "chan_2" } as unknown as import("discord.js").DMChannel;
  const task = tasksModule.createTask({ message, channel, notifyOnCompletion: true });

  assert.equal(tasksModule.verifyTaskCallback(task, task.callbackToken), true);
  assert.equal(tasksModule.verifyTaskCallback(task, "invalid"), false);

  const userTasks = tasksModule.listTasksByDiscordUser("user_2");
  assert.ok(userTasks.some((t) => t.id === task.id));
});

test("recover non-terminal tasks marks pending/running as failed", () => {
  const message = {
    id: "msg_3",
    author: { id: "user_3" },
  } as unknown as import("discord.js").Message;
  const channel = { id: "chan_3" } as unknown as import("discord.js").DMChannel;
  const task = tasksModule.createTask({ message, channel, notifyOnCompletion: true });
  tasksModule.updateTask(task.id, { status: "running" });

  const recovered = tasksModule.recoverNonTerminalTasks();
  assert.ok(recovered >= 1);

  const after = tasksModule.getTask(task.id);
  assert.equal(after?.status, "failed");
  assert.match(after?.summary ?? "", /interrupted by process restart/i);
});
