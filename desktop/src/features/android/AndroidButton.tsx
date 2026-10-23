import { Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AndroidState } from "@ohmycode/android-use/types";
import { IconButton } from "../../shared/ui/icon-button";
import { Tooltip } from "../../shared/ui/tooltip";

export function AndroidButton({ state, opened, onToggle }: { state: AndroidState | null; opened: boolean; onToggle(): void }) {
  const { t } = useTranslation();
  if (!state?.adbReady || !state.enabled) return null;
  return <Tooltip content={t("android.title")}><IconButton active={opened} aria-pressed={opened} aria-label={t("android.title")} onClick={onToggle}><Smartphone /></IconButton></Tooltip>;
}
