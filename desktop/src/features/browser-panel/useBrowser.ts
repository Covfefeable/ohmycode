import { useCallback, useEffect, useState } from "react";
import type { BrowserState } from "@ohmycode/browser-use/types";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";

const empty: BrowserState = { tabs: [], selectedId: null, opened: false, detached: false };

export function useBrowser(conversationId: string) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [state, setState] = useState<BrowserState>(empty);
  const failed = useCallback(() => toast({ type: "error", message: t("browser.failed") }), [t, toast]);
  useEffect(() => {
    let subscribed = true;
    let received = false;
    const unsubscribe = window.ohmycode.browser.onState(conversationId, (next) => { received = true; setState(next); });
    void window.ohmycode.browser.state(conversationId).then((next) => { if (subscribed && !received) setState(next); }).catch(() => { if (subscribed) failed(); });
    return () => { subscribed = false; unsubscribe(); };
  }, [conversationId, failed]);
  const toggle = useCallback(() => window.ohmycode.browser.setOpened(conversationId, !state.opened).catch(failed), [conversationId, state.opened, failed]);
  return { state, toggle };
}
