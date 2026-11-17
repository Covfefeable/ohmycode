import { useEffect, useState } from "react";
import type { ApprovalMode, OperationApproval } from "../../../contracts/domain";

export function useOperationApproval(conversationId: string, running: boolean) {
  const [mode, setMode] = useState<ApprovalMode>("ask");
  const [requests, setRequests] = useState<OperationApproval[]>([]);
  const [failed, setFailed] = useState(false);
  const [loadedId, setLoadedId] = useState(conversationId);
  useEffect(() => {
    let disposed = false;
    let receivedUpdate = false;
    const unsubscribe = window.ohmycode.conversations.onApprovalState(conversationId, (state) => {
      receivedUpdate = true;
      if (!disposed) { setLoadedId(conversationId); setMode(state.mode); setRequests(state.requests); setFailed(false); }
    });
    const refresh = async () => {
      try {
        const state = await window.ohmycode.conversations.approvalState(conversationId);
        if (!disposed && !receivedUpdate) { setLoadedId(conversationId); setMode(state.mode); setRequests(state.requests); setFailed(false); }
      } catch { if (!disposed) setFailed(true); }
    };
    void refresh();
    return () => { disposed = true; unsubscribe(); };
  }, [conversationId, running]);
  return {
    mode: loadedId === conversationId ? mode : "ask" as ApprovalMode,
    requests: requests.filter((item) => item.conversationId === conversationId),
    failed: loadedId === conversationId && failed,
    async select(next: ApprovalMode) {
      try {
        await window.ohmycode.conversations.setApprovalMode(conversationId, next);
        setLoadedId(conversationId);
        setMode(next);
        setFailed(false);
      } catch { setFailed(true); }
    },
    async reply(id: string, allowed: boolean) {
      try {
        await window.ohmycode.conversations.replyApproval(conversationId, id, allowed);
        setRequests((items) => items.filter((item) => item.id !== id));
        setFailed(false);
      } catch { setFailed(true); }
    },
  };
}
