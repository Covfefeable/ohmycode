import { useTranslation } from "react-i18next";
import type { SupportedLanguage } from "../../app/i18n";
import { Select } from "../../shared/ui/select";
import styles from "./LanguageSwitcher.module.css";

type Props = { compact?: boolean };

export function LanguageSwitcher({ compact = false }: Props) {
  const { t, i18n } = useTranslation();
  const language: SupportedLanguage = i18n.resolvedLanguage?.startsWith("zh") ? "zh-CN" : "en";

  function changeLanguage(nextLanguage: SupportedLanguage) {
    void i18n.changeLanguage(nextLanguage);
  }

  return (
    <div className={`${styles.field} ${compact ? styles.compact : ""}`}>
      <span>{t("language.label")}</span>
      <Select compact={compact} ariaLabel={t("language.label")} value={language} options={[
        { value: "zh-CN", label: t("language.zhCN") },
        { value: "en", label: t("language.en") },
      ]} onChange={(value) => changeLanguage(value as SupportedLanguage)} />
    </div>
  );
}
