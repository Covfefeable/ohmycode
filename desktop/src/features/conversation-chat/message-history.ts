/** Replace a completed Turn's placeholder without dropping already loaded history. */
export function mergeTurnMessages(current: LocalMessage[], saved: LocalMessage[], turnId: string): LocalMessage[] {
  const byId = new Map(saved.map((message) => [message.id, message]));
  const known = new Set(current.map((message) => message.id));
  const additions = saved.filter((message) => !known.has(message.id));
  const result: LocalMessage[] = [];
  let replaced = false;
  for (const message of current) {
    if (message.id === `stream-${turnId}` && saved.some((item) => item.role === "assistant")) {
      result.push(...additions);
      replaced = true;
    } else {
      result.push(byId.get(message.id) ?? message);
    }
  }
  if (!replaced) result.push(...additions);
  return result;
}
