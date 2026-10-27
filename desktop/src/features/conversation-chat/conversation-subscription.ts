type Callbacks = {
  loaded(conversation: LocalConversation, snapshot: TurnSnapshot | null): void;
  events(events: RuntimeEvent[]): void;
  toolStarted(tool: string): void;
  failed(): void;
};

/** Subscribe before loading history, then replay and batch live events once per frame. */
export function subscribeConversationEvents(conversationId: string, callbacks: Callbacks): () => void {
  let disposed = false;
  let loaded = false;
  let frame: number | null = null;
  const pending: RuntimeEvent[] = [];
  const handled = new Set<string>();
  let queued: RuntimeEvent[] = [];
  const enqueue = (event: RuntimeEvent, live: boolean) => {
    const key = `${event.turnId}:${event.sequence}`;
    if (disposed || handled.has(key)) return;
    handled.add(key);
    if (live && event.type === "item.started" && event.item.kind === "tool" && event.item.tool) callbacks.toolStarted(event.item.tool);
    queued.push(event);
    if (frame === null) frame = window.requestAnimationFrame(() => {
      frame = null;
      const events = queued;
      queued = [];
      if (!disposed) callbacks.events(events);
    });
  };
  const unsubscribe = window.ohmycode.conversations.onThreadEvent(conversationId, (event) => {
    if (!loaded) pending.push(event);
    else enqueue(event, true);
  });
  void Promise.all([
    window.ohmycode.conversations.history(conversationId),
    window.ohmycode.conversations.threadSnapshot(conversationId),
  ]).then(([conversation, snapshot]) => {
    if (disposed) return;
    callbacks.loaded(conversation, snapshot);
    if (snapshot?.status === "in_progress") for (const event of snapshot.events) enqueue(event, false);
    for (const event of pending.sort((left, right) => left.sequence - right.sequence)) enqueue(event, true);
    pending.length = 0;
    loaded = true;
  }).catch(() => {
    if (disposed) return;
    unsubscribe();
    callbacks.failed();
  });
  return () => {
    disposed = true;
    unsubscribe();
    if (frame !== null) window.cancelAnimationFrame(frame);
    queued = [];
    pending.length = 0;
  };
}
