import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../shared/ui/icon-button";
import { Tooltip } from "../../shared/ui/tooltip";

type Theme = "dark" | "light";

export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === "light" ? "light" : "dark");
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ohmycode.theme", next);
    setTheme(next);
  }
  const label = t(theme === "dark" ? "navigation.useLightTheme" : "navigation.useDarkTheme");
  return <Tooltip content={label}><IconButton aria-label={label} onClick={toggle}>{theme === "dark" ? <Sun /> : <Moon />}</IconButton></Tooltip>;
}
