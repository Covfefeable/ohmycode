import { useEffect, useRef, useState } from "react";
import { Bug, ExternalLink, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import styles from "./DebugPanel.module.css";

const DEBUG_SEQUENCE = "ohmycodedebug";

export function DebugPanel() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
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
      void window.ohmycode.debug.getConfig().then((config) => {
        setApiUrl(config.apiUrl);
        setOpen(true);
      });
    };
    window.addEventListener("keydown", listen, true);
    return () => window.removeEventListener("keydown", listen, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

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
  return <div className={styles.backdrop} onMouseDown={() => setOpen(false)}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="debug-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><span><Bug /><h2 id="debug-title">{t("debug.title")}</h2></span><button aria-label={t("debug.close")} onClick={() => setOpen(false)}><X /></button></header>
      <div className={styles.content}>
        <label><span>{t("debug.apiUrl")}</span><input autoFocus spellCheck={false} value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void save(); }} /></label>
        <p>{t("debug.apiUrlHint")}</p>
        <button className={styles.toolButton} onClick={() => window.ohmycode.debug.openDevTools()}><ExternalLink />{t("debug.openDevTools")}</button>
      </div>
      <footer><button onClick={() => setOpen(false)}>{t("common.cancel")}</button><button className={styles.primary} disabled={saving || !apiUrl.trim()} onClick={() => void save()}>{t("debug.save")}</button></footer>
    </section>
  </div>;
}
