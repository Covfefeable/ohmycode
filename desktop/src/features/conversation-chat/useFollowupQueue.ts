import { useEffect, useState } from "react";
import type { FollowupState } from "@ohmycode/protocol";

export function useFollowupQueue(conversationId: string) {
  const [state, setState] = useState<FollowupState>({ inputs: [], paused: false });
  useEffect(() => {
    let disposed = false;
    let updated = false;
    const unsubscribe = window.ohmycode.conversations.onFollowups(conversationId, (value) => {
      updated = true;
      if (!disposed) setState(value);
    });
    void window.ohmycode.conversations.followups(conversationId).then((value) => {
      if (!disposed && !updated) setState(value);
    }).catch(() => { /* Leave already received queue state intact on connection failure. */ });
    return () => { disposed = true; unsubscribe(); };
  }, [conversationId]);
  return state;
}
