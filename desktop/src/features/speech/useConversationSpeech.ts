import { useEffect } from "react";
import { useSpeech } from "./speech-context";
import { speechText } from "./speech-text";

export function useConversationSpeech(conversationId: string) {
  const { settings, recording, playback } = useSpeech();
  useEffect(() => {
    if (!settings?.autoPlay || recording) return;
    const items = new Map<
      string,
      { text: string; sent: number; task?: ReturnType<typeof playback.task> }
    >();
    const sequences = new Map<string, number>();
    function flush(
      item: {
        text: string;
        sent: number;
        task?: ReturnType<typeof playback.task>;
      },
      final: boolean,
    ) {
      const plain = speechText(item.text);
      // Hold partial sentences so unfinished Markdown isn't spoken as syntax.
      let boundary = final ? plain.length : 0;
      if (!final)
        for (const match of plain.matchAll(/[。！？.!?;；\n]/g))
          boundary = match.index + 1;
      if (boundary > item.sent) {
        item.task ??= playback.task();
        item.task.append(plain.slice(item.sent, boundary));
        item.sent = boundary;
      }
      if (final) item.task?.finish();
    }
    const unsubscribe = window.ohmycode.conversations.onThreadEvent(
      conversationId,
      (event) => {
        if (event.sequence <= (sequences.get(event.turnId) ?? -1)) return;
        sequences.set(event.turnId, event.sequence);
        if (event.type === "turn.started") {
          playback.stop();
          items.clear();
        }
        if (
          event.type === "item.started" &&
          event.item.kind === "agent_message"
        )
          items.set(event.item.id, { text: event.item.content ?? "", sent: 0 });
        if (event.type === "item.delta") {
          const item = items.get(event.itemId);
          if (item) {
            item.text += event.delta;
            if (/[。！？.!?;；\n]/.test(event.delta)) flush(item, false);
          }
        }
        if (
          event.type === "item.completed" &&
          event.item.kind === "agent_message"
        ) {
          const item = items.get(event.item.id) ?? { text: "", sent: 0 };
          item.text = event.item.content ?? item.text;
          flush(item, true);
          items.delete(event.item.id);
        }
        if (event.type === "turn.interrupted" || event.type === "turn.failed") {
          items.clear();
          playback.stop();
        }
      },
    );
    return () => {
      unsubscribe();
      playback.stop();
    };
  }, [conversationId, settings?.autoPlay, recording, playback]);
}
