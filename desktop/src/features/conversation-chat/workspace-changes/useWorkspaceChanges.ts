import { useCallback, useEffect, useState } from "react";
import type { WorkspaceChangeSet } from "../../../../contracts/domain";

export function useWorkspaceChanges(conversationId: string, sending: boolean, active: boolean) {
  const [state, setState] = useState<{ conversationId: string; records: WorkspaceChangeSet[]; failed: boolean }>({ conversationId, records: [], failed: false });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!active) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const records = await window.ohmycode.conversations.snapshots(conversationId);
        if (!current) return;
        setState({ conversationId, records, failed: false });
        if (sending || records.some((record) => record.status === "active")) timer = setTimeout(() => void load(), 3000);
      } catch { if (current) setState((value) => ({ conversationId, records: value.conversationId === conversationId ? value.records : [], failed: true })); }
    }
    void load();
    return () => { current = false; clearTimeout(timer); };
  }, [conversationId, sending, active, revision]);
  const records = state.conversationId === conversationId ? state.records.filter((record) => record.files.some((file) => !file.restored)) : [];
  return { records, failed: state.conversationId === conversationId && state.failed, hasChanges: records.length > 0, refresh };
}
