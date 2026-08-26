import { useTranslation } from "react-i18next";
import type { SupportedLanguage } from "../../app/i18n";
import { Select } from "../../shared/ui/select";
import styles from "./LanguageSwitcher.module.css";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const language: SupportedLanguage = i18n.resolvedLanguage?.startsWith("zh") ? "zh-CN" : "en";

  function changeLanguage(nextLanguage: SupportedLanguage) {
    void i18n.changeLanguage(nextLanguage);
  }

  return (
    <label className={styles.field}>
      <span>{t("language.label")}</span>
      <Select ariaLabel={t("language.label")} value={language} options={[
        { value: "zh-CN", label: t("language.zhCN") },
        { value: "en", label: t("language.en") },
      ]} onChange={(value) => changeLanguage(value as SupportedLanguage)} />
    </label>
  );
}
