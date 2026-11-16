import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../../shared/ui/icon-button";
import { Tooltip } from "../../../shared/ui/tooltip";

export function WorkspaceChangesButton({ opened, onClick }: { opened: boolean; onClick(): void }) {
  const { t } = useTranslation();
  return <Tooltip content={t("snapshots.title")}><IconButton aria-label={t("snapshots.title")} active={opened} aria-pressed={opened} onClick={onClick}><History /></IconButton></Tooltip>;
}
