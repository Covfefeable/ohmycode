import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ImagePreview } from "../../../shared/ui/image-preview/ImagePreview";
import type { ToolActivityPresentation } from "./tool-presentation";
import styles from "./ActivityTimeline.module.css";

const FileDiffViewer = lazy(() => import("./file-diff-viewer/FileDiffViewer").then((module) => ({ default: module.FileDiffViewer })));
const FileContentViewer = lazy(() => import("./file-diff-viewer/FileDiffViewer").then((module) => ({ default: module.FileContentViewer })));

export function ToolResultView({ presentation, completed }: { presentation: ToolActivityPresentation; completed: boolean }) {
  const { t } = useTranslation();
  const { viewer, failed, changes, result, input, resource } = presentation;
  if (!failed) {
    if (viewer === "image") return completed ? <ImagePreview src={presentation.imageSource} name={presentation.displayResource} /> : null;
    if (viewer === "file-diff" && changes.length) return <Suspense fallback={<div className={styles.diffLoading}>{t("agent.loadingDiff")}</div>}><FileDiffViewer changes={changes} /></Suspense>;
    if (viewer === "file-content" && result) return <Suspense fallback={<div className={styles.diffLoading}>{t("agent.loadingFilePreview")}</div>}><FileContentViewer content={result} path={resource} startLine={typeof input.startLine === "number" ? input.startLine : 1} /></Suspense>;
  }
  return result ? <pre className={styles.output}>{result}</pre> : null;
}
