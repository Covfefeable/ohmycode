import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "../shared/locales/en";
import { zhCN } from "../shared/locales/zh-CN";

export const supportedLanguages = ["zh-CN", "en"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

function normalizeLanguage(language: string | null | undefined): SupportedLanguage {
  return language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

const savedLanguage = window.localStorage.getItem("ohmycode.language");
const initialLanguage = normalizeLanguage(savedLanguage ?? window.navigator.language);

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    en: { translation: en },
  },
  lng: initialLanguage,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on("languageChanged", (language) => {
  window.localStorage.setItem("ohmycode.language", normalizeLanguage(language));
  document.documentElement.lang = normalizeLanguage(language);
});

document.documentElement.lang = initialLanguage;

export { i18n };

