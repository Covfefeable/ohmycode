import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageLocation } from "../../../entities/conversation/types";

type SearchRequest = { query: string; at?: string; direction?: "next" | "previous" };
type SearchView = { page: LocalConversation; location: MessageLocation; revision: number; prepended: number };

export function useConversationSearch(conversationId: string, location?: MessageLocation) {
  const [opened, setOpened] = useState(Boolean(location));
  const [request, setRequest] = useState<SearchRequest>({ query: location?.query ?? "", at: location?.messageId });
  const [result, setResult] = useState<MessageSearchResult | null>(null);
  const [view, setView] = useState<SearchView | null>(null);
  const [loading, setLoading] = useState(Boolean(location?.query.trim()));
  const [failed, setFailed] = useState(false);
  const version = useRef(0);
  const pagePending = useRef(false);
  const [previousLocation, setPreviousLocation] = useState(location);
  const begin = useCallback((next: SearchRequest) => {
    version.current += 1;
    pagePending.current = false;
    setRequest(next);
    setResult(null);
    setFailed(false);
    setLoading(Boolean(next.query.trim()));
  }, []);

  if (location !== previousLocation) {
    setPreviousLocation(location);
    setOpened(Boolean(location));
    if (!location) setView(null);
    setRequest({ query: location?.query ?? "", at: location?.messageId });
    setResult(null);
    setFailed(false);
    setLoading(Boolean(location?.query.trim()));
  }

  useEffect(() => {
    const current = ++version.current;
    const query = request.query.trim();
    pagePending.current = false;
    if (!query) return () => { version.current += 1; };
    const timer = window.setTimeout(() => {
      void window.ohmycode.conversations.searchMessages(conversationId, { ...request, query })
        .then(async (match) => {
          if (version.current !== current) return;
          setResult(match);
          if (!match.messageId) return;
          const page = await window.ohmycode.conversations.history(conversationId, { around: match.messageId });
          if (version.current !== current) return;
          setView({ page, location: { messageId: match.messageId, query }, revision: current, prepended: 0 });
        })
        .catch(() => { if (version.current === current) setFailed(true); })
        .finally(() => { if (version.current === current) setLoading(false); });
    }, request.at ? 0 : 250);
    return () => { version.current += 1; window.clearTimeout(timer); };
  }, [conversationId, request]);

  const changeQuery = useCallback((query: string) => { begin({ query }); }, [begin]);
  const open = useCallback(() => setOpened(true), []);
  const returnLatest = useCallback(() => {
    version.current += 1;
    pagePending.current = false;
    setView(null);
    setOpened(false);
    setRequest({ query: "" });
    setResult(null);
    setLoading(false);
    setFailed(false);
  }, []);

  async function load(direction: "before" | "after") {
    const cursor = direction === "before" ? view?.page.olderCursor : view?.page.newerCursor;
    if (!view || !cursor || loading || pagePending.current) return;
    const current = version.current;
    pagePending.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const page = await window.ohmycode.conversations.history(conversationId, { [direction]: cursor });
      if (current !== version.current) return;
      setView((state) => {
        if (!state) return state;
        const known = new Set(state.page.messages?.map((message) => message.id));
        const added = (page.messages ?? []).filter((message) => !known.has(message.id));
        return { ...state,
          prepended: state.prepended + (direction === "before" ? added.length : 0),
          page: { ...state.page,
            messages: direction === "before" ? [...added, ...(state.page.messages ?? [])] : [...(state.page.messages ?? []), ...added],
            olderCursor: direction === "before" ? page.olderCursor : state.page.olderCursor,
            newerCursor: direction === "after" ? page.newerCursor : state.page.newerCursor,
          },
        };
      });
    } catch { if (current === version.current) setFailed(true); }
    finally {
      if (current === version.current) { pagePending.current = false; setLoading(false); }
    }
  }

  return {
    opened, query: request.query, result, view, loading, failed, open, changeQuery, returnLatest,
    close: () => { setOpened(false); changeQuery(""); },
    retry: () => begin({ ...request }),
    move: (direction: "next" | "previous") => begin({ query: request.query, at: result?.messageId ?? undefined, direction }),
    loadOlder: () => load("before"), loadNewer: () => load("after"),
  };
}
