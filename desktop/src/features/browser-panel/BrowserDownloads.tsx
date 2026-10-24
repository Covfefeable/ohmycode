import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Download, FolderOpen, X } from "lucide-react";
import type { BrowserDownload } from "@ohmycode/browser-use/types";
import { IconButton } from "../../shared/ui/icon-button";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./BrowserDownloads.module.css";

export function BrowserDownloads({ downloads, onShow, onDismiss }: { downloads: BrowserDownload[]; onShow(id: string): void; onDismiss(id: string): void }) {
  const { t } = useTranslation();
  if (!downloads.length) return null;
  return <div className={styles.list}>{downloads.map((download) => {
    const completed = download.state === "completed";
    const progressing = download.state === "progressing";
    const progress = completed ? 100 : download.totalBytes > 0 ? Math.min(100, download.receivedBytes / download.totalBytes * 100) : 0;
    return <div key={download.id} className={styles.row} role="status" style={{ "--download-progress": `${progress}%` } as CSSProperties}>
      <Download className={styles.icon} />
      <span className={styles.filename} title={download.filename}>{download.filename}</span>
      <span className={styles.status}>{t(completed ? "browser.downloadCompleted" : progressing ? "browser.downloading" : "browser.downloadFailed")}{progressing && download.totalBytes > 0 ? ` ${Math.floor(progress)}%` : ""}</span>
      <div className={styles.actions}>
        {completed && <Tooltip content={t("browser.showDownload")}><IconButton className={styles.folder} aria-label={t("browser.showDownload")} onClick={() => onShow(download.id)}><FolderOpen /></IconButton></Tooltip>}
        <Tooltip content={t("browser.dismissDownload")}><IconButton className={styles.folder} aria-label={t("browser.dismissDownload")} onClick={() => onDismiss(download.id)}><X /></IconButton></Tooltip>
      </div>
    </div>;
  })}</div>;
}
