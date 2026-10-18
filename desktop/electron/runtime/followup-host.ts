import { BrowserWindow } from "electron";
import { FollowupQueue } from "@ohmycode/agent-runtime";
import type { FollowupInput, FollowupState } from "@ohmycode/protocol";
import { readTokens } from "../auth/token-store.js";
import { getApiUrl } from "../config.js";
import { ApiError, apiRequest } from "../api/api-client.js";
import type { SqliteEventStore } from "./sqlite-event-store.js";

type Host = { active(threadId: string): string | undefined; start(threadId: string, input: FollowupInput): void };
const queues = new Map<string, FollowupQueue>();
let store: SqliteEventStore;
let host: Host;

export function initializeFollowups(nextStore: SqliteEventStore, nextHost: Host): void {
  queues.clear(); store = nextStore; host = nextHost;
}

async function scope(): Promise<string> {
  const tokens = await readTokens();
  if (!tokens) throw new Error("authentication_required");
  const { sub } = JSON.parse(Buffer.from(tokens.accessToken.split(".")[1], "base64url").toString()) as { sub: string };
  return `${getApiUrl()}:${sub}`;
}

async function queue(threadId: string): Promise<FollowupQueue> {
  const owner = await scope();
  const key = `${owner}:${threadId}`;
  let value = queues.get(key);
  if (!value) {
    const state = store.loadFollowups(owner, threadId) ?? { inputs: [], paused: false };
    // Restart never silently dispatches work; retain the queue for explicit resumption.
    if (state.inputs.length) state.paused = true;
    value = new FollowupQueue(state, (snapshot) => {
      store.saveFollowups(owner, threadId, snapshot);
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(`thread:followups:${threadId}`, snapshot);
      }
    });
    queues.set(key, value);
    await reconcile(value);
  }
  return value;
}

async function reconcile(q: FollowupQueue): Promise<void> {
  for (const input of q.snapshot().inputs) {
    if (input.status === "queued" || !input.turnId) continue;
    try {
      const value = await apiRequest<{ status: "received" | "waiting" | "not_received" }>(`/api/agent-runs/${input.turnId}/inputs/${input.id}${input.status === "sending" ? "?initial=1" : ""}`);
      if (value.status === "received") q.remove(input.id);
      if (value.status === "not_received") q.reset(input.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) q.reset(input.id);
      // An unknown delivery outcome must not silently resend the same message.
    }
  }
}

export async function followupSnapshot(threadId: string): Promise<FollowupState> { return (await queue(threadId)).snapshot(); }

export async function enqueueFollowup(threadId: string, input: FollowupInput): Promise<void> {
  (await queue(threadId)).add(input);
  await drainFollowups(threadId);
}

export async function drainFollowups(threadId: string): Promise<void> {
  const q = await queue(threadId);
  if (host.active(threadId)) return;
  const input = q.reserve(crypto.randomUUID());
  if (input) host.start(threadId, input);
}

export async function followupReceived(threadId: string, inputId: string): Promise<void> { (await queue(threadId)).remove(inputId); await drainFollowups(threadId); }

export async function finishFollowups(threadId: string, completed: boolean): Promise<void> {
  const q = await queue(threadId);
  if (completed) { await drainFollowups(threadId); return; }
  q.pause();
  await reconcile(q);
}

export async function resumeFollowups(threadId: string): Promise<void> {
  const q = await queue(threadId);
  await reconcile(q);
  if (!host.active(threadId) && q.snapshot().inputs.some((item) => item.status !== "queued")) throw new ApiError(0, "network_error");
  q.resume();
  await drainFollowups(threadId);
}
export async function withdrawFollowup(threadId: string, inputId: string): Promise<FollowupInput> { return (await queue(threadId)).withdraw(inputId); }

export async function steerFollowup(threadId: string, inputId: string): Promise<void> {
  const q = await queue(threadId);
  const turnId = host.active(threadId);
  if (!turnId) throw new Error("turn_finished");
  const input = q.steer(inputId, turnId);
  try {
    await apiRequest(`/api/agent-runs/${turnId}/inputs/${input.id}`, { method: "POST", body: JSON.stringify({ content: input.content, attachments: input.attachments }) });
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) { q.reset(inputId); await drainFollowups(threadId); }
    else q.pause();
    throw error;
  }
}
