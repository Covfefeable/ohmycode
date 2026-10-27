import { updateActivity } from "./activity-timeline/updateActivity";

/** Message projection only: no subscriptions, requests, scrolling or React state. */
export function projectRuntimeMessages(current: LocalMessage[], events: RuntimeEvent[], now = new Date().toISOString()): LocalMessage[] {
  const messages = [...current];
  for (const event of events) {
    if (event.type === "item.completed" && event.item.kind === "user_message") {
      const item = event.item;
      const input = item.input as { attachments: MessageAttachment[]; initial?: boolean };
      const existing = messages.findIndex((message) => message.id === item.id || input.initial && message.id === `user-${event.turnId}`);
      const userMessage: LocalMessage = { id: item.id, role: "user", content: item.content ?? "", attachments: input.attachments, createdAt: now };
      if (existing >= 0) messages[existing] = userMessage;
      else {
        const streamIndex = messages.findIndex((message) => message.id === `stream-${event.turnId}`);
        messages.splice(streamIndex < 0 ? messages.length : streamIndex, 0, userMessage);
      }
      continue;
    }
    const streamId = `stream-${event.turnId}`;
    let index = messages.findIndex((message) => message.id === streamId);
    if (index < 0 && (event.type === "turn.started" || event.type.startsWith("item."))) {
      messages.push({ id: streamId, role: "assistant", content: "", createdAt: now, agentStartedAt: now, activity: [] });
      index = messages.length - 1;
    }
    if (index >= 0) {
      const message = messages[index];
      messages[index] = { ...message, activity: updateActivity(message.activity ?? [], event) };
    }
  }
  return messages;
}
