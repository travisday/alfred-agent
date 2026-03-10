import { describe, it, expect } from "node:test";

import { type TaskRecord, updateTask } from "./tasks.js";

describe("tasks", () => {
  it("updates task fields and timestamps", () => {
    const now = new Date().toISOString();
    const base: TaskRecord = {
      id: "t1",
      status: "pending",
      discordUserId: "u",
      discordChannelId: "c",
      originMessageId: "m",
      notifyOnCompletion: true,
      notifyChannel: "same_channel",
      callbackToken: "tok",
      createdAt: now,
      updatedAt: now,
    };

    // Pretend it's registered in the in-memory map
    // @ts-expect-error access internal map via exported function
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tasksModule = require("./tasks.js") as typeof import("./tasks.js");
    // @ts-expect-error internal map
    tasksModule["tasks"].set(base.id, base);

    const updated = updateTask("t1", { status: "completed" });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("completed");
    expect(updated!.updatedAt >= now).toBe(true);
  });
});

