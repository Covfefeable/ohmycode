import { useEffect, useState } from "react";

export function useConversationModel(conversationId: string, reloadToken = 0) {
  const key = `ohmycode.conversation-model:${conversationId}`;
  const [models, setModels] = useState<ModelConfiguration[]>([]);
  const [selectedModelId, setSelected] = useState(() => sessionStorage.getItem(key) ?? "");

  useEffect(() => {
    let disposed = false;
    let changed = false;
    const apply = (next: ModelConfiguration[]) => {
      const remembered = sessionStorage.getItem(key);
      const selected = next.find((model) => model.id === remembered)?.id ?? next[0]?.id ?? "";
      setModels(next);
      setSelected(selected);
      if (selected) sessionStorage.setItem(key, selected);
      else sessionStorage.removeItem(key);
    };
    const unsubscribe = window.ohmycode.settings.onModelsChanged((next) => { changed = true; apply(next); });
    void window.ohmycode.settings.listModels().then((next) => {
      if (!disposed && !changed) apply(next);
    }).catch(() => undefined);
    return () => { disposed = true; unsubscribe(); };
  }, [key, reloadToken]);

  function setSelectedModelId(id: string) {
    sessionStorage.setItem(key, id);
    setSelected(id);
  }

  return { models, selectedModelId, setSelectedModelId };
}
