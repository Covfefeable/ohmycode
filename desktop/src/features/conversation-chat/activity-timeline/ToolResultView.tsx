import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownImage } from "../../../shared/ui/image-preview/MarkdownImage";
import type { ToolActivityPresentation } from "./tool-presentation";
import styles from "./ActivityTimeline.module.css";
import { ToolDetailPanel } from "./tool-result/ToolDetailPanel";
import { PlainTextContent, StructuredContent, TerminalContent } from "./tool-result/ResultContent";

const FileDiffViewer = lazy(() => import("./file-diff-viewer/FileDiffViewer").then((module) => ({ default: module.FileDiffViewer })));
const FileContentViewer = lazy(() => import("./file-diff-viewer/FileDiffViewer").then((module) => ({ default: module.FileContentViewer })));

export function ToolResultView({ presentation, completed }: { presentation: ToolActivityPresentation; completed: boolean }) {
  const { t } = useTranslation();
  const { viewer, failed, changes, result, input, resource, rawResult } = presentation;
  const content = !failed && viewer === "image" && completed && presentation.imageSource
    ? <MarkdownImage src={presentation.imageSource} name={presentation.displayResource} />
    : !failed && viewer === "file-diff" && changes.length
      ? <Suspense fallback={<div className={styles.diffLoading}>{t("agent.loadingDiff")}</div>}><FileDiffViewer changes={changes} /></Suspense>
      : !failed && viewer === "file-content" && result
        ? <Suspense fallback={<div className={styles.diffLoading}>{t("agent.loadingFilePreview")}</div>}><FileContentViewer content={result} path={resource} startLine={typeof input.startLine === "number" ? input.startLine : 1} /></Suspense>
        : !failed && presentation.kind === "file" ? <PlainTextContent value={result} />
          : presentation.kind === "terminal" ? <TerminalContent input={input} value={rawResult} />
          : <StructuredContent value={rawResult} />;
  return <ToolDetailPanel input={input} result={rawResult}>{content}</ToolDetailPanel>;
}
