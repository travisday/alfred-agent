import crypto from "node:crypto";
import http from "node:http";

import type { TaskStatus } from "./tasks.js";

export interface WorkerCallbackOptions {
  baseUrl: string;
  taskId: string;
  status: TaskStatus;
  summary?: string;
  detailsUrl?: string;
  metadata?: Record<string, unknown>;
  webhookSecret: string;
  callbackToken: string;
}

export function sendTaskCompletionCallback(opts: WorkerCallbackOptions): Promise<void> {
  const url = new URL("/webhooks/task-completed", opts.baseUrl);
  const payload = {
    task_id: opts.taskId,
    status: opts.status,
    summary: opts.summary,
    details_url: opts.detailsUrl,
    metadata: opts.metadata,
  };
  const body = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", opts.webhookSecret).update(body, "utf8").digest("hex");

  return new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-task-signature": hmac,
          "x-task-callback-token": opts.callbackToken,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const msg = Buffer.concat(chunks).toString("utf8");
            reject(
              new Error(
                `Task completion webhook failed with status ${res.statusCode ?? "?"}: ${msg || "no body"}`
              )
            );
          });
        }
      }
    );

    req.on("error", (err) => {
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

