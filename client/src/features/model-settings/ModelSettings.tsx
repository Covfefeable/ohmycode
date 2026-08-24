import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical, LoaderCircle, Plus, PlugZap, Trash2 } from "lucide-react";
import { useFeedback } from "../feedback";
import styles from "./ModelSettings.module.css";

const newModel = (): ModelConfiguration => ({ id: crypto.randomUUID(), name: "", baseUrl: "https://api.openai.com/v1", model: "", apiKey: "" });

export function ModelSettings({ initial }: { initial: ModelConfiguration[] }) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [models, setModels] = useState(initial);
  const [dragged, setDragged] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  function update(id: string, patch: Partial<ModelConfiguration>) { setModels((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item)); }
  function drop(target: string) { if (!dragged || dragged === target) return; setModels((items) => { const next = [...items]; const from = next.findIndex((item) => item.id === dragged); const to = next.findIndex((item) => item.id === target); const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }); setDragged(null); }
  async function test(model: ModelConfiguration) {
    setTestingId(model.id);
    try {
      const result = await window.ohmycode.settings.testModel(model);
      toast({ type: result.ok ? "success" : "error", message: result.ok ? t("settings.testSuccess", { latency: result.latencyMs }) : t(`settings.testErrors.${result.message ?? "connection_failed"}`) });
    } catch {
      toast({ type: "error", message: t("settings.testErrors.connection_failed") });
    } finally {
      setTestingId(null);
    }
  }
  async function save() {
    const invalid = models.some((item) => !item.name.trim() || !item.baseUrl.trim() || !item.model.trim() || (!item.hasApiKey && !item.apiKey?.trim()));
    if (invalid) { toast({ type: "error", message: t("settings.modelValidation") }); return; }
    try {
      await window.ohmycode.settings.saveModels(models);
      const fresh = await window.ohmycode.settings.get();
      setModels(fresh.models);
      toast({ type: "success", message: t("settings.modelsSaved") });
    } catch { toast({ type: "error", message: t("settings.saveFailed") }); }
  }
  return <section className={styles.section}>
    <header><div><p>{t("settings.modelsEyebrow")}</p><h2>{t("settings.modelsTitle")}</h2><span>{t("settings.modelsDescription")}</span></div><button onClick={() => setModels((items) => [...items, newModel()])}><Plus />{t("settings.addModel")}</button></header>
    <div className={styles.list}>{models.map((model, index) => <article key={model.id} draggable onDragStart={() => setDragged(model.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => drop(model.id)}>
      <div className={styles.cardHead}><span className={styles.handle}><GripVertical /></span><strong>{index === 0 ? t("settings.defaultModel") : `#${index + 1}`}</strong><button aria-label={t("settings.removeModel")} onClick={() => setModels((items) => items.filter((item) => item.id !== model.id))}><Trash2 /></button></div>
      <div className={styles.grid}>
        <label><span>{t("settings.configName")}</span><input value={model.name} onChange={(e) => update(model.id, { name: e.target.value })} /></label>
        <label><span>{t("settings.modelName")}</span><input value={model.model} onChange={(e) => update(model.id, { model: e.target.value })} /></label>
        <label className={styles.wide}><span>{t("settings.baseUrl")}</span><input value={model.baseUrl} onChange={(e) => update(model.id, { baseUrl: e.target.value })} /></label>
        <label className={styles.wide}><span>{t("settings.apiKey")}</span><input type="password" value={model.apiKey ?? ""} placeholder={model.hasApiKey ? t("settings.keyStored") : "sk-…"} onChange={(e) => update(model.id, { apiKey: e.target.value })} /></label>
      </div>
      <footer><button disabled={testingId === model.id} onClick={() => void test(model)}>{testingId === model.id ? <LoaderCircle className={styles.spinner} /> : <PlugZap />}{t("settings.test")}</button></footer>
    </article>)}</div>
    {models.length === 0 && <div className={styles.empty}>{t("settings.noModels")}</div>}
    <div className={styles.actions}><button onClick={() => void save()}>{t("settings.saveModels")}</button></div>
  </section>;
}
