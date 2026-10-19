import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Plus } from "lucide-react";
import { useFeedback } from "../feedback";
import { EmptyState } from "../../shared/ui/empty-state";
import { SettingsSectionHeader } from "../../shared/ui/settings-section-header";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { ModelCard } from "./ModelCard";
import { useModelOrder } from "./useModelOrder";
import styles from "./ModelSettings.module.css";

const newModel = (): ModelConfiguration => ({
  id: crypto.randomUUID(),
  name: "",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  contextLength: 262144,
  supportsVision: false,
  apiKey: "",
});

export function ModelSettings({ initial }: { initial: ModelConfiguration[] }) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [models, setModels] = useState(initial);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(
    initial[0]?.id ?? null,
  );
  const [deleteModelId, setDeleteModelId] = useState<string | null>(null);
  const order = useModelOrder(models, setModels);
  function update(id: string, patch: Partial<ModelConfiguration>) {
    setModels((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }
  async function test(model: ModelConfiguration) {
    setTestingId(model.id);
    try {
      const result = await window.ohmycode.settings.testModel(model);
      toast({
        type: result.ok ? "success" : "error",
        message: result.ok
          ? t("settings.testSuccess", { latency: result.latencyMs })
          : t(`settings.testErrors.${result.message ?? "connection_failed"}`),
      });
    } catch {
      toast({
        type: "error",
        message: t("settings.testErrors.connection_failed"),
      });
    } finally {
      setTestingId(null);
    }
  }
  async function save() {
    const invalid = models.some(
      (item) =>
        !item.name.trim() ||
        !item.baseUrl.trim() ||
        !item.model.trim() ||
        (!item.hasApiKey && !item.apiKey?.trim()),
    );
    if (invalid) {
      toast({ type: "error", message: t("settings.modelValidation") });
      return;
    }
    try {
      const freshModels = await window.ohmycode.settings.saveModels(models);
      setModels(freshModels);
      toast({ type: "success", message: t("settings.modelsSaved") });
    } catch {
      toast({ type: "error", message: t("settings.saveFailed") });
    }
  }
  return (
    <section className={styles.section}>
      <SettingsSectionHeader
        title={t("settings.modelsTitle")}
        description={t("settings.modelsDescription")}
        actions={
          <>
            <button
              onClick={() => {
                const item = newModel();
                setModels((items) => [...items, item]);
                setExpandedId(item.id);
              }}
            >
              <Plus />
              {t("settings.addModel")}
            </button>
            <button
              className={styles.primaryAction}
              onClick={() => void save()}
            >
              {t("settings.saveModels")}
            </button>
          </>
        }
      />
      <div className={styles.list}>
        {models.map((model, index) => (
          <ModelCard
            key={model.id}
            model={model}
            index={index}
            expanded={expandedId === model.id}
            testing={testingId === model.id}
            order={order}
            onToggle={() =>
              setExpandedId((id) => (id === model.id ? null : model.id))
            }
            onTest={() => void test(model)}
            onRemove={() => setDeleteModelId(model.id)}
            onChange={(patch) => update(model.id, patch)}
          />
        ))}
      </div>
      {models.length === 0 && (
        <EmptyState
          icon={<Bot />}
          title={t("settings.noModels")}
          description={t("settings.noModelsDescription")}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteModelId)}
        title={t("common.confirmDelete")}
        description={t("common.deleteWarning")}
        onCancel={() => setDeleteModelId(null)}
        onConfirm={() => {
          const id = deleteModelId;
          setDeleteModelId(null);
          if (id) setModels((items) => items.filter((item) => item.id !== id));
        }}
      />
    </section>
  );
}
