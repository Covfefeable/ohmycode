import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBrowser } from "../browser-panel/useBrowser";
import { useAndroidState } from "../android/useAndroidState";
import { useAndroidPresentation } from "../android/useAndroidPresentation";
import { useFeedback } from "../feedback";

type Panel = "browser" | "android";

export function useConversationPanels(conversationId: string, active: boolean) {
  const browser = useBrowser(conversationId);
  const android = useAndroidState();
  const androidDetached = useAndroidPresentation();
  const androidOwner = android.state?.ownerConversationId;
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [selection, setSelection] = useState<Panel | null>();
  const panel = selection === undefined ? (browser.state.opened ? "browser" : null) : selection;

  const show = useCallback((target: Panel) => {
    setSelection(target);
    if (!active) return;
    const request = target === "browser"
      ? browser.state.detached
        ? window.ohmycode.browser.setDetached(conversationId, true)
        : window.ohmycode.browser.setOpened(conversationId, true)
      : androidDetached && (!androidOwner || androidOwner === conversationId)
        ? window.ohmycode.android.setDetached(true, conversationId) : Promise.resolve();
    void request.catch(() => toast({ type: "error", message: t(target === "browser" ? "browser.failed" : "android.operationFailed") }));
  }, [active, androidDetached, androidOwner, browser.state.detached, conversationId, t, toast]);

  const close = () => {
    setSelection(null);
    if (panel === "browser") void window.ohmycode.browser.setOpened(conversationId, false)
      .catch(() => toast({ type: "error", message: t("browser.failed") }));
  };
  const toggle = (target: Panel) => {
    if (panel !== target || (target === "browser" ? browser.state.detached : androidDetached)) show(target);
    else close();
  };
  const onToolStarted = useCallback((tool: string) => {
    if (tool.startsWith("browser_")) show("browser");
    else if (tool.startsWith("android_")) show("android");
  }, [show]);

  return { browser: browser.state, android: android.state, panel, toggle, close, onToolStarted };
}
