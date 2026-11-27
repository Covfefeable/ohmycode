import { IconButton } from "../../shared/ui/icon-button";
import { Button } from "../../shared/ui/button";
import { FormField, TextInput } from "../../shared/ui/form-control";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bug, ExternalLink, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import styles from "./DebugPanel.module.css";
import { ContextInspector } from "./context-inspector/ContextInspector";

const DEBUG_SEQUENCE = "ohmycodedebug";

export function DebugPanel() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const { pathname } = useLocation();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const bufferRef = useRef("");
  const [open, setOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      const candidate = `${bufferRef.current}${event.key.toLowerCase()}`;
      bufferRef.current = DEBUG_SEQUENCE.startsWith(candidate)
        ? candidate
        : DEBUG_SEQUENCE.startsWith(event.key.toLowerCase())
          ? event.key.toLowerCase()
          : "";
      if (bufferRef.current !== DEBUG_SEQUENCE) return;
      bufferRef.current = "";
      const currentConversationId = pathname === "/" ? sessionStorage.getItem("ohmycode.activeConversationId") : null;
      void window.ohmycode.debug.getConfig().then((config) => {
        setConversationId(currentConversationId);
        setApiUrl(config.apiUrl);
        setOpen(true);
      });
    };
    window.addEventListener("keydown", listen, true);
    return () => window.removeEventListener("keydown", listen, true);
  }, [pathname]);

  useEffect(() => {
    if (!open || inspecting) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, inspecting]);

  async function save() {
    setSaving(true);
    try {
      const config = await window.ohmycode.debug.setApiUrl(apiUrl);
      setApiUrl(config.apiUrl);
      toast({ type: "success", message: t("debug.saved") });
    } catch {
      toast({ type: "error", message: t("debug.invalidUrl") });
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  if (inspecting && conversationId) return <ContextInspector key={conversationId} conversationId={conversationId} onClose={() => setInspecting(false)} />;
  return <div className={styles.backdrop} onMouseDown={() => setOpen(false)}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="debug-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><span><Bug /><h2 id="debug-title">{t("debug.title")}</h2></span><IconButton aria-label={t("debug.close")} onClick={() => setOpen(false)}><X /></IconButton></header>
      <div className={styles.content}>
        <FormField><span>{t("debug.apiUrl")}</span><TextInput autoFocus spellCheck={false} value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void save(); }} /></FormField>
        <p>{t("debug.apiUrlHint")}</p>
        <Button className={styles.toolButton} onClick={() => window.ohmycode.debug.openDevTools()}><ExternalLink />{t("debug.openDevTools")}</Button>
        <Button className={styles.toolButton} disabled={!conversationId} onClick={() => setInspecting(true)}>{t("debug.viewContext")}</Button>
      </div>
      <footer><Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button><Button variant="primary" disabled={saving || !apiUrl.trim()} onClick={() => void save()}>{t("debug.save")}</Button></footer>
    </section>
  </div>;
}
