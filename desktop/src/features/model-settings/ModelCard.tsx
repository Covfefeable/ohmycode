import {
  ChevronDown,
  GripVertical,
  LoaderCircle,
  PlugZap,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../../shared/ui/tooltip";
import { IconButton } from "../../shared/ui/icon-button";
import type { useModelOrder } from "./useModelOrder";
import styles from "./ModelSettings.module.css";

type Props = {
  model: ModelConfiguration;
  index: number;
  expanded: boolean;
  testing: boolean;
  order: ReturnType<typeof useModelOrder>;
  onToggle(): void;
  onTest(): void;
  onRemove(): void;
  onChange(patch: Partial<ModelConfiguration>): void;
};

export function ModelCard({
  model,
  index,
  expanded,
  testing,
  order,
  onToggle,
  onTest,
  onRemove,
  onChange,
}: Props) {
  const { t } = useTranslation();
  return (
    <article {...order.cardProps(model.id)}>
      <div className={styles.cardHead}>
        <span className={styles.handle} {...order.handleProps(model.id)}>
          <GripVertical />
        </span>
        <button
          className={styles.cardToggle}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span>
            <strong>{model.name || t("settings.unnamedModel")}</strong>
            <small>
              {index === 0
                ? t("settings.defaultModel")
                : model.model || `#${index + 1}`}
            </small>
          </span>
          <ChevronDown className={expanded ? styles.open : ""} />
        </button>
        <Tooltip content={t("settings.test")}>
          <IconButton
            className={styles.iconAction}
            aria-label={t("settings.test")}
            disabled={testing}
            onClick={onTest}
          >
            {testing ? (
              <LoaderCircle className={styles.spinner} />
            ) : (
              <PlugZap />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip content={t("settings.removeModel")}>
          <IconButton
            className={`${styles.iconAction} ${styles.deleteAction}`}
            aria-label={t("settings.removeModel")}
            onClick={onRemove}
          >
            <Trash2 />
          </IconButton>
        </Tooltip>
      </div>
      {expanded && (
        <div className={styles.details}>
          <div className={styles.grid}>
            <label>
              <span>{t("settings.configName")}</span>
              <input
                value={model.name}
                onChange={(e) => onChange({ name: e.target.value })}
              />
            </label>
            <label>
              <span>{t("settings.modelName")}</span>
              <input
                value={model.model}
                onChange={(e) => onChange({ model: e.target.value })}
              />
            </label>
            <label className={styles.contextLength}>
              <span>{t("settings.contextLength")}</span>
              <div className={styles.numberField}>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  value={Math.round(model.contextLength / 1024)}
                  onChange={(e) =>
                    onChange({
                      contextLength: Math.max(
                        1024,
                        Number(e.target.value || 1) * 1024,
                      ),
                    })
                  }
                />
                <span>K</span>
              </div>
            </label>
            <div className={styles.credentialsRow}>
              <label>
                <span>{t("settings.baseUrl")}</span>
                <input
                  value={model.baseUrl}
                  onChange={(e) => onChange({ baseUrl: e.target.value })}
                />
              </label>
              <label>
                <span>{t("settings.apiKey")}</span>
                <input
                  type="password"
                  value={model.apiKey ?? ""}
                  placeholder={
                    model.hasApiKey ? t("settings.keyStored") : "sk-…"
                  }
                  onChange={(e) => onChange({ apiKey: e.target.value })}
                />
              </label>
            </div>
            <label className={styles.visionToggle}>
              <input
                type="checkbox"
                checked={Boolean(model.supportsVision)}
                onChange={(e) => onChange({ supportsVision: e.target.checked })}
              />
              <span>{t("settings.supportsVision")}</span>
            </label>
          </div>
        </div>
      )}
    </article>
  );
}
