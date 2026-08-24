import { useTranslation } from "react-i18next";
import type { SupportedLanguage } from "../../app/i18n";
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
      <select value={language} onChange={(event) => changeLanguage(event.target.value as SupportedLanguage)}>
        <option value="zh-CN">{t("language.zhCN")}</option>
        <option value="en">{t("language.en")}</option>
      </select>
    </label>
  );
}

